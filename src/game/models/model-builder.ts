import {
  type BufferGeometry,
  Euler,
  Group,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface Placement {
  readonly at?: readonly [number, number, number];
  /** Euler rotation in radians (XYZ order). */
  readonly rotate?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
}

/**
 * Collects primitive parts with their transforms and merges them into one mesh per
 * material, so a detailed model still costs only a few draw calls.
 */
export class ModelBuilder {
  private readonly parts = new Map<Material, BufferGeometry[]>();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly euler = new Euler();
  private readonly scaleVec = new Vector3();

  /** Adds a geometry. The builder takes ownership and transforms it in place. */
  add(geometry: BufferGeometry, material: Material, placement: Placement = {}): this {
    const [px, py, pz] = placement.at ?? [0, 0, 0];
    const [rx, ry, rz] = placement.rotate ?? [0, 0, 0];
    const [sx, sy, sz] = placement.scale ?? [1, 1, 1];
    this.matrix.compose(
      this.position.set(px, py, pz),
      this.quaternion.setFromEuler(this.euler.set(rx, ry, rz)),
      this.scaleVec.set(sx, sy, sz),
    );
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(this.matrix);
    let list = this.parts.get(material);
    if (!list) {
      list = [];
      this.parts.set(material, list);
    }
    list.push(g);
    return this;
  }

  /** Adds the same geometry mirrored across the x = 0 plane as well. */
  addMirrored(geometry: BufferGeometry, material: Material, placement: Placement): this {
    const [x, y, z] = placement.at ?? [0, 0, 0];
    const [rx, ry, rz] = placement.rotate ?? [0, 0, 0];
    this.add(geometry.clone(), material, { ...placement, at: [x, y, z] });
    return this.add(geometry, material, { ...placement, at: [-x, y, z], rotate: [rx, -ry, -rz] });
  }

  /** Merges everything added so far into a group of meshes, one per material. */
  build(name: string, shadows = true): Group {
    const group = new Group();
    group.name = name;
    for (const [material, list] of this.parts) {
      const geometry = mergeGeometries(list.map(stripToCommon));
      for (const g of list) g.dispose();
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Keeps only position, normal and uv so geometries from different primitives can merge. */
function stripToCommon(geometry: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
  }
  return geometry;
}
