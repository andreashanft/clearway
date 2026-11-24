import './touch-controls.css';
import type { Button, InputSource, InputState } from '../../engine/input/input';

/** How far the knob travels from the centre of the steering control, in CSS pixels. */
const STEER_RADIUS = 56;
/** A pinch zooms one step when the finger distance changes by this factor. */
const PINCH_STEP = 1.22;
/** A twist rotates the view one step when the fingers turn by this angle, in radians. */
const TWIST_STEP = (24 * Math.PI) / 180;

interface Point {
  x: number;
  y: number;
}

/**
 * On-screen car controls for touch.
 *
 * The steering control floats under the left thumb: slide the thumb left or right to steer. The
 * right thumb has the GAS pedal, the BRAKE pedal and the DRIFT button above the GAS pedal. The
 * brake pedal brakes first and then reverses. The DRIFT button is the handbrake, which makes the
 * vehicle slide. Two other fingers zoom with a pinch and rotate the fixed view with a twist.
 */
export class TouchControls implements InputSource {
  private readonly root: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly steer: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly brakeButton: HTMLButtonElement;
  private readonly gasButton: HTMLButtonElement;
  private readonly handbrakeButton: HTMLButtonElement;

  /** Fingers on the scene that do not steer. Two of them make a camera gesture. */
  private readonly touches = new Map<number, Point>();
  private steerPointer: number | undefined;
  private steerOrigin = 0;
  private steerValue = 0;
  private gesture: { ids: [number, number]; distance: number; angle: number } | undefined;
  private brakeHeld = false;
  private gasHeld = false;
  private handbrakeHeld = false;
  private readonly queued = new Set<Button>();

