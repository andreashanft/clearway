import type { Save } from '../../engine/save';
import { medalSteps } from '../../engine/save';
import type { LevelData } from '../../game/level';
import { formatTime, type Medal } from '../../game/scoring';
import { button, el, setText } from '../dom';
import { ICONS } from '../icons';
import { renderLevelThumbnail } from '../level-thumbnail';

export interface CampaignHandlers {
  onBack: () => void;
  onOpenLevel: (levelId: string) => void;
}

const MEDAL_LETTER: Record<Medal, string> = { none: '', bronze: 'B', silver: 'S', gold: 'G' };

/** Campaign map: one card per level with its art, medal, best time and lock state. */
export class CampaignScreen {
  readonly root: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly medals: HTMLElement;
  private readonly cleared: HTMLElement;
  private readonly thumbnails = new Map<string, HTMLCanvasElement>();

  constructor(
    private readonly levels: readonly LevelData[],
    private readonly handlers: CampaignHandlers,
  ) {
    this.medals = el('b', { className: 'campaign__medals' });
    this.cleared = el('b', { className: 'campaign__cleared' });
    this.cards = el('div', { className: 'campaign__cards' });
    this.root = el('section', {
      className: 'screen campaign cw-backdrop',
      attributes: { 'aria-label': 'Campaign' },
      children: [
        el('header', {
          className: 'campaign__header',
          children: [
            button('Back to title', 'ghost', handlers.onBack, {
              className: 'cw-button--icon',
              html: ICONS.back,
            }),
            el('h1', { className: 'cw-display campaign__title', text: 'Campaign' }),
            el('div', {
              className: 'campaign__totals',
              children: [
                el('div', {
                  className: 'cw-tag campaign__total',
                  children: [el('span', { text: 'MEDALS' }), this.medals],
                }),
                el('div', {
                  className: 'cw-tag campaign__total',
                  children: [el('span', { text: 'CLEARED' }), this.cleared],
                }),
              ],
            }),
          ],
        }),
        this.cards,
      ],
    });
  }

  show(save: Save): void {
    const ids = this.levels.map((level) => level.id);
    setText(this.medals, `${medalSteps(save, ids)}/${ids.length * 3}`);
    setText(this.cleared, `${ids.filter((id) => save.isCleared(id)).length}/${ids.length}`);

    // The first open level without a medal is the one to play next.
    const nextUp = this.levels.find(
      (level) => save.isUnlocked(level.id, ids) && !save.isCleared(level.id),
    );
    this.cards.replaceChildren(
      ...this.levels.map((level) => this.createCard(level, save, ids, level === nextUp)),
    );
    const focus = this.cards.querySelector<HTMLElement>('.campaign__card.is-next button, button');
    focus?.focus({ preventScroll: true });
  }

  private createCard(level: LevelData, save: Save, ids: string[], isNext: boolean): HTMLElement {
    const record = save.record(level.id);
    const medal = record?.medal ?? 'none';
    const unlocked = save.isUnlocked(level.id, ids);
    const number = String(level.index).padStart(2, '0');
    const lineSeconds = level.hauler.length / level.hauler.speed;

    let thumbnail = this.thumbnails.get(level.id);
    if (!thumbnail) {
      thumbnail = renderLevelThumbnail(level, 300, 128);
      this.thumbnails.set(level.id, thumbnail);
    }

    const art = el('div', {
      className: 'campaign__art',
      children: [
        thumbnail,
        el('span', { className: 'cw-tag campaign__time', text: `0${formatTime(lineSeconds)}` }),
      ],
    });
    if (!unlocked) {
      art.append(
        el('div', {
          className: 'campaign__lock',
          html: ICONS.lock,
          attributes: { role: 'img', 'aria-label': 'Locked' },
        }),
      );
    } else if (medal !== 'none') {
      art.append(
        el('div', {
          className: `medal medal--${medal} campaign__medal`,
          text: MEDAL_LETTER[medal],
          attributes: { role: 'img', 'aria-label': `${medal} medal` },
        }),
      );
    } else if (isNext) {
      art.append(el('span', { className: 'campaign__next', text: 'NEXT UP' }));
    }

    const open = (): void => this.handlers.onOpenLevel(level.id);
    let footer: HTMLElement;
    if (!unlocked) {
      footer = el('div', {
        className: 'campaign__locked',
        text: `BRONZE ON L${level.index - 1} TO UNLOCK`,
      });
    } else if (record && medal !== 'none') {
      footer = el('div', {
        className: 'campaign__footer',
        children: [
          el('div', {
            className: 'campaign__best',
            text: `BEST ${formatTime(record.bestClearSeconds)}`,
          }),
          button('Replay', 'ghost', open, {
            className: 'campaign__replay',
            ariaLabel: `Replay ${level.name}`,
          }),
        ],
      });
    } else {
      footer = button('Briefing', 'primary', open, {
        className: 'campaign__briefing',
        ariaLabel: `Briefing for ${level.name}`,
      });
    }

    return el('article', {
      className: `campaign__card${isNext ? ' is-next' : ''}${unlocked ? '' : ' is-locked'}`,
      children: [
        art,
        el('div', {
          className: 'campaign__body',
          children: [
            el('div', {
              className: 'cw-label',
              text: `LEVEL ${number} · ${level.setting} · ${level.timeOfDay}`,
            }),
            el('h2', { className: 'cw-display campaign__name', text: level.name }),
            footer,
          ],
        }),
      ],
    });
  }
}
