/** Indices in the W3C "standard" gamepad mapping. */
export const PAD = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
} as const;

export interface PadSnapshot {
  readonly leftX: number;
  readonly leftY: number;
  readonly rightY: number;
  readonly leftTrigger: number;
  readonly rightTrigger: number;
  isDown(button: number): boolean;
  wasPressed(button: number): boolean;
}

/** Polls the first connected standard-layout gamepad once per frame. */
export class Gamepads {
  private previous: boolean[] = [];
  private current: boolean[] = [];
  /** True when the pad produced meaningful input this frame. */
  active = false;

  poll(): PadSnapshot | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads.find((p): p is Gamepad => p?.connected === true);
    if (!pad) {
      this.previous = [];
      this.current = [];
      this.active = false;
      return null;
    }
    this.previous = this.current;
    this.current = pad.buttons.map((b) => b.pressed);
    const axis = (i: number): number => pad.axes[i] ?? 0;
    const trigger = (i: number): number => pad.buttons[i]?.value ?? 0;

    const snapshot: PadSnapshot = {
      leftX: axis(0),
      leftY: axis(1),
      rightY: axis(3),
      leftTrigger: trigger(PAD.leftTrigger),
      rightTrigger: trigger(PAD.rightTrigger),
      isDown: (button) => this.current[button] === true,
      wasPressed: (button) => this.current[button] === true && this.previous[button] !== true,
    };
    this.active =
      Math.hypot(snapshot.leftX, snapshot.leftY) > 0.25 ||
      snapshot.rightTrigger > 0.1 ||
      snapshot.leftTrigger > 0.1 ||
      this.current.some(Boolean);
    return snapshot;
  }
}
