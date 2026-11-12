import type * as THREE from 'three/webgpu';
import type { Strength } from './level';
import type { LevelResult } from './scoring';
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
  /** A vehicle drove past a beacon and lit it. */
  beaconLit: { lit: number; total: number };
  /** A vehicle found the hidden relay dish. */
  dishFound: Record<string, never>;
  /** The level moved on, for example from playing to bonus time. */
  phaseChanged: { phase: Phase; previous: Phase };
  /** A route obstacle no longer blocks the Hauler. */
  obstacleCleared: { id: string; name: string; left: number };
  /** The last route obstacle fell. Bonus time starts. */
  pathClear: { clearSeconds: number; bonusSeconds: number };
  /** The Hauler touched something solid and blew up. */
  haulerDestroyed: {
    /** What it hit, in lower case with an article: "the farmhouse". */
    hit: string;
    /** What kind of thing it hit, for the tip on the fail screen. */
    cause: FailCause;
    obstaclesCleared: number;
    obstaclesTotal: number;
  };
  /** The Hauler left the map, or the player finished the level early. */
  levelEnded: { result: LevelResult };
  /** A tutorial hint should show. */
  hint: { text: string };
  /** The player climbed into a vehicle, or left one and walks as the pilot. */
  vehicleChanged: { type: string };
  /** The player pressed the pause button or key. */
  pauseRequested: Record<string, never>;
  /** The slow-motion replay of the crash started or ended. */
  replayChanged: { playing: boolean };
}

/**
 * Where a level is in its flow.
 *
 * - `ready`: loaded, the Hauler waits at the map edge.
 * - `playing`: the Hauler rolls and obstacles still stand.
 * - `bonus`: the path is clear and the Hauler still drives.
 * - `failed`: the Hauler blew up.
 * - `ended`: the Hauler left the map, or the player finished early.
 */
export type Phase = 'ready' | 'playing' | 'bonus' | 'failed' | 'ended';

/** What the Hauler hit. */
export type FailCause = Strength | 'vehicle' | 'tnt' | 'explosion' | 'tree' | 'gap';
