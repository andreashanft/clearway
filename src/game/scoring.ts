import type { Strength } from './level';
import { STRENGTH_HP } from './world/damage';

export type Medal = 'none' | 'bronze' | 'silver' | 'gold';

/** What the player achieved by the time the level ended. */
export interface LevelTally {
  /** True when every route obstacle fell before the Hauler arrived. */
  pathCleared: boolean;
  obstaclesCleared: number;
  obstaclesTotal: number;
  buildingsDestroyed: number;
  buildingsTotal: number;
  beaconsLit: number;
  beaconsTotal: number;
  dishFound: boolean;
  /** Seconds from the level start until the path was clear. */
  clearSeconds: number;
  /** Seconds of bonus time that the fast clear earned. */
  bonusSeconds: number;
  /** Points from destroyed segments, beacons and the dish. */
  points: number;
}

export interface MedalRules {
  /** Fraction of the buildings that silver needs. */
  silverBuildings: number;
  /** Fraction of the beacons that silver needs. */
  silverBeacons: number;
}

/** What a player still needs for gold. */
export interface GoldGap {
  buildings: number;
  beacons: number;
  dish: boolean;
}

export interface LevelResult extends LevelTally {
  medal: Medal;
  score: number;
  forGold: GoldGap;
}

/** Points for one destroyed building segment: its hit points. */
export function segmentPoints(strength: Strength): number {
  return STRENGTH_HP[strength];
}

export const BEACON_POINTS = 50;
export const DISH_POINTS = 1000;
/** Points for each second of bonus time. */
const BONUS_POINTS_PER_SECOND = 20;

/**
 * Awards the medal.
 *
 * Bronze: the path is clear. Silver: the path, 80 % of the buildings and 80 % of the beacons.
 * Gold: every building, every beacon and the relay dish.
 */
export function medalFor(tally: Readonly<LevelTally>, rules: Readonly<MedalRules>): Medal {
  if (!tally.pathCleared) {
    return 'none';
  }
  const buildings =
    tally.buildingsTotal === 0 ? 1 : tally.buildingsDestroyed / tally.buildingsTotal;
  const beacons = tally.beaconsTotal === 0 ? 1 : tally.beaconsLit / tally.beaconsTotal;
  if (buildings >= 1 && beacons >= 1 && tally.dishFound) {
    return 'gold';
  }
  if (buildings >= rules.silverBuildings && beacons >= rules.silverBeacons) {
    return 'silver';
  }
  return 'bronze';
}

/** Builds the result of a level from its tally. */
export function scoreLevel(tally: Readonly<LevelTally>, rules: Readonly<MedalRules>): LevelResult {
  return {
    ...tally,
    medal: medalFor(tally, rules),
    score: tally.points + Math.round(tally.bonusSeconds) * BONUS_POINTS_PER_SECOND,
    forGold: {
      buildings: tally.buildingsTotal - tally.buildingsDestroyed,
      beacons: tally.beaconsTotal - tally.beaconsLit,
      dish: !tally.dishFound,
    },
  };
}

const MEDAL_RANK: Record<Medal, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };

/** Returns the better of two medals. */
export function betterMedal(a: Medal, b: Medal): Medal {
  return MEDAL_RANK[a] >= MEDAL_RANK[b] ? a : b;
}

/** Formats seconds as `m:ss`. */
export function formatTime(seconds: number): string {
  // The small offset keeps a time such as 29.9999 s, which is 30 s with rounding noise, at 0:30.
  const whole = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
