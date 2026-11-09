import { PhysicsLines } from './debug/physics-lines';
import { DebugOverlay } from './debug/overlay';
import { AudioEngine } from './engine/audio';
import { DynamicResolution } from './engine/dynamic-resolution';
import { EventBus } from './engine/events';
import type { LaunchFlags } from './engine/flags';
import { InputManager } from './engine/input/input-manager';
import { GameLoop } from './engine/loop';
import { Physics, type Rapier } from './engine/physics';
import type { Renderer } from './engine/renderer';
import { browserStorage, load, save, type Storage } from './engine/save';
import { CAMPAIGN, campaignLevel } from './game/campaign';
import { type AudioScene, GameAudio } from './game/audio/game-audio';
import type { GameEvents } from './game/events';
import { Game } from './game/game';
import { findLevel, type LevelDefinition, LEVELS } from './game/level-data';
import {
  type GraphicsQuality,
  isUnlocked,
  medalPoints,
  recordRun,
  SAVE_SCHEMA,
  type SaveData,
  type Settings,
} from './game/progress';
import { medalFor } from './game/scoring';
import type { UiCommands } from './ui/commands';
import { Hud } from './ui/hud/hud';
import { button, h } from './ui/kit';
import {
  briefingScreen,
  campaignScreen,
  countdownScreen,
  failScreen,
  pauseScreen,
  resultsScreen,
  rotateScreen,
  type Screen,
  settingsScreen,
  titleScreen,
} from './ui/screens/screens';
import { CameraGestures } from './ui/touch-controls/camera-gestures';
import { TouchControls } from './ui/touch-controls/touch-controls';

type Flow =
  | 'title'
  | 'campaign'
  | 'briefing'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'failed'
  | 'results'
  | 'settings'
  | 'help';

const VEHICLE_NAMES: Readonly<Record<string, string>> = {
  bruiser: 'Bruiser',
  fishtail: 'Fishtail',
  liftoff: 'Liftoff',
  tumbler: 'Tumbler',
  railbed: 'Railbed',
};

/** The part of the Battery Status API this uses. */
interface BatteryLike extends EventTarget {
  readonly charging: boolean;
}

/** The sound scene for each step of the flow; settings and help keep the scene they opened over. */
function audioSceneFor(flow: Flow, returnTo: Flow): AudioScene {
  switch (flow) {
    case 'briefing':
    case 'countdown':
      return 'briefing';
    case 'playing':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'failed':
      return 'failed';
    case 'results':
      return 'results';
    case 'settings':
    case 'help':
      return returnTo === 'paused' ? 'paused' : 'menu';
    default:
      return 'menu';
  }
}

/** Beacon and relay dish lines for the pause screen. */
function pickupText(
  p: { found: number; total: number; dish: boolean; dishExists: boolean } | undefined,
): { beacons: string; dish: string } {
  if (!p) return { beacons: '–', dish: '–' };
  return {
    beacons: p.total > 0 ? `${p.found} / ${p.total}` : '–',
    dish: !p.dishExists ? '–' : p.dish ? 'FOUND' : 'NOT FOUND',
  };
}

/** Device pixel ratio cap and shadow map size for each graphics quality. */
const QUALITY: Readonly<Record<GraphicsQuality, { dpr: number; shadows: number }>> = {
  low: { dpr: 1, shadows: 0 },
  medium: { dpr: 1.5, shadows: 1024 },
  high: { dpr: 2, shadows: 2048 },
  ultra: { dpr: 3, shadows: 2048 },
};

/**
 * The application shell: owns the renderer, input, UI and loop, moves between screens,
 * and runs one level at a time with a fresh physics world, so Retry and Next start clean.
 */
