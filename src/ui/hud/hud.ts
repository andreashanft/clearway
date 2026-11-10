import './hud.css';
import type { InputSource } from '../../engine/input/controls';
import type { GameBus, GameEvents } from '../../game/events';
import { formatScore } from '../../game/points';
import type { CommandBus } from '../commands';
import { button, chip, formatClock, h, icon, stat } from '../kit';
import { Minimap } from './minimap';

/** Seconds a hint stays up. */
const HINT_SECONDS = 6;

/** Score pop-ups on screen at once, and how long each lasts. */
const MAX_POPUPS = 8;
const POPUP_MS = 1300;

/**
 * The in-game HUD: pause button and counters, the countdown to the next impact with the
 * hint pill under it, the mini-map, the Hauler pointer, the path-clear banner, and (with
 * a keyboard) the vehicle card and key hints. It listens to game
 * events and sends commands; it never touches the game directly.
 */
export class Hud {
  readonly element = h('div', { class: 'cw-hud' });
  private readonly counters = h('div', { class: 'cw-hud__counters' });
  private readonly obstaclesStat = stat('OBSTACLES', '–');
  private readonly levelStat = stat('LEVEL', '');
  private readonly buildingsStat = stat('BUILDINGS', '–');
  private readonly beaconsStat = stat('BEACONS', '–', 'signal');
  private readonly scoreStat = stat('SCORE', '0', 'hazard');
  private readonly popups = h('div', { class: 'cw-hud__popups', attrs: { 'aria-hidden': 'true' } });
  private readonly routePanel = h('div', { class: 'cw-hud__route cw-glass' });
  private readonly routeLabel = h('div', { class: 'cw-hud__route-label', text: 'NEXT IMPACT' });
  private readonly routeTimer = h('div', { class: 'cw-hud__route-timer' });
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
  private readonly vehicleCard = h('div', { class: 'cw-hud__vehicle' });
  private readonly vehicleName = h('div', { class: 'cw-hud__vehicle-name' });
  private readonly vehicleSpeed = h('div', { class: 'cw-label' });
  private readonly vehicleAction = h('div', { class: 'cw-hud__vehicle-action' });
  private readonly keys = h('div', { class: 'cw-hud__keys cw-glass' });
  private readonly context = h('div', { class: 'cw-hud__context' });
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
    for (const s of [
      this.obstaclesStat,
      this.buildingsStat,
      this.beaconsStat,
      this.scoreStat,
      this.levelStat,
    ]) {
      s.classList.add('cw-glass', 'cw-hud__counter');
    }
    this.counters.append(
      pause,
      this.obstaclesStat,
      this.buildingsStat,
      this.beaconsStat,
      this.scoreStat,
      this.levelStat,
    );

