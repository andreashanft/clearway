import { button, el } from '../dom';

export interface TitleHandlers {
  onPlay: () => void;
  onSettings: () => void;
  onHowToPlay: () => void;
}

/** Title screen: the headline over the backdrop, Play, Settings and How to play. No taglines. */
export class TitleScreen {
  readonly root: HTMLElement;
  private readonly play: HTMLButtonElement;

  constructor(handlers: TitleHandlers) {
    this.play = button('Play', 'primary', handlers.onPlay, { className: 'title__play' });
    this.root = el('section', {
      className: 'screen title',
      attributes: { 'aria-label': 'Title' },
      children: [
        el('div', { className: 'title__shade' }),
        el('div', {
          className: 'title__main',
          children: [
            el('h1', {
              className: 'cw-display title__headline',
              html: 'Clear<br>the <span class="title__accent">path.</span>',
            }),
            el('div', { className: 'cw-tag cw-tag--signal title__build', text: 'Test yard' }),
            el('div', {
              className: 'title__actions',
              children: [
                this.play,
                button('Settings', 'ghost', handlers.onSettings),
                button('How to play', 'ghost', handlers.onHowToPlay),
              ],
            }),
          ],
        }),
      ],
    });
  }

  show(): void {
    this.play.focus({ preventScroll: true });
  }
}
