import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Helpers for building vertex-coloured, non-indexed geometry from primitives. Everything
 * that shares one vertex-colour material can then be merged or batched together.
 */

export type Vec3 = readonly [number, number, number];

const tmpColor = new Color();
const tmpMatrix = new Matrix4();
const tmpPosition = new Vector3();
const tmpQuaternion = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3(1, 1, 1);

/** Gives every vertex one colour and drops attributes other than position and normal. */
export function paint(geometry: BufferGeometry, colour: string | Color): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const c = typeof colour === 'string' ? tmpColor.set(colour) : colour;
  const count = g.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) colours.set([c.r, c.g, c.b], k * 3);
  g.setAttribute('color', new BufferAttribute(colours, 3));
  if (g.hasAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/** Moves and rotates a geometry in place. */
export function place(
  geometry: BufferGeometry,
  at: Vec3 = [0, 0, 0],
  rotate: Vec3 = [0, 0, 0],
): BufferGeometry {
  tmpMatrix.compose(
    tmpPosition.set(...at),
    tmpQuaternion.setFromEuler(tmpEuler.set(...rotate)),
    tmpScale,
  );
  return geometry.applyMatrix4(tmpMatrix);
}

/** A painted box centred at `at`. */
export function box(
  size: Vec3,
  colour: string,
  at: Vec3 = [0, 0, 0],
  rotate: Vec3 = [0, 0, 0],
): BufferGeometry {
  return place(paint(new BoxGeometry(...size), colour), at, rotate);
}

/** Merges painted parts into one geometry. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** A triangular prism (a gable end): base along x, apex up, thickness along z. */
export function gable(
  width: number,
  height: number,
  depth: number,
  colour: string,
): BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const h = height;
  // Front triangle (z = +d), back triangle (z = −d), two sloped quads and the base.
  const v = [
    [-w, 0, d],
    [w, 0, d],
    [0, h, d],
    [w, 0, -d],
    [-w, 0, -d],
    [0, h, -d],
    [-w, 0, d],
    [0, h, d],
    [0, h, -d],
    [-w, 0, d],
    [0, h, -d],
    [-w, 0, -d],
    [w, 0, d],
    [w, 0, -d],
    [0, h, -d],
    [w, 0, d],
    [0, h, -d],
    [0, h, d],
    [-w, 0, d],
    [-w, 0, -d],
    [w, 0, -d],
    [-w, 0, d],
    [w, 0, -d],
    [w, 0, d],
  ];
  const positions = new Float32Array(v.flat());
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return paint(g, colour);
}

/** Scales the colours of a painted geometry, for example to darken a variant. */
export function shade(geometry: BufferGeometry, factor: number): BufferGeometry {
  const colours = geometry.getAttribute('color');
  for (let k = 0; k < colours.count * 3; k++) {
    (colours.array as Float32Array)[k] = Math.min(
      1,
      ((colours.array as Float32Array)[k] ?? 0) * factor,
    );
  }
  colours.needsUpdate = true;
  return geometry;
}
