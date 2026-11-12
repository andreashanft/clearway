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

const bruiser = VEHICLE_SPECS.bruiser;

function ram(speed: number, ramArmed = false): number {
  return impactDamage({ mass: bruiser.mass, speed, vehicleFactor: bruiser.damage, ramArmed });
}

describe('impactDamage', () => {
  it('ignores slow scraping', () => {
    expect(ram(MIN_IMPACT_SPEED - 0.1)).toBe(0);
  });

  it('grows with the square of the speed', () => {
    expect(ram(12) / ram(6)).toBeCloseTo(4);
  });

  it('lets the Bruiser drop a shed with one ram at top speed', () => {
    expect(ram(bruiser.topSpeed)).toBeGreaterThanOrEqual(STRENGTH_HP.shed);
  });

  it('needs two plain rams for a house segment', () => {
    const damage = ram(bruiser.topSpeed);
    expect(damage).toBeLessThan(STRENGTH_HP.house);
    expect(damage * 2).toBeGreaterThanOrEqual(STRENGTH_HP.house);
  });

  it('drops a house segment with one ram charge', () => {
    expect(ram(bruiser.topSpeed * 1.25, true)).toBeGreaterThanOrEqual(STRENGTH_HP.house);
  });

  it('needs downhill speed on top of a ram charge for brick', () => {
    expect(ram(bruiser.topSpeed * 1.25, true)).toBeLessThan(STRENGTH_HP.brick);
    expect(ram(bruiser.topSpeed * 1.25 * 1.2, true)).toBeGreaterThanOrEqual(STRENGTH_HP.brick);
  });
});

describe('canDamage', () => {
  it('protects concrete from every vehicle except the Tumbler', () => {
    expect(canDamage('bruiser', 'concrete')).toBe(false);
    expect(canDamage('fishtail', 'concrete')).toBe(false);
    expect(canDamage('tumbler', 'concrete')).toBe(true);
    expect(canDamage('bruiser', 'brick')).toBe(true);
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
