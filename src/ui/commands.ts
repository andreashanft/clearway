import type { EventBus } from '../engine/events';

/** Commands the UI sends down to the game shell. */
export interface UiCommands {
  /** Restart the current level. */
  retry: undefined;
  /** End free roam and show the results. */
  finish: undefined;
  /** Go on to the next level. */
  next: undefined;
  /** Leave the level. */
  quit: undefined;
}

export type CommandBus = EventBus<UiCommands>;
