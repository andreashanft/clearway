import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS } from '../src/game/vehicles/specs';
import {
  MIN_IMPACT_SPEED,
  STRENGTH_HP,
  TNT_DAMAGE,
  TNT_RADIUS,
  applySegmentDamage,
  blastDamage,
  canDamage,
  impactDamage,
} from '../src/game/world/damage';

const { dozer, buggy } = VEHICLE_SPECS;

function ram(speed: number, spec = dozer): number {
  return impactDamage({ mass: spec.mass, speed, vehicleFactor: spec.damage });
}

describe('impactDamage', () => {
  it('ignores slow scraping', () => {
    expect(ram(MIN_IMPACT_SPEED - 0.1)).toBe(0);
  });

  it('grows with the square of the speed', () => {
    expect(ram(12) / ram(6)).toBeCloseTo(4);
  });

  it('lets the bulldozer drop a house segment with one ram at top speed', () => {
    expect(ram(dozer.topSpeed)).toBeGreaterThanOrEqual(STRENGTH_HP.house);
  });

  it('needs two rams of the bulldozer for a brick segment', () => {
    const damage = ram(dozer.topSpeed);
    expect(damage).toBeLessThan(STRENGTH_HP.brick);
    expect(damage * 2).toBeGreaterThanOrEqual(STRENGTH_HP.brick);
  });

  it('lets the light buggy drop a shed, but not a house, with one ram at top speed', () => {
    const damage = ram(buggy.topSpeed, buggy);
    expect(damage).toBeGreaterThanOrEqual(STRENGTH_HP.shed);
    expect(damage).toBeLessThan(STRENGTH_HP.house);
  });
});

describe('canDamage', () => {
  it('protects concrete from every vehicle', () => {
    expect(canDamage('concrete')).toBe(false);
    expect(canDamage('brick')).toBe(true);
    expect(canDamage('shed')).toBe(true);
  });
});

describe('blastDamage', () => {
  it('falls off linearly to zero at the radius', () => {
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, 0)).toBe(TNT_DAMAGE);
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, TNT_RADIUS / 2)).toBeCloseTo(TNT_DAMAGE / 2);
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, TNT_RADIUS)).toBe(0);
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, TNT_RADIUS * 2)).toBe(0);
  });

  it('lets one TNT crate against the wall drop a concrete segment', () => {
    expect(blastDamage(TNT_DAMAGE, TNT_RADIUS, 3)).toBeGreaterThanOrEqual(STRENGTH_HP.concrete);
  });
});

describe('applySegmentDamage', () => {
  it('damages one segment without collapse', () => {
    const hp = [250, 250];
    expect(applySegmentDamage(hp, 250, 0, 200)).toEqual([]);
    expect(hp).toEqual([50, 250]);
  });

  it('weakens the neighbour when a segment falls', () => {
    const hp = [250, 250, 250];
    expect(applySegmentDamage(hp, 250, 0, 250)).toEqual([0]);
    expect(hp).toEqual([0, 125, 250]);
  });

  it('drops a two-segment house with two plain rams, even slightly off top speed', () => {
    const hp = [250, 250];
    applySegmentDamage(hp, 250, 0, 190);
    expect(applySegmentDamage(hp, 250, 0, 190)).toEqual([0, 1]);
    expect(hp).toEqual([0, 0]);
  });

  it('drops a two-segment house with one ram charge', () => {
    const hp = [250, 250];
    expect(applySegmentDamage(hp, 250, 1, 560)).toEqual([1, 0]);
  });

  it('spreads in both directions and stops when the damage runs out', () => {
    const hp = [600, 600, 600, 600, 600];
    const fallen = applySegmentDamage(hp, 600, 2, 1000);
    expect(fallen).toEqual([2, 1, 3]);
    expect(hp[0]).toBe(200);
    expect(hp[4]).toBe(200);
  });

  it('ignores a segment that has already fallen', () => {
    const hp = [0, 250];
    expect(applySegmentDamage(hp, 250, 0, 500)).toEqual([]);
    expect(hp).toEqual([0, 250]);
  });
});
