import type { FailCause } from '../../game/events';
import { button, el, setText } from '../dom';

export interface FailHandlers {
  onRetry: () => void;
  onWatchAgain: () => void;
  onQuit: () => void;
}

/** One tip per kind of crash. A tip names a way out, in one sentence. */
const TIPS: Record<FailCause, string> = {
  shed: 'A ram at speed drops a shed.',
  house: 'A ram at three quarters of the top speed drops a house.',
  block: 'Ram a large building where the Hauler will pass, and carve a way through.',
  tower: 'Ram the base of a tower until it falls.',
  vehicle: "Keep your vehicle off the Hauler's line.",
  tnt: "Keep TNT crates off the Hauler's line.",
  explosion: 'Set TNT off before the Hauler is near.',
  tree: 'Trees stop the Hauler too.',
};

/** Hauler destroyed: what it hit, one tip, Retry, Watch again and Quit. */
export class FailScreen {
  readonly root: HTMLElement;
  private readonly hit: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly replayTag: HTMLElement;
  private readonly retry: HTMLButtonElement;

  constructor(handlers: FailHandlers) {
    this.hit = el('b');
    this.progress = el('span');
    this.tip = el('span');
    this.replayTag = el('div', {
      className: 'cw-tag cw-tag--alarm fail__replay is-on',
      children: [el('span', { className: 'fail__dot' }), el('span', { text: 'REPLAY 0.25×' })],
    });
    this.retry = button('Retry', 'danger', handlers.onRetry, { className: 'fail__retry' });
    this.root = el('section', {
      className: 'screen fail',
      attributes: { 'aria-label': 'Hauler destroyed' },
      children: [
        el('div', { className: 'fail__bar fail__bar--top' }),
        el('div', { className: 'fail__bar fail__bar--bottom' }),
        this.replayTag,
        el('div', {
          className: 'fail__panel',
          children: [
            el('h1', { className: 'cw-display fail__title', html: 'Hauler<br>destroyed' }),
            el('div', {
              className: 'fail__detail',
              children: [
                el('span', { text: 'Hit ' }),
                this.hit,
                el('span', { text: ' · ' }),
                this.progress,
              ],
            }),
            el('div', {
              className: 'fail__tip',
              children: [
                el('span', { className: 'fail__tip-label', text: 'TIP' }),
                el('span', { text: ' · ' }),
                this.tip,
              ],
            }),
            this.retry,
            el('div', {
              className: 'fail__row',
              children: [
                button('Watch again', 'ghost', handlers.onWatchAgain),
                button('Quit to title', 'ghost', handlers.onQuit),
              ],
            }),
          ],
        }),
      ],
    });
  }

  show(hit: string, cause: FailCause, cleared: number, total: number): void {
    setText(this.hit, hit);
    setText(this.progress, `${cleared} of ${total} cleared`);
    setText(this.tip, TIPS[cause]);
    // Retry is the default action.
    this.retry.focus({ preventScroll: true });
  }
}
