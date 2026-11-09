import './hud.css';
import type { InputSource } from '../../engine/input/controls';
import type { GameBus } from '../../game/events';
import type { CommandBus } from '../commands';
import { button, chip, formatClock, h, icon, stat } from '../kit';
import { Minimap } from './minimap';

/** Seconds a hint stays up. */
const HINT_SECONDS = 6;

/**
 * The in-game HUD from the gameplay mocks: pause button and counters, the route bar with
 * its countdown and hint pill, the mini-map, the Hauler pointer, the path-clear banner,
 * free roam, and (with a keyboard) the vehicle card and key hints. It listens to game
 * events and sends commands; it never touches the game directly.
 */
export class Hud {
  readonly element = h('div', { class: 'cw-hud' });
  private readonly counters = h('div', { class: 'cw-hud__counters' });
  private readonly obstaclesStat = stat('OBSTACLES', '–');
  private readonly levelStat = stat('LEVEL', '');
  private readonly buildingsStat = stat('BUILDINGS', '–');
  private readonly routePanel = h('div', { class: 'cw-hud__route cw-glass' });
  private readonly routeLabel = h('div', { class: 'cw-hud__route-label', text: 'HAULER STARTING' });
  private readonly routeTimer = h('div', { class: 'cw-hud__route-timer' });
  private readonly routeFill = h('div', { class: 'cw-hud__route-fill' });
  private readonly routeTrack = h('div', { class: 'cw-hud__route-track' }, this.routeFill);
  private readonly hintPill = h('div', { class: 'cw-hud__hint', attrs: { role: 'status' } });
  private readonly minimap = new Minimap();
  private readonly minimapBox = h('div', { class: 'cw-hud__minimap cw-glass' });
  private readonly pointer = h('div', {
    class: 'cw-hud__pointer',
    attrs: { 'aria-hidden': 'true' },
  });
  private readonly pointerLabel = h('span');
  private readonly banner = h('div', { class: 'cw-hud__banner', attrs: { role: 'status' } });
  private readonly bannerChip = chip('', 'go');
  private readonly roam = h('div', { class: 'cw-hud__roam' });
  private readonly roamText = h('span');
  private readonly finish: HTMLButtonElement;
  private readonly vehicleCard = h('div', { class: 'cw-hud__vehicle' });
  private readonly vehicleName = h('div', { class: 'cw-hud__vehicle-name' });
  private readonly vehicleSpeed = h('div', { class: 'cw-label' });
  private readonly vehicleAction = h('div', { class: 'cw-hud__vehicle-action' });
  private readonly keys = h('div', { class: 'cw-hud__keys cw-glass' });
  private readonly context = h('div', { class: 'cw-hud__context' });
  private readonly ticks = new Map<string, { element: HTMLElement; label: string }>();
  private readonly unsubscribe: (() => void)[] = [];
  private bannerLeft = 0;
  private hintLeft = 0;
  private buildingsTotal = 0;
  private actionLabel = 'ACTION';

