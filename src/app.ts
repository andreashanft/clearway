import { PhysicsLines } from './debug/physics-lines';
import { DebugOverlay } from './debug/overlay';
import { EventBus } from './engine/events';
import type { LaunchFlags } from './engine/flags';
import { InputManager } from './engine/input/input-manager';
import { GameLoop } from './engine/loop';
import { Physics, type Rapier } from './engine/physics';
import type { Renderer } from './engine/renderer';
import type { GameEvents } from './game/events';
import { Game } from './game/game';
import { findLevel, type LevelDefinition, LEVELS } from './game/level-data';
import type { UiCommands } from './ui/commands';
import { Hud } from './ui/hud/hud';
import { CameraGestures } from './ui/touch-controls/camera-gestures';
import { TouchControls } from './ui/touch-controls/touch-controls';

/**
 * The application shell: owns the renderer, input, UI and loop, and runs one level at a
 * time with a fresh physics world, so Retry and Next start clean.
 */
export class App {
  readonly bus = new EventBus<GameEvents>();
  readonly commands = new EventBus<UiCommands>();
  readonly input: InputManager;
  readonly loop: GameLoop;
  private readonly hud: Hud;
  private game: Game | null = null;
  private physics: Physics | null = null;
  private level: LevelDefinition | null = null;
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
    this.input = new InputManager(renderer.three.domElement);
    const touchControls = new TouchControls(ui, this.input.touch, this.bus);
    new CameraGestures(renderer.three.domElement, this.input.touch);
    this.input.onSourceChange((source) => {
      touchControls.setVisible(source === 'touch');
    });
    this.hud = new Hud(ui, this.bus, this.commands);

    renderer.onResize((viewport) => this.game?.setViewport(viewport));

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
        game.render(alpha, frameSeconds);
        this.hud.update(frameSeconds);
        this.physicsLines?.update();
        renderer.render(game.scene, game.camera.camera);
        this.overlay?.update(frameSeconds);
      },
    });

    this.commands.on('retry', () => {
      if (this.level) void this.start(this.level);
    });
    this.commands.on('finish', () => this.game?.finish());
    this.commands.on('next', () => {
      const index = LEVELS.findIndex((l) => l.id === this.level?.id);
      const next = LEVELS[index + 1] ?? LEVELS[0];
      if (next) void this.start(next);
    });
    this.commands.on('quit', () => {
      const first = LEVELS[0];
      if (first) void this.start(first);
    });

    if (flags.debug) this.createDebugTools();
  }

  get currentGame(): Game | null {
    return this.game;
  }

  get currentPhysics(): Physics | null {
    return this.physics;
  }

  /** Starts (or restarts) a level from scratch. */
  async start(level: LevelDefinition): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.loop.stop();
      this.game?.dispose();
      this.physics?.dispose();
      this.physicsLines?.dispose();
      this.physicsLines = null;
      this.input.reset();
      this.hud.reset();
      this.level = level;
      this.physics = new Physics(this.rapier);
      const game = new Game(this.physics, this.input, this.bus);
      this.game = game;
      await game.load(level);
      game.setViewport(this.renderer.viewport);
      const session = game.levelSession;
      if (session) session.invincible = this.invincible;
      this.loop.start();
    } finally {
      this.loading = false;
    }
  }

  /** The level named by `?level=`, or the first one. */
  initialLevel(): LevelDefinition {
    const level = (this.flags.level ? findLevel(this.flags.level) : undefined) ?? LEVELS[0];
    if (!level) throw new Error('No levels found');
    return level;
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
      return `SESSION ${session.phase}  t ${session.elapsed.toFixed(1)} s  next ${next ? `${next.id} @ ${next.distance.toFixed(0)} m` : '–'}  ${countdown === null ? '' : `${countdown.toFixed(1)} s`}`;
    });
    overlay.addSelect(
      'Level',
      LEVELS.map((l) => ({ value: l.id, label: `${l.index}. ${l.name}` })),
      this.initialLevel().id,
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
