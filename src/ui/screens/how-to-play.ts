import { button, el } from '../dom';
import { ICONS } from '../icons';
import { createControlsHelp } from './controls-help';

/**
 * What to do, in three steps. Each step is one short sentence. Until the city and the carrier
 * exist, the steps describe the test yard.
 */
const STEPS = [
  'The test yard is for trying out how the three vehicles drive.',
  'Use the bar at the top to switch the vehicle and the camera view, or to reset the yard.',
  'Drive the slalom, the turning circles and the streets, and ram the buildings.',
];

/** How to play: the three rules and the Controls help. */
export class HowToPlayScreen {
  readonly root: HTMLElement;
  private readonly back: HTMLButtonElement;

  constructor(onBack: () => void) {
    this.back = button('Back', 'ghost', onBack, { className: 'cw-button--icon', html: ICONS.back });
    this.root = el('section', {
      className: 'screen howto cw-backdrop',
      attributes: { 'aria-label': 'How to play' },
      children: [
        el('div', {
          className: 'howto__rules',
          children: [
            el('div', {
              className: 'howto__head',
              children: [
                this.back,
                el('h1', { className: 'cw-display howto__title', text: 'How to play' }),
              ],
            }),
            el('ol', {
              className: 'howto__steps',
              children: STEPS.map((step, index) =>
                el('li', {
                  className: 'howto__step',
                  children: [
                    el('span', { className: 'cw-display howto__number', text: String(index + 1) }),
                    el('span', { text: step }),
                  ],
                }),
              ),
            }),
          ],
        }),
        createControlsHelp(),
      ],
    });
  }

  show(): void {
    this.back.focus({ preventScroll: true });
  }
}
