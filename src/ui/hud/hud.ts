import './hud.css';
import type { GameBus } from '../../game/events';
import type { LevelStats, Medal } from '../../game/scoring';
import { shortfallFor } from '../../game/scoring';
import type { CommandBus } from '../commands';

/** Formats seconds as m:ss. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const MEDAL_LETTER: Record<Medal, string> = { bronze: 'B', silver: 'S', gold: 'G' };

/**
 * The in-game HUD: counters, the route bar with its countdown, banners, free roam and the
 * fail and results panels. It listens to game events and sends commands; it never
 * touches the game directly.
 */
export class Hud {
  readonly element = el('div', 'cw-hud');
  private readonly obstaclesValue = el('div', 'cw-hud__value', '–');
  private readonly buildingsCounter = el('div', 'cw-hud__counter');
  private readonly buildingsValue = el('div', 'cw-hud__value', '–');
  private readonly routePanel = el('div', 'cw-hud__route');
  private readonly routeLabel = el('div', 'cw-hud__route-label', 'HAULER STARTING');
  private readonly routeTimer = el('div', 'cw-hud__route-timer', '0:00');
  private readonly routeFill = el('div', 'cw-hud__route-fill');
  private readonly routeTrack = el('div', 'cw-hud__route-track');
  private readonly ticks = new Map<string, HTMLElement>();
  private readonly banner = el('div', 'cw-hud__banner');
  private readonly finishButton = el(
    'button',
    'cw-button cw-button--primary cw-hud__finish',
    'FINISH',
  );
  private readonly panel = el('div', 'cw-hud__panel');
  private readonly unsubscribe: (() => void)[] = [];
  private bannerTimer = 0;

  constructor(parent: HTMLElement, bus: GameBus, commands: CommandBus) {
    const counters = el('div', 'cw-hud__counters');
    const obstacles = el('div', 'cw-hud__counter');
    obstacles.append(el('div', 'cw-hud__label', 'OBSTACLES'), this.obstaclesValue);
    this.buildingsCounter.append(el('div', 'cw-hud__label', 'BUILDINGS LEFT'), this.buildingsValue);
    this.buildingsCounter.hidden = true;
    counters.append(obstacles, this.buildingsCounter);

    const head = el('div', 'cw-hud__route-head');
    head.append(this.routeLabel, this.routeTimer);
    this.routeTrack.append(this.routeFill);
    this.routePanel.append(head, this.routeTrack);

    this.finishButton.type = 'button';
    this.finishButton.hidden = true;
    this.finishButton.addEventListener('click', () => commands.emit('finish', undefined));
    this.banner.hidden = true;
    this.panel.hidden = true;

    this.element.append(counters, this.routePanel, this.banner, this.finishButton, this.panel);
    parent.append(this.element);

    this.unsubscribe.push(
      bus.on('session:obstacles', ({ obstacles, routeLength }) => {
        this.routeTrack.querySelectorAll('.cw-hud__tick').forEach((t) => t.remove());
        this.ticks.clear();
        for (const o of obstacles) {
          const tick = el('div', 'cw-hud__tick');
          tick.style.left = `${(o.distance / routeLength) * 100}%`;
          tick.title = o.label;
          this.routeTrack.append(tick);
          this.ticks.set(o.id, tick);
        }
        this.obstaclesValue.textContent = `${obstacles.length} LEFT`;
      }),
      bus.on('hauler:status', (s) => {
        this.routeFill.style.width = `${Math.min(100, (s.distance / s.routeLength) * 100)}%`;
        this.routePanel.dataset.urgency = s.urgency;
        this.obstaclesValue.textContent = `${s.obstaclesLeft} LEFT`;
        this.buildingsValue.textContent = String(s.buildingsLeft);
        if (s.countdown !== null && s.next !== null) {
          this.routeLabel.textContent = `NEXT IMPACT · ${s.next.toUpperCase()}`;
          this.routeTimer.textContent = formatClock(s.countdown);
        }
      }),
      bus.on('obstacle:cleared', ({ id }) => {
        this.ticks.get(id)?.classList.add('is-cleared');
      }),
      bus.on('session:phase', ({ phase }) => {
        this.element.dataset.phase = phase;
        if (phase === 'pathClear') {
          this.routeLabel.textContent = 'PATH CLEAR';
          this.routeTimer.textContent = '';
          this.showBanner('PATH CLEAR', 'Free roam: flatten the rest', 'go', 3);
        }
        if (phase === 'freeRoam') {
          this.routePanel.hidden = true;
          this.buildingsCounter.hidden = false;
          this.finishButton.hidden = false;
        }
        if (phase === 'results') this.finishButton.hidden = true;
      }),
      bus.on('hauler:stalled', ({ seconds }) => {
        this.showBanner('HAULER STALLED', `${seconds} seconds of grace`, 'signal', 2);
      }),
      bus.on('hauler:destroyed', () => {
        this.showPanel('fail', 'HAULER DESTROYED', 'The core went up. Clear the route faster.', [
          {
            label: 'RETRY',
            kind: 'danger',
            command: () => commands.emit('retry', undefined),
            focus: true,
          },
          { label: 'QUIT', kind: 'ghost', command: () => commands.emit('quit', undefined) },
        ]);
      }),
      bus.on('session:results', ({ stats, medal }) => {
        this.showResults(stats, medal, commands);
      }),
    );
  }

