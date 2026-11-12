import './screens/screens.css';
import type { App } from '../app';
import type { Save, Settings } from '../engine/save';
import type { Game } from '../game/game';
import { LEVELS, getLevel } from '../game/levels';
import { el } from './dom';
import { BriefingScreen } from './screens/briefing';
import { CampaignScreen } from './screens/campaign';
import { FailScreen } from './screens/fail';
import { HowToPlayScreen } from './screens/how-to-play';
import { PauseScreen } from './screens/pause';
import { ResultsScreen } from './screens/results';
import { SettingsScreen } from './screens/settings';
import { TitleScreen } from './screens/title';

/** Every state of the screen flow. `playing` shows the head-up display and no screen. */
export type ScreenName =
  | 'title'
  | 'campaign'
  | 'briefing'
  | 'playing'
  | 'paused'
  | 'failed'
  | 'results'
  | 'settings'
  | 'howto';

/** Screens that cover the 3D scene completely. The scene is not drawn behind them. */
const OPAQUE: ReadonlySet<ScreenName> = new Set(['campaign', 'results', 'settings', 'howto']);

/** Screens on which the simulation runs. On every other screen it stands still. */
const RUNNING: ReadonlySet<ScreenName> = new Set(['playing', 'failed', 'title', 'briefing']);

/** Milliseconds between the crash and the fail screen, so that the explosion shows first. */
const FAIL_DELAY = 900;
/** Milliseconds between the end of the level and the result screen. */
const RESULT_DELAY = 500;

/**
 * The screen flow of the game, as a small state machine:
 *
 * `title → campaign → briefing → playing ⇄ paused`, and
 * `playing → failed`, or `playing → results` once the Hauler has left.
 * Settings and How to play return to where they were opened from.
 */
export class Flow {
  private current: ScreenName = 'title';
  private settingsReturn: ScreenName = 'title';
  private levelId = LEVELS[0].id;
  private clock = 0;
  private timer: number | undefined;
  private busy = false;

