import type { Button, InputSource, InputState } from './input';

/** Keys that fire once when they go down. */
const PRESS_KEYS: Record<string, Button> = {
  Space: 'action',
  KeyC: 'camera',
  KeyQ: 'rotateLeft',
  KeyR: 'rotateRight',
  KeyZ: 'zoomIn',
  KeyX: 'zoomOut',
  Escape: 'pause',
};

/** Keys whose default browser action would scroll the page. */
const CAPTURED_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Keyboard and mouse wheel.
 *
 * W or the up arrow accelerates. S or the down arrow brakes and then reverses. A and D or the
 * left and right arrows steer. Space is the action and Shift is the handbrake. C switches the
 * camera view, Q and R rotate the fixed view, Z, X and the wheel zoom, and Escape pauses.
 */
export class KeyboardInput implements InputSource {
  private readonly down = new Set<string>();
  private readonly queued = new Set<Button>();
  private wheel = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      // Space and the arrows must not scroll the page. A focused button still gets its Space.
      if (CAPTURED_KEYS.has(event.code) && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
      }
      if (event.repeat) {
        return;
      }
      this.down.add(event.code);
      const button = PRESS_KEYS[event.code];
      if (button) {
        this.queued.add(button);
      }
    });
    target.addEventListener('keyup', (event) => this.down.delete(event.code));
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener(
      'wheel',
      (event) => {
        this.wheel += event.deltaY;
      },
      { passive: true },
    );
  }

  poll(state: InputState): void {
    state.steer += this.axis('KeyD', 'ArrowRight') - this.axis('KeyA', 'ArrowLeft');
    state.throttle += this.axis('KeyW', 'ArrowUp') - this.axis('KeyS', 'ArrowDown');
    state.action ||= this.down.has('Space');
    state.brake ||= this.down.has('ShiftLeft') || this.down.has('ShiftRight');

    for (const button of this.queued) {
      state.pressed.add(button);
    }
    this.queued.clear();

    if (Math.abs(this.wheel) >= 40) {
      state.pressed.add(this.wheel < 0 ? 'zoomIn' : 'zoomOut');
      this.wheel = 0;
    }
  }

  private axis(...codes: string[]): number {
    return codes.some((code) => this.down.has(code)) ? 1 : 0;
  }
}
