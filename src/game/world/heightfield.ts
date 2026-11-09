/**
 * A square grid of terrain heights centred on the world origin. Sample (i, j) sits at
 * x = (i − (size − 1) / 2) × spacing and z = (j − (size − 1) / 2) × spacing.
 */
export class Heightfield {
  /** Width and depth of the whole grid in metres. */
  readonly extent: number;
  private readonly half: number;

  constructor(
    /** Samples per side. */
    readonly size: number,
    /** Metres between neighbouring samples. */
    readonly spacing: number,
    /** Heights in metres, row by row (index = j × size + i). */
    readonly heights: Float32Array,
  ) {
    if (heights.length !== size * size) {
      throw new RangeError(`Expected ${size * size} heights, got ${heights.length}`);
    }
    this.extent = (size - 1) * spacing;
    this.half = this.extent / 2;
  }

  /** Builds a heightfield from 8-bit grayscale pixel values (0 = 0 m, 255 = maxHeight). */
  static fromGrayscale(
    pixels: ArrayLike<number>,
    size: number,
    spacing: number,
    maxHeight: number,
  ): Heightfield {
    const heights = new Float32Array(size * size);
    for (let k = 0; k < heights.length; k++) heights[k] = ((pixels[k] ?? 0) / 255) * maxHeight;
    return new Heightfield(size, spacing, heights);
  }

  /** Height of grid sample (i, j), clamped to the grid edge. */
  sample(i: number, j: number): number {
    const ci = Math.min(this.size - 1, Math.max(0, i));
    const cj = Math.min(this.size - 1, Math.max(0, j));
    return this.heights[cj * this.size + ci] ?? 0;
  }

  /** World x or z of grid index `i`. */
  coordinate(i: number): number {
    return i * this.spacing - this.half;
  }

  /**
   * Height at a world position, matching the rendered and physical surface: each grid
   * cell is split into two triangles along the diagonal from (i, j) to (i + 1, j + 1).
   */
  heightAt(x: number, z: number): number {
    const fx = (x + this.half) / this.spacing;
    const fz = (z + this.half) / this.spacing;
    const i = Math.min(this.size - 2, Math.max(0, Math.floor(fx)));
    const j = Math.min(this.size - 2, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const h00 = this.sample(i, j);
    const h11 = this.sample(i + 1, j + 1);
    if (u >= v) {
      const h10 = this.sample(i + 1, j);
      return h00 + (h10 - h00) * u + (h11 - h10) * v;
    }
    const h01 = this.sample(i, j + 1);
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  /** Unit surface normal at a world position, from central differences. */
  normalAt(x: number, z: number): { x: number; y: number; z: number } {
    const e = this.spacing * 0.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx;
    const ny = 2 * e;
    const nz = -dz;
    const len = Math.hypot(nx, ny, nz);
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /** True when the position lies over the grid. */
  contains(x: number, z: number): boolean {
    return Math.abs(x) <= this.half && Math.abs(z) <= this.half;
  }
}
