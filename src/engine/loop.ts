/** Length of one simulation step in seconds. The game simulates at a fixed 60 Hz. */
export const STEP_SECONDS = 1 / 60;

/** The longest frame the loop accepts. A longer frame, for example after a tab switch, is cut. */
const MAX_FRAME_SECONDS = 0.25;

/** The most simulation steps the loop runs for one frame, so that a slow device cannot stall. */
const MAX_STEPS_PER_FRAME = 5;

/**
 * Turns variable frame times into fixed simulation steps.
 *
 * The stepper keeps the time that is not yet simulated in an accumulator. It reports how far the
 * current frame lies between the last two steps, so that the renderer can interpolate.
 */
export class FixedStepper {
  /** Multiplies the speed of the simulation. The debug overlay and the slow-motion replay use it. */
  timeScale = 1;

  /** When true, time does not advance. */
  paused = false;

  private accumulator = 0;

  /**
   * Adds one frame of real time and runs the simulation steps that are due.
   *
   * @param frameSeconds Real time since the previous frame, in seconds.
   * @param step Called once for each fixed step with the step length in seconds.
   * @returns The interpolation factor from 0 to 1 between the previous and the current step.
   */
  advance(frameSeconds: number, step: (dt: number) => void): number {
    if (this.paused) {
      return 1;
    }
    const frame = Math.min(Math.max(frameSeconds, 0), MAX_FRAME_SECONDS);
    this.accumulator += frame * this.timeScale;

    let steps = 0;
    while (this.accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
      step(STEP_SECONDS);
      this.accumulator -= STEP_SECONDS;
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_FRAME) {
      // The device cannot keep up. Drop the backlog so that the game slows down and does not stall.
      this.accumulator = Math.min(this.accumulator, STEP_SECONDS);
    }
    return this.accumulator / STEP_SECONDS;
  }

  /** Discards time that is not yet simulated, for example when a level restarts. */
  reset(): void {
    this.accumulator = 0;
  }
}

/** Smoothed frame statistics for the debug overlay and the dynamic resolution. */
export class FrameStats {
  /** Smoothed frame time in milliseconds. */
  frameMs = 16.7;

  /** Smoothed frames per second. */
  get fps(): number {
    return 1000 / this.frameMs;
  }

  /** Feeds the duration of one frame, in seconds, into the running average. */
  sample(frameSeconds: number): void {
    const ms = frameSeconds * 1000;
    this.frameMs += (ms - this.frameMs) * 0.08;
  }
}
