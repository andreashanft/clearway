export type InputSource = 'touch' | 'keyboard' | 'gamepad';

/**
 * Everything the player asked for during one rendered frame, merged from all devices.
 * Edge flags (`…Pressed`, `cameraTurn`, `zoomStep`) are true for one frame only.
 */
export interface ControlFrame {
  /**
   * Point-to-drive stick in screen space: x to the right, y up, length 0–1. The vehicle
   * turns towards this direction and accelerates by its length.
   */
  readonly stickX: number;
  readonly stickY: number;
  /** Classic steering: −1 full left to +1 full right. */
  readonly steer: number;
  /** Classic throttle: +1 full ahead, −1 back (brakes first, then reverses). */
  readonly throttle: number;
  readonly brake: boolean;
  readonly action: boolean;
  readonly actionPressed: boolean;
  readonly enterExitPressed: boolean;
  /** −1 rotates the camera 45° to the left, +1 to the right. */
  readonly cameraTurn: -1 | 0 | 1;
  /** −1 zooms in one preset, +1 zooms out one preset. */
  readonly zoomStep: -1 | 0 | 1;
  readonly pausePressed: boolean;
  /** The device that produced input most recently. */
  readonly source: InputSource;
}

export const IDLE_FRAME: ControlFrame = {
  stickX: 0,
  stickY: 0,
  steer: 0,
  throttle: 0,
  brake: false,
  action: false,
  actionPressed: false,
  enterExitPressed: false,
  cameraTurn: 0,
  zoomStep: 0,
  pausePressed: false,
  source: 'keyboard',
};

/** Clamps a stick vector to the unit circle and removes a radial dead zone. */
export function shapeStick(x: number, y: number, deadZone: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= deadZone || length === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (length - deadZone) / (1 - deadZone));
  return { x: (x / length) * scaled, y: (y / length) * scaled };
}
