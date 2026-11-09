export interface DynamicResolutionOptions {
  /** Drop the render scale when frames take longer than this, in milliseconds. */
  readonly slowMs: number;
  /** Raise it again when frames are faster than this. */
  readonly fastMs: number;
  /** Size of each change. */
  readonly step: number;
  readonly min: number;
  /** Seconds of slow frames before dropping, and of fast frames before raising. */
  readonly dropAfter: number;
  readonly raiseAfter: number;
  /**
   * A display locked to 60 Hz never shows frames under 14 ms, however light the load.
   * After this many seconds without a slow frame the scale tries one step up anyway;
   * if that brings slow frames back, it drops again and waits twice as long next time.
   */
  readonly probeAfter: number;
}

/** From the brief: drop by 10% steps above 18 ms, recover below 14 ms. */
export const DEFAULT_DYNAMIC_RESOLUTION: DynamicResolutionOptions = {
  slowMs: 18,
  fastMs: 14,
  step: 0.1,
  min: 0.5,
  dropAfter: 0.5,
  raiseAfter: 2,
  probeAfter: 6,
};

/** Frames longer than this are hitches (a tab switch, a level load) and are ignored. */
const HITCH_MS = 250;
const LONGEST_PROBE = 60;

/**
 * Picks a render scale from measured frame times, so a busy moment on a phone costs
 * sharpness instead of frame rate.
 */
export class DynamicResolution {
  scale = 1;
  private average = 1000 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private steadyFor = 0;
  private probeAfter: number;
  private probing = false;

  constructor(private readonly options: DynamicResolutionOptions = DEFAULT_DYNAMIC_RESOLUTION) {
    this.probeAfter = options.probeAfter;
  }

  /** Feeds one frame's duration; returns the new scale when it changes, otherwise null. */
  update(frameSeconds: number): number | null {
    const ms = frameSeconds * 1000;
    if (ms <= 0 || ms > HITCH_MS) return null;
    const o = this.options;
    this.average += (ms - this.average) * 0.15;

    if (this.average > o.slowMs) {
      this.slowFor += frameSeconds;
      this.fastFor = 0;
      this.steadyFor = 0;
    } else {
      this.slowFor = 0;
      this.steadyFor += frameSeconds;
      this.fastFor = this.average < o.fastMs ? this.fastFor + frameSeconds : 0;
    }

    if (this.slowFor >= o.dropAfter && this.scale > o.min) {
      // A probe that brought slow frames back: wait longer before the next one.
      if (this.probing) this.probeAfter = Math.min(LONGEST_PROBE, this.probeAfter * 2);
      this.probing = false;
      return this.change(-o.step);
    }
    if (this.scale < 1 && this.fastFor >= o.raiseAfter) {
      this.probing = false;
      return this.change(o.step);
    }
    if (this.scale < 1 && this.steadyFor >= this.probeAfter) {
      this.probing = true;
      return this.change(o.step);
    }
    return null;
  }

  private change(by: number): number {
    this.scale = Math.round(Math.min(1, Math.max(this.options.min, this.scale + by)) * 100) / 100;
    this.slowFor = 0;
    this.fastFor = 0;
    this.steadyFor = 0;
    return this.scale;
  }
}
