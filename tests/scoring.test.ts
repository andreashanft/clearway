import { describe, expect, it } from 'vitest';
import { type LevelStats, medalFor, medalRank, shortfallFor } from '../src/game/scoring';

const base: LevelStats = {
  pathCleared: true,
  clearTime: 150,
  buildingsDestroyed: 10,
  buildingsTotal: 15,
  beaconsFound: 20,
  beaconsTotal: 30,
  dishFound: false,
  dishExists: true,
  score: 0,
};

describe('medalFor', () => {
  it('gives nothing when the path was not cleared', () => {
    expect(medalFor({ ...base, pathCleared: false, buildingsDestroyed: 15 })).toBeNull();
  });

  it('gives bronze for the path alone', () => {
    expect(medalFor(base)).toBe('bronze');
  });

  it('gives silver at 80% of buildings and beacons', () => {
    expect(medalFor({ ...base, buildingsDestroyed: 12, beaconsFound: 24 })).toBe('silver');
    expect(medalFor({ ...base, buildingsDestroyed: 12, beaconsFound: 23 })).toBe('bronze');
  });

  it('gives gold only with everything including the dish', () => {
    const all = { ...base, buildingsDestroyed: 15, beaconsFound: 30 };
    expect(medalFor(all)).toBe('silver');
    expect(medalFor({ ...all, dishFound: true })).toBe('gold');
  });

  it('treats missing beacons and dish as complete', () => {
    expect(
      medalFor({
        ...base,
        buildingsDestroyed: 15,
        beaconsFound: 0,
        beaconsTotal: 0,
        dishExists: false,
        score: 0,
      }),
    ).toBe('gold');
  });
});

describe('shortfallFor', () => {
  it('counts what silver and gold still need', () => {
    expect(shortfallFor(base, 'silver')).toEqual({ buildings: 2, beacons: 4, dish: false });
    expect(shortfallFor(base, 'gold')).toEqual({ buildings: 5, beacons: 10, dish: true });
  });
});

describe('medalRank', () => {
  it('orders medals', () => {
    expect(medalRank('gold')).toBeGreaterThan(medalRank('silver'));
    expect(medalRank('silver')).toBeGreaterThan(medalRank('bronze'));
    expect(medalRank('bronze')).toBeGreaterThan(medalRank(null));
  });
});
