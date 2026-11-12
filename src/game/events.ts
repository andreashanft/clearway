import type * as THREE from 'three/webgpu';
import type { Strength } from './level';
import type { Building } from './world/buildings';

/** Where an explosion comes from. */
export type ExplosionSource = 'tnt' | 'tank' | 'hauler';

/**
 * Everything that the game layer announces. The user interface, the audio and the camera listen
 * on the event bus. The simulation never calls them directly.
 */
export interface GameEvents {
  /** A vehicle hit a building. */
  impact: {
    position: THREE.Vector3;
    /** Strength from 0 to 1, for sound volume and camera shake. */
    strength: number;
    material: Strength;
    /** True when the building took no damage, for example a Bruiser against concrete. */
    blocked: boolean;
    /** True when at least one segment fell. */
    broke: boolean;
  };
  /** A building lost half of its hit points and shows cracks. */
  buildingCracked: { building: Building; position: THREE.Vector3 };
  /** One segment of a building fell. */
  segmentDestroyed: { building: Building; position: THREE.Vector3 };
  /** The last segment of a building fell. */
  buildingDestroyed: { building: Building };
  explosion: { position: THREE.Vector3; radius: number; source: ExplosionSource };
  /** A vehicle pushed a TNT crate and lit its fuse. */
  tntLit: { position: THREE.Vector3 };
  /** A TNT crate came back at its starting place. */
  tntRespawned: { position: THREE.Vector3 };
  /** A vehicle fired its action, for example the ram charge. */
  actionFired: { kind: string };
  /** A vehicle landed after a jump. */
  landed: { speed: number };
}
