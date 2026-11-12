import { clamp } from '../math';

/**
 * Terrain heights on a square grid.
 *
 * The grid has `samples × samples` points and covers a square of `size` metres around
 * `(centerX, centerZ)`. `heights` stores one row after the other. A row runs along X and the rows
 * advance along Z.
 */
export class Heightfield {
  /** Distance between two neighbouring samples in metres. */
  readonly spacing: number;
  readonly minX: number;
  readonly minZ: number;

  constructor(
    readonly samples: number,
    readonly size: number,
    readonly centerX: number,
    readonly centerZ: number,
    readonly heights: Float32Array,
  ) {
    if (heights.length !== samples * samples) {
      throw new Error(`A heightfield of ${samples} samples needs ${samples * samples} heights.`);
    }
    this.spacing = size / (samples - 1);
    this.minX = centerX - size / 2;
    this.minZ = centerZ - size / 2;
  }

  /**
   * Builds a heightfield from 8-bit grey values, where 255 means `maxHeight`.
   *
   * @param grey One value per sample, row by row.
   * @param smoothingPasses How many 3 × 3 blur passes hide the 8-bit height steps.
   */
  static fromGrey(
    grey: ArrayLike<number>,
    samples: number,
    size: number,
    center: readonly [number, number],
    maxHeight: number,
    smoothingPasses = 1,
  ): Heightfield {
    let heights: Float32Array = new Float32Array(samples * samples);
    for (let i = 0; i < heights.length; i += 1) {
      heights[i] = (grey[i] / 255) * maxHeight;
    }
    for (let pass = 0; pass < smoothingPasses; pass += 1) {
      heights = blur(heights, samples);
    }
    return new Heightfield(samples, size, center[0], center[1], heights);
  }

  /** Height of one sample. Indices outside the grid use the nearest edge sample. */
  sample(ix: number, iz: number): number {
    const x = clamp(ix, 0, this.samples - 1);
    const z = clamp(iz, 0, this.samples - 1);
    return this.heights[z * this.samples + x];
  }

  /** Terrain height at a world position, interpolated between the four nearest samples. */
  heightAt(x: number, z: number): number {
    const gx = clamp((x - this.minX) / this.spacing, 0, this.samples - 1);
    const gz = clamp((z - this.minZ) / this.spacing, 0, this.samples - 1);
    const ix = Math.min(Math.floor(gx), this.samples - 2);
    const iz = Math.min(Math.floor(gz), this.samples - 2);
    const tx = gx - ix;
    const tz = gz - iz;
    const top = this.sample(ix, iz) * (1 - tx) + this.sample(ix + 1, iz) * tx;
    const bottom = this.sample(ix, iz + 1) * (1 - tx) + this.sample(ix + 1, iz + 1) * tx;
    return top * (1 - tz) + bottom * tz;
  }

  /** Unit normal of the terrain at a world position as `[x, y, z]`. */
  normalAt(x: number, z: number): [number, number, number] {
    const e = this.spacing;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx;
    const ny = 2 * e;
    const nz = -dz;
    const length = Math.hypot(nx, ny, nz);
    return [nx / length, ny / length, nz / length];
  }
}

function blur(source: Float32Array, samples: number): Float32Array {
  const result = new Float32Array(source.length);
  for (let z = 0; z < samples; z += 1) {
    for (let x = 0; x < samples; x += 1) {
      let sum = 0;
      let weight = 0;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = x + dx;
          const sz = z + dz;
          if (sx < 0 || sz < 0 || sx >= samples || sz >= samples) {
            continue;
          }
          const w = dx === 0 && dz === 0 ? 4 : dx === 0 || dz === 0 ? 2 : 1;
          sum += source[sz * samples + sx] * w;
          weight += w;
        }
      }
      result[z * samples + x] = sum / weight;
    }
  }
  return result;
}
