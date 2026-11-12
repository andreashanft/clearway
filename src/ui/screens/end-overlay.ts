import './end-overlay.css';
import type { Game } from '../../game/game';
import { formatTime } from '../../game/scoring';
import { button, el, tag } from '../dom';

/**
 * Placeholder for the fail and result screens. It shows what happened and offers a restart.
 * Milestone 5 replaces it with the screens of the design.
 */
export class EndOverlay {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly tags: HTMLElement;

  constructor(parent: HTMLElement, onRestart: () => void) {
    this.title = el('h1', { className: 'cw-display end__title' });
    this.detail = el('p', { className: 'end__detail' });
    this.tags = el('div', { className: 'end__tags' });
    this.root = el('div', {
      className: 'end',
      children: [
        el('div', {
          className: 'end__panel cw-card',
          children: [
            this.title,
            this.detail,
            this.tags,
            button('Retry', 'primary', () => {
              this.root.hidden = true;
              onRestart();
            }),
          ],
        }),
      ],
    });
    this.root.hidden = true;
    parent.append(this.root);
  }

  attach(game: Game): void {
    this.root.hidden = true;
    game.events.on('haulerDestroyed', ({ hit, obstaclesCleared, obstaclesTotal }) => {
      this.show(
        'Hauler destroyed',
        `Hit ${hit}.`,
        [`${obstaclesCleared} of ${obstaclesTotal} cleared`],
        'fail',
      );
    });
    game.events.on('levelEnded', ({ result }) => {
      this.show(
        result.medal === 'none' ? 'Level over' : result.medal,
        `Score ${result.score}`,
        [
          `Cleared ${formatTime(result.clearSeconds)}`,
          `Buildings ${result.buildingsDestroyed} / ${result.buildingsTotal}`,
          `Beacons ${result.beaconsLit} / ${result.beaconsTotal}`,
          `Relay dish ${result.dishFound ? 'found' : 'not found'}`,
        ],
        'result',
      );
    });
  }

  private show(title: string, detail: string, tags: string[], kind: 'fail' | 'result'): void {
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.tags.replaceChildren(...tags.map((text) => tag(text)));
    this.root.dataset.kind = kind;
    this.root.hidden = false;
  }
}
