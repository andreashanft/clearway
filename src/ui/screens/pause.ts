import { formatTime } from '../../game/scoring';
import { button, el, setText } from '../dom';
import { createControlsHelp } from './controls-help';

export interface PauseHandlers {
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

/** Pause: Resume, Restart, Settings, Quit to map, and the Controls help. */
export class PauseScreen {
  readonly root: HTMLElement;
  private readonly impact: HTMLElement;
  private readonly resume: HTMLButtonElement;

  constructor(handlers: PauseHandlers) {
    this.impact = el('span', { className: 'cw-tag cw-tag--amber' });
    this.resume = button('Resume', 'primary', handlers.onResume, { className: 'pause__resume' });
    this.root = el('section', {
      className: 'screen pause',
      attributes: { 'aria-label': 'Paused' },
      children: [
        el('div', {
          className: 'pause__menu',
          children: [
            el('div', {
              className: 'pause__head',
              children: [
                el('h1', { className: 'cw-display pause__title', text: 'Paused' }),
                this.impact,
              ],
            }),
            this.resume,
            el('div', {
              className: 'pause__row',
              children: [
                button('Restart', 'secondary', handlers.onRestart),
                button('Settings', 'ghost', handlers.onSettings),
              ],
            }),
            button('Quit to map', 'quiet', handlers.onQuit, { className: 'pause__quit' }),
          ],
        }),
        createControlsHelp(),
      ],
    });
  }

  /**
   * @param secondsToImpact Seconds until the Hauler hits the next obstacle, or `Infinity`.
   * @param secondsToLeave Seconds until the Hauler leaves the map.
   */
  show(secondsToImpact: number, secondsToLeave: number): void {
    const clear = !Number.isFinite(secondsToImpact);
    setText(
      this.impact,
      clear ? `${formatTime(secondsToLeave)} BONUS` : `${formatTime(secondsToImpact)} TO IMPACT`,
    );
    this.impact.className = `cw-tag ${clear ? 'cw-tag--signal' : 'cw-tag--amber'}`;
    this.resume.focus({ preventScroll: true });
  }
}
