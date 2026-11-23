import './overlay.css';

/** One line of live statistics in the debug overlay. */
export interface DebugStat {
  label: string;
  /** Returns the text to show. The overlay calls it a few times per second. */
  read: () => string;
}

/** How often the overlay refreshes its statistics, in seconds. */
const REFRESH_SECONDS = 0.25;

/** A group of debug controls: sliders, toggles, selects and buttons. */
export class DebugControls {
  constructor(private readonly root: HTMLElement) {}

  /** Adds a slider and reports each change. */
  addSlider(
    label: string,
    range: { min: number; max: number; step: number; value: number },
    onChange: (value: number) => void,
  ): void {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(range.value);
    const digits = range.step >= 1 ? 0 : range.step >= 0.1 ? 1 : 2;
    const readout = document.createElement('span');
    readout.className = 'debug__readout';
    readout.textContent = range.value.toFixed(digits);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      readout.textContent = value.toFixed(digits);
      onChange(value);
    });
    // A slider that keeps the focus would swallow the driving keys.
    input.addEventListener('pointerup', () => input.blur());
    this.addRow(label, input, readout);
  }

  /** Adds a checkbox and reports each change. */
  addToggle(label: string, value: boolean, onChange: (value: boolean) => void): void {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    this.addRow(label, input);
  }

  /** Adds a button. */
  addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.root.append(button);
  }

  /** Removes every control, so that the group can be built again. */
  clear(): void {
    this.root.replaceChildren();
  }

  private addRow(label: string, ...elements: HTMLElement[]): void {
    const row = document.createElement('label');
    row.className = 'debug__row';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(text, ...elements);
    this.root.append(row);
  }
}

/**
 * Developer overlay, shown when the URL contains `?debug`.
 *
 * It lists live statistics and hosts controls that systems register. `controls` holds the
 * general ones. `addPanel` adds a titled group that its owner can clear and build again.
 */
export class DebugOverlay {
  readonly controls: DebugControls;
  private readonly root: HTMLElement;
  private readonly statsList: HTMLElement;
  private readonly stats: { stat: DebugStat; value: HTMLElement }[] = [];
  private sinceRefresh = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'debug';
    this.root.setAttribute('aria-label', 'Debug overlay');

    this.statsList = document.createElement('dl');
    this.statsList.className = 'debug__stats';
    const controls = document.createElement('div');
    controls.className = 'debug__controls';
    this.controls = new DebugControls(controls);

    this.root.append(this.statsList, controls);
    parent.append(this.root);
  }

  /** Adds a statistics line. */
  addStat(stat: DebugStat): void {
    const term = document.createElement('dt');
    term.textContent = stat.label;
    const value = document.createElement('dd');
    this.statsList.append(term, value);
    this.stats.push({ stat, value });
  }

  /** Adds a titled, collapsible group of controls. */
  addPanel(title: string): DebugControls {
    const details = document.createElement('details');
    details.className = 'debug__panel';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = title;
    const controls = document.createElement('div');
    controls.className = 'debug__controls';
    details.append(summary, controls);
    this.root.append(details);
    return new DebugControls(controls);
  }

  /** Refreshes the statistics. Call it once per frame with the frame time in seconds. */
  update(frameSeconds: number): void {
    this.sinceRefresh += frameSeconds;
    if (this.sinceRefresh < REFRESH_SECONDS) {
      return;
    }
    this.sinceRefresh = 0;
    for (const { stat, value } of this.stats) {
      value.textContent = stat.read();
    }
  }
}

/** Returns true when the URL asks for the debug overlay. */
export function isDebugRequested(search: string = window.location.search): boolean {
  return new URLSearchParams(search).has('debug');
}
