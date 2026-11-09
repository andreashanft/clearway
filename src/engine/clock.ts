/** Result of advancing the fixed-step clock by one rendered frame. */
export interface ClockAdvance {
  /** Number of fixed simulation steps to run this frame. */
  readonly steps: number;
  /** Fraction (0–1) of a step left over, used to interpolate rendering. */
  readonly alpha: number;
  /** True when the frame was too slow and simulation time was dropped. */
  readonly dropped: boolean;
}

export interface FixedStepClockOptions {
  /** Simulation rate in steps per second. */
  readonly stepHz?: number;
  /** Upper bound on steps per frame, so a slow frame can't snowball. */
  readonly maxStepsPerFrame?: number;
}

/**
 * Accumulates real frame time and turns it into whole fixed simulation steps.
 * Pure and deterministic, so it can be unit tested without a browser.
 */
export class FixedStepClock {
  readonly stepSeconds: number;
  readonly maxStepsPerFrame: number;
  /** Multiplies incoming frame time (debug slow motion, hit-stop). */
  timeScale = 1;
  private accumulator = 0;

  constructor(options: FixedStepClockOptions = {}) {
    const stepHz = options.stepHz ?? 60;
    if (stepHz <= 0) throw new RangeError('stepHz must be positive');
    this.stepSeconds = 1 / stepHz;
    this.maxStepsPerFrame = Math.max(1, Math.floor(options.maxStepsPerFrame ?? 5));
  }

  /** Adds one frame's elapsed real time (in seconds) and reports the steps to run. */
  advance(frameSeconds: number): ClockAdvance {
    const scaled = Math.max(0, frameSeconds) * Math.max(0, this.timeScale);
    this.accumulator += scaled;

    let steps = Math.floor(this.accumulator / this.stepSeconds);
    let dropped = false;
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      dropped = true;
    }
    this.accumulator -= steps * this.stepSeconds;
    if (dropped) {
      // Keep at most one step of backlog so the next frame starts fresh.
      this.accumulator = Math.min(this.accumulator, this.stepSeconds);
    }
    // Guard against floating-point drift leaving a tiny negative remainder.
    if (this.accumulator < 0) this.accumulator = 0;

    return { steps, alpha: this.accumulator / this.stepSeconds, dropped };
  }

  /** Clears any leftover time, for example after the tab was hidden. */
  reset(): void {
    this.accumulator = 0;
  }
}
