import type { EventBus } from '../engine/events';
import type { VehicleType } from './level-data';

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
}

export type GameBus = EventBus<GameEvents>;
