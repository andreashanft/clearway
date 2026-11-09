import { type BufferGeometry, Euler, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyFinish, FINISH_MATERIAL, type Finish } from './finish';

export interface Placement {
  readonly at?: readonly [number, number, number];
  /** Euler rotation in radians (XYZ order). */
  readonly rotate?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
}

/**
 * Collects primitive parts, each with a surface finish and a transform, and merges them
 * into one mesh on the shared finish material: one draw however detailed the model.
 */
export class ModelBuilder {
  private readonly parts: BufferGeometry[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly euler = new Euler();
  private readonly scaleVec = new Vector3();

  /** Adds a geometry. The builder takes ownership and transforms it in place. */
  add(geometry: BufferGeometry, finish: Finish, placement: Placement = {}): this {
    const [px, py, pz] = placement.at ?? [0, 0, 0];
    const [rx, ry, rz] = placement.rotate ?? [0, 0, 0];
    const [sx, sy, sz] = placement.scale ?? [1, 1, 1];
    this.matrix.compose(
      this.position.set(px, py, pz),
      this.quaternion.setFromEuler(this.euler.set(rx, ry, rz)),
      this.scaleVec.set(sx, sy, sz),
    );
    const g = applyFinish(geometry, finish);
    g.applyMatrix4(this.matrix);
    this.parts.push(g);
    return this;
  }

  /** Adds the same geometry mirrored across the x = 0 plane as well. */
  addMirrored(geometry: BufferGeometry, finish: Finish, placement: Placement): this {
    const [x, y, z] = placement.at ?? [0, 0, 0];
    const [rx, ry, rz] = placement.rotate ?? [0, 0, 0];
    this.add(geometry.clone(), finish, { ...placement, at: [x, y, z] });
    return this.add(geometry, finish, { ...placement, at: [-x, y, z], rotate: [rx, -ry, -rz] });
  }

  /** Merges everything added so far into one mesh. */
  build(name: string, shadows = true): Mesh {
    const geometry = mergeGeometries(this.parts);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, FINISH_MATERIAL);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    return mesh;
  }
}
