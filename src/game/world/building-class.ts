import type { BuildingClass } from '../level';

/** Height of one floor in metres. The windows go by floors. */
export const FLOOR_HEIGHT = 3;
/** A building taller than this, in metres, is a tower. A tower is cut into stacked sections. */
export const TOWER_HEIGHT = 15;
/** A tower's sections are about this tall: four floors. */
export const SECTION_HEIGHT = 4 * FLOOR_HEIGHT;

/**
 * Returns how many sections are stacked in every column of a building, from its bottom to its
 * roof. A building of at most `TOWER_HEIGHT` has one section, and a taller one at least two.
 *
 * @param height Height of the building from its bottom to its roof, in metres.
 */
export function sectionCount(height: number): number {
  return height > TOWER_HEIGHT ? Math.max(2, Math.round(height / SECTION_HEIGHT)) : 1;
}

/** Sorts a building by its height and footprint area. */
export function classifyBuilding(height: number, area: number): BuildingClass {
  if (height > TOWER_HEIGHT) {
    return 'tower';
  }
  if (height <= 4.5 && area <= 60) {
    return 'shed';
  }
  return height <= 10 && area <= 250 ? 'house' : 'block';
}
