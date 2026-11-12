import type { RecordOutcome } from '../../engine/save';
import type { LevelData } from '../../game/level';
import { formatTime, type LevelResult } from '../../game/scoring';
import { button, el, setText } from '../dom';
import { ICONS } from '../icons';

export interface ResultsHandlers {
  onReplay: () => void;
  onNext: () => void;
}

interface Row {
  fill: HTMLElement;
  value: HTMLElement;
}

/** Results: the medal, what was cleared and collected, and what gold still needs. */
export class ResultsScreen {
  readonly root: HTMLElement;
  private readonly levelTag: HTMLElement;
  private readonly medal: HTMLElement;
  private readonly medalName: HTMLElement;
  private readonly bestTag: HTMLElement;
  private readonly scoreTag: HTMLElement;
  private readonly path: Row;
  private readonly buildings: Row;
  private readonly beacons: Row;
  private readonly dish: Row;
  private readonly gold: HTMLElement;
  private readonly goldText: HTMLElement;
  private readonly next: HTMLButtonElement;

  constructor(handlers: ResultsHandlers) {
    this.levelTag = el('span', { className: 'cw-tag' });
    this.medal = el('div', { className: 'results__medal', html: ICONS.star });
    this.medalName = el('h1', { className: 'cw-display results__medal-name' });
    this.bestTag = el('span', { className: 'cw-tag cw-tag--go results__best' });
    this.scoreTag = el('span', { className: 'cw-tag' });

    const row = (
      label: string,
      tone: string,
      withMark: boolean,
    ): { element: HTMLElement; row: Row } => {
      const fill = el('div', { className: `results__fill results__fill--${tone}` });
      const value = el('div', { className: 'results__value' });
      const track = el('div', { className: 'results__track', children: [fill] });
      if (withMark) {
        // The tick marks the share that silver needs.
        track.append(el('div', { className: 'results__mark' }));
      }
      return {
        element: el('div', {
          className: 'results__row',
          children: [el('div', { className: 'results__label', text: label }), track, value],
        }),
        row: { fill, value },
      };
    };
    const path = row('Path cleared', 'go', false);
    const buildings = row('Buildings', 'hazard', true);
    const beacons = row('Beacons', 'signal', true);
    const dish = row('Relay dish', 'signal', false);
    this.path = path.row;
    this.buildings = buildings.row;
    this.beacons = beacons.row;
    this.dish = dish.row;

    this.goldText = el('span');
    this.gold = el('div', {
      className: 'results__gold',
      children: [
        el('div', { className: 'medal medal--gold results__gold-medal', text: 'G' }),
        el('div', { children: [el('b', { text: 'For gold: ' }), this.goldText] }),
      ],
    });
    this.next = button('Next level', 'primary', handlers.onNext, { className: 'results__next' });

    this.root = el('section', {
      className: 'screen results cw-backdrop',
      attributes: { 'aria-label': 'Results' },
      children: [
        el('div', {
          className: 'results__hero',
          children: [this.levelTag, this.medal, this.medalName, this.bestTag, this.scoreTag],
        }),
        el('div', {
          className: 'results__detail',
          children: [
            el('div', {
              className: 'results__card cw-card',
              children: [path.element, buildings.element, beacons.element, dish.element],
            }),
            this.gold,
            el('div', {
              className: 'results__actions',
              children: [button('Replay', 'secondary', handlers.onReplay), this.next],
            }),
          ],
        }),
      ],
    });
  }

  /**
   * @param hasNext True when a further level follows this one.
   */
  show(level: LevelData, result: LevelResult, outcome: RecordOutcome, hasNext: boolean): void {
    setText(
      this.levelTag,
      `LEVEL ${String(level.index).padStart(2, '0')} · ${level.name}`.toUpperCase(),
    );
    this.root.dataset.medal = result.medal;
    setText(this.medalName, result.medal === 'none' ? 'No medal' : result.medal);
    setText(
      this.bestTag,
      `${outcome.newBestTime ? 'NEW BEST · ' : ''}CLEARED ${formatTime(result.clearSeconds)}`,
    );
    setText(this.scoreTag, `SCORE ${result.score.toLocaleString('en-GB')}`);

    const share = (part: number, whole: number): number => (whole === 0 ? 1 : part / whole);
    const set = (row: Row, fraction: number, text: string): void => {
      row.fill.style.transform = `scaleX(${fraction.toFixed(3)})`;
      setText(row.value, text);
    };
    set(
      this.path,
      share(result.obstaclesCleared, result.obstaclesTotal),
      `${result.obstaclesCleared} / ${result.obstaclesTotal}`,
    );
    set(
      this.buildings,
      share(result.buildingsDestroyed, result.buildingsTotal),
      `${result.buildingsDestroyed} / ${result.buildingsTotal}`,
    );
    set(
      this.beacons,
      share(result.beaconsLit, result.beaconsTotal),
      `${result.beaconsLit} / ${result.beaconsTotal}`,
    );
    set(this.dish, result.dishFound ? 1 : 0, result.dishFound ? 'FOUND' : 'NOT FOUND');
    this.dish.value.classList.toggle('results__value--small', true);

    const needs: string[] = [];
    if (result.forGold.buildings > 0) {
      needs.push(
        `${result.forGold.buildings} ${result.forGold.buildings === 1 ? 'building' : 'buildings'}`,
      );
    }
    if (result.forGold.beacons > 0) {
      needs.push(
        `${result.forGold.beacons} ${result.forGold.beacons === 1 ? 'beacon' : 'beacons'}`,
      );
    }
    if (result.forGold.dish) {
      needs.push('relay dish');
    }
    this.gold.hidden = needs.length === 0;
    setText(this.goldText, needs.join(' · '));

    setText(this.next, hasNext ? 'Next level' : 'Campaign');
    this.next.focus({ preventScroll: true });
  }
}
