/**
 * The Hauler's route: a uniform Catmull-Rom spline through ground control points,
 * resampled into a dense polyline with an arc-length table. The terrain baker uses the
 * same spline, so the painted road and the Hauler's path line up.
 *
 * This module has no browser or Three.js dependencies so scripts can use it too.
 */

export type Point2 = readonly [number, number];

export interface RouteSample {
  /** Ground position. */
  readonly x: number;
  readonly z: number;
  /** Unit tangent in the direction of travel. */
  readonly dx: number;
  readonly dz: number;
}

/** Samples a uniform Catmull-Rom spline through `points`, about `step` metres apart. */
export function sampleCatmullRom(points: readonly Point2[], step: number): Point2[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]] as const);
  const out: Point2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([
        catmullRom(p0[0], p1[0], p2[0], p3[0], t),
        catmullRom(p0[1], p1[1], p2[1], p3[1], t),
      ]);
    }
  }
  const last = points[points.length - 1];
  if (last) out.push([last[0], last[1]]);
  return out;
}

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  );
}

export class Route {
  /** Total length in metres. */
  readonly length: number;
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  /** Cumulative distance at each sample. */
  private readonly cumulative: Float64Array;

  constructor(controlPoints: readonly Point2[], step = 0.5) {
    const samples = sampleCatmullRom(controlPoints, step);
    if (samples.length < 2) throw new Error('A route needs at least two points');
    this.xs = new Float64Array(samples.length);
    this.zs = new Float64Array(samples.length);
    this.cumulative = new Float64Array(samples.length);
    let total = 0;
    samples.forEach(([x, z], i) => {
      if (i > 0) total += Math.hypot(x - (this.xs[i - 1] ?? x), z - (this.zs[i - 1] ?? z));
      this.xs[i] = x;
      this.zs[i] = z;
      this.cumulative[i] = total;
    });
    this.length = total;
  }

  /** Position and direction at `distance` metres along the route (clamped to its ends). */
  sampleAt(distance: number): RouteSample {
    const d = Math.min(this.length, Math.max(0, distance));
    const i = this.segmentIndex(d);
    const x0 = this.xs[i] ?? 0;
    const z0 = this.zs[i] ?? 0;
    const x1 = this.xs[i + 1] ?? x0;
    const z1 = this.zs[i + 1] ?? z0;
    const c0 = this.cumulative[i] ?? 0;
    const c1 = this.cumulative[i + 1] ?? c0;
    const t = c1 > c0 ? (d - c0) / (c1 - c0) : 0;
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    return {
      x: x0 + (x1 - x0) * t,
      z: z0 + (z1 - z0) * t,
      dx: (x1 - x0) / len,
      dz: (z1 - z0) / len,
    };
  }

  /** The closest point on the route to (x, z): its distance along and its offset from it. */
  project(x: number, z: number): { along: number; offset: number } {
    let best = Infinity;
    let along = 0;
    for (let i = 0; i < this.xs.length - 1; i++) {
      const ax = this.xs[i] ?? 0;
      const az = this.zs[i] ?? 0;
      const bx = this.xs[i + 1] ?? ax;
      const bz = this.zs[i + 1] ?? az;
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) {
        best = d;
        along = (this.cumulative[i] ?? 0) + t * Math.sqrt(len2);
      }
    }
    return { along, offset: best };
  }

  /** Direction of travel (heading about +y) within `radius` of (x, z), or null. */
  headingNear(x: number, z: number, radius: number): number | null {
    const { along, offset } = this.project(x, z);
    if (offset > radius) return null;
    const s = this.sampleAt(along);
    return Math.atan2(s.dx, s.dz);
  }

  /** Evenly spaced points along the route, for drawing it. */
  points(spacing: number): RouteSample[] {
    const out: RouteSample[] = [];
    const count = Math.max(1, Math.round(this.length / spacing));
    for (let k = 0; k <= count; k++) out.push(this.sampleAt((k / count) * this.length));
    return out;
  }

  private segmentIndex(d: number): number {
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.cumulative[mid] ?? 0) <= d) lo = mid;
      else hi = mid;
    }
    return lo;
  }
}