  constructor(parent: HTMLElement, bus: GameBus, commands: CommandBus) {
    const pause = button('', 'ghost', () => commands.emit('pause', undefined), {
      icon: icon('pause', 16),
      ariaLabel: 'Pause',
      class: 'cw-button--icon cw-hud__pause',
    });
    this.levelStat.classList.add('cw-hud__level');
    this.buildingsStat.hidden = true;
    for (const s of [this.obstaclesStat, this.buildingsStat, this.levelStat]) {
      s.classList.add('cw-glass', 'cw-hud__counter');
    }
    this.counters.append(pause, this.obstaclesStat, this.buildingsStat, this.levelStat);

    this.routePanel.append(
      h('div', { class: 'cw-hud__route-head' }, this.routeLabel, this.routeTimer),
      this.routeTrack,
    );
    const top = h('div', { class: 'cw-hud__top' }, this.routePanel, this.hintPill);
    this.hintPill.hidden = true;

    this.minimapBox.append(this.minimap.canvas);
    this.minimapBox.addEventListener('dblclick', () => commands.emit('recentre', undefined));
    let lastTap = 0;
    this.minimapBox.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'touch') return;
      const now = performance.now();
      if (now - lastTap < 320) commands.emit('recentre', undefined);
      else this.minimapBox.classList.toggle('is-collapsed');
      lastTap = now;
    });

    this.pointer.append(icon('arrow', 16), this.pointerLabel);
    this.pointer.hidden = true;

    this.banner.append(
      h('div', { class: 'cw-hud__check' }, icon('check', 40)),
      h(
        'div',
        { class: 'cw-hud__banner-text' },
        h('div', { class: 'cw-hud__banner-title', text: 'PATH CLEAR' }),
        h(
          'div',
          { class: 'cw-hud__banner-sub' },
          this.bannerChip,
          h('span', { text: 'The Hauler is rolling to the safe zone.' }),
        ),
      ),
    );
    this.banner.hidden = true;

    this.roam.append(h('span', { class: 'cw-hud__roam-title', text: 'FREE ROAM' }), this.roamText);
    this.roam.hidden = true;
    this.finish = button('Finish level', 'secondary', () => commands.emit('finish', undefined), {
      class: 'cw-hud__finish',
    });
    this.finish.hidden = true;

    this.vehicleCard.append(
      h('div', { class: 'cw-hud__vehicle-head' }, this.vehicleName, this.vehicleSpeed),
      this.vehicleAction,
    );
    this.keys.append(
      ...[
        ['WASD', 'drive'],
        ['SHIFT', 'brake'],
        ['SPACE', 'action'],
        ['E', 'exit / enter'],
        ['Q / R', 'rotate'],
        ['ESC', 'pause'],
      ].map(([key, what]) => h('div', {}, h('b', { text: key ?? '' }), ` ${what ?? ''}`)),
    );

    this.element.append(
      this.counters,
      top,
      this.minimapBox,
      this.pointer,
      this.banner,
      this.roam,
      this.finish,
      this.vehicleCard,
      this.keys,
      this.context,
    );
    this.context.hidden = true;
    parent.append(this.element);

    this.unsubscribe.push(
      bus.on('session:obstacles', ({ obstacles, routeLength }) => {
        for (const tick of this.ticks.values()) tick.element.remove();
        this.ticks.clear();
        for (const o of obstacles) {
          const element = h('div', { class: 'cw-hud__tick', attrs: { title: o.label } });
          element.style.left = `${(o.distance / routeLength) * 100}%`;
          this.routeTrack.append(element);
          this.ticks.set(o.id, { element, label: o.label });
        }
        setStat(this.obstaclesStat, `${obstacles.length} LEFT`);
      }),
      bus.on('map:setup', (setup) => {
        this.minimap.configure(setup);
      }),
      bus.on('hud:frame', (frame) => {
        this.minimap.draw(frame);
        this.placePointer(frame.hauler);
        if (frame.player) {
          this.vehicleSpeed.textContent = `${Math.abs(Math.round(frame.player.speed * 3.6))} KM/H`;
        }
      }),
      bus.on('hauler:status', (s) => {
        this.routeFill.style.width = `${Math.min(100, (s.distance / s.routeLength) * 100)}%`;
        this.routePanel.dataset.urgency = s.urgency;
        setStat(this.obstaclesStat, `${s.obstaclesLeft} LEFT`);
        setStat(
          this.buildingsStat,
          `${this.buildingsTotal - s.buildingsLeft} / ${this.buildingsTotal}`,
        );
        this.roamText.textContent =
          s.buildingsLeft > 0
            ? `No timer. Wreck ${s.buildingsLeft} more building${s.buildingsLeft === 1 ? '' : 's'} for gold.`
            : 'No timer. Every building is down.';
        if (s.countdown !== null && s.next !== null) {
          this.routeLabel.textContent = `NEXT IMPACT · ${s.next.toUpperCase()}`;
          this.routeTimer.textContent = formatClock(s.countdown);
        }
        for (const tick of this.ticks.values()) {
          tick.element.classList.toggle('is-next', tick.label === s.next);
        }
      }),
      bus.on('obstacle:cleared', ({ id }) => {
        this.ticks.get(id)?.element.classList.add('is-cleared');
      }),
      bus.on('session:phase', ({ phase }) => {
        this.element.dataset.phase = phase;
        if (phase === 'pathClear') {
          this.routeLabel.textContent = 'PATH CLEAR';
          this.routeTimer.textContent = '';
          this.banner.hidden = false;
          this.bannerLeft = 3;
        }
        if (phase === 'freeRoam' || phase === 'pathClear') {
          this.obstaclesStat.hidden = true;
          this.buildingsStat.hidden = false;
          this.roam.hidden = false;
          this.finish.hidden = false;
        }
        if (phase === 'freeRoam') this.routePanel.hidden = true;
      }),
      bus.on('path:cleared', ({ seconds }) => {
        this.bannerChip.textContent = `CLEARED IN ${formatClock(seconds)}`;
      }),
      bus.on('context', (context) => {
        this.context.hidden = context === null;
        if (context) this.context.replaceChildren(chip('E', 'hazard'), ` ${context.label}`);
      }),
      bus.on('hint', ({ text }) => {
        this.showHint(text);
      }),
      bus.on('hauler:stalled', ({ seconds }) => {
        this.showHint(`The Hauler stalled. ${seconds} seconds of grace.`);
      }),
      bus.on('tnt:lit', ({ seconds }) => {
        this.showHint(`Fuse lit: ${seconds.toFixed(0)} seconds. Push it into place and back off.`);
      }),
      bus.on('vehicle:changed', ({ name, actionLabel }) => {
        this.vehicleName.textContent = name.toUpperCase();
        this.actionLabel = actionLabel;
        this.vehicleAction.replaceChildren(
          chip('SPACE', 'hazard'),
          ` ${actionLabel.toLowerCase()} ready`,
        );
      }),
      bus.on('action:state', ({ active, ready, charge }) => {
        const state = active ? 'on' : ready ? 'ready' : `${Math.round(charge * 100)}%`;
        this.vehicleAction.replaceChildren(
          chip('SPACE', 'hazard'),
          ` ${this.actionLabel.toLowerCase()} ${state}`,
        );
      }),
    );
  }

  /** Sets up for a fresh attempt at a level. */
  reset(levelName: string, buildingsTotal: number): void {
    this.routePanel.hidden = false;
    this.obstaclesStat.hidden = false;
    this.buildingsStat.hidden = true;
    this.banner.hidden = true;
    this.roam.hidden = true;
    this.finish.hidden = true;
    this.hintPill.hidden = true;
    this.pointer.hidden = true;
    this.routeLabel.textContent = 'HAULER STARTING';
    this.routeTimer.textContent = '';
    this.routeFill.style.width = '0%';
    this.routePanel.dataset.urgency = 'calm';
    this.buildingsTotal = buildingsTotal;
    setStat(this.levelStat, levelName.toUpperCase());
    delete this.element.dataset.phase;
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  setMinimapVisible(visible: boolean): void {
    this.minimapBox.hidden = !visible;
  }

  /** Keyboard and gamepad players see the vehicle card and key hints. */
  setInputSource(source: InputSource): void {
    this.element.dataset.input = source;
  }

  update(frameSeconds: number): void {
    if (this.bannerLeft > 0) {
      this.bannerLeft -= frameSeconds;
      if (this.bannerLeft <= 0) this.banner.hidden = true;
    }
    if (this.hintLeft > 0) {
      this.hintLeft -= frameSeconds;
      if (this.hintLeft <= 0) this.hintPill.hidden = true;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.element.remove();
  }

  private showHint(text: string): void {
    this.hintPill.replaceChildren(h('span', { class: 'cw-hud__hint-dot' }), text);
    this.hintPill.hidden = false;
    this.hintLeft = HINT_SECONDS;
  }

  /** An arrow at the screen edge pointing at the Hauler when it is out of view. */
  private placePointer(
    hauler: { screenX: number; screenY: number; onScreen: boolean; distance: number } | null,
  ): void {
    if (!hauler || hauler.onScreen || this.element.dataset.phase === 'freeRoam') {
      this.pointer.hidden = true;
      return;
    }
    const rect = this.element.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    let dx = hauler.screenX - cx;
    let dy = hauler.screenY - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Push the arrow out to the edge of an inset rectangle.
    // Keep clear of the corner panels: more inset on bigger screens.
    const marginX = Math.max(10, cx - Math.max(90, rect.width * 0.14));
    const marginY = Math.max(10, cy - Math.max(70, rect.height * 0.2));
    const t = Math.min(
      Math.abs(marginX / (Math.abs(dx) > 1e-6 ? dx : 1e-6)),
      Math.abs(marginY / (Math.abs(dy) > 1e-6 ? dy : 1e-6)),
    );
    this.pointer.style.transform = `translate(${cx + dx * t}px, ${cy + dy * t}px) translate(-50%, -50%)`;
    const svg = this.pointer.querySelector('svg');
    // The arrow icon points to the upper right; rotate it towards the Hauler.
    if (svg) svg.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI + 45}deg)`;
    this.pointerLabel.textContent = `HAULER ${Math.round(hauler.distance)} M`;
    this.pointer.hidden = false;
  }
}

function setStat(element: HTMLElement, value: string): void {
  const v = element.querySelector('.cw-stat__value');
  if (v) v.textContent = value;
}
