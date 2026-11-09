import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/game/world/heightfield';

/** A 3 × 3 grid, 2 m apart, centred on the origin (x and z run from −2 to 2). */
function grid(heights: number[]): Heightfield {
  return new Heightfield(3, 2, Float32Array.from(heights));
}

describe('Heightfield', () => {
  it('rejects a height array of the wrong length', () => {
    expect(() => new Heightfield(3, 1, new Float32Array(8))).toThrow(RangeError);
  });

  it('centres the grid on the origin', () => {
    const field = grid([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(field.extent).toBe(4);
    expect(field.coordinate(0)).toBe(-2);
    expect(field.coordinate(2)).toBe(2);
    expect(field.contains(2, -2)).toBe(true);
    expect(field.contains(2.1, 0)).toBe(false);
  });

  it('returns exact heights at the samples', () => {
    const field = grid([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(field.heightAt(-2, -2)).toBeCloseTo(1);
    expect(field.heightAt(0, 0)).toBeCloseTo(5);
    expect(field.heightAt(2, 2)).toBeCloseTo(9);
    expect(field.heightAt(2, -2)).toBeCloseTo(3);
  });

  it('interpolates on the triangles split along the (i, j)–(i+1, j+1) diagonal', () => {
    // Only the far corner of the first cell is raised.
    const field = grid([0, 0, 0, 0, 4, 0, 0, 0, 0]);
    // On the diagonal the height rises linearly to the raised corner.
    expect(field.heightAt(-1, -1)).toBeCloseTo(2);
    // Off the diagonal, in the triangle (i, j), (i + 1, j), (i + 1, j + 1).
    expect(field.heightAt(-0.5, -1.5)).toBeCloseTo(1);
    // The mirrored point in the other triangle gives the same height.
    expect(field.heightAt(-1.5, -0.5)).toBeCloseTo(1);
  });

  it('clamps positions outside the grid to the edge', () => {
    const field = grid([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(field.heightAt(-10, -10)).toBeCloseTo(1);
    expect(field.heightAt(10, 10)).toBeCloseTo(9);
  });

  it('converts 8-bit grayscale to metres', () => {
    const field = Heightfield.fromGrayscale([0, 255, 51, 102], 2, 4, 30);
    expect(field.sample(0, 0)).toBe(0);
    expect(field.sample(1, 0)).toBeCloseTo(30);
    expect(field.sample(0, 1)).toBeCloseTo(6);
  });

  it('points the normal up on flat ground and away from a slope', () => {
    const flat = grid([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(flat.normalAt(0, 0).y).toBeCloseTo(1);
    // Rising towards +x, so the normal leans towards −x.
    const ramp = grid([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const n = ramp.normalAt(0, 0);
    expect(n.x).toBeLessThan(0);
    expect(n.y).toBeGreaterThan(0.8);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
  });
});
