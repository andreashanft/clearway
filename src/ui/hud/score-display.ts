import './score-display.css';
import * as THREE from 'three/webgpu';
import type { Game } from '../../game/game';
import { el, setText } from '../dom';

/** Seconds for which a score pop-up rises and fades. */
const POPUP_SECONDS = 1.1;
/** At most this many pop-ups show at once. A chain reaction drops the oldest. */
const MAX_POPUPS = 14;
/** Breaks this close together, in metres and seconds, share one pop-up that adds them up. */
const MERGE_METRES = 30;
const MERGE_SECONDS = 0.4;
/** The counter rolls towards the score by this share of the gap per second. */
const ROLL_RATE = 8;

interface Popup {
  element: HTMLElement;
  position: THREE.Vector3;
  age: number;
  points: number;
  multiplier: number;
  chain: number;
  tower: boolean;
}

/**
 * The score counter, the combo multiplier with its draining bar, and the points that pop up
 * where a building breaks.
 */
export class ScoreDisplay {
  readonly root: HTMLElement;
  private readonly total: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly multiplier: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly popups: Popup[] = [];
  private readonly projected = new THREE.Vector3();
  private shown = 0;
  private lastMultiplier = 1;

  constructor() {
    this.total = el('div', { className: 'score__total', text: '0' });
    this.multiplier = el('div', { className: 'score__multiplier' });
    this.bar = el('div', { className: 'score__bar-fill' });
    this.combo = el('div', {
      className: 'score__combo',
      children: [this.multiplier, el('div', { className: 'score__bar', children: [this.bar] })],
    });
    this.layer = el('div', { className: 'score-popups' });
    this.layer.setAttribute('aria-hidden', 'true');
    this.root = el('div', {
      className: 'score',
      attributes: { role: 'status', 'aria-label': 'Score' },
      children: [this.total, this.combo],
    });
  }

  /** The layer that holds the pop-ups. It covers the whole screen. */
  get popupLayer(): HTMLElement {
    return this.layer;
  }

  /** Connects the display to a level. Returns a function that disconnects it. */
  attach(game: Game): () => void {
    this.clear();
    this.shown = 0;
    this.lastMultiplier = 1;
    setText(this.total, '0');
    return game.events.on('scored', ({ position, points, multiplier, chain, tower }) => {
      this.addPopup(position, points, multiplier, chain, tower);
    });
  }

  /** Refreshes the counter, the combo and the pop-ups. Call it once per frame. */
  update(game: Game, camera: THREE.Camera, frameSeconds: number): void {
    const { score } = game;
    if (this.shown !== score.total) {
      const gap = score.total - this.shown;
      const step = Math.ceil(Math.abs(gap) * Math.min(1, ROLL_RATE * frameSeconds));
      this.shown = Math.abs(gap) <= step ? score.total : this.shown + Math.sign(gap) * step;
      setText(this.total, this.shown.toLocaleString('en-GB'));
    }
    const multiplier = score.breaks > 0 ? score.multiplier : 1;
    this.combo.classList.toggle('is-on', score.breaks > 0);
    if (multiplier !== this.lastMultiplier) {
      setText(this.multiplier, `×${multiplier}`);
      this.multiplier.classList.remove('is-bump');
      // Restart the bump animation: reading the width forces a reflow.
      void this.multiplier.offsetWidth;
      this.multiplier.classList.add('is-bump');
      this.lastMultiplier = multiplier;
    }
    this.bar.style.transform = `scaleX(${score.comboShare.toFixed(3)})`;
    this.root.setAttribute('aria-label', `Score ${score.total}, combo times ${multiplier}`);

    const width = this.layer.clientWidth;
    const height = this.layer.clientHeight;
    for (let i = this.popups.length - 1; i >= 0; i -= 1) {
      const popup = this.popups[i];
      popup.age += frameSeconds;
      if (popup.age >= POPUP_SECONDS) {
        popup.element.remove();
        this.popups.splice(i, 1);
        continue;
      }
      this.projected.copy(popup.position).project(camera);
      const behind = this.projected.z > 1;
      const x = ((this.projected.x + 1) / 2) * width;
      const y = ((1 - this.projected.y) / 2) * height - popup.age * 46;
      popup.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      popup.element.style.opacity = behind
        ? '0'
        : String(Math.min(1, 2.4 * (1 - popup.age / POPUP_SECONDS)));
    }
  }

  /** Removes every pop-up, for example when a level ends. */
  clear(): void {
    for (const popup of this.popups) {
      popup.element.remove();
    }
    this.popups.length = 0;
  }

  private addPopup(
    position: THREE.Vector3,
    points: number,
    multiplier: number,
    chain: number,
    tower: boolean,
  ): void {
    const near = this.popups.find(
      (popup) => popup.age < MERGE_SECONDS && popup.position.distanceTo(position) < MERGE_METRES,
    );
    if (near) {
      near.points += points;
      near.multiplier = Math.max(near.multiplier, multiplier);
      near.chain = Math.max(near.chain, chain);
      near.tower ||= tower;
      near.age = Math.min(near.age, 0.1);
      this.render(near);
      return;
    }
    if (this.popups.length >= MAX_POPUPS) {
      this.popups.shift()?.element.remove();
    }
    const popup: Popup = {
      element: el('div', { className: 'score-popup' }),
      position: position.clone(),
      age: 0,
      points,
      multiplier,
      chain,
      tower,
    };
    this.render(popup);
    this.layer.append(popup.element);
    this.popups.push(popup);
  }

  /** Writes the points and the tag of a pop-up. */
  private render(popup: Popup): void {
    const parts: HTMLElement[] = [
      el('span', {
        className: 'score-popup__points',
        text: `+${popup.points.toLocaleString('en-GB')}`,
      }),
    ];
    if (popup.chain > 0) {
      const text = popup.chain > 1 ? `CHAIN ×${popup.chain}` : 'CHAIN';
      parts.push(el('span', { className: 'score-popup__tag', text }));
    } else if (popup.multiplier > 1) {
      parts.push(el('span', { className: 'score-popup__tag', text: `×${popup.multiplier}` }));
    }
    popup.element.className = `score-popup${popup.tower ? ' is-tower' : ''}${popup.chain > 0 ? ' is-chain' : ''}`;
    popup.element.replaceChildren(...parts);
  }
}
