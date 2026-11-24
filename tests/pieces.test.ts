import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/game/math';
import { polygonArea } from '../src/game/polygon';
import { MAX_PIECES, cutFootprint } from '../src/game/world/pieces';

function rectangle(width: number, depth: number, x = 0, z = 0): Vec2[] {
  return [
    [x - width / 2, z - depth / 2],
    [x + width / 2, z - depth / 2],
    [x + width / 2, z + depth / 2],
    [x - width / 2, z + depth / 2],
  ];
}

const total = (pieces: { area: number }[]): number => pieces.reduce((sum, p) => sum + p.area, 0);

describe('cutFootprint', () => {
  it('keeps a house in one piece', () => {
    const shape = cutFootprint(rectangle(12, 9));
    expect(shape.pieces).toHaveLength(1);
    expect(shape.rectangular).toBe(true);
    expect(shape.pieces[0].outer.every(Boolean)).toBe(true);
  });

  it('cuts a long building into a row of pieces', () => {
    const shape = cutFootprint(rectangle(44, 10));
    expect(shape.pieces).toHaveLength(4);
    expect(shape.neighbours[0]).toEqual([1]);
    expect(shape.neighbours[1].sort()).toEqual([0, 2]);
  });

  it('cuts a large block into a grid and keeps its area', () => {
    const footprint = rectangle(60, 40, 100, -50);
    const shape = cutFootprint(footprint);
    expect(shape.pieces).toHaveLength(24);
    expect(total(shape.pieces)).toBeCloseTo(polygonArea(footprint));
  });

  it('marks the walls of the cuts as inner walls', () => {
    const shape = cutFootprint(rectangle(20, 10));
    for (const piece of shape.pieces) {
      expect(piece.outer.filter((outer) => !outer)).toHaveLength(1);
    }
  });

  it('cuts a building that is turned, along its own long side', () => {
    const angle = Math.PI / 6;
    const turned = rectangle(40, 10).map(([x, z]): Vec2 => [
      x * Math.cos(angle) - z * Math.sin(angle),
      x * Math.sin(angle) + z * Math.cos(angle),
    ]);
    const shape = cutFootprint(turned);
    expect(shape.pieces).toHaveLength(4);
    expect(shape.rect.half[0]).toBeCloseTo(20);
    expect(shape.rect.half[1]).toBeCloseTo(5);
  });

  it('keeps the area of a U-shaped block and does not join its two wings', () => {
    const footprint: Vec2[] = [
      [0, 0],
      [60, 0],
      [60, 60],
      [42, 60],
      [42, 18],
      [18, 18],
      [18, 60],
      [0, 60],
    ];
    const shape = cutFootprint(footprint);
    expect(total(shape.pieces)).toBeCloseTo(polygonArea(footprint), 0);
    expect(shape.rectangular).toBe(false);
    // No piece in the left wing touches a piece in the right wing.
    shape.pieces.forEach((piece, index) => {
      if (piece.center[0] < 18 && piece.center[1] > 20) {
        for (const other of shape.neighbours[index]) {
          expect(shape.pieces[other].center[0]).toBeLessThan(42);
        }
      }
    });
  });

  it('marks the joint between two separate parts of a piece, so that it gets no wall', () => {
    // Two wings 2 m apart: the cut at Z = 10 leaves both wing ends in one piece.
    const footprint: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 20],
      [6, 20],
      [6, 8],
      [4, 8],
      [4, 20],
      [0, 20],
    ];
    const shape = cutFootprint(footprint);
    const split = shape.pieces.find((piece) => piece.bridge.some(Boolean));
    expect(split).toBeDefined();
    expect(split?.convex).toBe(false);
    expect(total(shape.pieces)).toBeCloseTo(polygonArea(footprint), 0);
  });

  it('marks a rectangular piece as convex', () => {
    expect(cutFootprint(rectangle(12, 9)).pieces[0].convex).toBe(true);
  });

  it('limits the number of pieces of a huge building', () => {
    expect(cutFootprint(rectangle(300, 200)).pieces.length).toBeLessThanOrEqual(MAX_PIECES);
  });

  it('accepts either winding order', () => {
    const clockwise = rectangle(20, 10).reverse();
    expect(cutFootprint(clockwise).pieces).toHaveLength(2);
  });
});
