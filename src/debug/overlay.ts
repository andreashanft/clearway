import './overlay.css';
import type { FixedStepClock } from '../engine/clock';
import type { Physics } from '../engine/physics';
import type { Renderer } from '../engine/renderer';

export interface DebugSources {
  readonly renderer: Renderer;
  readonly physics: Physics;
  readonly clock: FixedStepClock;
}

const REFRESH_SECONDS = 0.5;

/**
 * The `?debug` panel: frame rate, draw calls and physics cost, plus a growing set of
 * toggles and sliders that later milestones register (time scale, level select, …).
 */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly controlsEl: HTMLElement;
  private frames = 0;
  private elapsed = 0;
  private worstFrame = 0;

  constructor(
    parent: HTMLElement,
    private readonly sources: DebugSources,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'cw-debug';
    this.root.setAttribute('aria-label', 'Debug overlay');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'cw-debug__toggle';
    header.textContent = 'DEBUG';
    header.addEventListener('click', () => this.root.classList.toggle('is-collapsed'));

    this.statsEl = document.createElement('pre');
    this.statsEl.className = 'cw-debug__stats';
    this.controlsEl = document.createElement('div');
    this.controlsEl.className = 'cw-debug__controls';

    this.root.append(header, this.statsEl, this.controlsEl);
    parent.append(this.root);

    this.addSlider('Time scale', { min: 0, max: 2, step: 0.05, value: 1 }, (value) => {
      this.sources.clock.timeScale = value;
    });
  }

  /** Call once per rendered frame. */
  update(frameSeconds: number): void {
    this.frames++;
    this.elapsed += frameSeconds;
    this.worstFrame = Math.max(this.worstFrame, frameSeconds);
    if (this.elapsed < REFRESH_SECONDS) return;

    const fps = this.frames / this.elapsed;
    const avgMs = (this.elapsed / this.frames) * 1000;
    const { renderer, physics } = this.sources;
    const { drawCalls, triangles } = renderer.frameStats;
    const { width, height } = renderer.viewport;

    this.statsEl.textContent = [
      `FPS     ${fps.toFixed(0).padStart(4)}   avg ${avgMs.toFixed(1)} ms  max ${(this.worstFrame * 1000).toFixed(1)} ms`,
      `GPU     ${renderer.backend.toUpperCase()}  ${width}×${height} @${renderer.pixelRatio.toFixed(2)}x`,
      `DRAW    ${drawCalls} calls  ${formatCount(triangles)} tris`,
      `PHYSICS ${physics.lastStepMs.toFixed(2)} ms  ${physics.bodyCount} bodies`,
    ].join('\n');

    this.frames = 0;
    this.elapsed = 0;
    this.worstFrame = 0;
  }

  addToggle(label: string, value: boolean, onChange: (value: boolean) => void): void {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    this.controlsEl.append(row(label, input));
  }

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
    const readout = document.createElement('output');
    readout.textContent = range.value.toFixed(2);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      readout.textContent = value.toFixed(2);
      onChange(value);
    });
    this.controlsEl.append(row(label, input, readout));
  }

  addSelect(
    label: string,
    options: readonly { value: string; label: string }[],
    value: string,
    onChange: (value: string) => void,
  ): void {
    const select = document.createElement('select');
    for (const option of options) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      select.append(el);
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    this.controlsEl.append(row(label, select));
  }

  addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.controlsEl.append(button);
  }

  dispose(): void {
    this.root.remove();
  }
}

function row(label: string, ...controls: HTMLElement[]): HTMLLabelElement {
  const el = document.createElement('label');
  el.className = 'cw-debug__row';
  const text = document.createElement('span');
  text.textContent = label;
  el.append(text, ...controls);
  return el;
}

function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
