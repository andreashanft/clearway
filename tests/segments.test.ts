import { describe, expect, it } from 'vitest';
import type { BuildingData } from '../src/game/level';
import { segmentBoxes, segmentLayout } from '../src/game/world/segments';

function building(overrides: Partial<BuildingData>): BuildingData {
  return {
    id: 'test',
    name: 'test',
    kind: 'house',
    strength: 'house',
    pos: [100, 50],
    size: [24, 9, 17],
    yaw: 0,
    colors: { wall: '#ffffff', roof: '#ffffff' },
    ...overrides,
  };
}

describe('segmentLayout', () => {
  it('gives a normal house two segments', () => {
    expect(segmentLayout(building({})).count).toBe(2);
  });

  it('gives a long warehouse five segments', () => {
    expect(segmentLayout(building({ kind: 'barn', size: [64.7, 11, 25] })).count).toBe(5);
  });

  it('gives a small shed one segment', () => {
    expect(segmentLayout(building({ kind: 'shed', size: [13.8, 5, 10.4] })).count).toBe(1);
  });

  it('cuts along the longer side, whichever axis that is', () => {
    const layout = segmentLayout(building({ size: [10, 9, 40] }));
    expect(layout.alongX).toBe(false);
    expect(layout.length).toBeCloseTo(40 / 3);
    expect(layout.depth).toBe(10);
  });

  it('keeps round buildings in one piece', () => {
    const layout = segmentLayout(building({ kind: 'silo', size: [15, 16, 15] }));
    expect(layout.count).toBe(1);
    expect(layout.round).toBe(true);
  });

  it('uses one segment per house of a terrace', () => {
    const layout = segmentLayout(building({ kind: 'terrace', size: [84, 8.5, 12], segments: 5 }));
    expect(layout.count).toBe(5);
    expect(layout.length).toBeCloseTo(16.8);
  });
});

describe('segmentBoxes', () => {
  it('lines the segments up along the building', () => {
    const boxes = segmentBoxes(building({}));
    expect(boxes).toHaveLength(2);
    expect(boxes[0].center[0]).toBeCloseTo(94);
    expect(boxes[1].center[0]).toBeCloseTo(106);
    expect(boxes[0].half).toEqual([6, 8.5]);
  });

  it('follows the rotation of the building', () => {
    const boxes = segmentBoxes(building({ yaw: 90 }));
    expect(boxes[0].center[0]).toBeCloseTo(100);
    expect(boxes[0].center[1]).toBeCloseTo(44);
    expect(boxes[1].center[1]).toBeCloseTo(56);
  });
});
