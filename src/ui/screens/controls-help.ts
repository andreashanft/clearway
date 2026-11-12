import { el } from '../dom';

type Device = 'touch' | 'keyboard' | 'gamepad';

/** What each control does, per input device. Keys and actions only, no sentences. */
const CONTROLS: Record<Device, [string, string][]> = {
  touch: [
    ['Left thumb', 'Drive'],
    ['Big button', 'Vehicle action'],
    ['Brake', 'Brake / reverse'],
    ['Exit', 'Leave or enter a vehicle'],
    ['Pinch', 'Zoom'],
    ['Two-finger twist', 'Rotate view'],
  ],
  keyboard: [
    ['W A S D', 'Drive'],
    ['Space', 'Vehicle action'],
    ['Shift', 'Brake / reverse'],
    ['E', 'Leave or enter a vehicle'],
    ['Q / R', 'Rotate view'],
    ['Wheel · Z / X', 'Zoom'],
    ['Esc', 'Pause'],
  ],
  gamepad: [
    ['Left stick', 'Steer'],
    ['RT / LT', 'Accelerate / brake'],
    ['A', 'Vehicle action'],
    ['Y', 'Leave or enter a vehicle'],
    ['LB / RB', 'Rotate view'],
    ['Right stick', 'Zoom'],
    ['Start', 'Pause'],
  ],
};

const LABELS: Record<Device, string> = { touch: 'Touch', keyboard: 'Keyboard', gamepad: 'Gamepad' };

/**
 * The Controls panel: tabs for touch, keyboard and gamepad, and the list of controls.
 * Control help lives here and never on the head-up display.
 */
export function createControlsHelp(): HTMLElement {
  const rows = el('div', { className: 'controls__rows' });
  const tabs = new Map<Device, HTMLButtonElement>();

  const select = (device: Device): void => {
    for (const [name, tab] of tabs) {
      tab.setAttribute('aria-pressed', String(name === device));
    }
    rows.replaceChildren(
      ...CONTROLS[device].map(([key, action]) =>
        el('div', {
          className: 'controls__row',
          children: [
            el('div', {
              className: 'controls__key',
              children: [el('span', { className: 'cw-tag controls__keycap', text: key })],
            }),
            el('div', { className: 'controls__action', text: action }),
          ],
        }),
      ),
    );
  };

  const tabRow = el('div', { className: 'controls__tabs' });
  for (const device of Object.keys(CONTROLS) as Device[]) {
    const tab = el('button', {
      className: 'controls__tab',
      text: LABELS[device],
      attributes: { type: 'button' },
      onClick: () => select(device),
    });
    tabs.set(device, tab);
    tabRow.append(tab);
  }

  const touchFirst = window.matchMedia('(pointer: coarse)').matches;
  select(touchFirst ? 'touch' : 'keyboard');

  return el('div', {
    className: 'controls cw-card',
    children: [
      el('div', {
        className: 'controls__head',
        children: [el('h2', { className: 'cw-display controls__title', text: 'Controls' }), tabRow],
      }),
      rows,
    ],
  });
}
