import { describe, expect, it } from 'vitest';
import { impactDamage, STRENGTH_HP } from '../src/game/damage';
import { FISHTAIL_DAMAGE, FISHTAIL_SPEC } from '../src/game/vehicles/fishtail';
import { LIFTOFF_DAMAGE, LIFTOFF_SPEC } from '../src/game/vehicles/liftoff';
import {
  CHAIN_MAX,
  chainStacks,
  rollMultiplier,
  ROLL_SPEED,
  TUMBLER_SPEC,
} from '../src/game/vehicles/tumbler';

describe('Tumbler chained rolls', () => {
  it('stacks hits within two seconds, up to three, and resets after', () => {
    expect(chainStacks(0, 1.5)).toBe(1);
    expect(chainStacks(1, 2)).toBe(2);
    expect(chainStacks(CHAIN_MAX, 0.5)).toBe(CHAIN_MAX);
    expect(chainStacks(2, 2.5)).toBe(0);
    expect(chainStacks(0, Infinity)).toBe(0);
  });

  it('adds 25% per stack', () => {
    expect(rollMultiplier(1) / rollMultiplier(0)).toBeCloseTo(1.25);
    expect(rollMultiplier(3) / rollMultiplier(0)).toBeCloseTo(1.75);
    expect(rollMultiplier(9)).toBe(rollMultiplier(CHAIN_MAX));
  });

  it('needs two chained rolls for concrete', () => {
    const first = impactDamage(TUMBLER_SPEC.mass, ROLL_SPEED, rollMultiplier(0));
    const second = impactDamage(TUMBLER_SPEC.mass, ROLL_SPEED, rollMultiplier(1));
    expect(first).toBeLessThan(STRENGTH_HP.concrete);
    expect(first + second).toBeGreaterThanOrEqual(STRENGTH_HP.concrete);
  });
});

describe('Fishtail', () => {
  it('drops a house in a slide but not with a plain ram at the same speed', () => {
    const ram = impactDamage(FISHTAIL_SPEC.mass, 14, FISHTAIL_DAMAGE.body);
    const slide = impactDamage(FISHTAIL_SPEC.mass, 14, FISHTAIL_DAMAGE.bodySliding);
    expect(ram).toBeGreaterThanOrEqual(STRENGTH_HP.shed);
    expect(ram).toBeLessThan(STRENGTH_HP.house);
    expect(slide).toBeGreaterThanOrEqual(STRENGTH_HP.house);
  });

  it('drops brick in a slide at 72 km/h, and the tail hits hardest', () => {
    const body = impactDamage(FISHTAIL_SPEC.mass, 20, FISHTAIL_DAMAGE.bodySliding);
    const tail = impactDamage(FISHTAIL_SPEC.mass, 20, FISHTAIL_DAMAGE.tailSliding);
    expect(body).toBeGreaterThanOrEqual(STRENGTH_HP.brick);
    expect(tail).toBeGreaterThan(body);
  });
});

describe('Liftoff', () => {
  it('drops a shed by landing on it, not by bumping it', () => {
    expect(impactDamage(LIFTOFF_SPEC.mass, 9, LIFTOFF_DAMAGE.landing)).toBeGreaterThanOrEqual(
      STRENGTH_HP.shed,
    );
    expect(impactDamage(LIFTOFF_SPEC.mass, 5, LIFTOFF_DAMAGE.ram)).toBeLessThan(STRENGTH_HP.shed);
  });
});
