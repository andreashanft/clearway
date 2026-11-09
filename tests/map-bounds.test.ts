import { describe, expect, it } from 'vitest';
import { mapBounds } from '../src/game/map-bounds';

describe('mapBounds', () => {
  it('widens a straight east–west route to the mini-map shape', () => {
    const b = mapBounds([
      [-380, 10],
      [380, 10],
    ]);
    expect(b.minX).toBe(-420);
    expect(b.maxX).toBe(420);
    expect((b.maxX - b.minX) / (b.maxZ - b.minZ)).toBeCloseTo(1.45);
    expect((b.minZ + b.maxZ) / 2).toBeCloseTo(10);
  });

  it('widens a north–south route sideways', () => {
    const b = mapBounds([
      [0, -300],
      [0, 300],
    ]);
    expect(b.minZ).toBe(-340);
    expect((b.maxX - b.minX) / (b.maxZ - b.minZ)).toBeCloseTo(1.45);
  });
});
