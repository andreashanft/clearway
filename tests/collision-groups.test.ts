import { describe, expect, it } from 'vitest';
import { COLLISION } from '../src/engine/collision-groups';

/** True when Rapier would let colliders with these interaction groups touch. */
function interacts(a: number, b: number): boolean {
  return ((a >>> 16) & b & 0xffff) !== 0 && ((b >>> 16) & a & 0xffff) !== 0;
}

describe('collision groups', () => {
  it('lets debris land on the ground, buildings and other debris', () => {
    expect(interacts(COLLISION.chunk, COLLISION.ground)).toBe(true);
    expect(interacts(COLLISION.chunk, COLLISION.building)).toBe(true);
    expect(interacts(COLLISION.chunk, COLLISION.chunk)).toBe(true);
  });

  it('keeps debris away from vehicles and crates', () => {
    expect(interacts(COLLISION.chunk, COLLISION.vehicle)).toBe(false);
    expect(interacts(COLLISION.chunk, COLLISION.tnt)).toBe(false);
  });

  it('still lets vehicles hit buildings, crates and each other', () => {
    expect(interacts(COLLISION.vehicle, COLLISION.building)).toBe(true);
    expect(interacts(COLLISION.vehicle, COLLISION.tnt)).toBe(true);
    expect(interacts(COLLISION.vehicle, COLLISION.vehicle)).toBe(true);
  });
});
