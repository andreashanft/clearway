import type * as THREE from 'three/webgpu';
import type { EventBus } from '../../engine/events';
import type { PhysicsWorld } from '../../engine/physics';
import type { ExplosionSource, GameEvents } from '../events';
import type { Vehicle } from '../vehicles/vehicle';
import type { Buildings } from '../world/buildings';
import type { Effects } from '../world/effects';

/** What a weapon needs from the game. */
export interface WeaponContext {
  physics: PhysicsWorld;
  buildings: Buildings;
  effects: Effects;
  events: EventBus<GameEvents>;
  /** Sets off an explosion that damages buildings and throws vehicles. */
  explode(position: THREE.Vector3, radius: number, damage: number, source: ExplosionSource): void;
  /**
   * Height of the ground at a point: the terrain, or a bridge deck below `fromY`.
   *
   * @param fromY Height of the asking object. Decks well above it do not count.
   */
  groundAt(x: number, z: number, fromY: number): number;
}

/** The state of a weapon for the HUD and the touch button. */
export interface WeaponStatus {
  /** Short name in capitals, for example `BOOST`. */
  label: string;
  /** Fill of the meter from 0 to 1. */
  meter: number;
  /** Short text beside the meter, for example `READY` or `6 / 12`. */
  value: string;
  /** True when the action button does something now. */
  ready: boolean;
  /** True while the weapon works, for example during a boost or while the flail spins. */
  active: boolean;
}

/**
 * The weapon of a vehicle. The action button controls it: some weapons act once per press, some
 * while the button is held.
 */
export interface Weapon {
  /** Objects in world space, such as a flail ball or flying rockets. */
  readonly object: THREE.Object3D;
  /**
   * Advances the weapon by one simulation step.
   *
   * @param held True while the action button is down.
   * @param pressed True in the step in which the action button went down.
   */
  step(dt: number, vehicle: Vehicle, held: boolean, pressed: boolean): void;
  /** Draws the weapon between the previous and the current step. */
  sync(alpha: number, vehicle: Vehicle): void;
  status(): WeaponStatus;
  /** Adds ammunition. Returns false when the weapon takes none or is full. */
  addAmmo(count: number): boolean;
  dispose(): void;
}
