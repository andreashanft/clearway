import './touch-controls.css';
import type { Button, InputSource, InputState } from '../../engine/input/input';

/** How far the knob travels from the centre of the stick, in CSS pixels. */
const STICK_RADIUS = 46;
/** A second finger turns a stick touch into a camera gesture below this stick deflection. */
const GESTURE_TAKEOVER_DEFLECTION = 0.35;
/** A pinch zooms one step when the finger distance changes by this factor. */
const PINCH_STEP = 1.22;
/** A twist rotates the view one step when the fingers turn by this angle, in radians. */
const TWIST_STEP = (24 * Math.PI) / 180;

interface Point {
  x: number;
  y: number;
}

/** State of the Action button, as the head-up display shows it. */
export interface ActionButtonState {
  label: string;
  /** Charge from 0 to 1. */
  charge: number;
  /** True while the action runs. */
  active: boolean;
  /** False when the vehicle has no action. */
  available: boolean;
}

/**
 * On-screen controls for touch: a floating stick for the left thumb, and round Action, Brake
 * and Exit buttons for the right thumb. A pinch zooms and a two-finger twist rotates the view.
 */
export class TouchControls implements InputSource {
  private readonly root: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly actionButton: HTMLButtonElement;
  private readonly actionLabel: HTMLElement;
  private readonly brakeButton: HTMLButtonElement;
  private readonly exitButton: HTMLButtonElement;

  private readonly touches = new Map<number, Point>();
  private stickPointer: number | undefined;
  private stickOrigin: Point = { x: 0, y: 0 };
  private stickX = 0;
  private stickY = 0;
  private gesture: { ids: [number, number]; distance: number; angle: number } | undefined;
  private actionHeld = false;
  private brakeHeld = false;
  private readonly queued = new Set<Button>();
  private lastAction = '';

  constructor(parent: HTMLElement, canvas: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.hidden = true;

    this.zone = document.createElement('div');
    this.zone.className = 'touch__zone';

    this.stick = document.createElement('div');
    this.stick.className = 'touch__stick';
    this.stick.setAttribute('aria-hidden', 'true');
    this.knob = document.createElement('div');
    this.knob.className = 'touch__knob';
    this.stick.append(this.knob);

    this.actionButton = this.createButton('touch__action', 'Action');
    this.actionLabel = document.createElement('span');
    this.actionButton.append(this.actionLabel);
    this.brakeButton = this.createButton('touch__brake', 'Brake');
    this.brakeButton.textContent = 'BRAKE';
    this.exitButton = this.createButton('touch__exit', 'Exit vehicle');
    this.exitButton.textContent = 'EXIT';
    this.exitButton.hidden = true;

    this.root.append(this.zone, this.stick, this.exitButton, this.brakeButton, this.actionButton);
    parent.append(this.root);

    this.bindHold(this.actionButton, (held) => {
      this.actionHeld = held;
      if (held) {
        this.queued.add('action');
      }
    });
    this.bindHold(this.brakeButton, (held) => {
      this.brakeHeld = held;
    });
    this.bindHold(this.exitButton, (held) => {
      if (held) {
        this.queued.add('enterExit');
      }
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

  /** Forces the controls on, for testing on a desktop. */
  forceShow(): void {
    this.root.hidden = false;
  }

  /** Mirrors the layout for left-handed players. */
  setLeftHanded(leftHanded: boolean): void {
    this.root.classList.toggle('is-lefty', leftHanded);
  }

  /** Updates the label and the charge display of the Action button. */
  setAction(state: Readonly<ActionButtonState>): void {
    const percent = Math.round(state.charge * 100);
    const mode = !state.available
      ? 'none'
      : state.active
        ? 'active'
        : state.charge >= 1
          ? 'ready'
          : 'charging';
    const text = mode === 'charging' ? `${percent}%` : state.label;
    const signature = `${mode}:${text}`;
    if (signature === this.lastAction) {
      return;
    }
    this.lastAction = signature;
    this.actionButton.dataset.mode = mode;
    this.actionButton.style.setProperty('--charge', `${percent}%`);
    this.actionButton.setAttribute('aria-label', state.label || 'Action');
    this.actionLabel.textContent = text;
    this.actionButton.hidden = mode === 'none';
  }

  /** Shows the Exit button with a label such as EXIT or ENTER. */
  setExit(label: string | undefined): void {
    this.exitButton.hidden = label === undefined;
    if (label !== undefined && this.exitButton.textContent !== label) {
      this.exitButton.textContent = label;
      this.exitButton.setAttribute(
        'aria-label',
        label === 'EXIT' ? 'Exit vehicle' : 'Enter vehicle',
      );
    }
  }

  poll(state: InputState): void {
    state.pointX += this.stickX;
    state.pointY += this.stickY;
    state.action ||= this.actionHeld;
    state.brake ||= this.brakeHeld;
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
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.touches.size === 1 && element === this.zone) {
      this.stickPointer = event.pointerId;
      this.stickOrigin = { x: event.clientX, y: event.clientY };
      this.stick.classList.add('is-active');
      this.stick.style.left = `${event.clientX}px`;
      this.stick.style.top = `${event.clientY}px`;
      this.moveStick(event.clientX, event.clientY);
      return;
    }
    if (this.touches.size === 2 && !this.gesture) {
      const deflection = Math.hypot(this.stickX, this.stickY);
      if (this.stickPointer !== undefined && deflection >= GESTURE_TAKEOVER_DEFLECTION) {
        return;
      }
      this.releaseStick();
      const ids = [...this.touches.keys()] as [number, number];
      this.gesture = { ids, ...this.measure(ids) };
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const touch = this.touches.get(event.pointerId);
    if (!touch) {
      return;
    }
    touch.x = event.clientX;
    touch.y = event.clientY;

    if (event.pointerId === this.stickPointer) {
      this.moveStick(event.clientX, event.clientY);
      return;
    }
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
    if (event.pointerId === this.stickPointer) {
      this.releaseStick();
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

  private moveStick(x: number, y: number): void {
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      dx = (dx / length) * STICK_RADIUS;
      dy = (dy / length) * STICK_RADIUS;
    }
    this.stickX = dx / STICK_RADIUS;
    // Screen Y points down, stick Y points up.
    this.stickY = -dy / STICK_RADIUS;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private releaseStick(): void {
    this.stickPointer = undefined;
    this.stickX = 0;
    this.stickY = 0;
    this.stick.classList.remove('is-active');
    this.stick.style.left = '';
    this.stick.style.top = '';
    this.knob.style.transform = '';
  }

  private releaseAll(): void {
    this.releaseStick();
    this.touches.clear();
    this.gesture = undefined;
    this.actionHeld = false;
    this.brakeHeld = false;
  }
}
