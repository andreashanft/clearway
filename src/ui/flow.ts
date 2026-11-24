import './screens/screens.css';
import type { App } from '../app';
import type { Save, Settings } from '../engine/save';
import type { Game } from '../game/game';
import { el } from './dom';
import { FailScreen } from './screens/fail';
import { HowToPlayScreen } from './screens/how-to-play';
import { PauseScreen } from './screens/pause';
import { ResultsScreen } from './screens/results';
import { SettingsScreen } from './screens/settings';
import { TitleScreen } from './screens/title';
import { YardBar } from './yard-bar';

/** Every state of the screen flow. `playing` shows the head-up display and no screen. */
export type ScreenName =
  'title' | 'playing' | 'paused' | 'failed' | 'results' | 'settings' | 'howto';

/** Screens that cover the 3D scene completely. The scene is not drawn behind them. */
const OPAQUE: ReadonlySet<ScreenName> = new Set(['results', 'settings', 'howto']);

/** Screens on which the simulation runs. On every other screen it stands still. */
const RUNNING: ReadonlySet<ScreenName> = new Set(['playing', 'failed', 'title']);

/** Milliseconds between the crash and the fail screen, so that the explosion shows first. */
const FAIL_DELAY = 900;
/** Milliseconds between the end of the run and the result screen. */
const RESULT_DELAY = 500;

/**
 * The screen flow of the game, as a small state machine:
 *
 * `title → playing ⇄ paused`, and `playing → failed`, or `playing → results` once the Hauler
 * has left. Settings and How to play return to where they were opened from.
 *
 * Until the city map exists, Play leads straight into the test yard.
 */
export class Flow {
  private current: ScreenName = 'title';
  private settingsReturn: ScreenName = 'title';
  private clock = 0;
  private timer: number | undefined;
  private busy = false;

  private readonly title: TitleScreen;
  private readonly pause: PauseScreen;
  private readonly fail: FailScreen;
  private readonly results: ResultsScreen;
  private readonly settings: SettingsScreen;
  private readonly howto: HowToPlayScreen;
  private readonly yardBar: YardBar;
  private readonly loading: HTMLElement;
  private readonly roots: Partial<Record<ScreenName, HTMLElement>>;
  private readonly shell: HTMLElement;

  constructor(
    private readonly app: App,
    private readonly save: Save,
    parent: HTMLElement,
  ) {
    this.shell = parent.parentElement ?? parent;
    this.title = new TitleScreen({
      onPlay: () => this.startPlay(),
      onSettings: () => this.openSettings(),
      onHowToPlay: () => this.go('howto'),
    });
    this.pause = new PauseScreen({
      onResume: () => this.resume(),
      onRestart: () => void this.restart(),
      onSettings: () => this.openSettings(),
      onQuit: () => void this.showTitle(),
    });
    this.fail = new FailScreen({
      onRetry: () => void this.restart(),
      onWatchAgain: () => this.app.game?.replayCrash(),
      onQuit: () => void this.showTitle(),
    });
    this.results = new ResultsScreen({
      onReplay: () => void this.restart(),
      onNext: () => void this.showTitle(),
    });
    this.settings = new SettingsScreen({
      onBack: () => this.go(this.settingsReturn),
      onChange: (changes) => {
        this.save.updateSettings(changes);
        this.applySettings();
      },
    });
    this.howto = new HowToPlayScreen(() => this.go('title'));
    this.yardBar = new YardBar(parent, {
      onVehicle: (type) => this.app.setVehicle(type),
      onCamera: () => this.toggleCamera(),
      onReset: () => void this.restart(),
    });
    this.loading = el('div', {
      className: 'loading',
      attributes: { role: 'status' },
      children: [el('span', { className: 'cw-tag', text: 'LOADING' })],
    });
    this.loading.hidden = true;

    this.roots = {
      title: this.title.root,
      paused: this.pause.root,
      failed: this.fail.root,
      results: this.results.root,
      settings: this.settings.root,
      howto: this.howto.root,
    };
    for (const root of Object.values(this.roots)) {
      root.hidden = true;
      parent.append(root);
    }
    parent.append(this.loading);

    app.onGameLoaded((game) => this.connect(game));
    app.onFrame((frameSeconds) => this.update(frameSeconds));
    this.applySettings();
  }

  /** Shows the title screen, or drops straight into play when `skipTitle` is set. */
  async boot(skipTitle = false): Promise<void> {
    if (skipTitle) {
      if (await this.loadLevel()) {
        this.startPlay();
      }
      return;
    }
    await this.showTitle();
  }

  /** The screen that currently shows. */
  get screen(): ScreenName {
    return this.current;
  }

  private async showTitle(): Promise<void> {
    if (await this.loadLevel()) {
      this.go('title');
    }
  }

  private startPlay(): void {
    this.app.game?.start();
    this.go('playing');
  }

  private pauseGame(): void {
    if (this.current === 'playing') {
      this.go('paused');
    }
  }

  private resume(): void {
    this.go('playing');
  }

  private async restart(): Promise<void> {
    if (await this.loadLevel(true)) {
      this.startPlay();
    }
  }

  private openSettings(): void {
    this.settingsReturn = this.current;
    this.go('settings');
  }

