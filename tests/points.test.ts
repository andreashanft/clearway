import { describe, expect, it } from 'vitest';
import { recordRun } from '../src/game/progress';
import { buildingPoints, formatScore, propPoints } from '../src/game/points';
import type { LevelStats } from '../src/game/scoring';

describe('points', () => {
  it('scores buildings by strength, and small structures for less', () => {
    expect(buildingPoints('shed', 'shed')).toBe(50);
    expect(buildingPoints('house', 'house')).toBe(100);
    expect(buildingPoints('warehouse', 'brick')).toBe(250);
    expect(buildingPoints('stone-barn', 'concrete')).toBe(500);
    expect(buildingPoints('fence', 'shed')).toBe(20);
  });

  it('scores scenery, and nothing for unknown props', () => {
    expect(propPoints('tree')).toBe(10);
    expect(propPoints('bush')).toBe(5);
    expect(propPoints('lamp')).toBe(0);
  });

  it('formats scores with thin-space thousands', () => {
    expect(formatScore(0)).toBe('0');
    expect(formatScore(950)).toBe('950');
    expect(formatScore(12450)).toBe('12 450');
    expect(formatScore(1234567)).toBe('1 234 567');
  });

  it('keeps the best score in the save', () => {
    const run = (score: number): LevelStats => ({
      pathCleared: true,
      clearTime: 100,
      buildingsDestroyed: 1,
      buildingsTotal: 2,
      beaconsFound: 0,
      beaconsTotal: 0,
      dishFound: false,
      dishExists: false,
      score,
    });
    const first = recordRun(undefined, run(4000));
    expect(first.bestScore).toBe(4000);
    expect(recordRun(first, run(2500)).bestScore).toBe(4000);
    expect(recordRun(first, run(6100)).bestScore).toBe(6100);
  });
});
