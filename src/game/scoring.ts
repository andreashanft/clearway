export type Medal = 'bronze' | 'silver' | 'gold';

/** What the player achieved in one run of a level. */
export interface LevelStats {
  readonly pathCleared: boolean;
  /** Seconds from the Hauler starting to the last obstacle falling. */
  readonly clearTime: number | null;
  readonly buildingsDestroyed: number;
  readonly buildingsTotal: number;
  readonly beaconsFound: number;
  readonly beaconsTotal: number;
  readonly dishFound: boolean;
  /** False for levels without a relay dish yet. */
  readonly dishExists: boolean;
  /** Points for everything destroyed and found. */
  readonly score: number;
}

/** Share needed for silver, from the brief. */
export const SILVER_SHARE = 0.8;

function share(found: number, total: number): number {
  return total <= 0 ? 1 : found / total;
}

/**
 * Bronze for clearing the path; silver for the path plus 80% of buildings and beacons;
 * gold for every building, every beacon and the relay dish.
 */
export function medalFor(stats: LevelStats): Medal | null {
  if (!stats.pathCleared) return null;
  const buildings = share(stats.buildingsDestroyed, stats.buildingsTotal);
  const beacons = share(stats.beaconsFound, stats.beaconsTotal);
  const dish = stats.dishFound || !stats.dishExists;
  if (buildings >= 1 && beacons >= 1 && dish) return 'gold';
  if (buildings >= SILVER_SHARE && beacons >= SILVER_SHARE) return 'silver';
  return 'bronze';
}

export interface Shortfall {
  readonly buildings: number;
  readonly beacons: number;
  readonly dish: boolean;
}

/** How many more buildings and beacons (and whether the dish) a better medal needs. */
export function shortfallFor(stats: LevelStats, medal: 'silver' | 'gold'): Shortfall {
  const need = (total: number, found: number): number =>
    Math.max(0, Math.ceil((medal === 'gold' ? 1 : SILVER_SHARE) * total - 1e-9) - found);
  return {
    buildings: need(stats.buildingsTotal, stats.buildingsDestroyed),
    beacons: need(stats.beaconsTotal, stats.beaconsFound),
    dish: medal === 'gold' && stats.dishExists && !stats.dishFound,
  };
}

/** Orders medals so a better result can replace a saved one. */
export function medalRank(medal: Medal | null): number {
  return medal === 'gold' ? 3 : medal === 'silver' ? 2 : medal === 'bronze' ? 1 : 0;
}
