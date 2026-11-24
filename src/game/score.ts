/*
 * The points for destruction: every break scores by the volume that fell, quick breaks one after
 * another raise a combo multiplier, and breaks that a falling tower caused earn a chain bonus.
 */

/** Points for the reference house of 800 m³. */
export const HOUSE_POINTS = 100;
const HOUSE_VOLUME = 800;
/** Points grow with the volume to this power, so that a tower is worth a lot but not everything. */
const POINTS_EXPONENT = 0.7;
/** A combo lasts this many seconds after the latest break. */
export const COMBO_SECONDS = 3;
/** Every this many breaks in a combo raise the multiplier by one. */
export const BREAKS_PER_STEP = 3;
export const MAX_MULTIPLIER = 8;
/** Each collapse that led to a break adds this share of the points. */
export const CHAIN_BONUS = 0.5;

/** Returns the points for a break of a volume in cubic metres, before the multipliers. */
export function breakPoints(volume: number): number {
  const points = HOUSE_POINTS * Math.max(0, volume / HOUSE_VOLUME) ** POINTS_EXPONENT;
  return Math.max(10, Math.round(points / 5) * 5);
}

/** What one break earned. */
export interface Award {
  points: number;
  multiplier: number;
  chain: number;
}

/** Keeps the score and the combo of a run. */
export class ScoreKeeper {
  total = 0;
  /** Breaks in the current combo. */
  breaks = 0;
  /** Seconds left before the combo ends. */
  comboSeconds = 0;

  /** The multiplier that the next break gets. */
  get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.breaks / BREAKS_PER_STEP));
  }

  /** The share of the combo time that is left, from 0 to 1, for the HUD. */
  get comboShare(): number {
    return this.breaks > 0 ? this.comboSeconds / COMBO_SECONDS : 0;
  }

  /**
   * Scores one break.
   *
   * @param volume Volume that fell, in cubic metres.
   * @param chain How many tower collapses led to the break.
   */
  award(volume: number, chain: number): Award {
    const multiplier = this.multiplier;
    const points = Math.round(breakPoints(volume) * multiplier * (1 + CHAIN_BONUS * chain));
    this.total += points;
    this.breaks += 1;
    this.comboSeconds = COMBO_SECONDS;
    return { points, multiplier, chain };
  }

  /** Adds points that have no multiplier, for example for a beacon. */
  add(points: number): void {
    this.total += points;
  }

  /** Lets the combo run down. Call it once per simulation step. */
  update(dt: number): void {
    if (this.breaks === 0) {
      return;
    }
    this.comboSeconds -= dt;
    if (this.comboSeconds <= 0) {
      this.comboSeconds = 0;
      this.breaks = 0;
    }
  }
}
