import './overlay.css';

/** One line of live statistics in the debug overlay. */
export interface DebugStat {
  label: string;
  /** Returns the text to show. The overlay calls it a few times per second. */
  read: () => string;
}

/** How often the overlay refreshes its statistics, in seconds. */
const REFRESH_SECONDS = 0.25;

/**
 * Developer overlay, shown when the URL contains `?debug`.
 *
 * It lists live statistics and hosts controls that systems register: sliders, toggles, selects
 * and buttons.
 */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly statsList: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly stats: { stat: DebugStat; value: HTMLElement }[] = [];
  private sinceRefresh = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'debug';
    this.root.setAttribute('aria-label', 'Debug overlay');

    this.statsList = document.createElement('dl');
    this.statsList.className = 'debug__stats';
    this.controls = document.createElement('div');
    this.controls.className = 'debug__controls';

    this.root.append(this.statsList, this.controls);
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
    const readout = document.createElement('span');
    readout.className = 'debug__readout';
    readout.textContent = range.value.toFixed(2);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      readout.textContent = value.toFixed(2);
      onChange(value);
    });
    this.addControl(label, input, readout);
  }

  /** Adds a checkbox and reports each change. */
  addToggle(label: string, value: boolean, onChange: (value: boolean) => void): void {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    this.addControl(label, input);
  }

  /** Adds a drop-down list and reports each change. */
  addSelect(
    label: string,
    options: { value: string; label: string }[],
    value: string,
    onChange: (value: string) => void,
  ): void {
    const select = document.createElement('select');
    for (const option of options) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    this.addControl(label, select);
  }

  /** Adds a button. */
  addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.controls.append(button);
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

  private addControl(label: string, ...elements: HTMLElement[]): void {
    const row = document.createElement('label');
    row.className = 'debug__row';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(text, ...elements);
    this.controls.append(row);
  }
}

/** Returns true when the URL asks for the debug overlay. */
export function isDebugRequested(search: string = window.location.search): boolean {
  return new URLSearchParams(search).has('debug');
}