  constructor(parent: HTMLElement, canvas: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.hidden = true;

    this.zone = document.createElement('div');
    this.zone.className = 'touch__zone';

    this.steer = document.createElement('div');
    this.steer.className = 'touch__steer';
    this.steer.setAttribute('aria-hidden', 'true');
    this.knob = document.createElement('div');
    this.knob.className = 'touch__knob';
    this.steer.append(this.knob);

    this.brakeButton = this.createButton('touch__brake', 'Brake and reverse');
    this.brakeButton.textContent = 'BRAKE';
    this.gasButton = this.createButton('touch__gas', 'Accelerate');
    this.gasButton.textContent = 'GAS';
    this.handbrakeButton = this.createButton('touch__handbrake', 'Handbrake: slide');
    this.handbrakeButton.textContent = 'DRIFT';

    this.root.append(this.zone, this.steer, this.brakeButton, this.gasButton, this.handbrakeButton);
    parent.append(this.root);

    this.bindHold(this.brakeButton, (held) => {
      this.brakeHeld = held;
    });
    this.bindHold(this.gasButton, (held) => {
      this.gasHeld = held;
    });
    this.bindHold(this.handbrakeButton, (held) => {
      this.handbrakeHeld = held;
    });

    for (const element of [this.zone, canvas]) {
      element.addEventListener('pointerdown', (event) => this.onPointerDown(event, element));
      element.addEventListener('pointermove', (event) => this.onPointerMove(event));
      element.addEventListener('pointerup', (event) => this.onPointerEnd(event));
      element.addEventListener('pointercancel', (event) => this.onPointerEnd(event));
    }

    // Show the controls on touch devices, and on any device as soon as a finger touches it.
    if (window.matchMedia('(pointer: coarse)').matches) {
      this.root.hidden = false;
    }
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType === 'touch') {
          this.root.hidden = false;
        }
      },
      { capture: true },
    );
  }

  /** Shows or hides the controls. The screens hide them outside of play. */
  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-off', !visible);
    if (!visible) {
      this.releaseAll();
    }
  }

  /** True when the controls are on the screen. */
  get shown(): boolean {
    return !this.root.hidden && !this.root.classList.contains('is-off');
  }

  /** Forces the controls on, for testing on a desktop. */
  forceShow(): void {
    this.root.hidden = false;
  }

  /** Mirrors the layout for left-handed players. */
  setLeftHanded(leftHanded: boolean): void {
    this.root.classList.toggle('is-lefty', leftHanded);
  }

  poll(state: InputState): void {
    state.steer += this.steerValue;
    state.throttle += (this.gasHeld ? 1 : 0) - (this.brakeHeld ? 1 : 0);
    state.brake ||= this.handbrakeHeld;
    for (const button of this.queued) {
      state.pressed.add(button);
    }
    this.queued.clear();
  }

  private createButton(className: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `touch__button ${className}`;
    button.setAttribute('aria-label', label);
    return button;
  }

  private bindHold(button: HTMLButtonElement, onChange: (held: boolean) => void): void {
    const release = (): void => {
      button.classList.remove('is-held');
      onChange(false);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add('is-held');
      onChange(true);
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private onPointerDown(event: PointerEvent, element: HTMLElement): void {
    if (event.pointerType === 'mouse' && element !== this.zone) {
      return;
    }
    element.setPointerCapture(event.pointerId);

    // The first finger in the zone steers, and it keeps steering whatever other fingers do.
    if (element === this.zone && this.steerPointer === undefined) {
      this.steerPointer = event.pointerId;
      this.steerOrigin = event.clientX;
      this.steer.classList.add('is-active');
      this.steer.style.left = `${event.clientX}px`;
      this.steer.style.top = `${event.clientY}px`;
      this.moveSteering(event.clientX);
      return;
    }
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size === 2 && !this.gesture) {
      const ids = [...this.touches.keys()] as [number, number];
      this.gesture = { ids, ...this.measure(ids) };
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerId === this.steerPointer) {
      this.moveSteering(event.clientX);
      return;
    }
    const touch = this.touches.get(event.pointerId);
    if (!touch) {
      return;
    }
    touch.x = event.clientX;
    touch.y = event.clientY;
    if (this.gesture?.ids.includes(event.pointerId)) {
      const { distance, angle } = this.measure(this.gesture.ids);
      const ratio = distance / this.gesture.distance;
      if (ratio > PINCH_STEP || ratio < 1 / PINCH_STEP) {
        this.queued.add(ratio > 1 ? 'zoomIn' : 'zoomOut');
        this.gesture.distance = distance;
      }
      const turned = Math.atan2(
        Math.sin(angle - this.gesture.angle),
        Math.cos(angle - this.gesture.angle),
      );
      if (Math.abs(turned) > TWIST_STEP) {
        // The world follows the fingers: a clockwise twist turns the camera anticlockwise.
        this.queued.add(turned > 0 ? 'rotateLeft' : 'rotateRight');
        this.gesture.angle = angle;
      }
    }
  }

  private onPointerEnd(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    if (event.pointerId === this.steerPointer) {
      this.releaseSteering();
    }
    if (this.gesture?.ids.includes(event.pointerId)) {
      this.gesture = undefined;
    }
  }

  private measure(ids: [number, number]): { distance: number; angle: number } {
    const a = this.touches.get(ids[0]);
    const b = this.touches.get(ids[1]);
    if (!a || !b) {
      return { distance: 1, angle: 0 };
    }
    return {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  /** Steers by how far the thumb is to the left or the right of where it landed. */
  private moveSteering(x: number): void {
    const dx = Math.min(STEER_RADIUS, Math.max(-STEER_RADIUS, x - this.steerOrigin));
    this.steerValue = dx / STEER_RADIUS;
    this.knob.style.transform = `translateX(${dx}px)`;
  }

  private releaseSteering(): void {
    this.steerPointer = undefined;
    this.steerValue = 0;
    this.steer.classList.remove('is-active');
    this.steer.style.left = '';
    this.steer.style.top = '';
    this.knob.style.transform = '';
  }

  private releaseAll(): void {
    this.releaseSteering();
    this.touches.clear();
    this.gesture = undefined;
    this.brakeHeld = false;
    this.gasHeld = false;
    this.handbrakeHeld = false;
    for (const button of [this.brakeButton, this.gasButton, this.handbrakeButton]) {
      button.classList.remove('is-held');
    }
  }
}
