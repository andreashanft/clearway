import type { EventBus } from '../engine/events';
import type { VehicleType } from './level-data';
import type { LevelStats, Medal } from './scoring';
import type { Phase, Urgency } from './session';

/** Events the game layer sends up to the UI. */
export interface GameEvents {
  /** The player took control of a different vehicle (or the level started). */
  'vehicle:changed': { type: VehicleType; name: string; actionLabel: string };
  /** The active vehicle's Action button state, for the touch button and vehicle card. */
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
    next: string | null;
    urgency: Urgency;
    obstaclesLeft: number;
    buildingsLeft: number;
  };
  'obstacle:cleared': { id: string };
  /** Easy mode: the Hauler paused once to give the player time. */
  'hauler:stalled': { seconds: number };
  'session:results': { stats: LevelStats; medal: Medal | null };
  /** The Hauler was destroyed and the slow motion has played out. */
  'hauler:destroyed': Record<string, never>;
}

export type GameBus = EventBus<GameEvents>;
