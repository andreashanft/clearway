import type { Strength } from './damage';
import type { BuildingStyle } from './world/building-styles';

/** Points for a destroyed building, by strength. */
export const BUILDING_POINTS: Readonly<Record<Strength, number>> = {
  shed: 50,
  house: 100,
  brick: 250,
  concrete: 500,
};

/** Small structures are worth less than their strength suggests. */
const STYLE_POINTS: Partial<Record<BuildingStyle, number>> = {
  fence: 20,
  bales: 30,
  container: 80,
};

/** Points for knocking over scenery. */
export const PROP_POINTS: Readonly<Record<string, number>> = {
  tree: 10,
  pine: 10,
  bush: 5,
  rock: 5,
};

export const BEACON_POINTS = 25;
export const DISH_POINTS = 500;
export const PATH_CLEAR_POINTS = 1000;

/** Points for destroying a building of this style and strength. */
export function buildingPoints(style: BuildingStyle, strength: Strength): number {
  return STYLE_POINTS[style] ?? BUILDING_POINTS[strength];
}

/** Points for knocking over a prop; unknown props score nothing. */
export function propPoints(type: string): number {
  return PROP_POINTS[type] ?? 0;
}

/** A score with thin-space thousands separators, such as "12 450". */
export function formatScore(points: number): string {
  return Math.round(points)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
