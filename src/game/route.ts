import type { BuildingData, HaulerData } from './level';
import { DEG, boxCorners, headingVector, type OrientedBox, type Vec2 } from './math';
import { segmentBoxes, segmentLayout } from './world/segments';

/** Size of the Hauler in metres. */
export const HAULER_LENGTH = 26;
export const HAULER_WIDTH = 8;
/** The swept strip is this much wider than the Hauler on each side. */
const STRIP_MARGIN = 0.4;

/** The straight line that the Hauler drives. Distances along it start at the Hauler's front. */
export interface Route {
  start: Vec2;
  /** Heading in radians. */
  heading: number;
  direction: Vec2;
  length: number;
  speed: number;
  /** Half the width of the strip that the Hauler sweeps. */
  halfWidth: number;
}

/** One building segment that stands in the Hauler's strip. */
export interface RouteSegment {
  buildingId: string;
  segmentIndex: number;
  /** Route distance at which the Hauler's front reaches the segment. */
  enter: number;
  /** Route distance at which the Hauler's front leaves the segment. */
  exit: number;
}

/** Something that the Hauler would hit: one building, or a group of buildings. */
export interface RouteObstacle {
  /** Building id or group. */
  id: string;
  /** Name in lower case, for example "farmhouse". */
  name: string;
  /** Route distance at which the Hauler first touches the obstacle. */
  distance: number;
  segments: RouteSegment[];
}

export function createRoute(hauler: HaulerData): Route {
  const heading = hauler.heading * DEG;
  return {
    start: hauler.start,
    heading,
    direction: headingVector(heading),
    length: hauler.length,
    speed: hauler.speed,
    halfWidth: HAULER_WIDTH / 2 + STRIP_MARGIN,
  };
}

/** Returns the point on the route at a distance. */
export function routePoint(route: Route, distance: number): Vec2 {
  return [
    route.start[0] + route.direction[0] * distance,
    route.start[1] + route.direction[1] * distance,
  ];
}

/** Converts a world point into route coordinates: distance along the line, and offset to the right. */
export function toRoute(route: Route, point: Vec2): Vec2 {
  const dx = point[0] - route.start[0];
  const dz = point[1] - route.start[1];
  return [
    dx * route.direction[0] + dz * route.direction[1],
    -dx * route.direction[1] + dz * route.direction[0],
  ];
}

/**
 * Finds the stretch of the route on which the Hauler's strip overlaps a polygon.
 *
 * @param polygon Corners of a convex polygon in world coordinates.
 * @returns The enter and exit distances, or `undefined` when the strip misses the polygon.
 */
export function sweepPolygon(route: Route, polygon: readonly Vec2[]): [number, number] | undefined {
  // Clip the polygon to the strip, in route coordinates, one edge of the strip after the other.
  let points = polygon.map((corner) => toRoute(route, corner));
  for (const side of [1, -1]) {
    const clipped: Vec2[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      const currentInside = current[1] * side <= route.halfWidth;
      const nextInside = next[1] * side <= route.halfWidth;
      if (currentInside) {
        clipped.push(current);
      }
      if (currentInside !== nextInside) {
        const t = (route.halfWidth * side - current[1]) / (next[1] - current[1]);
        clipped.push([current[0] + (next[0] - current[0]) * t, route.halfWidth * side]);
      }
    }
    points = clipped;
    if (points.length === 0) {
      return undefined;
    }
  }
  let enter = Infinity;
  let exit = -Infinity;
  for (const [distance] of points) {
    enter = Math.min(enter, distance);
    exit = Math.max(exit, distance);
  }
  if (exit < 0 || enter > route.length) {
    return undefined;
  }
  return [enter, exit];
}

/** Corners of the footprint of a segment. A round footprint becomes an octagon. */
export function footprintPolygon(box: OrientedBox, round: boolean): Vec2[] {
  if (!round) {
    return boxCorners(box);
  }
  const radius = Math.min(box.half[0], box.half[1]);
  const corners: Vec2[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    // The octagon encloses the circle.
    const reach = radius / Math.cos(Math.PI / 8);
    corners.push([
      box.center[0] + Math.cos(angle) * reach,
      box.center[1] + Math.sin(angle) * reach,
    ]);
  }
  return corners;
}

/**
 * Sweeps the Hauler's footprint along its line and lists what stands in the way.
 *
 * The order and the timing of the obstacles are computed here. They are never authored.
 */
export function findObstacles(route: Route, buildings: readonly BuildingData[]): RouteObstacle[] {
  const byId = new Map<string, RouteObstacle>();
  for (const building of buildings) {
    const layout = segmentLayout(building);
    segmentBoxes(building, layout).forEach((box, segmentIndex) => {
      const range = sweepPolygon(route, footprintPolygon(box, layout.round));
      if (!range) {
        return;
      }
      const id = building.group ?? building.id;
      let obstacle = byId.get(id);
      if (!obstacle) {
        obstacle = { id, name: building.name, distance: Infinity, segments: [] };
        byId.set(id, obstacle);
      }
      obstacle.segments.push({
        buildingId: building.id,
        segmentIndex,
        enter: range[0],
        exit: range[1],
      });
      obstacle.distance = Math.min(obstacle.distance, Math.max(0, range[0]));
    });
  }
  return [...byId.values()].sort((a, b) => a.distance - b.distance);
}

/** Seconds until the Hauler's front reaches a route distance. */
export function secondsUntil(route: Route, haulerDistance: number, distance: number): number {
  return Math.max(0, distance - haulerDistance) / route.speed;
}

/** How urgent the next obstacle is. The pointer takes its colour from it. */
export type Urgency = 'calm' | 'warning' | 'critical';

/** Under this many seconds to impact, the pointer turns amber. */
export const WARNING_SECONDS = 15;
/** Under this many seconds to impact, the pointer turns red and pulses. */
export const CRITICAL_SECONDS = 5;

export function urgencyOf(secondsToImpact: number): Urgency {
  if (secondsToImpact < CRITICAL_SECONDS) {
    return 'critical';
  }
  return secondsToImpact < WARNING_SECONDS ? 'warning' : 'calm';
}
