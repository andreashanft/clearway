import './hud.css';
import * as THREE from 'three/webgpu';
import type { Game } from '../../game/game';
import { formatTime, medalFor, type Medal } from '../../game/scoring';
import { button, el, setText, tag } from '../dom';
import { ICONS, vehicleIcon } from '../icons';
import { Minimap } from './minimap';

/** Distance of the pointer from the vehicle on the screen, in CSS pixels. */
const POINTER_OFFSET = 68;
/** The pointer hides when the obstacle is this close, in metres. It would only be in the way. */
const POINTER_HIDE_DISTANCE = 16;
/** Seconds for which the Path clear banner shows before bonus time takes over. */
const BANNER_SECONDS = 3;
const HINT_SECONDS = 6.5;
const MEDAL_TOAST_SECONDS = 2.6;

export interface HudHandlers {
  onPause: () => void;
  onFinish: () => void;
  onRecenter: () => void;
}

/**
 * The head-up display. It stays minimal: icons and numbers, and nothing that explains itself in
 * sentences. The centre of the screen stays clear.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly counters: HTMLElement;
  private readonly obstacleCount: HTMLElement;
  private readonly beaconCount: HTMLElement;
  private readonly dishCounter: HTMLElement;
  private readonly dishCount: HTMLElement;
  private readonly leaveCounter: HTMLElement;
  private readonly leaveTime: HTMLElement;
  private readonly minimap = new Minimap();
  private readonly minimapFrame: HTMLElement;
  private readonly pointer: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardIcon: HTMLElement;
  private readonly cardName: HTMLElement;
  private readonly cardLabel: HTMLElement;
  private readonly cardBar: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerClear: HTMLElement;
  private readonly bannerBonus: HTMLElement;
  private readonly finishButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;

  private bannerTimer = 0;
  private hintTimer = 0;
  private toastTimer = 0;
  private medal: Medal = 'none';
  private cardVehicle = '';
  private unsubscribe: (() => void)[] = [];
  private readonly projected = new THREE.Vector3();
  private readonly gapTarget = new THREE.Vector3();
  private lastMinimapTap = 0;

  constructor(parent: HTMLElement, handlers: HudHandlers) {
    const pause = button('Pause', 'ghost', handlers.onPause, {
      className: 'cw-button--icon hud__pause',
      html: ICONS.pause,
    });

    this.obstacleCount = el('span', { className: 'hud__number' });
    this.beaconCount = el('span', { className: 'hud__number hud__number--signal' });
    this.dishCount = el('span', { className: 'hud__number' });
    this.leaveTime = el('span', { className: 'hud__number hud__number--signal' });
    this.dishCounter = el('div', {
      className: 'hud__counter hud__counter--dish',
      children: [el('span', { html: ICONS.dish }), this.dishCount],
    });
    this.leaveCounter = el('div', {
      className: 'hud__counter hud__counter--leave',
      children: [el('span', { html: ICONS.hauler }), this.leaveTime],
    });
    this.counters = el('div', {
      className: 'hud__counters cw-glass',
      attributes: { role: 'status' },
      children: [
        el('div', {
          className: 'hud__counter',
          children: [el('span', { html: ICONS.obstacle }), this.obstacleCount],
        }),
        el('div', {
          className: 'hud__counter',
          children: [el('span', { html: ICONS.beacon }), this.beaconCount],
        }),
        this.dishCounter,
        this.leaveCounter,
      ],
    });

    this.minimapFrame = el('div', {
      className: 'hud__minimap cw-glass',
      attributes: { 'aria-label': 'Mini-map' },
      children: [this.minimap.canvas],
    });
    // A double tap on the mini-map resets the camera.
    this.minimapFrame.addEventListener('pointerdown', () => {
      const now = performance.now();
      if (now - this.lastMinimapTap < 350) {
        handlers.onRecenter();
      }
      this.lastMinimapTap = now;
    });

    this.pointer = el('div', { className: 'hud__pointer', html: ICONS.chevron });
    this.pointer.setAttribute('aria-hidden', 'true');

    this.cardIcon = el('div', { className: 'hud__card-icon' });
    this.cardName = el('div', { className: 'hud__card-name' });
    this.cardLabel = el('div', { className: 'hud__card-label' });
    this.cardBar = el('div', { className: 'hud__card-bar' });
    this.card = el('div', {
      className: 'hud__card',
      children: [
        this.cardIcon,
        el('div', {
          className: 'hud__card-body',
          children: [
            el('div', { className: 'hud__card-row', children: [this.cardName, this.cardLabel] }),
            el('div', { className: 'hud__card-track', children: [this.cardBar] }),
          ],
        }),
      ],
    });

    this.bannerClear = tag('', 'go');
    this.bannerBonus = tag('', 'signal');
    this.banner = el('div', {
      className: 'hud__banner',
      attributes: { role: 'status' },
      children: [
        el('div', { className: 'hud__banner-check', html: ICONS.check }),
        el('div', {
          className: 'hud__banner-text',
          children: [
            el('h1', { className: 'hud__banner-title cw-display', text: 'Path clear' }),
            el('div', {
              className: 'hud__banner-tags',
              children: [this.bannerClear, this.bannerBonus],
            }),
          ],
        }),
      ],
    });

    this.finishButton = button('Finish level', 'secondary', handlers.onFinish, {
      className: 'hud__finish',
    });
    this.hint = el('div', { className: 'hud__hint', attributes: { role: 'status' } });
    this.toast = el('div', { className: 'hud__toast', attributes: { role: 'status' } });

    this.root = el('div', {
      className: 'hud',
      children: [
        el('div', { className: 'hud__shade' }),
        el('div', { className: 'hud__top-left', children: [pause, this.counters] }),
        this.minimapFrame,
        this.pointer,
        this.card,
        this.banner,
        this.hint,
        this.toast,
        this.finishButton,
      ],
    });
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** Shows or hides the whole head-up display. */
  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Tells the display whether touch controls share the screen, which moves a few parts. */
  setTouchLayout(touch: boolean): void {
    this.root.classList.toggle('has-touch', touch);
  }

  /** Shows or hides the mini-map, for the Display setting. */
  setMinimapVisible(visible: boolean): void {
    this.minimapFrame.hidden = !visible;
  }

  /** Connects the display to a level. */
  attach(game: Game): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.minimap.reset();
    this.bannerTimer = 0;
    this.hintTimer = 0;
    this.toastTimer = 0;
    this.medal = 'none';
    this.banner.classList.remove('is-on');
    this.hint.classList.remove('is-on');
    this.toast.classList.remove('is-on');

    this.unsubscribe = [
      game.events.on('pathClear', ({ clearSeconds, bonusSeconds }) => {
        setText(this.bannerClear, `CLEARED ${formatTime(clearSeconds)}`);
        setText(this.bannerBonus, `BONUS ${formatTime(bonusSeconds)}`);
        this.banner.classList.add('is-on');
        this.bannerTimer = BANNER_SECONDS;
        this.medal = 'bronze';
      }),
      game.events.on('hint', ({ text }) => {
        setText(this.hint, text);
        this.hint.classList.add('is-on');
        this.hintTimer = HINT_SECONDS;
      }),
    ];
  }

  /** Refreshes the display. Call it once per frame. */
  update(game: Game, camera: THREE.Camera, frameSeconds: number): void {
    if (this.root.hidden) {
      return;
    }
    const { phase } = game;
    const bonus = phase === 'bonus';
    this.root.dataset.phase = phase;

    // Counters: obstacles and beacons while the path is blocked; buildings, beacons, the dish
    // and the time until the Hauler leaves once it is clear.
    const tally = game.tally();
    if (bonus) {
      setText(this.obstacleCount, `${tally.buildingsDestroyed} / ${tally.buildingsTotal}`);
      setText(this.dishCount, `${tally.dishFound ? 1 : 0} / 1`);
      this.dishCounter.classList.toggle('is-found', tally.dishFound);
      setText(this.leaveTime, formatTime(game.secondsUntilHaulerLeaves));
    } else {
      setText(this.obstacleCount, String(game.obstaclesLeft));
    }
    setText(this.beaconCount, `${tally.beaconsLit} / ${tally.beaconsTotal}`);
    const summary = bonus
      ? `${tally.buildingsDestroyed} of ${tally.buildingsTotal} buildings, ${tally.beaconsLit} of ${tally.beaconsTotal} beacons, relay dish ${tally.dishFound ? 'found' : 'not found'}, ${formatTime(game.secondsUntilHaulerLeaves)} until the Hauler leaves`
      : `${game.obstaclesLeft} obstacles left, ${tally.beaconsLit} of ${tally.beaconsTotal} beacons`;
    if (this.counters.getAttribute('aria-label') !== summary) {
      this.counters.setAttribute('aria-label', summary);
    }

    this.updatePointer(game, camera);
    this.updateCard(game);
    if (!this.minimapFrame.hidden) {
      this.minimap.draw(game);
    }

    this.finishButton.hidden = !bonus || this.bannerTimer > 0;
    if (this.bannerTimer > 0) {
      this.bannerTimer -= frameSeconds;
      if (this.bannerTimer <= 0) {
        this.banner.classList.remove('is-on');
      }
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= frameSeconds;
      if (this.hintTimer <= 0) {
        this.hint.classList.remove('is-on');
      }
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= frameSeconds;
      if (this.toastTimer <= 0) {
        this.toast.classList.remove('is-on');
      }
    }

    // Medal earned: a short banner when bonus time lifts the medal to silver or gold.
    if (bonus && this.bannerTimer <= 0) {
      const medal = medalFor(tally, game.level.medals);
      if (medal !== this.medal) {
        this.medal = medal;
        if (medal === 'silver' || medal === 'gold') {
          setText(this.toast, `${medal} medal`);
          this.toast.dataset.medal = medal;
          this.toast.classList.add('is-on');
          this.toastTimer = MEDAL_TOAST_SECONDS;
        }
      }
    }
  }

  /** Places the chevron beside the player's vehicle and points it at the next obstacle. */
  private updatePointer(game: Game, camera: THREE.Camera): void {
    const next = game.phase === 'playing' ? game.nextObstacle : undefined;
    if (!next) {
      this.pointer.classList.remove('is-on');
      return;
    }
    // Aim at the part of the obstacle that the Hauler reaches first.
    let target: THREE.Vector3 | undefined;
    let nearest = Infinity;
    const gap = next.obstacle.gap;
    if (gap) {
      // A gap in the route: point at the slot that the Railbed must fill.
      target = this.gapTarget.set(
        gap.slot[0],
        game.heightAt(gap.slot[0], gap.slot[1]),
        gap.slot[1],
      );
    }
    for (const segment of next.obstacle.segments) {
      if (segment.building.hp[segment.index] > 0 && segment.enter < nearest) {
        nearest = segment.enter;
        target = segment.building.segments[segment.index].center;
      }
    }
    const vehicle = game.activeVehicle.object.position;
    if (!target || Math.hypot(target.x - vehicle.x, target.z - vehicle.z) < POINTER_HIDE_DISTANCE) {
      this.pointer.classList.remove('is-on');
      return;
    }

    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    this.projected.copy(vehicle).project(camera);
    const x = (this.projected.x * 0.5 + 0.5) * width;
    const y = (-this.projected.y * 0.5 + 0.5) * height;
    // The direction on the screen follows from the direction on the ground and the view heading.
    const view = game.cameraRig.targetHeading;
    const dx = target.x - vehicle.x;
    const dz = target.z - vehicle.z;
    const screenRight = -dx * Math.sin(view) + dz * Math.cos(view);
    const screenUp = dx * Math.cos(view) + dz * Math.sin(view);
    const angle = Math.atan2(-screenUp, screenRight);

    this.pointer.style.transform = `translate(${x + Math.cos(angle) * POINTER_OFFSET}px, ${y + Math.sin(angle) * POINTER_OFFSET}px) translate(-50%, -50%) rotate(${angle}rad)`;
    this.pointer.dataset.urgency = game.urgency;
    this.pointer.classList.add('is-on');
  }

  private updateCard(game: Game): void {
    const vehicle = game.activeVehicle;
    if (this.cardVehicle !== vehicle.spec.type) {
      this.cardVehicle = vehicle.spec.type;
      this.cardIcon.innerHTML = vehicleIcon(vehicle.spec.type, 44);
      setText(this.cardName, vehicle.spec.name);
      setText(this.cardLabel, vehicle.spec.actionLabel ? `${vehicle.spec.actionLabel} CHARGE` : '');
    }
    const charge = vehicle.actionActive ? 1 : vehicle.actionCharge;
    this.cardBar.style.transform = `scaleX(${charge.toFixed(3)})`;
    this.card.classList.toggle('is-ready', vehicle.actionCharge >= 1 || vehicle.actionActive);
  }
}
