import type { Button, InputSource, InputState } from './input';

/** Standard gamepad button indices that fire once when they go down. */
const PRESS_BUTTONS: [number, Button][] = [
  [0, 'action'], // A
  [3, 'enterExit'], // Y
  [4, 'rotateLeft'], // LB
  [5, 'rotateRight'], // RB
  [9, 'pause'], // Start
];

const STICK_DEAD_ZONE = 0.18;
const ZOOM_THRESHOLD = 0.6;

/**
 * Gamepad with the standard mapping.
 *
 * The left stick steers, the right trigger accelerates, the left trigger brakes and reverses,
 * A is the action, Y enters or leaves a vehicle, the bumpers rotate the camera, the right stick
 * zooms and Start pauses.
 */
export class GamepadInput implements InputSource {
  private readonly wasDown = new Set<number>();
  private zoomArmed = true;

  poll(state: InputState): void {
    if (typeof navigator.getGamepads !== 'function') {
      return;
    }
    const pad = navigator.getGamepads().find((candidate) => candidate?.connected);
    if (!pad) {
      this.wasDown.clear();
      return;
    }

    const stickX = pad.axes[0] ?? 0;
    if (Math.abs(stickX) > STICK_DEAD_ZONE) {
      state.steer += (stickX - Math.sign(stickX) * STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
    }
    const accelerate = pad.buttons[7]?.value ?? 0;
    const reverse = pad.buttons[6]?.value ?? 0;
    state.throttle += accelerate - reverse;
    state.action ||= pad.buttons[0]?.pressed ?? false;

    for (const [index, button] of PRESS_BUTTONS) {
      const down = pad.buttons[index]?.pressed ?? false;
      if (down && !this.wasDown.has(index)) {
        state.pressed.add(button);
      }
      if (down) {
        this.wasDown.add(index);
      } else {
        this.wasDown.delete(index);
      }
    }

    // Right stick: push up to zoom in, pull down to zoom out. One step per push.
    const zoom = pad.axes[3] ?? 0;
    if (Math.abs(zoom) < ZOOM_THRESHOLD * 0.5) {
      this.zoomArmed = true;
    } else if (this.zoomArmed && Math.abs(zoom) > ZOOM_THRESHOLD) {
      state.pressed.add(zoom < 0 ? 'zoomIn' : 'zoomOut');
      this.zoomArmed = false;
    }
  }
}
