import './yard-bar.css';
import type { Game } from '../game/game';
import type { VehicleType } from '../game/level';
import { VEHICLE_SPECS, VEHICLE_TYPES } from '../game/vehicles/specs';
import { el, setText } from './dom';
import { vehicleIcon } from './icons';

export interface YardBarHandlers {
  onVehicle: (type: VehicleType) => void;
  onCamera: () => void;
  onReset: () => void;
}

/**
 * The bar at the top of the test yard: it switches the vehicle and the camera view, resets the
 * yard and counts the cones that the player knocked over.
 *
 * On a keyboard, the keys 1, 2 and 3 choose the vehicle and Backspace resets the yard.
 */
/**
 * Wraps a click handler so that the button gives up the keyboard focus afterwards. A focused
 * button would take the next press of Space or Enter away from the game.
 */
function release(handler: () => void): (event: MouseEvent) => void {
  return (event) => {
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.blur();
    }
    handler();
  };
}

export class YardBar {
  private readonly root: HTMLElement;
  private readonly vehicleButtons = new Map<VehicleType, HTMLButtonElement>();
  private readonly cameraButton: HTMLButtonElement;
  private readonly cones: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement, handlers: YardBarHandlers) {
    const vehicles = el('div', { className: 'yard__group', attributes: { role: 'group' } });
    vehicles.setAttribute('aria-label', 'Vehicle');
    VEHICLE_TYPES.forEach((type, index) => {
      const { name } = VEHICLE_SPECS[type];
      const vehicleButton = el('button', {
        className: 'yard__button yard__vehicle',
        html: vehicleIcon(type, 26),
        attributes: { type: 'button', 'aria-pressed': 'false', title: `${name} (${index + 1})` },
        children: [el('span', { className: 'yard__name', text: name })],
        onClick: release(() => handlers.onVehicle(type)),
      });
      vehicleButton.setAttribute('aria-label', name);
      this.vehicleButtons.set(type, vehicleButton);
      vehicles.append(vehicleButton);
    });

    this.cameraButton = el('button', {
      className: 'yard__button',
      attributes: { type: 'button', title: 'Switch camera view (C)' },
      onClick: release(handlers.onCamera),
    });
    const reset = el('button', {
      className: 'yard__button',
      text: 'Reset',
      attributes: { type: 'button', title: 'Reset the yard (Backspace)' },
      onClick: release(handlers.onReset),
    });
    this.cones = el('span', { className: 'cw-tag yard__cones' });

    this.root = el('div', {
      className: 'yard cw-glass',
      attributes: { role: 'toolbar', 'aria-label': 'Test yard' },
      children: [
        vehicles,
        el('div', { className: 'yard__group', children: [this.cameraButton, reset] }),
        this.cones,
      ],
    });
    this.root.hidden = true;
    parent.append(this.root);

    window.addEventListener('keydown', (event) => {
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (
        !this.visible ||
        event.repeat ||
        typing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      // The key position counts, not the character, so that Shift and other layouts work.
      const digit = /^Digit([1-9])$/.exec(event.code);
      const type = digit ? VEHICLE_TYPES[Number(digit[1]) - 1] : undefined;
      if (type) {
        handlers.onVehicle(type);
      } else if (event.code === 'Backspace') {
        handlers.onReset();
      }
    });
  }

  /** Shows or hides the bar. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.hidden = !visible;
  }

  /** Refreshes the bar. Call it once per frame while it shows. */
  update(game: Game, chaseCamera: boolean): void {
    if (!this.visible) {
      return;
    }
    for (const [type, vehicleButton] of this.vehicleButtons) {
      const pressed = String(type === game.activeVehicle.spec.type);
      if (vehicleButton.getAttribute('aria-pressed') !== pressed) {
        vehicleButton.setAttribute('aria-pressed', pressed);
      }
    }
    setText(this.cameraButton, chaseCamera ? 'Chase view' : 'Fixed view');
    const knocked = game.cones?.knockedCount ?? 0;
    setText(this.cones, `CONES HIT ${knocked}`);
    this.cones.classList.toggle('cw-tag--amber', knocked > 0);
  }
}
