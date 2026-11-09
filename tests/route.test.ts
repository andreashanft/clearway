import { describe, expect, it } from 'vitest';
import { Route, sampleCatmullRom } from '../src/game/route';

describe('sampleCatmullRom', () => {
  it('passes through every control point', () => {
    const points = [
      [0, 0],
      [10, 5],
      [20, 0],
    ] as const;
    const samples = sampleCatmullRom(points, 1);
    for (const [x, z] of points) {
      expect(samples.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 1e-9)).toBe(true);
    }
  });
});

describe('Route', () => {
  it('measures a straight route exactly', () => {
    const route = new Route([
      [0, 0],
      [100, 0],
    ]);
    expect(route.length).toBeCloseTo(100);
    const mid = route.sampleAt(25);
    expect(mid.x).toBeCloseTo(25);
    expect(mid.z).toBeCloseTo(0);
    expect(mid.dx).toBeCloseTo(1);
  });

  it('clamps sampling to the ends', () => {
    const route = new Route([
      [0, 0],
      [0, 50],
    ]);
    expect(route.sampleAt(-10).z).toBeCloseTo(0);
    expect(route.sampleAt(500).z).toBeCloseTo(50);
  });

  it('projects a point onto the route', () => {
    const route = new Route([
      [0, 0],
      [100, 0],
    ]);
    const p = route.project(40, 6);
    expect(p.along).toBeCloseTo(40);
    expect(p.offset).toBeCloseTo(6);
  });

  it('keeps sampled tangents unit length on a curve', () => {
    const route = new Route([
      [0, 0],
      [50, 30],
      [100, 0],
      [150, -30],
    ]);
    for (const s of route.points(10)) expect(Math.hypot(s.dx, s.dz)).toBeCloseTo(1);
    // Distance along is consistent with projection.
    const s = route.sampleAt(77);
    expect(route.project(s.x, s.z).along).toBeCloseTo(77, 0);
  });
});
