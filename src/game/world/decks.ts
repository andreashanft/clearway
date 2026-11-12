import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { DeckData } from '../level';
import { DEG, toBoxLocal, type OrientedBox } from '../math';
import { MeshBuilder, shade } from './mesh-builder';

/** A vehicle may be this far below a deck and still count as driving onto it, in metres. */
const STEP_UP = 1.4;
const DECK_THICKNESS = 1.2;

/** A surface above the terrain that vehicles drive on: a road bridge, or the deck of the Railbed. */
export interface Deck {
  box: OrientedBox;
  /** Height of the driving surface in metres. */
  top: number;
}

/** Returns the height of a deck at a point, or `undefined` when the point is not on it. */
export function deckHeightAt(deck: Deck, x: number, z: number, fromY: number): number | undefined {
  // A vehicle well below the deck drives under it.
  if (fromY < deck.top - STEP_UP) {
    return undefined;
  }
  const local = toBoxLocal([x, z], deck.box);
  return Math.abs(local[0]) <= deck.box.half[0] && Math.abs(local[1]) <= deck.box.half[1]
    ? deck.top
    : undefined;
}

/** Builds the fixed decks of a level: slabs with kerbs, and colliders for debris and crates. */
export function createDecks(
  data: readonly DeckData[],
  physics: PhysicsWorld,
): { object: THREE.Object3D; decks: Deck[] } {
  const object = new THREE.Group();
  object.name = 'decks';
  const decks: Deck[] = [];
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  for (const deck of data) {
    const heading = deck.yaw * DEG;
    const color = Number.parseInt((deck.color ?? '#55524D').slice(1), 16);
    const builder = new MeshBuilder();
    builder.box([deck.size[0], DECK_THICKNESS, deck.size[1]], [0, -DECK_THICKNESS / 2, 0], color);
    for (const side of [-1, 1]) {
      builder.box(
        [deck.size[0], 1.2, 0.6],
        [0, 0.5, side * (deck.size[1] / 2 - 0.3)],
        shade(color, 0.12),
      );
    }
    const mesh = new THREE.Mesh(builder.build(), material);
    mesh.position.set(deck.center[0], deck.top, deck.center[1]);
    mesh.rotation.y = -heading;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    object.add(mesh);

    const half = -heading / 2;
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(deck.size[0] / 2, DECK_THICKNESS / 2, deck.size[1] / 2)
        .setTranslation(deck.center[0], deck.top - DECK_THICKNESS / 2, deck.center[1])
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
        // Loose things rest on a bridge. Vehicles follow it through their ground query.
        .setCollisionGroups(collisionGroups(Layer.terrain, Layer.debris | Layer.crate)),
    );
    decks.push({
      box: { center: deck.center, half: [deck.size[0] / 2, deck.size[1] / 2], heading },
      top: deck.top,
    });
  }
  return { object, decks };
}
