import type { Route } from '../route';

/**
 * Finds route obstacles by sweeping the Hauler's front sensor along its route and testing
 * it against building footprints. Pure geometry with no physics, so levels can be checked
 * by scripts and tests as well as by the game.
 */

/** Hauler dimensions shared by the model, the physics body and the sweep. */
export const HAULER = {
  length: 11,
  width: 3.8,
  /** Depth of the sensor box ahead of the nose. */
  sensorDepth: 1.2,
  /** Extra width on each side so near misses still count. */
  sensorMargin: 0.2,
} as const;

/** A rectangle on the ground: centre, half extents and rotation about the vertical. */
export interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  /** Anticlockwise rotation seen from above, in radians (Three.js rotation.y). */
  readonly yaw: number;
}

export interface SweepTarget {
  readonly id: string;
  /** Targets with the same group form one obstacle. */
  readonly group: string;
  readonly footprint: Footprint;
}

export interface RouteObstacle {
  /** The group id: a building id, or a shared group such as "twin-silos". */
  readonly id: string;
  readonly memberIds: readonly string[];
  /** Nose distance along the route when the sensor first touches the obstacle. */
  readonly distance: number;
}

/** Axes of a footprint: local x and z directions in world space. */
function axes(f: Footprint): [[number, number], [number, number]] {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  // rotation.y maps local x to (cos, −sin) and local z to (sin, cos) in (x, z).
  return [
    [c, -s],
    [s, c],
  ];
}

/** Separating-axis test for two ground rectangles. */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  const [ax, az] = axes(a);
  const [bx, bz] = axes(b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ux, uz] of [ax, az, bx, bz]) {
    const ra =
      a.halfX * Math.abs(ax[0] * ux + ax[1] * uz) + a.halfZ * Math.abs(az[0] * ux + az[1] * uz);
    const rb =
      b.halfX * Math.abs(bx[0] * ux + bx[1] * uz) + b.halfZ * Math.abs(bz[0] * ux + bz[1] * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

/** The sensor's footprint when the Hauler's nose is `noseDistance` along the route. */
export function sensorFootprint(route: Route, noseDistance: number): Footprint {
  const s = route.sampleAt(noseDistance + HAULER.sensorDepth / 2);
  // Local z runs along the direction of travel.
  return {
    x: s.x,
    z: s.z,
    halfX: HAULER.width / 2 + HAULER.sensorMargin,
    halfZ: HAULER.sensorDepth / 2,
    yaw: Math.atan2(s.dx, s.dz),
  };
}

/**
 * Sweeps the sensor from the route start to its end and returns every obstacle in the
 * order the Hauler would meet it.
 */
export function sweepRoute(
  route: Route,
  targets: readonly SweepTarget[],
  step = 0.25,
): RouteObstacle[] {
  const firstHit = new Map<string, number>();
  const remaining = new Set(targets);
  for (let d = 0; d <= route.length && remaining.size > 0; d += step) {
    const sensor = sensorFootprint(route, d);
    for (const target of remaining) {
      const reach = Math.hypot(target.footprint.halfX, target.footprint.halfZ) + HAULER.width;
      if (Math.hypot(target.footprint.x - sensor.x, target.footprint.z - sensor.z) > reach)
        continue;
      if (footprintsOverlap(sensor, target.footprint)) {
        firstHit.set(target.id, d);
        remaining.delete(target);
      }
    }
  }
  const groups = new Map<string, { members: string[]; distance: number }>();
  for (const target of targets) {
    const d = firstHit.get(target.id);
    if (d === undefined) continue;
    const group = groups.get(target.group);
    if (group) {
      group.members.push(target.id);
      group.distance = Math.min(group.distance, d);
    } else {
      groups.set(target.group, { members: [target.id], distance: d });
    }
  }
  return [...groups.entries()]
    .map(([id, g]) => ({ id, memberIds: g.members, distance: g.distance }))
    .sort((a, b) => a.distance - b.distance);
}