    this.routePanel.append(this.routeLabel, this.routeTimer);
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
          h('span', { text: 'Flatten what you can before the Hauler leaves.' }),
        ),
      ),
    );
    this.banner.hidden = true;

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
      this.popups,
      this.counters,
      top,
      this.minimapBox,
      this.pointer,
      this.banner,
      this.vehicleCard,
      this.keys,
      this.context,
    );
    this.context.hidden = true;
    parent.append(this.element);

    this.unsubscribe.push(
      bus.on('session:obstacles', ({ obstacles }) => {
        setStat(this.obstaclesStat, `${obstacles.length} LEFT`);
      }),
      bus.on('map:setup', (setup) => {
        this.minimap.configure(setup);
      }),
      bus.on('hud:frame', (frame) => {
        this.minimap.draw(frame);
        this.placePointer(frame);
        if (frame.player) {
          this.vehicleSpeed.textContent = `${Math.abs(Math.round(frame.player.speed * 3.6))} KM/H`;
        }
      }),
      bus.on('hauler:status', (s) => {
        this.routePanel.dataset.urgency = s.urgency;
        setStat(this.obstaclesStat, `${s.obstaclesLeft} LEFT`);
        setStat(
          this.buildingsStat,
          `${this.buildingsTotal - s.buildingsLeft} / ${this.buildingsTotal}`,
        );
        if (s.countdown !== null && s.next !== null) {
          this.routeLabel.textContent = `NEXT IMPACT · ${s.next.toUpperCase()}`;
          this.routeTimer.textContent = formatClock(s.countdown);
        } else if (this.element.dataset.phase === 'pathClear') {
          // The path is clear: what counts down now is the rest of the run.
          this.routeLabel.textContent = 'PATH CLEAR · TIME LEFT';
          this.routeTimer.textContent = formatClock(s.timeLeft);
        }
      }),
      bus.on('session:phase', ({ phase }) => {
        this.element.dataset.phase = phase;
        if (phase === 'pathClear') {
          this.routeLabel.textContent = 'PATH CLEAR · TIME LEFT';
          this.banner.hidden = false;
          this.bannerLeft = 3;
          this.obstaclesStat.hidden = true;
          this.buildingsStat.hidden = false;
        }
      }),
      bus.on('path:cleared', ({ seconds }) => {
        this.bannerChip.textContent = `CLEARED IN ${formatClock(seconds)}`;
      }),
      bus.on('context', (context) => {
        this.context.hidden = context === null;
        if (context) this.context.replaceChildren(chip('E', 'hazard'), ` ${context.label}`);
      }),
      bus.on('pickup:beacon', ({ found, total }) => {
        setStat(this.beaconsStat, `${found} / ${total}`);
        // Restart the flash on the next frame, so back-to-back beacons each flash.
        this.beaconsStat.classList.remove('is-flash');
        requestAnimationFrame(() => this.beaconsStat.classList.add('is-flash'));
      }),
      bus.on('score', (score) => {
        setStat(this.scoreStat, formatScore(score.total));
        // Scenery adds up quietly; buildings, pickups and the path clear pop up.
        if (score.kind !== 'prop' && score.onScreen) this.popUp(score);
      }),
      bus.on('hint', ({ text }) => {
        this.showHint(text);
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

  /** Shows "+points" rising and fading over what earned them. */
  private popUp(score: GameEvents['score']): void {
    while (this.popups.childElementCount >= MAX_POPUPS) this.popups.firstElementChild?.remove();
    const popup = h(
      'div',
      { class: 'cw-hud__popup', data: { kind: score.kind } },
      h('span', { class: 'cw-hud__popup-points', text: `+${formatScore(score.points)}` }),
      score.label ? h('span', { class: 'cw-hud__popup-label', text: score.label }) : null,
    );
    popup.style.left = `${Math.round(score.screenX)}px`;
    popup.style.top = `${Math.round(score.screenY)}px`;
    this.popups.append(popup);
    window.setTimeout(() => {
      popup.remove();
    }, POPUP_MS);
  }

  /** Sets up for a fresh attempt at a level. */
  reset(levelName: string, buildingsTotal: number, beaconsTotal = 0): void {
    this.beaconsStat.hidden = beaconsTotal === 0;
    setStat(this.beaconsStat, `0 / ${beaconsTotal}`);
    setStat(this.scoreStat, '0');
    this.popups.replaceChildren();
    this.routePanel.hidden = false;
    this.obstaclesStat.hidden = false;
    this.buildingsStat.hidden = true;
    this.banner.hidden = true;
    this.hintPill.hidden = true;
    this.pointer.hidden = true;
    this.routeLabel.textContent = 'NEXT IMPACT';
    this.routeTimer.textContent = '';
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
  private placePointer({ hauler, player, cameraYaw }: GameEvents['hud:frame']): void {
    if (!hauler || hauler.onScreen) {
      this.pointer.hidden = true;
      this.pointer.classList.remove('is-tracking');
      return;
    }
    const rect = this.element.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    let dx = hauler.screenX - cx;
    let dy = hauler.screenY - cy;
    if (player) {
      // Point along the ground from the player to the Hauler, turned into the view. The
      // Hauler's projected position is no use here: it mirrors once it is behind the camera.
      const wx = hauler.x - player.x;
      const wz = hauler.z - player.z;
      dx = wx * Math.cos(cameraYaw) - wz * Math.sin(cameraYaw);
      dy = wx * Math.sin(cameraYaw) + wz * Math.cos(cameraYaw);
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Push the arrow out to the edge of a rectangle that stays clear of the panels along
    // the top and, with touch controls, of the stick and buttons along the bottom.
    const touch = this.element.dataset.input === 'touch';
    const portrait = rect.height > rect.width;
    const insetX = Math.max(100, rect.width * 0.14);
    const insetTop = portrait ? 230 : rect.height < 340 ? 100 : rect.height < 600 ? 128 : 215;
    const insetBottom = touch ? (portrait ? 240 : 180) : Math.max(70, rect.height * 0.2);
    // On the shortest views the two insets meet; the arrow then slides along one line.
    let top = insetTop;
    let bottom = rect.height - insetBottom;
    if (bottom < top) top = bottom = (top + bottom) / 2;
    // Send the arrow far out along the bearing, then pull it back inside the rectangle:
    // it slides into a corner instead of sitting on top of the player.
    const far = rect.width + rect.height;
    const px = Math.max(insetX, Math.min(rect.width - insetX, cx + dx * far));
    const py = Math.max(top, Math.min(bottom, cy + dy * far));
    this.pointer.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    const svg = this.pointer.querySelector('svg');
    // The arrow icon points to the upper right; rotate it towards the Hauler.
    if (svg) svg.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI + 45}deg)`;
    this.pointerLabel.textContent = `HAULER ${Math.round(hauler.distance)} M`;
    this.pointer.hidden = false;
    // Positions arrive ten times a second; from the second one on, glide between them.
    requestAnimationFrame(() => this.pointer.classList.add('is-tracking'));
  }
}

function setStat(element: HTMLElement, value: string): void {
  const v = element.querySelector('.cw-stat__value');
  if (v) v.textContent = value;
}
