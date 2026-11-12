import type { LevelRecord } from '../../engine/save';
import type { LevelData } from '../../game/level';
import { createRoute, findObstacles } from '../../game/route';
import { formatTime } from '../../game/scoring';
import { VEHICLE_SPECS } from '../../game/vehicles/specs';
import { button, el, setText } from '../dom';
import { ICONS, vehicleIcon } from '../icons';

/** Seconds that the camera takes to fly along the Hauler's line. */
const FLYOVER_SECONDS = 9;

export interface BriefingHandlers {
  onBack: () => void;
  onStart: () => void;
  /** Called every frame with the fly-over position from 0 to 1, or `undefined` when it is over. */
  onFlyover: (progress: number | undefined) => void;
}

/**
 * Level briefing: the camera flies along the Hauler's line while the panel shows the obstacle
 * count, the first hit, the best medal and the vehicles on the map.
 */
export class BriefingScreen {
  readonly root: HTMLElement;
  private readonly levelTag: HTMLElement;
  private readonly settingTag: HTMLElement;
  private readonly name: HTMLElement;
  private readonly obstacles: HTMLElement;
  private readonly firstHit: HTMLElement;
  private readonly best: HTMLElement;
  private readonly kit: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly start: HTMLButtonElement;
  private readonly skip: HTMLButtonElement;
  private elapsed = 0;
  private flying = false;

  constructor(private readonly handlers: BriefingHandlers) {
    this.levelTag = el('span', { className: 'cw-tag' });
    this.settingTag = el('span', { className: 'cw-tag' });
    this.name = el('h1', { className: 'cw-display briefing__name' });
    this.obstacles = el('div', { className: 'briefing__value' });
    this.firstHit = el('div', { className: 'briefing__value briefing__value--hazard' });
    this.best = el('div', { className: 'briefing__value' });
    this.kit = el('div', { className: 'briefing__kit' });
    this.progress = el('div', { className: 'briefing__progress-fill' });
    this.start = button('Start', 'primary', handlers.onStart, { className: 'briefing__start' });
    this.skip = button('Skip', 'ghost', () => this.endFlyover(), { className: 'briefing__skip' });

    const tile = (label: string, value: HTMLElement): HTMLElement =>
      el('div', {
        className: 'briefing__tile cw-card',
        children: [el('div', { className: 'cw-label', text: label }), value],
      });

    this.root = el('section', {
      className: 'screen briefing',
      attributes: { 'aria-label': 'Level briefing' },
      children: [
        el('div', { className: 'briefing__tint' }),
        button('Back to campaign', 'ghost', handlers.onBack, {
          className: 'cw-button--icon briefing__back',
          html: ICONS.back,
        }),
        el('div', {
          className: 'briefing__flyover',
          children: [
            el('div', { className: 'briefing__progress', children: [this.progress] }),
            this.skip,
          ],
        }),
        el('div', {
          className: 'briefing__panel',
          children: [
            el('div', { className: 'briefing__tags', children: [this.levelTag, this.settingTag] }),
            this.name,
            el('div', {
              className: 'briefing__tiles',
              children: [
                tile('Obstacles', this.obstacles),
                tile('First hit', this.firstHit),
                tile('Best', this.best),
              ],
            }),
            this.kit,
            this.start,
          ],
        }),
      ],
    });
  }

  show(level: LevelData, record: LevelRecord | undefined): void {
    const obstacles = findObstacles(createRoute(level.hauler), level.buildings);
    const firstHit = Math.min(
      ...obstacles.map((obstacle) => obstacle.distance),
      ...level.expected.arrivals
        .filter((arrival) => arrival.gap)
        .map((arrival) => arrival.seconds * level.hauler.speed),
    );
    const gaps = level.expected.arrivals.filter((arrival) => arrival.gap).length;

    setText(this.levelTag, `LEVEL ${String(level.index).padStart(2, '0')}`);
    setText(this.settingTag, `${level.setting} · ${level.timeOfDay}`.toUpperCase());
    setText(this.name, level.name);
    setText(this.obstacles, String(obstacles.length + gaps));
    setText(this.firstHit, formatTime(firstHit / level.hauler.speed));
    const medal = record?.medal ?? 'none';
    setText(this.best, medal === 'none' ? '—' : medal);
    this.best.dataset.medal = medal;

    // The vehicles on the map, each type once, and the TNT crates.
    const types = [...new Set(level.vehicles.map((vehicle) => vehicle.type))];
    this.kit.replaceChildren(
      ...types.map((type) =>
        el('div', {
          className: 'briefing__chip cw-glass',
          children: [
            el('span', { html: vehicleIcon(type, 22) }),
            el('span', { text: VEHICLE_SPECS[type].name }),
          ],
        }),
      ),
    );
    if (level.tnt.length > 0) {
      this.kit.append(
        el('div', {
          className: 'briefing__chip cw-glass',
          children: [
            el('span', { html: ICONS.tnt }),
            el('span', { text: `TNT ×${level.tnt.length}` }),
          ],
        }),
      );
    }

    this.elapsed = 0;
    this.flying = true;
    this.skip.hidden = false;
    this.progress.style.transform = 'scaleX(0)';
    this.handlers.onFlyover(0);
    this.start.focus({ preventScroll: true });
  }

  /** Advances the fly-over. Call it once per frame while the screen shows. */
  update(frameSeconds: number): void {
    if (!this.flying) {
      return;
    }
    this.elapsed += frameSeconds;
    const progress = Math.min(1, this.elapsed / FLYOVER_SECONDS);
    this.progress.style.transform = `scaleX(${progress.toFixed(4)})`;
    if (progress >= 1) {
      this.endFlyover();
    } else {
      // Ease in and out, so that the camera does not jerk at either end.
      this.handlers.onFlyover(progress * progress * (3 - 2 * progress));
    }
  }

  private endFlyover(): void {
    this.flying = false;
    this.skip.hidden = true;
    this.progress.style.transform = 'scaleX(1)';
    this.handlers.onFlyover(undefined);
  }
}
