import * as THREE from 'three/webgpu';

type Point = [number, number, number];

/** Texture coordinates repeat once per this many metres. */
const UV_METRES = 9;

/**
 * Builds one flat-shaded, vertex-coloured mesh out of simple solids.
 *
 * A building segment or a prop is made of a few boxes, roofs and cylinders. Merging them into one
 * geometry keeps every segment at one draw call.
 */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly color = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();

  /** Sets the placement of the solids that follow: a position and a rotation around Y. */
  place(position: Point = [0, 0, 0], rotationY = 0): this {
    this.matrix.makeRotationY(rotationY).setPosition(...position);
    return this;
  }

  /** Adds a box. `center` and `size` are in the current placement. */
  box(size: Point, center: Point, color: number): this {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const [cx, cy, cz] = center;
    const corner = (sx: number, sy: number, sz: number): Point => [
      cx + sx * hx,
      cy + sy * hy,
      cz + sz * hz,
    ];
    this.quad(corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1), color);
    this.quad(corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), color);
    this.quad(corner(1, -1, 1), corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), color);
    this.quad(corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1), color);
    this.quad(corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), corner(-1, 1, -1), color);
    this.quad(corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1), color);
    return this;
  }

  /**
   * Adds a gabled roof whose ridge runs along X.
   *
   * @param length Size along X.
   * @param width Size along Z at the eaves.
   * @param height Height of the ridge above the eaves.
   * @param base Centre of the roof at eaves height.
   */
  gable(length: number, width: number, height: number, base: Point, color: number): this {
    const [cx, cy, cz] = base;
    const hl = length / 2;
    const hw = width / 2;
    const a: Point = [cx - hl, cy, cz + hw];
    const b: Point = [cx + hl, cy, cz + hw];
    const c: Point = [cx + hl, cy, cz - hw];
    const d: Point = [cx - hl, cy, cz - hw];
    const r0: Point = [cx - hl, cy + height, cz];
    const r1: Point = [cx + hl, cy + height, cz];
    this.quad(a, b, r1, r0, color);
    this.quad(c, d, r0, r1, color);
    this.triangle(b, c, r1, color);
    this.triangle(d, a, r0, color);
    return this;
  }

  /**
   * Adds a single-pitch roof that rises along Z.
   *
   * @param base Centre of the roof at the height of its low edge.
   */
  wedge(length: number, width: number, height: number, base: Point, color: number): this {
    const [cx, cy, cz] = base;
    const hl = length / 2;
    const hw = width / 2;
    const a: Point = [cx - hl, cy, cz + hw];
    const b: Point = [cx + hl, cy, cz + hw];
    const c: Point = [cx + hl, cy, cz - hw];
    const d: Point = [cx - hl, cy, cz - hw];
    const c1: Point = [cx + hl, cy + height, cz - hw];
    const d1: Point = [cx - hl, cy + height, cz - hw];
    this.quad(a, b, c1, d1, color);
    this.quad(c, d, d1, c1, color);
    this.triangle(b, c, c1, color);
    this.triangle(d, a, d1, color);
    return this;
  }

  /**
   * Adds a cylinder or, with a top radius of 0, a cone.
   *
   * @param base Centre of the bottom face.
   * @param axis `y` stands upright, `x` lies along X.
   */
  cylinder(
    radiusBottom: number,
    radiusTop: number,
    height: number,
    base: Point,
    color: number,
    segments = 12,
    axis: 'x' | 'y' = 'y',
  ): this {
    const at = (angle: number, radius: number, along: number): Point =>
      axis === 'y'
        ? [base[0] + Math.cos(angle) * radius, base[1] + along, base[2] + Math.sin(angle) * radius]
        : [base[0] + along, base[1] + Math.sin(angle) * radius, base[2] + Math.cos(angle) * radius];
    const topCentre = at(0, 0, height);
    const bottomCentre = at(0, 0, 0);
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const b0 = at(a0, radiusBottom, 0);
      const b1 = at(a1, radiusBottom, 0);
      const t0 = at(a0, radiusTop, height);
      const t1 = at(a1, radiusTop, height);
      if (radiusTop > 0) {
        this.quad(b1, b0, t0, t1, color);
        this.triangle(t0, topCentre, t1, color);
      } else {
        this.triangle(b1, b0, topCentre, color);
      }
      this.triangle(b0, b1, bottomCentre, color);
    }
    return this;
  }

  /** Builds the geometry. The builder can be reused afterwards. */
  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    this.positions.length = 0;
    this.normals.length = 0;
    this.colors.length = 0;
    this.uvs.length = 0;
    return geometry;
  }

  private quad(a: Point, b: Point, c: Point, d: Point, color: number): void {
    this.triangle(a, b, c, color);
    this.triangle(a, c, d, color);
  }

  /** Adds a triangle. Its corners run anticlockwise when seen from outside. */
  private triangle(a: Point, b: Point, c: Point, color: number): void {
    const points = [a, b, c].map((p) =>
      this.scratch
        .set(...p)
        .applyMatrix4(this.matrix)
        .toArray(),
    );
    const [p0, p1, p2] = points;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    this.color.setHex(color);
    for (const p of points) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(this.color.r, this.color.g, this.color.b);
      // Project the texture along the axis that the face looks along most.
      if (Math.abs(ny) > 0.7) {
        this.uvs.push(p[0] / UV_METRES, p[2] / UV_METRES);
      } else if (Math.abs(nx) > Math.abs(nz)) {
        this.uvs.push(p[2] / UV_METRES, p[1] / UV_METRES);
      } else {
        this.uvs.push(p[0] / UV_METRES, p[1] / UV_METRES);
      }
    }
  }
}

/** Darkens (`amount < 0`) or lightens (`amount > 0`) a colour. */
export function shade(color: number | string, amount: number): number {
  return new THREE.Color(color).offsetHSL(0, 0, amount).getHex();
}
