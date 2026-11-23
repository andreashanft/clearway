/** A button whose press matters once, at the moment it goes down. */
export type Button =
  'action' | 'camera' | 'rotateLeft' | 'rotateRight' | 'zoomIn' | 'zoomOut' | 'recenter' | 'pause';

/** The player's input for one simulation step, merged from every device. */
export interface InputState {
  /** Steering wheel from -1 (left) to 1 (right). */
  steer: number;
  /** Pedals from -1 (brake, then reverse) to 1 (full throttle). */
  throttle: number;
  /** True while the Action button is down. */
  action: boolean;
  /** True while the handbrake is on. */
  brake: boolean;
  /** Buttons that went down since the previous step. */
  pressed: Set<Button>;
}

export function emptyInput(): InputState {
  return {
    steer: 0,
    throttle: 0,
    action: false,
    brake: false,
    pressed: new Set(),
  };
}

/** A device that contributes to the input. */
export interface InputSource {
  /** Adds the state of the device to `state`. Presses are reported once. */
  poll(state: InputState): void;
}

/** Merges the input of every connected device. */
export class Input {
  private readonly sources: InputSource[] = [];

  add(source: InputSource): void {
    this.sources.push(source);
  }

  /** Reads every device. Call it once per simulation step. */
  poll(): InputState {
    const state = emptyInput();
    for (const source of this.sources) {
      source.poll(state);
    }
    state.steer = Math.min(1, Math.max(-1, state.steer));
    state.throttle = Math.min(1, Math.max(-1, state.throttle));
    return state;
  }
}

/**
 * An input source that code controls. The debug tools use it to drive the game without a
 * device.
 */
export class ScriptedInput implements InputSource {
  steer = 0;
  throttle = 0;
  action = false;
  brake = false;
  private readonly queued = new Set<Button>();

  press(button: Button): void {
    this.queued.add(button);
  }

  poll(state: InputState): void {
    state.steer += this.steer;
    state.throttle += this.throttle;
    state.action ||= this.action;
    state.brake ||= this.brake;
    for (const button of this.queued) {
      state.pressed.add(button);
    }
    this.queued.clear();
  }
}
