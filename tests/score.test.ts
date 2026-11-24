import { describe, expect, it } from 'vitest';
import {
  BREAKS_PER_STEP,
  COMBO_SECONDS,
  HOUSE_POINTS,
  MAX_MULTIPLIER,
  ScoreKeeper,
  breakPoints,
} from '../src/game/score';

describe('breakPoints', () => {
  it('gives the reference house its points and more for larger volumes', () => {
    expect(breakPoints(800)).toBe(HOUSE_POINTS);
    expect(breakPoints(80000)).toBeGreaterThan(breakPoints(800) * 10);
  });
});

describe('ScoreKeeper', () => {
  it('raises the multiplier with quick breaks one after another', () => {
    const score = new ScoreKeeper();
    for (let i = 0; i < BREAKS_PER_STEP; i += 1) {
      expect(score.award(800, 0).multiplier).toBe(1);
    }
    expect(score.award(800, 0).multiplier).toBe(2);
  });

  it('ends the combo when no break comes in time', () => {
    const score = new ScoreKeeper();
    for (let i = 0; i < 6; i += 1) {
      score.award(800, 0);
    }
    score.update(COMBO_SECONDS + 0.1);
    expect(score.multiplier).toBe(1);
    expect(score.comboShare).toBe(0);
  });

  it('caps the multiplier', () => {
    const score = new ScoreKeeper();
    for (let i = 0; i < 100; i += 1) {
      score.award(100, 0);
    }
    expect(score.multiplier).toBe(MAX_MULTIPLIER);
  });

  it('adds a chain bonus for breaks that a collapse caused', () => {
    const plain = new ScoreKeeper().award(800, 0).points;
    const chained = new ScoreKeeper().award(800, 2).points;
    expect(chained).toBe(plain * 2);
  });
});
