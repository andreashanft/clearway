import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/game/math';
import {
  centroid,
  cleanPolygon,
  clipPolygon,
  distanceToPolygon,
  minimumRectangle,
  signedArea,
} from '../src/game/polygon';

const square: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('polygon helpers', () => {
  it('measures the area and the centre', () => {
    expect(signedArea(square)).toBe(100);
    expect(centroid(square)).toEqual([5, 5]);
  });

  it('cleans a polygon into anticlockwise order without repeated or straight corners', () => {
    const messy: Vec2[] = [
      [0, 10],
      [10, 10],
      [10, 5],
      [10, 0],
      [0, 0],
      [0, 10],
    ];
    const clean = cleanPolygon(messy);
    expect(clean).toHaveLength(4);
    expect(signedArea(clean)).toBeGreaterThan(0);
  });

  it('clips a polygon at a line', () => {
    const half = clipPolygon(square, [1, 0], 4);
    expect(signedArea(cleanPolygon(half))).toBeCloseTo(40);
  });

  it('finds the rectangle of a turned box', () => {
    const angle = 0.4;
    const box = [
      [-8, -3],
      [8, -3],
      [8, 3],
      [-8, 3],
    ].map(([x, z]): Vec2 => [
      x * Math.cos(angle) - z * Math.sin(angle),
      x * Math.sin(angle) + z * Math.cos(angle),
    ]);
    const rect = minimumRectangle(box);
    expect(rect.half[0]).toBeCloseTo(8);
    expect(rect.half[1]).toBeCloseTo(3);
  });

  it('measures the distance to a polygon', () => {
    expect(distanceToPolygon([5, 5], square)).toBe(0);
    expect(distanceToPolygon([13, 5], square)).toBeCloseTo(3);
  });
});
