import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { LevelData } from '../level';
import { seededRandom, toBoxLocal, type OrientedBox, type Vec2 } from '../math';
import type { Heightfield } from './heightfield';

const CROWN_COLORS = [0x4f7f3e, 0x5a8a45, 0x467238, 0x558443];
const CROWN_HIGHLIGHT = 0x6a9a52;
const TRUNK_COLOR = 0x6e5338;
const HEDGE_COLORS = [0x4f7f3e, 0x487539, 0x568744];

/** Length of one hedge piece in metres. Vehicles crush hedges piece by piece. */
const HEDGE_PIECE_LENGTH = 3.2;
const HEDGE_WIDTH = 2.6;
const HEDGE_HEIGHT = 2.3;

/** One piece of a hedge. */
export interface HedgePiece {
  x: number;
  z: number;
  /** Index of the piece in the instanced mesh. */
  index: number;
  crushed: boolean;
  /** Placement of the piece while it stands. */
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
}

/** Trees and hedges of a level. */
export interface Scenery {
  object: THREE.Object3D;
  hedgePieces: HedgePiece[];
  hedgeMesh: THREE.InstancedMesh | undefined;
}

/** Builds the trees and hedges of a level. Trees get a solid trunk; hedges have no collider. */
export function createScenery(
  level: LevelData,
  heightfield: Heightfield,
  physics: PhysicsWorld,
): Scenery {
  const object = new THREE.Group();
  object.name = 'scenery';
  const random = seededRandom(level.index * 977);

  addTrees(object, level.scenery.trees, heightfield, physics, random);
  const { pieces, mesh } = addHedges(object, level.scenery.hedges, heightfield, random);

  return { object, hedgePieces: pieces, hedgeMesh: mesh };
}

function addTrees(
  parent: THREE.Object3D,
  trees: readonly [number, number, number][],
  heightfield: Heightfield,
  physics: PhysicsWorld,
  random: () => number,
): void {
  if (trees.length === 0) {
    return;
  }
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.7, 0.95, 1, 6),
    new THREE.MeshLambertMaterial({ color: TRUNK_COLOR }),
    trees.length,
  );
  const crownGeometry = new THREE.IcosahedronGeometry(1, 0);
  const crowns = new THREE.InstancedMesh(
    crownGeometry,
    new THREE.MeshLambertMaterial({ flatShading: true }),
    trees.length,
  );
  const highlights = new THREE.InstancedMesh(
    crownGeometry,
    new THREE.MeshLambertMaterial({ color: CROWN_HIGHLIGHT, flatShading: true }),
    trees.length,
  );

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const color = new THREE.Color();

  trees.forEach(([x, z, radius], index) => {
    const ground = heightfield.heightAt(x, z);
    const trunkHeight = radius * 1.1;
    const crownHeight = radius * (1.0 + random() * 0.25);

    matrix.compose(
      new THREE.Vector3(x, ground + trunkHeight / 2, z),
      rotation.identity(),
      new THREE.Vector3(radius * 0.22, trunkHeight, radius * 0.22),
    );
    trunks.setMatrixAt(index, matrix);

    euler.set(random() * 0.4, random() * Math.PI * 2, random() * 0.4);
    rotation.setFromEuler(euler);
    const crownY = ground + trunkHeight + crownHeight * 0.55;
    matrix.compose(
      new THREE.Vector3(x, crownY, z),
      rotation,
      new THREE.Vector3(radius, crownHeight, radius),
    );
    crowns.setMatrixAt(index, matrix);
    crowns.setColorAt(index, color.setHex(CROWN_COLORS[index % CROWN_COLORS.length]));

    // A smaller, lighter blob towards the sun gives the crown a readable highlight.
    matrix.compose(
      new THREE.Vector3(x - radius * 0.28, crownY + crownHeight * 0.38, z - radius * 0.22),
      rotation,
      new THREE.Vector3(radius * 0.55, crownHeight * 0.5, radius * 0.55),
    );
    highlights.setMatrixAt(index, matrix);

    physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(trunkHeight, Math.max(0.6, radius * 0.24))
        .setTranslation(x, ground + trunkHeight, z)
        .setCollisionGroups(collisionGroups(Layer.prop, 0xffff)),
    );
  });

  for (const mesh of [trunks, crowns, highlights]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
  }
  trunks.name = 'tree-trunks';
  crowns.name = 'tree-crowns';
  highlights.name = 'tree-highlights';
}

