import './touch-controls.css';
import type { TouchState } from '../../engine/input/touch-state';
import type { GameBus } from '../../game/events';

/** Stick travel from centre to rim, in CSS pixels (half the 116 px base). */
const STICK_RADIUS = 58;
/** Fraction of the travel that already means full throttle, so a short push is enough. */
const FULL_THROTTLE_AT = 0.6;
/** Travel below this fraction is ignored, so a resting thumb doesn't creep. */
const STICK_DEAD_ZONE = 0.12;

/**
 * The default "point-to-drive" touch layout from the gameplay mocks: a floating stick
 * under the left thumb, and round Action and Brake buttons under the right thumb.
 */
export class TouchControls {
  readonly element: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly actionButton: HTMLButtonElement;
  private readonly brakeButton: HTMLButtonElement;
  private readonly gasButton: HTMLButtonElement;
  private readonly reverseButton: HTMLButtonElement;
  private readonly contextButton: HTMLButtonElement;
  private classic = false;
  private stickPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private readonly touch: TouchState,
    bus: GameBus,
  ) {
    this.element = el('div', 'cw-touch');
    this.zone = el('div', 'cw-touch__zone');
    this.base = el('div', 'cw-touch__stick');
    this.knob = el('div', 'cw-touch__knob');
    this.base.append(this.knob);
    this.zone.append(this.base);

    this.brakeButton = button('cw-touch__brake', 'BRAKE');
    this.actionButton = button('cw-touch__action', 'ACTION');
    this.gasButton = button('cw-touch__gas', 'GAS');
    this.reverseButton = button('cw-touch__reverse', 'REV');
    this.contextButton = button('cw-touch__context', 'EXIT');
    this.contextButton.hidden = true;
    this.element.append(
      this.zone,
      this.brakeButton,
      this.gasButton,
      this.reverseButton,
      this.actionButton,
      this.contextButton,
    );
    this.contextButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      touch.pressEnterExit();
    });
    parent.append(this.element);

    this.zone.addEventListener('pointerdown', this.onStickDown);
    this.zone.addEventListener('pointermove', this.onStickMove);
    this.zone.addEventListener('pointerup', this.onStickUp);
    this.zone.addEventListener('pointercancel', this.onStickUp);

    holdButton(
      this.actionButton,
      () => touch.pressAction(),
      () => touch.releaseAction(),
    );
    holdButton(
      this.gasButton,
      () => {
        touch.gas = 1;
        touch.active = true;
      },
      () => {
        touch.gas = 0;
      },
    );
    holdButton(
      this.reverseButton,
      () => {
        touch.reverse = 1;
        touch.active = true;
      },
      () => {
        touch.reverse = 0;
      },
    );
    holdButton(
      this.brakeButton,
      () => {
        touch.brake = true;
        touch.active = true;
      },
      () => {
        touch.brake = false;
      },
    );

    this.unsubscribe.push(
      bus.on('vehicle:changed', ({ actionLabel }) => {
        this.actionButton.textContent = actionLabel;
        // On foot there is no Action.
        this.actionButton.hidden = actionLabel === '';
      }),
      bus.on('context', (context) => {
        this.contextButton.hidden = context === null;
        if (context) {
          this.contextButton.textContent =
            context.action === 'exit' ? 'EXIT' : context.label.toUpperCase();
          this.contextButton.classList.toggle('is-enter', context.action === 'enter');
        }
      }),
      bus.on('action:state', ({ ready, active, charge }) => {
        this.actionButton.classList.toggle('is-active', active);
        this.actionButton.classList.toggle('is-empty', !ready && charge <= 0);
        this.actionButton.classList.toggle('is-charging', !ready && charge > 0);
        this.actionButton.style.setProperty('--charge', `${Math.round(charge * 100)}%`);
      }),
    );
  }

  /**
   * Point-to-drive (one stick) or classic (steering stick plus gas and reverse pedals),
   * optionally mirrored for left-handed players.
   */
  setLayout(layout: 'point' | 'classic', leftHanded: boolean): void {
    this.classic = layout === 'classic';
    this.element.classList.toggle('is-classic', this.classic);
    this.element.classList.toggle('is-left-handed', leftHanded);
    this.releaseStick();
    this.touch.reset();
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
    if (!visible) this.releaseStick();
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.element.remove();
  }

  private readonly onStickDown = (event: PointerEvent): void => {
    if (this.stickPointer !== null) return;
    event.preventDefault();
    this.stickPointer = event.pointerId;
    this.zone.setPointerCapture(event.pointerId);
    // The stick appears where the thumb lands, kept fully inside the zone.
    const rect = this.zone.getBoundingClientRect();
    this.originX = clamp(event.clientX, rect.left + STICK_RADIUS, rect.right - STICK_RADIUS);
    this.originY = clamp(event.clientY, rect.top + STICK_RADIUS, rect.bottom - STICK_RADIUS);
    this.base.style.left = `${this.originX - rect.left}px`;
    this.base.style.top = `${this.originY - rect.top}px`;
    this.base.classList.add('is-active');
    this.moveKnob(event.clientX, event.clientY);
  };

  private readonly onStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    this.moveKnob(event.clientX, event.clientY);
  };

  private readonly onStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    this.releaseStick();
  };

  private moveKnob(clientX: number, clientY: number): void {
    let dx = clientX - this.originX;
    let dy = clientY - this.originY;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      dx = (dx / length) * STICK_RADIUS;
      dy = (dy / length) * STICK_RADIUS;
    }
    if (this.classic) {
      // Classic steering only uses the horizontal axis.
      this.knob.style.transform = `translate(${dx}px, 0)`;
      this.touch.steer = dx / STICK_RADIUS;
    } else {
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const travel = Math.min(1, length / STICK_RADIUS);
      const push =
        travel <= STICK_DEAD_ZONE
          ? 0
          : Math.min(1, (travel - STICK_DEAD_ZONE) / (FULL_THROTTLE_AT - STICK_DEAD_ZONE));
      const scale = length > 0 ? push / length : 0;
      this.touch.stickX = dx * scale;
      this.touch.stickY = -dy * scale;
    }
    this.touch.active = true;
  }

  private releaseStick(): void {
    this.stickPointer = null;
    this.touch.stickX = 0;
    this.touch.stickY = 0;
    this.touch.steer = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('is-active');
    this.base.style.left = '';
    this.base.style.top = '';
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `cw-touch__button ${className}`;
  node.textContent = label;
  return node;
}

/** Calls `down` while a pointer holds the button and `up` when it lets go. */
function holdButton(target: HTMLElement, down: () => void, up: () => void): void {
  target.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    target.classList.add('is-pressed');
    down();
  });
  const release = (): void => {
    target.classList.remove('is-pressed');
    up();
  };
  target.addEventListener('pointerup', release);
  target.addEventListener('pointercancel', release);
  target.addEventListener('contextmenu', (event) => event.preventDefault());
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
