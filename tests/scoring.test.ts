import { describe, expect, it } from 'vitest';
import {
  betterMedal,
  formatTime,
  medalFor,
  scoreLevel,
  type LevelTally,
} from '../src/game/scoring';

const rules = { silverBuildings: 0.8, silverBeacons: 0.8 };

function tally(overrides: Partial<LevelTally> = {}): LevelTally {
  return {
    pathCleared: true,
    obstaclesCleared: 6,
    obstaclesTotal: 6,
    buildingsDestroyed: 6,
    buildingsTotal: 14,
    beaconsLit: 0,
    beaconsTotal: 30,
    dishFound: false,
    clearSeconds: 112,
    bonusSeconds: 68,
    points: 4000,
    ...overrides,
  };
}

describe('medalFor', () => {
  it('gives no medal when the path was not cleared', () => {
    expect(medalFor(tally({ pathCleared: false, buildingsDestroyed: 14 }), rules)).toBe('none');
  });

  it('gives bronze for a clear path', () => {
    expect(medalFor(tally(), rules)).toBe('bronze');
  });

  it('gives silver for 80 % of the buildings and 80 % of the beacons', () => {
    expect(medalFor(tally({ buildingsDestroyed: 12, beaconsLit: 24 }), rules)).toBe('silver');
    expect(medalFor(tally({ buildingsDestroyed: 11, beaconsLit: 24 }), rules)).toBe('bronze');
    expect(medalFor(tally({ buildingsDestroyed: 12, beaconsLit: 23 }), rules)).toBe('bronze');
  });

  it('gives gold only for everything, including the relay dish', () => {
    const all = { buildingsDestroyed: 14, beaconsLit: 30 };
    expect(medalFor(tally({ ...all, dishFound: true }), rules)).toBe('gold');
    expect(medalFor(tally({ ...all, dishFound: false }), rules)).toBe('silver');
  });
});

describe('scoreLevel', () => {
  it('lists what gold still needs', () => {
    const result = scoreLevel(tally({ buildingsDestroyed: 12, beaconsLit: 26 }), rules);
    expect(result.medal).toBe('silver');
    expect(result.forGold).toEqual({ buildings: 2, beacons: 4, dish: true });
  });

  it('adds points for bonus time', () => {
    expect(scoreLevel(tally(), rules).score).toBe(4000 + 68 * 20);
  });
});

describe('helpers', () => {
  it('compares medals', () => {
    expect(betterMedal('bronze', 'gold')).toBe('gold');
    expect(betterMedal('silver', 'none')).toBe('silver');
  });

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(112.9)).toBe('1:52');
    expect(formatTime(-3)).toBe('0:00');
  });
});
