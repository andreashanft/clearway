import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/game/world/heightfield';

/** A 3 × 3 field that rises by 1 m per sample towards the east and covers 20 m. */
function ramp(): Heightfield {
  const heights = new Float32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
  return new Heightfield(3, 20, 100, 50, heights);
}

describe('Heightfield', () => {
  it('returns sample heights at sample positions', () => {
    const field = ramp();
    expect(field.heightAt(90, 40)).toBeCloseTo(0);
    expect(field.heightAt(100, 50)).toBeCloseTo(1);
    expect(field.heightAt(110, 60)).toBeCloseTo(2);
  });

  it('interpolates between samples', () => {
    expect(ramp().heightAt(95, 47)).toBeCloseTo(0.5);
  });

  it('uses the edge height outside the field', () => {
    const field = ramp();
    expect(field.heightAt(-1000, 50)).toBeCloseTo(0);
    expect(field.heightAt(1000, 50)).toBeCloseTo(2);
  });

  it('tilts the normal away from a rising slope', () => {
    const [nx, ny, nz] = ramp().normalAt(100, 50);
    expect(nx).toBeLessThan(0);
    expect(ny).toBeGreaterThan(0.9);
    expect(nz).toBeCloseTo(0);
  });

  it('scales grey values to the maximum height', () => {
    const field = Heightfield.fromGrey([0, 255, 0, 255], 2, 10, [0, 0], 24, 0);
    expect(field.heightAt(-5, -5)).toBeCloseTo(0);
    expect(field.heightAt(5, -5)).toBeCloseTo(24);
  });

  it('rejects a height array of the wrong size', () => {
    expect(() => new Heightfield(3, 20, 0, 0, new Float32Array(4))).toThrow();
  });
});
