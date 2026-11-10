import { describe, expect, it } from 'vitest';
import {
  BLAST_CORE,
  canDamage,
  damageFactor,
  explosionDamage,
  impactDamage,
  MIN_IMPACT_SPEED,
  STRENGTH_HP,
} from '../src/game/damage';
import { BRUISER_SPEC } from '../src/game/vehicles/bruiser';

describe('impactDamage', () => {
  it('ignores hits below the minimum speed', () => {
    expect(impactDamage(9000, MIN_IMPACT_SPEED - 0.1, 1)).toBe(0);
  });

  it('grows with the square of speed and with the multiplier', () => {
    const slow = impactDamage(9000, 5, 1);
    expect(impactDamage(9000, 10, 1)).toBeCloseTo(slow * 4);
    expect(impactDamage(9000, 5, 1.5)).toBeCloseTo(slow * 1.5);
    expect(impactDamage(9000, 10, 0)).toBe(0);
  });

  it('lets a Bruiser drop brick at full speed and a house at 60% of it', () => {
    const hit = impactDamage(BRUISER_SPEC.mass, BRUISER_SPEC.topSpeed, 1);
    expect(hit).toBeGreaterThanOrEqual(STRENGTH_HP.brick);
    const slower = impactDamage(BRUISER_SPEC.mass, BRUISER_SPEC.topSpeed * 0.6, 1);
    expect(slower).toBeGreaterThanOrEqual(STRENGTH_HP.house);
    expect(slower).toBeLessThan(STRENGTH_HP.brick);
  });
});

describe('explosionDamage', () => {
  it('is full inside the core, then falls off linearly to zero at the radius', () => {
    expect(explosionDamage(0, 8, 800)).toBe(800);
    expect(explosionDamage(BLAST_CORE, 8, 800)).toBe(800);
    expect(explosionDamage(5, 8, 800)).toBeCloseTo(400);
    expect(explosionDamage(8, 8, 800)).toBe(0);
    expect(explosionDamage(12, 8, 800)).toBe(0);
  });

  it('lets one crate against a concrete wall bring it down', () => {
    const hit = explosionDamage(1, 8, 800) * damageFactor('concrete', { kind: 'explosion' });
    expect(hit).toBeGreaterThanOrEqual(STRENGTH_HP.concrete);
    expect(damageFactor('concrete', { kind: 'vehicle', vehicle: 'tumbler' })).toBe(1);
    expect(damageFactor('brick', { kind: 'explosion' })).toBe(1);
  });
});

describe('canDamage', () => {
  it('protects concrete from every vehicle but the Tumbler', () => {
    expect(canDamage('concrete', { kind: 'vehicle', vehicle: 'bruiser' })).toBe(false);
    expect(canDamage('concrete', { kind: 'vehicle', vehicle: 'tumbler' })).toBe(true);
    expect(canDamage('concrete', { kind: 'explosion' })).toBe(true);
    expect(canDamage('brick', { kind: 'vehicle', vehicle: 'fishtail' })).toBe(true);
  });
});