  private toggleCamera(): void {
    this.save.updateSettings({ chaseCamera: !this.save.settings.chaseCamera });
    this.applySettings();
  }

  /**
   * Loads the area unless it is already loaded and has not started yet.
   *
   * @returns False when another load is still running. The caller must then do nothing.
   */
  private async loadLevel(force = false): Promise<boolean> {
    if (this.busy) {
      return false;
    }
    if (!force && this.app.game?.phase === 'ready') {
      return true;
    }
    this.busy = true;
    this.loading.hidden = false;
    window.clearTimeout(this.timer);
    try {
      // Let the browser paint the loading tag before the area builds.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await this.app.loadLevel();
    } finally {
      this.loading.hidden = true;
      this.busy = false;
    }
    return true;
  }

  /** Listens to a freshly loaded area. */
  private connect(game: Game): void {
    game.events.on('pauseRequested', () => this.pauseGame());
    game.events.on('cameraToggled', () => this.toggleCamera());
    game.events.on('haulerDestroyed', ({ hit, cause, obstaclesCleared, obstaclesTotal }) => {
      this.vibrate([60, 40, 140]);
      this.timer = window.setTimeout(() => {
        // The player may have left the area, or loaded it again, in the meantime.
        if (this.app.game === game && this.current === 'playing') {
          this.fail.show(hit, cause, obstaclesCleared, obstaclesTotal);
          this.go('failed');
        }
      }, FAIL_DELAY);
    });
    game.events.on('levelEnded', ({ result }) => {
      const outcome = this.save.recordResult(game.level.id, result);
      this.timer = window.setTimeout(() => {
        if (this.app.game === game && this.current === 'playing') {
          this.results.show(game.level, result, outcome, false);
          this.go('results');
        }
      }, RESULT_DELAY);
    });
    game.events.on('impact', ({ strength, broke }) => {
      this.vibrate(Math.round(strength * (broke ? 45 : 25)));
    });
    game.events.on('explosion', () => this.vibrate(70));
  }

  /** Switches to a screen and puts the app into the matching state. */
  private go(screen: ScreenName): void {
    const previous = this.current;
    this.current = screen;
    for (const [name, root] of Object.entries(this.roots)) {
      root.hidden = name !== screen;
    }
    const { app } = this;
    const playing = screen === 'playing';
    app.setPlayUi(playing);
    this.yardBar.setVisible(playing && app.game?.level.id === 'yard');
    // The area only runs during play and while the crash plays out. The title needs running
    // time for its camera, and its run has not started yet.
    app.setPaused(!RUNNING.has(screen));
    app.renderScene = !OPAQUE.has(screen);
    this.shell.classList.toggle('is-paused', screen === 'paused');
    this.shell.classList.toggle('is-failed', screen === 'failed');
    if (screen !== 'failed') {
      app.stepper.timeScale = 1;
    }
    if (app.game) {
      // The title shows the area without markings.
      app.game.showMarkers = screen !== 'title';
    }
    switch (screen) {
      case 'title':
        this.title.show();
        break;
      case 'paused':
        if (previous === 'playing' && app.game) {
          this.pause.show(app.game.secondsToImpact, app.game.secondsUntilHaulerLeaves);
        }
        break;
      case 'settings':
        this.settings.show(this.save.settings);
        break;
      case 'howto':
        this.howto.show();
        break;
      case 'playing':
        // A focused button would swallow the Space key.
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        break;
      default:
        break;
    }
  }

  /** Runs once per frame. */
  private update(frameSeconds: number): void {
    this.clock += frameSeconds;
    const { game } = this.app;
    if (this.current === 'title') {
      game?.setBackdrop(this.clock);
    } else if (this.current === 'playing' && game) {
      this.yardBar.update(game, this.save.settings.chaseCamera);
    }
    if (this.current !== 'playing' && this.current !== 'failed') {
      // The game does not read input in a menu, so the pause key works as Back here.
      const input = this.app.input.poll();
      if (input.pressed.has('pause')) {
        this.back();
      }
    }
  }

  /** The Escape key and the Start button: leave the current menu. */
  private back(): void {
    switch (this.current) {
      case 'paused':
        this.resume();
        break;
      case 'settings':
        this.go(this.settingsReturn);
        break;
      case 'howto':
        this.go('title');
        break;
      default:
        break;
    }
  }

  /** Applies the stored settings to the running app. */
  private applySettings(): void {
    const settings: Readonly<Settings> = this.save.settings;
    const { app } = this;
    app.options.cameraShake = settings.fullCameraShake ? 1 : 0.45;
    app.options.patternMarkings = settings.patternMarkings;
    app.options.chaseCamera = settings.chaseCamera;
    app.hud.setMinimapVisible(settings.minimap);
    app.touch.setLeftHanded(settings.leftHanded);
    app.audio.setVolumes({
      effects: settings.effectsVolume / 100,
      voice: settings.voiceVolume / 100,
    });
    app.hud.setSubtitles(settings.subtitles);
  }

  private vibrate(pattern: number | number[]): void {
    // Browsers block vibration until the player has touched the page.
    const touched = navigator.userActivation?.hasBeenActive ?? true;
    if (this.save.settings.haptics && touched && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  }
}
