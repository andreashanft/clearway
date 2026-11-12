import { describe, expect, it } from 'vitest';
import {
  approach,
  boxesOverlap,
  distanceToPolyline,
  distanceToSegment,
  headingVector,
  pointInPolygon,
  toBoxLocal,
  wrapAngle,
  type OrientedBox,
  type Vec2,
} from '../src/game/math';

describe('wrapAngle', () => {
  it('keeps angles in the range from -π to π', () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(Math.PI * 4 + 0.25)).toBeCloseTo(0.25);
  });
});

describe('approach', () => {
  it('moves by at most the step and stops at the target', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(0, -10, 3)).toBe(-3);
    expect(approach(-9, -10, 3)).toBe(-10);
  });
});

describe('headingVector', () => {
  it('points east at 0 and south at 90 degrees', () => {
    expect(headingVector(0)[0]).toBeCloseTo(1);
    expect(headingVector(Math.PI / 2)[1]).toBeCloseTo(1);
  });
});

describe('distances', () => {
  it('measures the distance to a segment', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBeCloseTo(3);
    expect(distanceToSegment([-4, 3], [0, 0], [10, 0])).toBeCloseTo(5);
  });

  it('measures the distance to a polyline', () => {
    const line: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(distanceToPolyline([12, 5], line)).toBeCloseTo(2);
  });
});

describe('pointInPolygon', () => {
  const square: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];

  it('tells inside from outside', () => {
    expect(pointInPolygon([2, 2], square)).toBe(true);
    expect(pointInPolygon([5, 2], square)).toBe(false);
    expect(pointInPolygon([2, -1], square)).toBe(false);
  });
});

describe('oriented boxes', () => {
  const box: OrientedBox = { center: [10, 10], half: [4, 1], heading: Math.PI / 2 };

  it('converts a point into the local frame', () => {
    // The box points south, so a point 3 m south of the centre lies 3 m along its local X axis.
    const local = toBoxLocal([10, 13], box);
    expect(local[0]).toBeCloseTo(3);
    expect(local[1]).toBeCloseTo(0);
  });

  it('detects overlap of rotated boxes', () => {
    const upright: OrientedBox = { center: [10, 14.5], half: [1, 1], heading: 0 };
    expect(boxesOverlap(box, upright)).toBe(true);
    const beside: OrientedBox = { center: [12.5, 10], half: [1, 1], heading: 0 };
    expect(boxesOverlap(box, beside)).toBe(false);
  });

  it('detects overlap that only a rotated axis separates', () => {
    const diamond: OrientedBox = { center: [0, 0], half: [2, 2], heading: Math.PI / 4 };
    const corner: OrientedBox = { center: [2.6, 2.6], half: [0.5, 0.5], heading: 0 };
    expect(boxesOverlap(diamond, corner)).toBe(false);
  });
});