function addHedges(
  parent: THREE.Object3D,
  hedges: readonly Vec2[][],
  heightfield: Heightfield,
  random: () => number,
): { pieces: HedgePiece[]; mesh: THREE.InstancedMesh | undefined } {
  const placements: { x: number; z: number; heading: number; length: number }[] = [];
  for (const hedge of hedges) {
    for (let i = 0; i + 1 < hedge.length; i += 1) {
      const [ax, az] = hedge[i];
      const [bx, bz] = hedge[i + 1];
      const length = Math.hypot(bx - ax, bz - az);
      const count = Math.max(1, Math.round(length / HEDGE_PIECE_LENGTH));
      for (let piece = 0; piece < count; piece += 1) {
        const t = (piece + 0.5) / count;
        placements.push({
          x: ax + (bx - ax) * t,
          z: az + (bz - az) * t,
          heading: Math.atan2(bz - az, bx - ax),
          length: length / count,
        });
      }
    }
  }
  // Pieces outside the terrain square would float over the apron.
  const inside = placements.filter(
    (p) =>
      Math.abs(p.x - heightfield.centerX) < heightfield.size / 2 &&
      Math.abs(p.z - heightfield.centerZ) < heightfield.size / 2,
  );
  if (inside.length === 0) {
    return { pieces: [], mesh: undefined };
  }

  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial(),
    inside.length,
  );
  mesh.name = 'hedges';
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const pieces: HedgePiece[] = [];

  inside.forEach((placement, index) => {
    const height = HEDGE_HEIGHT * (0.88 + random() * 0.24);
    const ground = heightfield.heightAt(placement.x, placement.z);
    rotation.setFromAxisAngle(up, -placement.heading);
    const position = new THREE.Vector3(placement.x, ground + height / 2 - 0.15, placement.z);
    const scale = new THREE.Vector3(
      placement.length + 0.3,
      height,
      HEDGE_WIDTH * (0.9 + random() * 0.2),
    );
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.setHex(HEDGE_COLORS[index % HEDGE_COLORS.length]));
    pieces.push({
      x: placement.x,
      z: placement.z,
      index,
      crushed: false,
      position,
      rotation: rotation.clone(),
      scale,
    });
  });

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return { pieces, mesh };
}

/** How far a hedge piece reaches from its centre, for the overlap test. */
const HEDGE_REACH = 1.8;
/** A crushed hedge piece keeps this fraction of its height. */
const CRUSHED_HEIGHT = 0.14;

const crushMatrix = new THREE.Matrix4();
const crushPosition = new THREE.Vector3();
const crushScale = new THREE.Vector3();

/**
 * Flattens every hedge piece under a box, for example under a vehicle.
 *
 * @param onCrush Called for each piece that was flattened in this call.
 */
export function crushHedges(
  scenery: Scenery,
  box: OrientedBox,
  onCrush: (position: THREE.Vector3) => void,
): void {
  const mesh = scenery.hedgeMesh;
  if (!mesh) {
    return;
  }
  const reach = Math.hypot(box.half[0], box.half[1]) + HEDGE_REACH;
  let changed = false;
  for (const piece of scenery.hedgePieces) {
    if (
      piece.crushed ||
      Math.abs(piece.x - box.center[0]) > reach ||
      Math.abs(piece.z - box.center[1]) > reach
    ) {
      continue;
    }
    const local = toBoxLocal([piece.x, piece.z], box);
    if (
      Math.abs(local[0]) > box.half[0] + HEDGE_REACH ||
      Math.abs(local[1]) > box.half[1] + HEDGE_REACH
    ) {
      continue;
    }
    piece.crushed = true;
    crushScale.copy(piece.scale);
    crushScale.y *= CRUSHED_HEIGHT;
    crushScale.z *= 1.25;
    crushPosition.copy(piece.position);
    crushPosition.y -= (piece.scale.y * (1 - CRUSHED_HEIGHT)) / 2;
    crushMatrix.compose(crushPosition, piece.rotation, crushScale);
    mesh.setMatrixAt(piece.index, crushMatrix);
    changed = true;
    onCrush(piece.position);
  }
  if (changed) {
    mesh.instanceMatrix.needsUpdate = true;
  }
}
