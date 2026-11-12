import RAPIER from '@dimforge/rapier3d-compat';
import { STEP_SECONDS } from './loop';

export { RAPIER };

/**
 * Gravity in m/s². It is stronger than on Earth on purpose: debris and jumps fall faster, which
 * makes the world read as a toy diorama.
 */
export const GRAVITY = 22;

/**
 * Collision layers. A collider belongs to one layer and names the layers it collides with.
 * Rapier packs both into one number: the upper 16 bits hold the membership, the lower the filter.
 */
export const Layer = {
  terrain: 0x0001,
  building: 0x0002,
  vehicle: 0x0004,
  debris: 0x0008,
  crate: 0x0010,
  prop: 0x0020,
  hauler: 0x0040,
  pilot: 0x0080,
  bridge: 0x0100,
} as const;

/** Builds a Rapier interaction group from a membership mask and a filter mask. */
export function collisionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Loads the Rapier WebAssembly module. Call it once before creating a world. */
export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

/** A started or ended contact between two colliders. */
export interface CollisionEvent {
  a: RAPIER.Collider;
  b: RAPIER.Collider;
  started: boolean;
}

/** Wraps a Rapier world that advances in fixed steps and collects collision events. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = STEP_SECONDS;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /**
   * Advances the simulation by one fixed step.
   *
   * @param onCollision Called for each contact that started or ended during the step.
   */
  step(onCollision?: (event: CollisionEvent) => void): void {
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((handleA, handleB, started) => {
      if (!onCollision) {
        return;
      }
      const a = this.world.getCollider(handleA);
      const b = this.world.getCollider(handleB);
      // A collider can be removed in the same step that reports its contact.
      if (a && b) {
        onCollision({ a, b, started });
      }
    });
  }

  /** Number of rigid bodies in the world, for the debug overlay. */
  get bodyCount(): number {
    return this.world.bodies.len();
  }

  /** Frees the WebAssembly memory of the world. */
  dispose(): void {
    this.eventQueue.free();
    this.world.free();
  }
}
