import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { float, texture, uv } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { COLLISION } from '../../engine/collision-groups';
import type { Physics } from '../../engine/physics';
import type { Heightfield } from './heightfield';

/** Grid cells per terrain chunk along each axis; chunks let the camera cull what it can't see. */
const CHUNK_CELLS = 32;
/** Height of the invisible walls that keep vehicles on the map. */
const WALL_HEIGHT = 40;

/**
 * The rendered and physical ground for a level: faceted low-poly chunks textured with the
 * baked colour map, plus a matching Rapier heightfield collider.
 */
export class Terrain {
  readonly group = new Group();
  /** The baked ground colours, for the mini-map background. */
  readonly colourImage: CanvasImageSource | null;
  private readonly material: MeshStandardNodeMaterial;
  private readonly detail: DataTexture;

  constructor(
    readonly field: Heightfield,
    colourMap: Texture,
  ) {
    colourMap.colorSpace = SRGBColorSpace;
    colourMap.anisotropy = 4;
    this.colourImage = (colourMap.image as CanvasImageSource | undefined) ?? null;
    this.detail = createDetailTexture();
    // The baked colour map carries the layout; two octaves of tiling noise add grain at
    // play zoom so the ground doesn't look like a blurred photo.
    const metresToUv = field.extent;
    const fine = texture(this.detail, uv().mul(metresToUv / 5)).r;
    const coarse = texture(this.detail, uv().mul(metresToUv / 23)).r;
    const grain = fine.mul(0.12).add(coarse.mul(0.18)).add(float(0.85));
    this.material = new MeshStandardNodeMaterial({
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
    });
    this.material.colorNode = texture(colourMap).mul(grain);
    this.group.name = 'terrain';
    this.buildChunks();
  }

  /** Adds the heightfield collider and boundary walls to the physics world. */
  addColliders(physics: Physics): void {
    const { rapier, world } = physics;
    const { size, extent } = this.field;
    const cells = size - 1;
    // Rapier stores heights column by column: rows run along z, columns along x.
    const heights = new Float32Array(size * size);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) heights[i * size + j] = this.field.sample(i, j);
    }
    const ground = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    world.createCollider(
      rapier.ColliderDesc.heightfield(cells, cells, heights, { x: extent, y: 1, z: extent })
        .setFriction(0.9)
        .setRestitution(0)
        .setCollisionGroups(COLLISION.ground),
      ground,
    );

    const half = extent / 2;
    const t = 2;
    for (const [x, z, hx, hz] of [
      [half + t, 0, t, half + 2 * t],
      [-half - t, 0, t, half + 2 * t],
      [0, half + t, half + 2 * t, t],
      [0, -half - t, half + 2 * t, t],
    ] as const) {
      world.createCollider(
        rapier.ColliderDesc.cuboid(hx, WALL_HEIGHT, hz)
          .setTranslation(x, WALL_HEIGHT / 2, z)
          .setCollisionGroups(COLLISION.ground),
        ground,
      );
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) (obj.geometry as BufferGeometry).dispose();
    });
    this.detail.dispose();
    this.material.dispose();
  }

  private buildChunks(): void {
    const cells = this.field.size - 1;
    for (let cj = 0; cj < cells; cj += CHUNK_CELLS) {
      for (let ci = 0; ci < cells; ci += CHUNK_CELLS) {
        const w = Math.min(CHUNK_CELLS, cells - ci);
        const h = Math.min(CHUNK_CELLS, cells - cj);
        const mesh = new Mesh(this.chunkGeometry(ci, cj, w, h), this.material);
        mesh.receiveShadow = true;
        mesh.name = `terrain-${ci}-${cj}`;
        this.group.add(mesh);
      }
    }
  }

  private chunkGeometry(i0: number, j0: number, w: number, h: number): BufferGeometry {
    const { field } = this;
    const verts = (w + 1) * (h + 1);
    const positions = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    let p = 0;
    let t = 0;
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const gi = i0 + i;
        const gj = j0 + j;
        positions[p++] = field.coordinate(gi);
        positions[p++] = field.sample(gi, gj);
        positions[p++] = field.coordinate(gj);
        uvs[t++] = gi / (field.size - 1);
        uvs[t++] = 1 - gj / (field.size - 1);
      }
    }
    // Two triangles per cell, split along the (i, j)–(i+1, j+1) diagonal like the collider.
    const indices = new Uint32Array(w * h * 6);
    let k = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const a = j * (w + 1) + i;
        const b = a + 1;
        const c = a + (w + 1);
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = b;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** A small tileable value-noise texture used as ground grain. */
function createDetailTexture(): DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size);
  const cells = 16;
  const lattice = new Float32Array(cells * cells);
  let seed = 1234567;
  for (let k = 0; k < lattice.length; k++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    lattice[k] = seed / 0x7fffffff;
  }
  const at = (i: number, j: number): number =>
    lattice[((j + cells) % cells) * cells + ((i + cells) % cells)] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const u = fx - i;
      const v = fy - j;
      const su = u * u * (3 - 2 * u);
      const sv = v * v * (3 - 2 * v);
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
      const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
      data[y * size + x] = Math.round((top + (bottom - top) * sv) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RedFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
