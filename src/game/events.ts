import type { EventBus } from '../engine/events';
import type { VehicleType } from './level-data';
import type { LevelStats, Medal } from './scoring';
import type { Phase, Urgency } from './session';

/** Events the game layer sends up to the UI. */
export interface GameEvents {
  /** The player took control of a different vehicle (or the level started). */
  'vehicle:changed': { type: VehicleType | 'pilot'; name: string; actionLabel: string };
  /** What the Enter/Exit button would do right now, or null when it has nothing to do. */
  context: { action: 'enter' | 'exit'; label: string } | null;
  /** The active vehicle's Action button state, for the touch button and the sound. */
  'action:state': { ready: boolean; active: boolean; charge: number };
  /** A building took damage. */
  'building:damaged': { id: string; hp: number; maxHp: number };
  /** A building fell. */
  'building:destroyed': { id: string; group: string | null };
  /** A hit landed hard enough to feel; `strength` runs from 0 to 1. */
  impact: { strength: number };
  /** A TNT crate's fuse started. */
  'tnt:lit': { seconds: number };
  /** Something exploded. */
  explosion: { x: number; y: number; z: number; radius: number };
  /** The level's obstacles, in route order, sent once when a level starts. */
  'session:obstacles': {
    obstacles: { id: string; label: string; distance: number }[];
    routeLength: number;
  };
  'session:phase': { phase: Phase };
  /** Hauler progress and the countdown to the next impact, about ten times a second. */
  'hauler:status': {
    distance: number;
    routeLength: number;
    countdown: number | null;
    /** Seconds until the Hauler leaves the level and the run ends. */
    timeLeft: number;
    next: string | null;
    urgency: Urgency;
    obstaclesLeft: number;
    buildingsLeft: number;
  };
  'obstacle:cleared': { id: string };
  'session:results': { stats: LevelStats; medal: Medal | null };
  /** The Hauler was destroyed and the slow motion has played out. */
  'hauler:destroyed': { hit: string; time: number; cleared: number; total: number };
  /** Static map data for the mini-map, sent once per level. */
  'map:setup': {
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
    route: [number, number][];
    background: CanvasImageSource | null;
    extent: number;
  };
  /** Positions for the mini-map and the Hauler pointer, about ten times a second. */
  'hud:frame': {
    hauler: {
      x: number;
      z: number;
      heading: number;
      screenX: number;
      screenY: number;
      onScreen: boolean;
      distance: number;
    } | null;
    player: { x: number; z: number; heading: number; speed: number } | null;
    vehicles: { x: number; z: number }[];
    obstacles: { x: number; z: number; cleared: boolean }[];
    crates: { x: number; z: number; lit: boolean }[];
    /** Beacons still to light. */
    beacons: { x: number; z: number }[];
    cameraYaw: number;
  };
  /** Points scored; `screenX` and `screenY` place a pop-up over what earned them. */
  score: {
    points: number;
    total: number;
    label: string;
    kind: 'path' | 'bonus' | 'prop' | 'pickup' | 'clear';
    screenX: number;
    screenY: number;
    onScreen: boolean;
  };
  /** The player lit a beacon. */
  'pickup:beacon': { found: number; total: number };
  /** The player found the relay dish. */
  'pickup:dish': { x: number; y: number; z: number };
  /** A short tutorial or context hint. */
  hint: { text: string };
  /** The last obstacle fell `seconds` into the run, with `timeLeft` seconds of it to go. */
  'path:cleared': { seconds: number; timeLeft: number };
}

export type GameBus = EventBus<GameEvents>;
