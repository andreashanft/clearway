/** A point or direction on the ground plane: `[x, z]` in metres. X points east, Z points south. */
export type Vec2 = [number, number];

export const DEG = Math.PI / 180;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wraps an angle in radians into the range from -π to π. */
export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - turn * Math.floor((angle + Math.PI) / turn);
}

/** Moves a value towards a target by at most `maxDelta`. */
export function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) {
    return Math.min(value + maxDelta, target);
  }
  return Math.max(value - maxDelta, target);
}

/**
 * Returns the blend factor for frame-rate independent smoothing.
 *
 * @param rate How quickly the value follows its target, per second.
 * @param dt Elapsed time in seconds.
 */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Smooth step from 0 at `edge0` to 1 at `edge1`. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Unit vector on the ground plane for a heading in radians.
 * A heading of 0 points east and positive headings turn clockwise, as seen from above.
 */
export function headingVector(heading: number): Vec2 {
  return [Math.cos(heading), Math.sin(heading)];
}

/** Distance from a point to a line segment on the ground plane. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const lengthSquared = abx * abx + abz * abz;
  const t =
    lengthSquared === 0
      ? 0
      : clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / lengthSquared, 0, 1);
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t));
}

/** Distance from a point to a polyline. */
export function distanceToPolyline(p: Vec2, points: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i], points[i + 1]));
  }
  return best;
}

/** Returns true when a point lies inside a polygon. */
export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to the outline of a polygon. It is 0 on the outline. */
export function distanceToPolygonEdge(p: Vec2, polygon: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    best = Math.min(best, distanceToSegment(p, polygon[j], polygon[i]));
  }
  return best;
}

/** A rectangle on the ground plane that can be rotated. */
export interface OrientedBox {
  center: Vec2;
  /** Half of the size along the local X axis and the local Z axis. */
  half: Vec2;
  /** Rotation in radians. See {@link headingVector}. */
  heading: number;
}

/** Returns the four corners of an oriented box. */
export function boxCorners(box: OrientedBox): Vec2[] {
  const [fx, fz] = headingVector(box.heading);
  const corners: Vec2[] = [];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    const lx = sx * box.half[0];
    const lz = sz * box.half[1];
    corners.push([box.center[0] + fx * lx - fz * lz, box.center[1] + fz * lx + fx * lz]);
  }
  return corners;
}

/** Converts a world point into the local frame of an oriented box. */
export function toBoxLocal(p: Vec2, box: OrientedBox): Vec2 {
  const [fx, fz] = headingVector(box.heading);
  const dx = p[0] - box.center[0];
  const dz = p[1] - box.center[1];
  return [dx * fx + dz * fz, -dx * fz + dz * fx];
}

/** Returns true when two oriented boxes overlap. It uses the separating axis theorem. */
export function boxesOverlap(a: OrientedBox, b: OrientedBox): boolean {
  const cornersA = boxCorners(a);
  const cornersB = boxCorners(b);
  const axes = [headingVector(a.heading), headingVector(b.heading)];
  for (const [ax, az] of axes) {
    for (const [nx, nz] of [
      [ax, az],
      [-az, ax],
    ] as const) {
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const c of cornersA) {
        const d = c[0] * nx + c[1] * nz;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const c of cornersB) {
        const d = c[0] * nx + c[1] * nz;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA < minB || maxB < minA) {
        return false;
      }
    }
  }
  return true;
}

/** Small deterministic random number generator, so that generated detail is the same on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
