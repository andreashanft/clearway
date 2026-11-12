import { GamepadInput } from './engine/input/gamepad';
import { Input, ScriptedInput } from './engine/input/input';
import { KeyboardInput } from './engine/input/keyboard';
import { FixedStepper, FrameStats, STEP_SECONDS } from './engine/loop';
import { RenderContext } from './engine/renderer';
import { Game, type GameOptions } from './game/game';
import { LEVELS, getLevel } from './game/levels';
import { Hud } from './ui/hud/hud';
import { TouchControls } from './ui/touch-controls/touch-controls';

/**
 * The running application: it owns the renderer, the input devices and the current game, and
 * drives the frame loop.
 */
export class App {
  readonly stepper = new FixedStepper();
  readonly frameStats = new FrameStats();
  readonly input = new Input();
  readonly keyboard = new KeyboardInput();
  /** Input that the debug tools and the autoplay control. */
  readonly scripted = new ScriptedInput();
  readonly touch: TouchControls;
  readonly hud: Hud;
  readonly options: GameOptions = {
    cameraShake: 0.45,
    steeringAssist: true,
    patternMarkings: false,
    autoSkid: true,
  };
  /** False while a screen covers the 3D scene completely. The scene is then not drawn. */
  renderScene = true;
  game: Game | undefined;

  private lastTime = 0;
  private readonly frameListeners: ((frameSeconds: number) => void)[] = [];
  private readonly gameListeners: ((game: Game) => void)[] = [];

  private constructor(
    readonly render: RenderContext,
    readonly ui: HTMLElement,
    canvas: HTMLCanvasElement,
  ) {
    this.hud = new Hud(ui, {
      onPause: () => this.scripted.press('pause'),
      onFinish: () => this.game?.finish(),
      onRecenter: () => this.game?.cameraRig.recenter(),
    });
    this.touch = new TouchControls(ui, canvas);
    this.input.add(this.keyboard);
    this.input.add(new GamepadInput());
    this.input.add(this.touch);
    this.input.add(this.scripted);

    render.onResize((width, height) => this.game?.resize(width / height));
    // The simulation pauses while the page is hidden.
    document.addEventListener('visibilitychange', () => {
      this.stepper.paused = document.hidden;
    });
  }

  /** Creates the renderer and starts the frame loop. */
  static async start(
    canvas: HTMLCanvasElement,
    ui: HTMLElement,
    options: { forceWebGL: boolean },
  ): Promise<App> {
    const render = await RenderContext.create(canvas, options);
    const app = new App(render, ui, canvas);
    app.lastTime = performance.now();
    await render.renderer.setAnimationLoop((time) => app.frame(time));
    return app;
  }

  /** Loads a level and makes it the current game. */
  async loadLevel(id: string = LEVELS[0].id): Promise<Game> {
    const game = await Game.create(getLevel(id), this.input, this.options);
    this.game?.dispose();
    this.game = game;
    game.resize(this.render.aspect);
    this.stepper.reset();
    this.hud.attach(game);
    // The crash plays out in slow motion.
    this.stepper.timeScale = 1;
    game.events.on('haulerDestroyed', () => {
      this.stepper.timeScale = 0.25;
    });
    for (const listener of this.gameListeners) {
      listener(game);
    }
    return game;
  }

  /** Shows or hides the head-up display and the touch controls. */
  setPlayUi(visible: boolean): void {
    this.hud.setVisible(visible);
    this.touch.setVisible(visible);
  }

  /** Registers a function that runs whenever a level has been loaded. */
  onGameLoaded(listener: (game: Game) => void): void {
    this.gameListeners.push(listener);
  }

  /** Registers a function that runs once per frame, after the game is drawn. */
  onFrame(listener: (frameSeconds: number) => void): void {
    this.frameListeners.push(listener);
  }

  /**
   * Runs the simulation for a span of game time without waiting for frames, then draws once.
   * The debug tools use it to test the game in a browser tab that is in the background.
   */
  advance(seconds: number): void {
    const game = this.game;
    if (!game) {
      return;
    }
    const steps = Math.round(seconds / STEP_SECONDS);
    for (let i = 0; i < steps; i += 1) {
      game.step(STEP_SECONDS);
    }
    game.sync(1, seconds);
    this.render.renderer.render(game.scene, game.cameraRig.camera);
    this.hud.update(game, game.cameraRig.camera, seconds);
  }

  private frame(time: number): void {
    const frameSeconds = (time - this.lastTime) / 1000;
    this.lastTime = time;
    this.frameStats.sample(frameSeconds);

    const game = this.game;
    if (game) {
      const alpha = this.stepper.advance(frameSeconds, (dt) => game.step(dt));
      if (this.renderScene) {
        game.sync(alpha, Math.min(frameSeconds, 0.1) * (this.stepper.paused ? 0 : 1));
        this.render.renderer.render(game.scene, game.cameraRig.camera);
      }
      this.updateTouchControls(game);
      this.hud.update(game, game.cameraRig.camera, Math.min(frameSeconds, 0.1));
    }
    for (const listener of this.frameListeners) {
      listener(frameSeconds);
    }
  }

  private updateTouchControls(game: Game): void {
    this.hud.setTouchLayout(this.touch.shown);
    const vehicle = game.activeVehicle;
    this.touch.setAction({
      label: vehicle.spec.actionLabel,
      charge: vehicle.actionCharge,
      active: vehicle.actionActive,
      available: vehicle.spec.actionKind !== 'none',
    });
  }
}
