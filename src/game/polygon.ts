import { pointInPolygon, type OrientedBox, type Vec2 } from './math';

/*
 * Helpers for simple polygons on the ground plane. A polygon is a list of corners without a
 * repeated first corner. "Anticlockwise" means a positive signed area in the X-Z plane.
 */

/** Points closer than this, in metres, count as the same point. */
const EPSILON = 1e-6;

/** Returns the signed area. It is positive when the corners run anticlockwise. */
export function signedArea(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, z0] = polygon[i];
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

/** Returns the area in square metres. */
export function polygonArea(polygon: readonly Vec2[]): number {
  return Math.abs(signedArea(polygon));
}

/** Returns the centre of mass of the polygon's area. A degenerate polygon gives its mean corner. */
export function centroid(polygon: readonly Vec2[]): Vec2 {
  if (polygon.length === 0) {
    return [0, 0];
  }
  const area = signedArea(polygon);
  if (Math.abs(area) < EPSILON) {
    const sum = polygon.reduce<Vec2>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / polygon.length, sum[1] / polygon.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, z0] = polygon[i];
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    const cross = x0 * z1 - x1 * z0;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  return [cx / (6 * area), cz / (6 * area)];
}

/**
 * Returns a clean copy of a polygon: anticlockwise, without a repeated closing corner, without
 * duplicate corners and without corners that lie on a straight line between their neighbours.
 */
export function cleanPolygon(polygon: readonly Vec2[]): Vec2[] {
  let points = polygon.map((p): Vec2 => [p[0], p[1]]);
  const same = (a: Vec2, b: Vec2): boolean =>
    Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
  points = points.filter((p, i) => !same(p, points[(i + 1) % points.length]));
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[(i + points.length - 1) % points.length];
      const b = points[i];
      const c = points[(i + 1) % points.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < 1e-4) {
        points.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return signedArea(points) < 0 ? points.reverse() : points;
}

/** Returns the convex hull, anticlockwise, with Andrew's monotone chain. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) {
    return sorted;
  }
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Returns the rectangle of least area that encloses the polygon. Its first half extent runs along
 * its heading and is the longer one.
 */
export function minimumRectangle(polygon: readonly Vec2[]): OrientedBox {
  const hull = convexHull(polygon);
  let best: OrientedBox | undefined;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const box = boundingBoxAlong(hull, heading);
    const area = box.half[0] * box.half[1];
    if (area < bestArea - EPSILON) {
      bestArea = area;
      best = box;
    }
  }
  best ??= boundingBoxAlong(hull.length > 0 ? hull : [[0, 0]], 0);
  if (best.half[1] > best.half[0]) {
    best = {
      center: best.center,
      half: [best.half[1], best.half[0]],
      heading: best.heading + Math.PI / 2,
    };
  }
  return best;
}

/** Returns the box that encloses the points and runs along a heading. */
function boundingBoxAlong(points: readonly Vec2[], heading: number): OrientedBox {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, z] of points) {
    const u = x * cos + z * sin;
    const v = -x * sin + z * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const u = (minU + maxU) / 2;
  const v = (minV + maxV) / 2;
  return {
    center: [u * cos - v * sin, u * sin + v * cos],
    half: [(maxU - minU) / 2, (maxV - minV) / 2],
    heading,
  };
}

/**
 * Cuts away the part of a polygon on the far side of a line, with one Sutherland-Hodgman pass.
 * The part where `normal · p <= offset` stays.
 *
 * A concave polygon that the line splits into several parts comes back as one polygon whose parts
 * are joined by edges of no width. Triangulation copes with that.
 */
export function clipPolygon(polygon: readonly Vec2[], normal: Vec2, offset: number): Vec2[] {
  const result: Vec2[] = [];
  const side = (p: Vec2): number => normal[0] * p[0] + normal[1] * p[1] - offset;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const a = side(current);
    const b = side(next);
    if (a <= 0) {
      result.push(current);
    }
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const t = a / (a - b);
      result.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
      ]);
    }
  }
  return result;
}

/** Returns true when a point lies on one of the polygon's edges, within a tolerance in metres. */
export function onOutline(point: Vec2, polygon: readonly Vec2[], tolerance = 0.01): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSq = dx * dx + dz * dz;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
    if (Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t) <= tolerance) {
      return true;
    }
  }
  return false;
}

/** Returns the distance from a point to the nearest point of a polygon. 0 inside it. */
export function distanceToPolygon(point: Vec2, polygon: readonly Vec2[]): number {
  if (pointInPolygon(point, polygon)) {
    return 0;
  }
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSq = dx * dx + dz * dz;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
    best = Math.min(best, Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t));
  }
  return best;
}