  private readonly title: TitleScreen;
  private readonly campaign: CampaignScreen;
  private readonly briefing: BriefingScreen;
  private readonly pause: PauseScreen;
  private readonly fail: FailScreen;
  private readonly results: ResultsScreen;
  private readonly settings: SettingsScreen;
  private readonly howto: HowToPlayScreen;
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
      onPlay: () => this.go('campaign'),
      onSettings: () => this.openSettings(),
      onHowToPlay: () => this.go('howto'),
    });
    this.campaign = new CampaignScreen(LEVELS, {
      onBack: () => void this.showTitle(),
      onOpenLevel: (id) => void this.openBriefing(id),
    });
    this.briefing = new BriefingScreen({
      onBack: () => this.go('campaign'),
      onStart: () => this.startPlay(),
      onFlyover: (progress) => this.app.game?.setFlyover(progress),
    });
    this.pause = new PauseScreen({
      onResume: () => this.resume(),
      onRestart: () => void this.restart(),
      onSettings: () => this.openSettings(),
      onQuit: () => this.go('campaign'),
    });
    this.fail = new FailScreen({
      onRetry: () => void this.restart(),
      onWatchAgain: () => this.app.game?.replayCrash(),
      onQuit: () => this.go('campaign'),
    });
    this.results = new ResultsScreen({
      onReplay: () => void this.openBriefing(this.levelId),
      onNext: () => this.go('campaign'),
    });
    this.settings = new SettingsScreen({
      onBack: () => this.go(this.settingsReturn),
      onChange: (changes) => {
        this.save.updateSettings(changes);
        this.applySettings();
      },
    });
    this.howto = new HowToPlayScreen(() => this.go('title'));
    this.loading = el('div', {
      className: 'loading',
      attributes: { role: 'status' },
      children: [el('span', { className: 'cw-tag', text: 'LOADING' })],
    });
    this.loading.hidden = true;

    this.roots = {
      title: this.title.root,
      campaign: this.campaign.root,
      briefing: this.briefing.root,
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

  /** Shows the title screen, or drops straight into a level when `levelId` is given. */
  async boot(levelId?: string): Promise<void> {
    if (levelId) {
      this.levelId = getLevel(levelId).id;
      if (await this.loadLevel(this.levelId)) {
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
    // The backdrop is the level that the player plays next.
    const ids = LEVELS.map((level) => level.id);
    const next = LEVELS.find(
      (level) => this.save.isUnlocked(level.id, ids) && !this.save.isCleared(level.id),
    );
    if (await this.loadLevel((next ?? LEVELS[0]).id)) {
      this.go('title');
    }
  }

  private async openBriefing(levelId: string): Promise<void> {
    if (await this.loadLevel(levelId)) {
      this.levelId = levelId;
      this.go('briefing');
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
    if (await this.loadLevel(this.levelId, true)) {
      this.startPlay();
    }
  }

  private openSettings(): void {
    this.settingsReturn = this.current;
    this.go('settings');
  }

  /**
   * Loads a level unless it is already loaded and has not started yet.
   *
   * @returns False when another load is still running. The caller must then do nothing.
   */
  private async loadLevel(levelId: string, force = false): Promise<boolean> {
    if (this.busy) {
      return false;
    }
    const game = this.app.game;
    if (!force && game && game.level.id === levelId && game.phase === 'ready') {
      return true;
    }
    this.busy = true;
    this.loading.hidden = false;
    window.clearTimeout(this.timer);
    try {
      // Let the browser paint the loading tag before the level builds.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await this.app.loadLevel(levelId);
    } finally {
      this.loading.hidden = true;
      this.busy = false;
    }
    return true;
  }

  /** Listens to a freshly loaded level. */
  private connect(game: Game): void {
    game.events.on('pauseRequested', () => this.pauseGame());
    game.events.on('haulerDestroyed', ({ hit, cause, obstaclesCleared, obstaclesTotal }) => {
      this.vibrate([60, 40, 140]);
      this.timer = window.setTimeout(() => {
        // The player may have left the level, or loaded another one, in the meantime.
        if (this.app.game === game && this.current === 'playing') {
          this.fail.show(hit, cause, obstaclesCleared, obstaclesTotal);
          this.go('failed');
        }
      }, FAIL_DELAY);
    });
    game.events.on('levelEnded', ({ result }) => {
      const outcome = this.save.recordResult(game.level.id, result);
      const hasNext = LEVELS.some((level) => level.index === game.level.index + 1);
      this.timer = window.setTimeout(() => {
        if (this.app.game === game && this.current === 'playing') {
          this.results.show(game.level, result, outcome, hasNext);
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
    // The level only runs during play and while the crash plays out. The title and the briefing
    // need running time for their camera, and their level has not started yet.
    app.setPaused(!RUNNING.has(screen));
    app.renderScene = !OPAQUE.has(screen);
    this.shell.classList.toggle('is-paused', screen === 'paused');
    this.shell.classList.toggle('is-failed', screen === 'failed');
    if (screen !== 'failed') {
      app.stepper.timeScale = 1;
    }
    if (app.game) {
      // The title shows the diorama without markings.
      app.game.showMarkers = screen !== 'title';
    }
    // Menus have their own quiet groove. During play the game state picks the music.
    if (screen === 'failed' || screen === 'results') {
      app.sound.setMenuMood('off');
    } else if (screen !== 'playing' && screen !== 'paused') {
      app.sound.setMenuMood('menu');
    }

    switch (screen) {
      case 'title': {
        const ids = LEVELS.map((level) => level.id);
        this.title.show(ids.filter((id) => this.save.isCleared(id)).length, ids.length);
        break;
      }
      case 'campaign':
        this.campaign.show(this.save);
        break;
      case 'briefing':
        this.briefing.show(getLevel(this.levelId), this.save.record(this.levelId));
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
    if (this.current === 'briefing') {
      this.briefing.update(frameSeconds);
    } else if (this.current === 'title') {
      // The title backdrop drifts slowly along the middle of the Hauler's line.
      this.app.game?.setFlyover(0.46 + 0.1 * Math.sin(this.clock * 0.12));
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
      case 'campaign':
        void this.showTitle();
        break;
      case 'briefing':
        this.go('campaign');
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
    app.options.steeringAssist = settings.steeringAssist;
    app.options.patternMarkings = settings.patternMarkings;
    app.options.autoSkid = settings.autoSkid;
    app.hud.setMinimapVisible(settings.minimap);
    app.touch.setLeftHanded(settings.leftHanded);
    app.touch.setClassic(settings.touchLayout === 'classic');
    app.keyboard.classic = settings.touchLayout === 'classic';
    app.audio.setVolumes({
      music: settings.musicVolume / 100,
      effects: settings.effectsVolume / 100,
      voice: settings.voiceVolume / 100,
    });
    app.sound.tensionMusic = settings.tensionMusic;
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
