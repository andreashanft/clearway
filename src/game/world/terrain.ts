import { texture, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { LevelData } from '../level';
import { createGroundDetail, paintGround } from './ground-paint';
import { Heightfield } from './heightfield';

/** The detail texture repeats once per this many metres. */
const DETAIL_TILE_METRES = 14;

/** How far the flat apron reaches beyond the terrain square, in metres. */
const APRON_SIZE = 4000;

/** The ground of a level: the height data, the mesh and the physics collider. */
export interface Terrain {
  heightfield: Heightfield;
  /** Contains the terrain mesh, the apron and the water. */
  object: THREE.Object3D;
  collider: RAPIER.Collider;
}

/** Loads a heightmap image and returns its grey values, row by row. */
export async function loadHeightmap(url: string): Promise<{ grey: Uint8Array; samples: number }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The heightmap ${url} did not load (HTTP ${response.status}).`);
  }
  // `createImageBitmap` decodes without waiting for the page to draw, so a level also loads in a
  // background tab. The options keep the grey values exactly as stored.
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  if (bitmap.width !== bitmap.height) {
    throw new Error(`The heightmap ${url} must be square.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('The browser cannot create a 2D canvas to read the heightmap.');
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const grey = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < grey.length; i += 1) {
    grey[i] = pixels[i * 4];
  }
  return { grey, samples: canvas.width };
}

/** Builds the terrain of a level and adds its collider to the physics world. */
export function createTerrain(
  level: LevelData,
  heightmap: { grey: Uint8Array; samples: number },
  physics: PhysicsWorld,
): Terrain {
  const { terrain } = level;
  const heightfield = Heightfield.fromGrey(
    heightmap.grey,
    heightmap.samples,
    terrain.size,
    terrain.center,
    terrain.maxHeight,
  );

  const object = new THREE.Group();
  object.name = 'terrain';
  object.add(createTerrainMesh(heightfield, paintGround(terrain, level.ground)));
  object.add(createApron(heightfield, terrain.baseColor));
  if (terrain.waterLevel !== undefined) {
    object.add(createWater(heightfield, terrain.waterLevel));
  }

  return { heightfield, object, collider: createCollider(heightfield, physics) };
}

function createTerrainMesh(heightfield: Heightfield, groundTexture: THREE.Texture): THREE.Mesh {
  const { samples, size } = heightfield;
  const geometry = new THREE.PlaneGeometry(size, size, samples - 1, samples - 1);
  // The plane is built in the XY plane. Lay it flat, so that its rows run along X and advance
  // along Z, like the heightfield.
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    position.setY(i, heightfield.heights[i]);
  }
  geometry.translate(heightfield.centerX, 0, heightfield.centerZ);
  geometry.computeVertexNormals();

  // Painted ground times a repeating detail texture. Mid-grey detail times two is neutral.
  const material = new THREE.MeshLambertNodeMaterial();
  const detail = texture(createGroundDetail(), uv().mul(size / DETAIL_TILE_METRES));
  material.colorNode = texture(groundTexture, uv()).mul(detail.r.mul(2));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain-mesh';
  mesh.receiveShadow = true;
  return mesh;
}

/** A large flat plane below the terrain edge, so that the camera never sees past the world. */
function createApron(heightfield: Heightfield, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(APRON_SIZE, APRON_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.name = 'terrain-apron';
  // The apron lies below the lowest point of the terrain, so that it never covers a valley.
  let lowest = Infinity;
  for (const height of heightfield.heights) {
    lowest = Math.min(lowest, height);
  }
  mesh.position.set(heightfield.centerX, lowest - 0.4, heightfield.centerZ);
  return mesh;
}

/** One flat sheet at the water level. It shows wherever the terrain dips below it. */
function createWater(heightfield: Heightfield, waterLevel: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(heightfield.size, heightfield.size).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x4e9cc2, transparent: true, opacity: 0.82 }),
  );
  mesh.name = 'water';
  mesh.position.set(heightfield.centerX, waterLevel, heightfield.centerZ);
  return mesh;
}

function createCollider(heightfield: Heightfield, physics: PhysicsWorld): RAPIER.Collider {
  const { samples, size } = heightfield;
  // Rapier stores heights column by column: one column per step along X, running along Z.
  const columnMajor = new Float32Array(samples * samples);
  for (let ix = 0; ix < samples; ix += 1) {
    for (let iz = 0; iz < samples; iz += 1) {
      columnMajor[ix * samples + iz] = heightfield.heights[iz * samples + ix];
    }
  }
  return physics.world.createCollider(
    RAPIER.ColliderDesc.heightfield(samples - 1, samples - 1, columnMajor, {
      x: size,
      y: 1,
      z: size,
    })
      .setTranslation(heightfield.centerX, 0, heightfield.centerZ)
      .setFriction(0.9)
      .setCollisionGroups(collisionGroups(Layer.terrain, 0xffff)),
  );
}
