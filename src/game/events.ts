import type * as THREE from 'three/webgpu';
import type { BuildingClass } from './level';
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
    material: BuildingClass;
    /** True when at least one piece fell, or a tower started to fall. */
    broke: boolean;
  };
  /** A building lost half of its hit points and shows cracks. */
  buildingCracked: { building: Building; position: THREE.Vector3 };
  /** One piece of a low building fell. */
  pieceDestroyed: {
    building: Building;
    position: THREE.Vector3;
    /** Volume of the piece in cubic metres. */
    volume: number;
    /** How many tower collapses led to the fall. 0 when the player broke the piece. */
    chain: number;
  };
  /** The base of a tower gave way, and the tower starts to sink. */
  towerCollapsing: { building: Building; position: THREE.Vector3; chain: number };
  /** One more floor of a falling tower reached the ground. */
  towerFloor: { building: Building; position: THREE.Vector3; floor: number };
  /** A falling tower has sunk completely. */
  towerFell: { building: Building; position: THREE.Vector3 };
  /** The last piece of a building fell, or a tower started to fall. */
  buildingDestroyed: { building: Building };
  /** A break earned points. */
  scored: {
    position: THREE.Vector3;
    points: number;
    /** The combo multiplier that applied. */
    multiplier: number;
    /** How many collapses led to the break. */
    chain: number;
    /** True for a whole tower. */
    tower: boolean;
  };
  explosion: { position: THREE.Vector3; radius: number; source: ExplosionSource };
  /** A vehicle pushed a TNT crate and lit its fuse. */
  tntLit: { position: THREE.Vector3 };
  /** A TNT crate came back at its starting place. */
  tntRespawned: { position: THREE.Vector3 };
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
  /** The player switched to another vehicle. */
  vehicleChanged: { type: string };
  /** The player pressed the button that switches between the chase view and the fixed view. */
  cameraToggled: Record<string, never>;
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
export type FailCause = BuildingClass | 'vehicle' | 'tnt' | 'explosion' | 'tree';
