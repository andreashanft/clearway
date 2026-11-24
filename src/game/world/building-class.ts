import type { BuildingClass } from '../level';

/** Height of one floor in metres. Windows and the collapse of a tower go by floors. */
export const FLOOR_HEIGHT = 3;
/** A building taller than this, in metres, is a tower: it falls as a whole, floor by floor. */
export const TOWER_HEIGHT = 15;

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
