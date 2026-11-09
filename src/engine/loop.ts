import { FixedStepClock, type FixedStepClockOptions } from './clock';

export interface LoopHandlers {
  /** Runs once per rendered frame before any simulation steps, for example to read input. */
  beginFrame?(frameSeconds: number): void;
  /** Runs one fixed simulation step of `dt` seconds. */
  step(dt: number): void;
  /** Draws a frame; `alpha` (0–1) interpolates between the last two steps. */
  render(alpha: number, frameSeconds: number): void;
}

/** Longest real frame the loop accepts, so a breakpoint or a hitch can't explode the sim. */
const MAX_FRAME_SECONDS = 0.25;

/**
 * Drives a fixed-step simulation from `requestAnimationFrame` and pauses itself while
 * the page is hidden.
 */
export class GameLoop {
  readonly clock: FixedStepClock;
  private frameHandle = 0;
  private lastTime = -1;
  private running = false;
  private hiddenPause = false;
  /** While paused the loop keeps rendering (for menus over the scene) but runs no steps. */
  paused = false;
  /** Highest frame rate to render at, or 0 for the display's own rate. */
  maxFps = 0;

  constructor(
    private readonly handlers: LoopHandlers,
    options: FixedStepClockOptions = {},
  ) {
    this.clock = new FixedStepClock(options);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    this.clock.reset();
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onFrame = (time: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.onFrame);
    // On a 120 Hz screen, skip every other frame when capped (with a little slack for
    // timer jitter); the fixed-step simulation is unaffected.
    if (this.maxFps > 0 && this.lastTime >= 0 && time - this.lastTime < 1000 / this.maxFps - 2) {
      return;
    }

    const frameSeconds =
      this.lastTime < 0 ? 0 : Math.min((time - this.lastTime) / 1000, MAX_FRAME_SECONDS);
    this.lastTime = time;

    if (this.paused) {
      this.clock.reset();
      this.handlers.render(1, frameSeconds);
      return;
    }
    this.handlers.beginFrame?.(frameSeconds);
    const { steps, alpha } = this.clock.advance(frameSeconds);
    for (let i = 0; i < steps; i++) this.handlers.step(this.clock.stepSeconds);
    this.handlers.render(alpha, frameSeconds);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden && this.running) {
      this.hiddenPause = true;
      this.stop();
    } else if (!document.hidden && this.hiddenPause) {
      this.hiddenPause = false;
      this.start();
    }
  };
}
