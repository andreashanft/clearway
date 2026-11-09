import type { TouchState } from '../../engine/input/touch-state';

/** Pinch ratio that steps the zoom one preset. */
const PINCH_STEP = 1.3;
/** Twist angle, in radians, that rotates the view one 45° step. */
const TWIST_STEP = (30 * Math.PI) / 180;

interface Point {
  x: number;
  y: number;
}

/**
 * Two-finger camera gestures on the game view: pinch to zoom between presets and twist
 * to rotate the view in 45° steps.
 */
export class CameraGestures {
  private readonly pointers = new Map<number, Point>();
  private baseDistance = 0;
  private baseAngle = 0;

  constructor(
    private readonly target: HTMLElement,
    private readonly touch: TouchState,
  ) {
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onUp);
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onUp);
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) this.resetBaseline();
  };

  private readonly onMove = (event: PointerEvent): void => {
    const point = this.pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (this.pointers.size !== 2) return;

    const { distance, angle } = this.measure();
    const ratio = distance / this.baseDistance;
    if (ratio > PINCH_STEP) {
      this.touch.zoom(-1);
      this.resetBaseline();
    } else if (ratio < 1 / PINCH_STEP) {
      this.touch.zoom(1);
      this.resetBaseline();
    }
    let twist = angle - this.baseAngle;
    if (twist > Math.PI) twist -= Math.PI * 2;
    if (twist < -Math.PI) twist += Math.PI * 2;
    if (Math.abs(twist) > TWIST_STEP) {
      // Screen y points down, so a positive twist is clockwise; the view follows the fingers.
      this.touch.turnCamera(twist > 0 ? 1 : -1);
      this.resetBaseline();
    }
  };

  private readonly onUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
  };

  private resetBaseline(): void {
    const { distance, angle } = this.measure();
    this.baseDistance = Math.max(1, distance);
    this.baseAngle = angle;
  }

  private measure(): { distance: number; angle: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { distance: 1, angle: 0 };
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
}
