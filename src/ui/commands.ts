import type { EventBus } from '../engine/events';

/** Commands the UI sends down to the game shell. */
export interface UiCommands {
  /** Restart the current level. */
  retry: undefined;
  /** Go on to the next level. */
  next: undefined;
  /** Leave the level. */
  quit: undefined;
  /** Open the pause menu. */
  pause: undefined;
  /** Snap the camera back behind the player (double-tap on the mini-map). */
  recentre: undefined;
}

export type CommandBus = EventBus<UiCommands>;
