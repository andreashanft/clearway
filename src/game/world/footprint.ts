import type { Footprint } from '../hauler/route-sweep';
import type { BuildingDefinition } from './buildings';

/** A building's ground rectangle, as used by the route sweep. */
export function footprintOf(def: Pick<BuildingDefinition, 'pos' | 'size' | 'yaw'>): Footprint {
  return {
    x: def.pos[0],
    z: def.pos[1],
    halfX: def.size[0] / 2,
    halfZ: def.size[2] / 2,
    yaw: ((def.yaw ?? 0) * Math.PI) / 180,
  };
}
