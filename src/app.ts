import { SoundDirector } from './audio/director';
import { AudioEngine } from './audio/engine';
import { GamepadInput } from './engine/input/gamepad';
import { Input, ScriptedInput } from './engine/input/input';
import { KeyboardInput } from './engine/input/keyboard';
import { FixedStepper, FrameStats, STEP_SECONDS } from './engine/loop';
import { RenderContext } from './engine/renderer';
import { Game, type GameOptions } from './game/game';
import { LEVELS, getLevel } from './game/levels';
import { Hud } from './ui/hud/hud';
import { TouchControls } from './ui/touch-controls/touch-controls';

/** Frames that stay longer than this lower the render scale, in milliseconds. */
const SLOW_FRAME_MS = 18;
/** Seconds without slow frames before the render scale rises again. */
const RECOVERY_SECONDS = 5;

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
  readonly audio = new AudioEngine();
  readonly sound = new SoundDirector(this.audio);
  /** True while a level is in play, as opposed to a menu. The sound follows it. */
  playing = false;
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
  private flowPaused = false;
  /** Seconds to wait before the render scale may rise again. It grows when a rise fails. */
  private recoverySeconds = RECOVERY_SECONDS;
  private sinceRecovery = Infinity;
  /** Seconds for which frames have run long, and short, for the dynamic resolution. */
  private slowSeconds = 0;
  private fastSeconds = 0;
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
      this.applyPause();
      this.audio.setMuted(document.hidden);
    });
    // Every button gives a short tick.
    ui.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) {
        this.sound.click();
      }
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
    this.sound.attach(game);
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

  /**
   * Pauses or resumes the simulation for the screen flow. The simulation also stands still
   * while the page is hidden, whatever the flow asks for.
   */
  setPaused(paused: boolean): void {
    this.flowPaused = paused;
    this.applyPause();
  }

  private applyPause(): void {
    this.stepper.paused = this.flowPaused || document.hidden;
  }

  /** Shows or hides the head-up display and the touch controls. */
  setPlayUi(visible: boolean): void {
    this.hud.setVisible(visible);
    this.touch.setVisible(visible);
    this.playing = visible;
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
    // A frame of more than 100 ms is a hitch or a background tab, not a slow device.
    if (frameSeconds <= 0.1) {
      this.frameStats.sample(frameSeconds);
    }
    this.adaptResolution(frameSeconds);

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
    this.sound.update(Math.min(frameSeconds, 0.1), this.playing && !this.stepper.paused);
    for (const listener of this.frameListeners) {
      listener(frameSeconds);
    }
  }

  /**
   * Dynamic resolution: when frames stay above 18 ms for a second, the render scale drops by
   * 10 %. After a stretch without slow frames it rises again by one step.
   *
   * The time between two frames never falls below the refresh period of the display, so the
   * recovery cannot wait for fast frames. It tries a higher scale instead, and waits twice as
   * long before the next try when that scale turns out to be too slow.
   */
  private adaptResolution(frameSeconds: number): void {
    if (!this.renderScene || document.hidden || frameSeconds > 0.1) {
      this.slowSeconds = 0;
      this.fastSeconds = 0;
      return;
    }
    const slow = this.frameStats.frameMs > SLOW_FRAME_MS;
    this.slowSeconds = slow ? this.slowSeconds + frameSeconds : 0;
    this.fastSeconds = slow ? 0 : this.fastSeconds + frameSeconds;
    this.sinceRecovery += frameSeconds;
    if (this.slowSeconds > 1) {
      if (this.sinceRecovery < 10) {
        // The last rise did not hold. Be more patient with the next one.
        this.recoverySeconds = Math.min(60, this.recoverySeconds * 2);
      }
      this.render.setScale(this.render.scale - 0.1);
      this.slowSeconds = 0;
    } else if (this.fastSeconds > this.recoverySeconds && this.render.scale < 1) {
      this.render.setScale(this.render.scale + 0.1);
      this.fastSeconds = 0;
      this.sinceRecovery = 0;
    }
  }

  private updateTouchControls(game: Game): void {
    this.hud.setTouchLayout(this.touch.shown);
    const vehicle = game.activeVehicle;
    // On foot the small button reads ENTER next to a vehicle, and hides otherwise.
    const onFoot = vehicle === game.pilot;
    this.touch.setExit(onFoot ? (game.enterTarget ? 'ENTER' : undefined) : 'EXIT');
    this.touch.setAction({
      label: vehicle.spec.actionLabel,
      charge: vehicle.actionCharge,
      active: vehicle.actionActive,
      available: vehicle.spec.actionKind !== 'none',
    });
  }
}
