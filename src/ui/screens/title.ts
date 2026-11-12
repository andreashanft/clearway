import { button, el, setText } from '../dom';

export interface TitleHandlers {
  onPlay: () => void;
  onSettings: () => void;
  onHowToPlay: () => void;
}

/** Title screen: the headline over the diorama, Play, Settings and How to play. No taglines. */
export class TitleScreen {
  readonly root: HTMLElement;
  private readonly cleared: HTMLElement;
  private readonly total: HTMLElement;
  private readonly play: HTMLButtonElement;

  constructor(handlers: TitleHandlers) {
    this.cleared = el('span', { className: 'title__cleared-count' });
    this.total = el('span');
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
            el('div', {
              className: 'title__cleared cw-glass',
              children: [
                el('div', { className: 'cw-label', text: 'Cleared' }),
                el('div', {
                  className: 'title__cleared-value',
                  children: [this.cleared, this.total],
                }),
              ],
            }),
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

  show(cleared: number, total: number): void {
    setText(this.cleared, String(cleared));
    setText(this.total, ` / ${total}`);
    this.play.focus({ preventScroll: true });
  }
}
