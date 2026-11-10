import './kit.css';

type Child = Node | string | null | undefined | false;

export interface Props {
  readonly class?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly style?: Readonly<Record<string, string>>;
  readonly on?: {
    readonly [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
  };
}

/** Creates an element with classes, attributes, listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  for (const [name, value] of Object.entries(props.data ?? {})) node.dataset[name] = value;
  for (const [name, value] of Object.entries(props.style ?? {}))
    node.style.setProperty(name, value);
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    node.addEventListener(type, listener as EventListener);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'text';

/**
 * A button from the design system: square with the lower-right corner cut. Yellow is the
 * one thing to do next, blue is secondary, outlined glass is everything else.
 */
export function button(
  label: string,
  variant: ButtonVariant,
  onClick: () => void,
  options: { size?: 'small' | 'large'; icon?: SVGElement; ariaLabel?: string; class?: string } = {},
): HTMLButtonElement {
  const node = h('button', {
    class: [
      'cw-button',
      `cw-button--${variant}`,
      options.size ? `cw-button--${options.size}` : '',
      options.class ?? '',
    ]
      .filter(Boolean)
      .join(' '),
    attrs: { type: 'button', ...(options.ariaLabel ? { 'aria-label': options.ariaLabel } : {}) },
    on: { click: onClick },
  });
  if (options.icon) node.append(options.icon);
  if (label) node.append(h('span', { text: label }));
  return node;
}

/** A small mono tag, such as "LEVEL 01". */
export function chip(
  text: string,
  tone: 'default' | 'hazard' | 'go' | 'alarm' | 'amber' | 'blue' = 'default',
): HTMLElement {
  return h('span', { class: `cw-chip cw-chip--${tone}`, text });
}

/** A label above a big number, as in the HUD counters. */
export function stat(label: string, value: string, tone?: string): HTMLElement {
  return h(
    'div',
    { class: 'cw-stat' },
    h('div', { class: 'cw-stat__label', text: label }),
    h('div', { class: 'cw-stat__value', text: value, data: tone ? { tone } : {} }),
  );
}

/** An accessible on/off switch. */
export function toggle(
  label: string,
  description: string,
  on: boolean,
  change: (on: boolean) => void,
): HTMLElement {
  const sw = h('button', {
    class: 'cw-switch',
    attrs: { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label },
  });
  sw.append(h('span', { class: 'cw-switch__knob' }));
  sw.addEventListener('click', () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    change(next);
  });
  return h(
    'div',
    { class: 'cw-setting' },
    h(
      'div',
      { class: 'cw-setting__text' },
      h('div', { class: 'cw-setting__label', text: label }),
      h('div', { class: 'cw-setting__desc', text: description }),
    ),
    sw,
  );
}

/** A labelled range slider with a live readout. */
export function slider(
  id: string,
  label: string,
  range: { min: number; max: number; step: number; value: number; format?: (v: number) => string },
  change: (value: number) => void,
): HTMLElement {
  const format = range.format ?? ((v: number) => String(Math.round(v)));
  const readout = h('output', {
    class: 'cw-slider__value',
    text: format(range.value),
    attrs: { for: id },
  });
  const input = h('input', {
    class: 'cw-slider__input',
    attrs: {
      id,
      type: 'range',
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
      value: String(range.value),
    },
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    readout.textContent = format(value);
    change(value);
  });
  return h(
    'div',
    { class: 'cw-slider' },
    h('label', { class: 'cw-slider__label', text: label, attrs: { for: id } }),
    input,
    readout,
  );
}

const ICONS: Readonly<Record<string, string>> = {
  back: '<path d="M11 3 L5 9 L11 15" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  pause:
    '<rect x="3" y="2" width="4" height="14" rx="1" fill="currentColor"/><rect x="11" y="2" width="4" height="14" rx="1" fill="currentColor"/>',
  check:
    '<path d="M4 9.5 L7.5 13 L14 5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<rect x="4" y="8" width="10" height="8" rx="2" fill="currentColor"/><path d="M6.5 8 V5.5 a2.5 2.5 0 0 1 5 0 V8" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  star: '<path d="M9 1.5 L11 6.6 L16.5 6.9 L12.2 10.3 L13.6 15.6 L9 12.6 L4.4 15.6 L5.8 10.3 L1.5 6.9 L7 6.6 Z" fill="currentColor"/>',
  clock:
    '<circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M9 5 V9 L11.5 10.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  arrow:
    '<path d="M15 3 L15 11 M15 3 L7 3 M15 3 L3 15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
};

/** An inline stroke icon that takes the text colour. Decorative unless labelled. */
export function icon(name: keyof typeof ICONS, size = 18): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

/** Formats seconds as m:ss. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
