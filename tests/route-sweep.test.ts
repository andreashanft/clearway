import { describe, expect, it } from 'vitest';
import {
  footprintsOverlap,
  HAULER,
  sweepRoute,
  type Footprint,
} from '../src/game/hauler/route-sweep';
import { Route } from '../src/game/route';

const square = (x: number, z: number, half: number, yaw = 0): Footprint => ({
  x,
  z,
  halfX: half,
  halfZ: half,
  yaw,
});

describe('footprintsOverlap', () => {
  it('detects overlap and separation of aligned rectangles', () => {
    expect(footprintsOverlap(square(0, 0, 1), square(1.5, 0, 1))).toBe(true);
    expect(footprintsOverlap(square(0, 0, 1), square(2.5, 0, 1))).toBe(false);
  });

  it('accounts for rotation', () => {
    // A square turned 45° reaches √2 along the axis, so it now touches.
    expect(footprintsOverlap(square(0, 0, 1), square(2.3, 0, 1, Math.PI / 4))).toBe(true);
    expect(footprintsOverlap(square(0, 0, 1), square(2.5, 0, 1, Math.PI / 4))).toBe(false);
  });
});

describe('sweepRoute', () => {
  const straight = new Route([
    [0, 0],
    [0, 200],
  ]);

  it('reports the nose distance at first contact, in route order', () => {
    const obstacles = sweepRoute(straight, [
      { id: 'far', group: 'far', footprint: square(0, 150, 4) },
      { id: 'near', group: 'near', footprint: square(0, 60, 4) },
      { id: 'aside', group: 'aside', footprint: square(30, 100, 4) },
    ]);
    expect(obstacles.map((o) => o.id)).toEqual(['near', 'far']);
    // The building's near edge is at 56 m; the sensor reaches it just before the nose does.
    expect(obstacles[0]?.distance).toBeCloseTo(56 - HAULER.sensorDepth, 0);
  });

  it('merges a group into one obstacle at its first member', () => {
    const obstacles = sweepRoute(straight, [
      { id: 'silo-a', group: 'silos', footprint: square(-2, 100, 3) },
      { id: 'silo-b', group: 'silos', footprint: square(3, 104, 3) },
    ]);
    expect(obstacles).toHaveLength(1);
    expect([...(obstacles[0]?.memberIds ?? [])].sort()).toEqual(['silo-a', 'silo-b']);
    expect(obstacles[0]?.distance).toBeCloseTo(97 - HAULER.sensorDepth, 0);
  });

  it('counts a building that only clips the edge of the Hauler’s path', () => {
    const edge = HAULER.width / 2 + 2.5;
    expect(
      sweepRoute(straight, [{ id: 'clip', group: 'clip', footprint: square(edge, 80, 2.7) }]),
    ).toHaveLength(1);
    expect(
      sweepRoute(straight, [{ id: 'miss', group: 'miss', footprint: square(edge + 1, 80, 2.7) }]),
    ).toHaveLength(0);
  });
});