export class App {
  readonly bus = new EventBus<GameEvents>();
  readonly commands = new EventBus<UiCommands>();
  readonly input: InputManager;
  readonly loop: GameLoop;
  private readonly hud: Hud;
  private readonly touchControls: TouchControls;
  private readonly audio = new AudioEngine();
  private readonly dynamicResolution = new DynamicResolution();
  private readonly sound: GameAudio;
  private readonly screenLayer: HTMLElement;
  private readonly storage: Storage | null = browserStorage();
  private data: SaveData;
  private game: Game | null = null;
  private physics: Physics | null = null;
  private level: LevelDefinition | null = null;
  private flow: Flow = 'title';
  private screen: Screen | null = null;
  private returnTo: Flow = 'title';
  private sceneHidden = false;
  /** True once the loaded level has been played and needs a fresh copy for the backdrop. */
  private dirty = false;
  private rotateShown = false;
  private overlay: DebugOverlay | null = null;
  private physicsLines: PhysicsLines | null = null;
  private invincible = false;
  private debugTimeScale = 1;
  private loading = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly rapier: Rapier,
    private readonly ui: HTMLElement,
    private readonly flags: LaunchFlags,
  ) {
    this.data = load(SAVE_SCHEMA, this.storage);
    this.input = new InputManager(renderer.three.domElement);
    this.touchControls = new TouchControls(ui, this.input.touch, this.bus);
    new CameraGestures(renderer.three.domElement, this.input.touch);
    this.hud = new Hud(ui, this.bus, this.commands);
    this.sound = new GameAudio(this.audio, this.bus);
    // Every menu and HUD button clicks.
    ui.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) this.sound.click();
    });
    this.screenLayer = h('div', { class: 'cw-screens' });
    ui.append(this.screenLayer);
    this.input.onSourceChange((source) => {
      this.hud.setInputSource(source);
      this.updateControlsVisibility();
    });

    renderer.onResize((viewport) => {
      this.game?.setViewport(viewport);
      this.checkOrientation();
    });

    this.loop = new GameLoop({
      beginFrame: () => {
        this.game?.beginFrame();
        this.loop.clock.timeScale = this.debugTimeScale * (this.game?.timeScale ?? 1);
      },
      step: (dt) => {
        const { game, physics } = this;
        if (!game || !physics) return;
        game.step(dt);
        physics.step(dt);
        game.afterStep();
      },
      render: (alpha, frameSeconds) => {
        const { game } = this;
        if (!game) return;
        if (!this.loop.paused) {
          game.render(alpha, frameSeconds);
          this.hud.update(frameSeconds);
        }
        if (this.flow === 'playing') {
          const scale = this.dynamicResolution.update(frameSeconds);
          if (scale !== null) renderer.renderScale = scale;
        }
        this.screen?.update?.();
        this.physicsLines?.update();
        if (!this.sceneHidden) renderer.render(game.scene, game.camera.camera);
        this.overlay?.update(frameSeconds);
      },
    });

    this.bindEvents();
    this.applySettings();
    this.capFrameRateOnBattery();
    if (flags.debug) this.createDebugTools();
  }

  /**
   * Renders at most 60 fps on battery: the simulation runs at 60 Hz anyway, so a 120 Hz
   * screen only adds interpolated frames. Where the Battery API is missing (Safari,
   * Firefox), phones and tablets count as on battery.
   */
  private capFrameRateOnBattery(): void {
    this.loop.maxFps = matchMedia('(pointer: coarse)').matches ? 60 : 0;
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    nav
      .getBattery?.()
      .then((battery) => {
        const apply = (): void => {
          this.loop.maxFps = battery.charging ? 0 : 60;
        };
        apply();
        battery.addEventListener('chargingchange', apply);
      })
      .catch(() => undefined);
  }

  get currentGame(): Game | null {
    return this.game;
  }

  get currentPhysics(): Physics | null {
    return this.physics;
  }

  /** Shows the title over a live Hollow Creek, or jumps straight into `?level=`. */
  async boot(): Promise<void> {
    const direct = this.flags.level ? findLevel(this.flags.level) : undefined;
    if (direct) {
      await this.loadLevel(direct);
      this.beginPlay();
      return;
    }
    await this.showTitle();
  }

  /** Starts (or restarts) a level straight into play, skipping the briefing. */
  async start(level: LevelDefinition): Promise<void> {
    await this.loadLevel(level);
    this.beginPlay();
  }

  // Flow ----------------------------------------------------------------------

  private async showTitle(): Promise<void> {
    const backdrop = LEVELS[0];
    if (!backdrop) return;
    if (!this.game || this.dirty || this.level?.id !== backdrop.id) await this.loadLevel(backdrop);
    this.game?.setMode('attract');
    this.setFlow('title');
    this.show(
      titleScreen(
        {
          version: __APP_VERSION__,
          levels: CAMPAIGN.length,
          medals: medalPoints(this.data.levels),
          maxMedals: CAMPAIGN.length * 3,
          vehicles: 4,
        },
        {
          play: () => this.showCampaign(),
          settings: () => this.openSettings(),
          howToPlay: () => this.showHelp(),
        },
      ),
    );
  }

  private showCampaign(): void {
    this.setFlow('campaign');
    const order = CAMPAIGN.map((l) => l.id);
    let nextMarked = false;
    const entries = CAMPAIGN.map((level) => {
      const record = this.data.levels[level.id];
      const unlocked = isUnlocked(order, this.data.levels, level.id);
      const available = findLevel(level.id) !== undefined;
      const isNext = unlocked && available && !record?.medal && !nextMarked;
      if (isNext) nextMarked = true;
      const before = CAMPAIGN[level.index - 2];
      return {
        level,
        record,
        unlocked,
        available,
        isNext,
        unlockHint: !available
          ? 'COMING SOON'
          : `BRONZE ON L${String(before?.index ?? 1)} TO UNLOCK`,
      };
    });
    this.show(
      campaignScreen(
        entries,
        {
          medals: medalPoints(this.data.levels),
          maxMedals: CAMPAIGN.length * 3,
          cleared: Object.values(this.data.levels).filter((r) => r.medal).length,
        },
        {
          back: () => void this.showTitle(),
          brief: (id) => void this.openBriefing(id),
        },
      ),
      true,
    );
  }

  private async openBriefing(id: string): Promise<void> {
    const def = findLevel(id);
    const level = campaignLevel(id);
    if (!def || !level) return;
    this.show(null);
    await this.loadLevel(def);
    const game = this.game;
    if (!game) return;
    game.setMode('briefing');
    this.setFlow('briefing');
    const session = game.levelSession;
    const firstHit = (session?.obstacles[0]?.distance ?? 0) / def.hauler.speed;
    // Every machine in the level, including the Railbed on its rails.
    const vehicles = [
      ...new Set([
        ...def.vehicles.map(
          (v) => `${VEHICLE_NAMES[v.type] ?? v.type}${v.lockedBy ? ' (locked)' : ''}`,
        ),
        ...(def.rail ? [VEHICLE_NAMES.railbed ?? 'Railbed'] : []),
      ]),
    ];
    this.show(
      briefingScreen(
        {
          level,
          description: def.description ?? level.tagline,
          firstHit,
          best: this.data.levels[id]?.medal ?? null,
          vehicles,
          tnt: def.tnt?.length ?? 0,
        },
        () => game.flyoverProgress,
        {
          back: () => this.showCampaign(),
          skip: () => game.skipFlyover(),
          start: () => this.countdown(),
        },
      ),
    );
  }

  /** 3-2-1, then play. The scene shows the player's vehicle while the clock is frozen. */
  private countdown(): void {
    const game = this.game;
    if (!game) return;
    game.setMode('play');
    this.loop.paused = true;
    this.setFlow('countdown');
    const overlay = countdownScreen();
    this.show(overlay);
    let n = 3;
    overlay.show(n);
    const tick = (): void => {
      if (this.flow !== 'countdown') return;
      n--;
      overlay.show(n);
      if (n > 0) {
        window.setTimeout(tick, 700);
      } else {
        window.setTimeout(() => {
          if (this.flow === 'countdown') this.beginPlay(true);
        }, 450);
      }
    };
    window.setTimeout(tick, 700);
  }

  private beginPlay(alreadyInPlayMode = false): void {
    const game = this.game;
    if (!game) return;
    if (!alreadyInPlayMode) game.setMode('play');
    this.dirty = true;
    this.loop.paused = false;
    this.setFlow('playing');
    this.show(null);
    this.checkOrientation();
  }

  private pause(): void {
    if (this.flow !== 'playing') return;
    this.loop.paused = true;
    this.input.reset();
    this.setFlow('paused');
    const session = this.game?.levelSession;
    this.show(
      pauseScreen(
        () => ({
          countdown: session?.countdown ?? null,
          obstaclesCleared: session?.obstacles.filter((o) => o.cleared).length ?? 0,
          obstaclesTotal: session?.obstacles.length ?? 0,
          ...pickupText(this.game?.pickupProgress),
          score: session?.score ?? 0,
        }),
        {
          resume: () => this.resume(),
          restart: () => this.restart(),
          settings: () => this.openSettings(),
          quit: () => this.quitToMap(),
        },
      ),
    );
  }

  private resume(): void {
    this.loop.paused = false;
    this.setFlow('playing');
    this.show(null);
  }

  private restart(): void {
    if (!this.level) return;
    void this.openBriefing(this.level.id);
  }

  private quitToMap(): void {
    this.loop.paused = false;
    this.showCampaign();
  }

  private onFailed(info: GameEvents['hauler:destroyed']): void {
    this.setFlow('failed');
    const tip = this.level?.tips?.[info.hit.toLowerCase().replace(/ /g, '-')] ?? null;
    this.show(
      failScreen(
        { ...info, tip },
        {
          retry: () => {
            if (this.level) void this.start(this.level);
          },
          quit: () => this.quitToMap(),
        },
      ),
    );
  }

  private onResults({ stats, medal }: GameEvents['session:results']): void {
    const level = this.level ? campaignLevel(this.level.id) : undefined;
    if (!this.level || !level) return;
    const previous = this.data.levels[this.level.id];
    const newBest =
      stats.clearTime !== null &&
      (previous?.bestTime === null ||
        previous?.bestTime === undefined ||
        stats.clearTime < previous.bestTime);
    this.data = {
      ...this.data,
      levels: { ...this.data.levels, [this.level.id]: recordRun(previous, stats) },
    };
    save(SAVE_SCHEMA, this.storage, this.data);
    const next = CAMPAIGN[level.index];
    this.setFlow('results');
    if (medal) this.sound.music.stinger('medal');
    this.show(
      resultsScreen(
        {
          level,
          stats,
          medal,
          newBest,
          previousBestScore: previous?.bestScore ?? 0,
          obstaclesTotal: this.game?.levelSession?.obstacles.length ?? 0,
          hasNext:
            next !== undefined && findLevel(next.id) !== undefined && medalFor(stats) !== null,
        },
        {
          keepExploring: () => {
            this.game?.levelSession?.resumeFreeRoam();
            this.setFlow('playing');
            this.show(null);
          },
          replay: () => this.restart(),
          next: () => this.showCampaign(),
        },
      ),
      true,
    );
  }

  private openSettings(): void {
    this.returnTo = this.flow;
    this.setFlow('settings');
    this.show(
      settingsScreen(
        () => this.data.settings,
        (patch) => this.updateSettings(patch),
        () => this.closeSettings(),
      ),
      true,
    );
  }

  private closeSettings(): void {
    if (this.returnTo === 'paused') {
      this.flow = 'playing';
      this.pause();
    } else {
      void this.showTitle();
    }
  }

  private showHelp(): void {
    this.returnTo = this.flow;
    this.setFlow('help');
    const row = (key: string, what: string): HTMLElement =>
      h(
        'div',
        { class: 'cw-setting' },
        h('div', { class: 'cw-setting__label', text: key }),
        h('div', { class: 'cw-setting__desc', text: what }),
      );
    const element = h(
      'section',
      {
        class: 'cw-screen cw-screen--dim',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How to play' },
      },
      h(
        'div',
        { class: 'cw-card cw-dialog' },
        h('h1', { class: 'cw-heading', text: 'How to play' }),
        h('p', {
          class: 'cw-body',
          text: 'The Hauler drives a fixed route and explodes if it touches anything solid. Demolish every building on its path before it arrives, then flatten the rest for a better medal.',
        }),
        row('Touch', 'Point the left stick where you want to go. Action and Brake on the right.'),
        row(
          'Keyboard',
          'WASD to drive, Space for Action, Shift to brake, Q/R and the wheel for the camera.',
        ),
        row('Gamepad', 'Left stick to point, triggers for gas and brake, A for Action.'),
        button('GOT IT', 'primary', () => void this.showTitle()),
      ),
    );
    this.show({ element });
  }

  // Helpers -------------------------------------------------------------------

  private async loadLevel(level: LevelDefinition): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.loop.stop();
      this.loop.paused = false;
      this.game?.dispose();
      this.physics?.dispose();
      this.physicsLines?.dispose();
      this.physicsLines = null;
      this.input.reset();
      this.hud.reset(
        level.name,
        level.buildings?.length ?? 0,
        (level.beacons?.trails ?? []).reduce((sum, trail) => sum + trail.count, 0),
        level.relayDish !== undefined,
      );
      this.level = level;
      this.dirty = false;
      this.physics = new Physics(this.rapier);
      const settings = this.data.settings;
      const game = new Game(this.physics, this.input, this.bus, {
        difficulty: settings.easyMode ? 'easy' : 'normal',
        steeringAssist: settings.steeringAssist,
        autoSkid: settings.autoSkid,
      });
      this.game = game;
      game.onPauseRequested = () => this.pause();
      await game.load(level);
      game.setViewport(this.renderer.viewport);
      game.setShadowQuality(this.quality().shadows);
      game.setPatternMarkings(this.data.settings.patternMarkings);
      game.setFullShake(this.data.settings.fullShake);
      const session = game.levelSession;
      if (session) session.invincible = this.invincible;
      this.loop.start();
    } finally {
      this.loading = false;
    }
  }

  private show(screen: Screen | null, coversScene = false): void {
    this.screen?.element.remove();
    this.screen = screen;
    this.sceneHidden = coversScene;
    if (screen) this.screenLayer.append(screen.element);
  }

  private setFlow(flow: Flow): void {
    this.flow = flow;
    this.sound.setScene(audioSceneFor(flow, this.returnTo));
    const inLevel = flow === 'playing' || flow === 'countdown' || flow === 'paused';
    this.hud.setVisible(inLevel);
    document.getElementById('app')?.classList.toggle('is-paused', flow === 'paused');
    this.updateControlsVisibility();
  }

  private updateControlsVisibility(): void {
    this.touchControls.setVisible(this.flow === 'playing' && this.input.source === 'touch');
  }

  /** Phones in portrait pause gameplay behind the "rotate device" card. */
  private checkOrientation(): void {
    const portraitPhone =
      this.input.source === 'touch' &&
      window.innerHeight > window.innerWidth &&
      window.innerWidth < 600;
    if (
      portraitPhone &&
      (this.flow === 'playing' || this.flow === 'countdown') &&
      !this.rotateShown
    ) {
      this.rotateShown = true;
      this.loop.paused = true;
      this.show(
        rotateScreen(
          () => this.game?.levelSession?.countdown ?? null,
          () => {
            this.rotateShown = false;
            this.quitToMap();
          },
        ),
      );
    } else if (!portraitPhone && this.rotateShown) {
      this.rotateShown = false;
      this.resume();
    }
  }

  private quality(): { dpr: number; shadows: number } {
    const choice = this.data.settings.graphics;
    const coarse = matchMedia('(pointer: coarse)').matches;
    return QUALITY[choice === 'auto' ? (coarse ? 'medium' : 'high') : choice];
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.data = { ...this.data, settings: { ...this.data.settings, ...patch } };
    save(SAVE_SCHEMA, this.storage, this.data);
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.data.settings;
    document.documentElement.style.setProperty('--cw-hud-scale', String(s.hudScale));
    document.documentElement.dataset.patterns = String(s.patternMarkings);
    this.touchControls.setLayout(s.controlLayout, s.leftHanded);
    this.hud.setMinimapVisible(s.minimap);
    const quality = this.quality();
    this.renderer.setMaxPixelRatio(quality.dpr);
    this.game?.setShadowQuality(quality.shadows);
    this.game?.setSteeringAssist(s.steeringAssist);
    this.game?.setPatternMarkings(s.patternMarkings);
    this.game?.setFullShake(s.fullShake);
    this.audio.setVolumes({ music: s.music, sfx: s.sfx, voice: s.voice });
    this.sound.tension = s.tensionMusic;
  }

  private bindEvents(): void {
    this.bus.on('hauler:destroyed', (info) => this.onFailed(info));
    this.bus.on('session:results', (results) => this.onResults(results));
    this.bus.on('impact', ({ strength }) => {
      // Not every browser has vibrate (Safari on iOS doesn't).
      // Browsers only allow vibration after the player has touched the page.
      const touched = navigator.userActivation.hasBeenActive;
      if (this.data.settings.haptics && strength > 0.3 && touched && 'vibrate' in navigator) {
        navigator.vibrate(Math.round(20 + strength * 60));
      }
    });
    this.commands.on('pause', () => this.pause());
    this.commands.on('finish', () => this.game?.finish());
    this.commands.on('recentre', () => this.game?.recentre());
    this.commands.on('retry', () => {
      if (this.level) void this.start(this.level);
    });
    this.commands.on('quit', () => this.quitToMap());
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape') return;
      if (this.flow === 'paused') this.resume();
      else if (this.flow === 'settings' || this.flow === 'help') this.closeSettings();
    });
    window.addEventListener('orientationchange', () => this.checkOrientation());
  }

  private createDebugTools(): void {
    const overlay = new DebugOverlay(this.ui, {
      renderer: this.renderer,
      physics: () => this.physics,
      clock: this.loop.clock,
    });
    this.overlay = overlay;
    overlay.setTimeScaleHandler((value) => {
      this.debugTimeScale = value;
    });
    overlay.addReadout(() => {
      const v = this.game?.activeVehicle;
      if (!v) return '';
      const kmh = (v.forwardSpeed * 3.6).toFixed(0).padStart(4);
      return `VEHICLE ${v.spec.name} ${kmh} km/h  steer ${v.drive.steer.toFixed(2)}  throttle ${v.drive.throttle.toFixed(2)}`;
    });
    overlay.addReadout(() => {
      const session = this.game?.levelSession;
      if (!session) return '';
      const next = session.next;
      const countdown = session.countdown;
      return `SESSION ${this.flow}/${session.phase}  t ${session.elapsed.toFixed(1)} s  next ${next ? `${next.id} @ ${next.distance.toFixed(0)} m` : '–'}  ${countdown === null ? '' : `${countdown.toFixed(1)} s`}`;
    });
    overlay.addSelect(
      'Level',
      LEVELS.map((l) => ({ value: l.id, label: `${l.index}. ${l.name}` })),
      this.flags.level ?? LEVELS[0]?.id ?? '',
      (id) => {
        const level = findLevel(id);
        if (level) void this.start(level);
      },
    );
    overlay.addToggle('Invincible Hauler', false, (on) => {
      this.invincible = on;
      const session = this.game?.levelSession;
      if (session) session.invincible = on;
    });
    overlay.addToggle('Colliders', false, (on) => {
      if (on && this.game && this.physics) {
        this.physicsLines = new PhysicsLines(this.physics, this.game.scene);
      } else {
        this.physicsLines?.dispose();
        this.physicsLines = null;
      }
    });
    overlay.addButton('Finish free roam', () => this.game?.finish());
    overlay.addButton('Print arrivals', () => {
      const session = this.game?.levelSession;
      const speed = this.level?.hauler.speed ?? 1;
      if (!session) return;
      console.table(
        session.obstacles.map((o) => ({
          obstacle: o.id,
          distance: Math.round(o.distance),
          arrives: `${(o.distance / speed).toFixed(1)} s`,
          target: this.level?.targets?.[o.id] ?? '–',
        })),
      );
    });
    // Handy for poking at the game from the browser console.
    Object.assign(window, { clearway: this });
  }
}