  /** Resets the HUD for a fresh attempt. */
  reset(): void {
    this.routePanel.hidden = false;
    this.buildingsCounter.hidden = true;
    this.finishButton.hidden = true;
    this.panel.hidden = true;
    this.banner.hidden = true;
    this.routeLabel.textContent = 'HAULER STARTING';
    this.routeTimer.textContent = '';
    this.routeFill.style.width = '0%';
  }

  update(frameSeconds: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= frameSeconds;
      if (this.bannerTimer <= 0) this.banner.hidden = true;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.element.remove();
  }

  private showBanner(title: string, subtitle: string, tone: string, seconds: number): void {
    this.banner.replaceChildren(
      el('div', 'cw-hud__banner-title', title),
      el('div', 'cw-hud__banner-sub', subtitle),
    );
    this.banner.dataset.tone = tone;
    this.banner.hidden = false;
    this.bannerTimer = seconds;
  }

  private showPanel(
    tone: string,
    title: string,
    body: string | HTMLElement,
    buttons: { label: string; kind: string; command: () => void; focus?: boolean }[],
  ): void {
    const actions = el('div', 'cw-hud__actions');
    let focus: HTMLButtonElement | null = null;
    for (const b of buttons) {
      const button = el('button', `cw-button cw-button--${b.kind}`, b.label);
      button.type = 'button';
      button.addEventListener('click', b.command);
      actions.append(button);
      if (b.focus) focus = button;
    }
    const content = typeof body === 'string' ? el('p', 'cw-hud__panel-body', body) : body;
    this.panel.replaceChildren(el('h2', 'cw-hud__panel-title', title), content, actions);
    this.panel.dataset.tone = tone;
    this.panel.hidden = false;
    this.banner.hidden = true;
    this.bannerTimer = 0;
    focus?.focus();
  }

  private showResults(stats: LevelStats, medal: Medal | null, commands: CommandBus): void {
    const body = el('div', 'cw-hud__results');
    const badge = el(
      'div',
      `cw-medal cw-medal--${medal ?? 'none'}`,
      medal ? MEDAL_LETTER[medal] : '–',
    );
    const list = el('dl', 'cw-hud__stats');
    const row = (term: string, value: string): void => {
      list.append(el('dt', '', term), el('dd', '', value));
    };
    row('CLEAR TIME', stats.clearTime === null ? '–' : formatClock(stats.clearTime));
    row('BUILDINGS', `${stats.buildingsDestroyed} / ${stats.buildingsTotal}`);
    if (stats.beaconsTotal > 0) row('BEACONS', `${stats.beaconsFound} / ${stats.beaconsTotal}`);
    if (stats.dishExists) row('RELAY DISH', stats.dishFound ? 'FOUND' : '–');
    body.append(badge, list);
    if (medal !== 'gold' && stats.pathCleared) {
      const goal = medal === 'silver' ? 'gold' : 'silver';
      const need = shortfallFor(stats, goal);
      const parts = [
        need.buildings > 0 ? `${need.buildings} more buildings` : '',
        need.beacons > 0 ? `${need.beacons} more beacons` : '',
        need.dish ? 'the relay dish' : '',
      ].filter(Boolean);
      body.append(
        el(
          'p',
          'cw-hud__hint',
          `${goal === 'gold' ? 'Gold' : 'Silver'} needs ${parts.join(', ')}.`,
        ),
      );
    }
    const title = medal ? `${medal.toUpperCase()} MEDAL` : 'RESULTS';
    this.showPanel(medal ?? 'none', title, body, [
      { label: 'REPLAY', kind: 'ghost', command: () => commands.emit('retry', undefined) },
      {
        label: 'NEXT',
        kind: 'primary',
        command: () => commands.emit('next', undefined),
        focus: true,
      },
    ]);
  }
}
