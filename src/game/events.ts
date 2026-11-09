import type { EventBus } from '../engine/events';
import type { VehicleType } from './level-data';

/** Events the game layer sends up to the UI. */
export interface GameEvents {
  /** The player took control of a different vehicle (or the level started). */
  'vehicle:changed': { type: VehicleType; name: string; actionLabel: string };
  /** The active vehicle's Action button state, for the touch button and vehicle card. */
  'action:state': { ready: boolean; active: boolean; charge: number };
}

export type GameBus = EventBus<GameEvents>;
