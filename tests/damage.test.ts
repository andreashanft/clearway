import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS, VEHICLE_TYPES } from '../src/game/vehicles/specs';
import {
  MAX_HP,
  MIN_HP,
  MIN_IMPACT_SPEED,
  TNT_DAMAGE,
  TNT_RADIUS,
  applyPieceDamage,
  blastDamage,
  hitPoints,
  ramDamage,
  type PieceGraph,
} from '../src/game/world/damage';

/** A house of 12 m × 9 m and 7 m height, as in the test yard. */
const HOUSE = hitPoints(12 * 9 * 7);
/** A tower of 26 m × 26 m and 40 floors. */
const TOWER = hitPoints(26 * 26 * 120);

function ram(type: (typeof VEHICLE_TYPES)[number], share: number): number {
  const spec = VEHICLE_SPECS[type];
  return ramDamage(spec.ram, spec.topSpeed * share, spec.topSpeed);
}

describe('hitPoints', () => {
  it('grows with the volume, but slower than the volume', () => {
    expect(hitPoints(1600)).toBeGreaterThan(hitPoints(800));
    expect(hitPoints(1600)).toBeLessThan(hitPoints(800) * 2);
  });

  it('keeps every building between the least and the most hit points', () => {
    expect(hitPoints(1)).toBe(MIN_HP);
    expect(hitPoints(1e7)).toBe(MAX_HP);
  });
});

describe('ramDamage', () => {
  it('ignores slow scraping', () => {
    expect(ramDamage(400, MIN_IMPACT_SPEED - 0.1, 20)).toBe(0);
  });

  it('grows with the square of the speed', () => {
    expect(ramDamage(400, 20, 20) / ramDamage(400, 10, 20)).toBeCloseTo(4);
  });

  it.each(VEHICLE_TYPES)(
    'lets the %s break a house with one ram at three quarters of its top speed',
    (type) => {
      expect(ram(type, 0.75)).toBeGreaterThanOrEqual(HOUSE);
    },
  );

  it.each(VEHICLE_TYPES)(
    'lets the %s bring down the 40-floor tower with a few rams at top speed',
    (type) => {
      expect(Math.ceil(TOWER / ram(type, 1))).toBeLessThanOrEqual(6);
    },
  );

  it('makes the bulldozer the strongest ram and the buggy the weakest', () => {
    expect(ram('dozer', 1)).toBeGreaterThan(ram('flail', 1));
    expect(ram('flail', 1)).toBeGreaterThan(ram('buggy', 1));
  });
});

describe('blastDamage', () => {
  it('falls off linearly to zero at the radius', () => {
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, 0)).toBe(TNT_DAMAGE);
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, TNT_RADIUS / 2)).toBeCloseTo(TNT_DAMAGE / 2);
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, TNT_RADIUS)).toBe(0);
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, TNT_RADIUS * 2)).toBe(0);
  });
});

/** A row of pieces along X, 10 m apart, each with the same hit points. */
function row(count: number, hp: number): PieceGraph {
  return {
    maxHp: new Array<number>(count).fill(hp),
    neighbours: Array.from({ length: count }, (_, i) =>
      [i - 1, i + 1].filter((j) => j >= 0 && j < count),
    ),
    centers: Array.from({ length: count }, (_, i): [number, number] => [i * 10, 0]),
  };
}

describe('applyPieceDamage', () => {
  it('damages one piece without a collapse', () => {
    const hp = [100, 100];
    expect(applyPieceDamage(hp, row(2, 100), 0, 60, [1, 0])).toEqual([]);
    expect(hp).toEqual([40, 100]);
  });

  it('weakens the neighbours when a piece falls', () => {
    const hp = [100, 100, 100];
    expect(applyPieceDamage(hp, row(3, 100), 1, 100)).toEqual([1]);
    expect(hp).toEqual([75, 0, 75]);
  });

  it('carries the spare damage of a ram on through the next piece in line', () => {
    const hp = [100, 100, 100, 100];
    const fallen = applyPieceDamage(hp, row(4, 100), 0, 400, [1, 0]);
    expect(fallen).toEqual([0, 1, 2]);
    expect(hp[3]).toBeGreaterThan(0);
  });

  it('does not carry a ram sideways', () => {
    const hp = [100, 100, 100];
    expect(applyPieceDamage(hp, row(3, 100), 1, 300, [0, 1])).toEqual([1]);
  });

  it('ignores a piece that has already fallen', () => {
    const hp = [0, 100];
    expect(applyPieceDamage(hp, row(2, 100), 0, 500, [1, 0])).toEqual([]);
    expect(hp).toEqual([0, 100]);
  });
});
