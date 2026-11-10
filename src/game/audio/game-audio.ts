import type { AudioEngine } from '../../engine/audio';
import type { GameBus } from '../events';
import type { VehicleType } from '../level-data';
import type { Phase } from '../session';
import { Music, tensionFor } from './music';
import { bell, blast, click, crumble, hiss, squelch, thump } from './synth';

/** Engine sound for each machine: base pitch, top speed (m/s) and filter brightness. */
interface Timbre {
  readonly base: number;
  readonly topSpeed: number;
  readonly cutoff: number;
  readonly level: number;
}

const TIMBRES: Readonly<Record<VehicleType | 'pilot', Timbre>> = {
  bruiser: { base: 36, topSpeed: 14, cutoff: 520, level: 0.16 },
  fishtail: { base: 50, topSpeed: 22, cutoff: 820, level: 0.14 },
  liftoff: { base: 68, topSpeed: 31, cutoff: 1500, level: 0.12 },
  tumbler: { base: 30, topSpeed: 25, cutoff: 420, level: 0.18 },
  railbed: { base: 44, topSpeed: 12.5, cutoff: 600, level: 0.14 },
  pilot: { base: 40, topSpeed: 4, cutoff: 300, level: 0 },
};

/** The sound of each machine's Action while it is running. */
const ACTION_SOUNDS: Partial<Record<VehicleType, { frequency: number; q: number; level: number }>> =
  {
    fishtail: { frequency: 1100, q: 0.9, level: 0.22 },
    liftoff: { frequency: 520, q: 0.5, level: 0.4 },
    tumbler: { frequency: 170, q: 0.7, level: 0.5 },
  };

/** Where the app is in its flow, as far as sound cares. */
export type AudioScene = 'menu' | 'briefing' | 'playing' | 'paused' | 'failed' | 'results';

/** Seconds within which beacons count as a run, each one chiming a step higher. */
const BEACON_RUN = 1.6;
/** Shortest gap between two impact sounds, so a scrape doesn't machine-gun. */
const IMPACT_GAP = 0.06;

/**
 * Turns game events into sound: the soundtrack's mood and tension, engine hum, action
 * loops, hits, collapses, blasts and pickups. It only listens to the event bus.
 */
export class GameAudio {
  readonly music: Music;
  /** With tension music off, the soundtrack keeps an even pace instead of speeding up. */
  tension = true;
  private scene: AudioScene = 'menu';
  private phase: Phase | null = null;
  private vehicle: VehicleType | 'pilot' = 'bruiser';
  private actionActive = false;
  private hum: {
    a: OscillatorNode;
    b: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null = null;
  private action: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  private drone: { gain: GainNode } | null = null;
  private lastImpact = 0;
  private lastBeacon = 0;
  private beaconRun = 0;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly engine: AudioEngine,
    bus: GameBus,
  ) {
    this.music = new Music(engine);
    engine.onReady((ctx) => {
      this.build(ctx);
    });
    this.unsubscribe.push(
      bus.on('vehicle:changed', ({ type }) => {
        this.vehicle = type;
        this.actionActive = false;
        this.updateLoops(0, 0);
      }),
      bus.on('action:state', ({ active }) => {
        this.actionActive = active;
      }),
      bus.on('hud:frame', (frame) => {
        this.updateLoops(frame.player?.speed ?? 0, frame.hauler?.distance ?? Infinity);
      }),
      bus.on('impact', ({ strength }) => {
        this.play((ctx, out, noise, t) => {
          if (t - this.lastImpact < IMPACT_GAP) return;
          this.lastImpact = t;
          thump(ctx, out, noise, t, strength);
        });
      }),
      bus.on('building:destroyed', () => {
        this.play((ctx, out, noise, t) => {
          crumble(ctx, out, noise, t + 0.03, 1);
        });
      }),
      bus.on('explosion', ({ radius }) => {
        this.play((ctx, out, noise, t) => {
          blast(ctx, out, noise, t, Math.min(1.6, Math.max(0.7, radius / 8)));
        });
      }),
      bus.on('tnt:lit', () => {
        this.play((ctx, out, noise, t) => {
          hiss(ctx, out, noise, t, 3600, 0.7, 0.9);
        });
      }),
      bus.on('pickup:beacon', () => {
        this.play((ctx, out, _noise, t) => {
          this.beaconRun = t - this.lastBeacon < BEACON_RUN ? Math.min(7, this.beaconRun + 1) : 0;
          this.lastBeacon = t;
          // Climb the E major pentatonic scale through a run of beacons.
          const scale = [0, 2, 4, 7, 9, 12, 14, 16];
          const note = 88 + (scale[this.beaconRun] ?? 0);
          bell(ctx, out, t, note, 0.35, 0.9);
          bell(ctx, out, t + 0.07, note + 7, 0.3, 0.5);
        });
      }),
      bus.on('pickup:dish', () => {
        this.music.stinger('medal');
      }),
      bus.on('hint', () => {
        this.playVoice();
      }),
      bus.on('hauler:status', ({ countdown, urgency }) => {
        if (this.phase === 'clearing') {
          this.music.setIntensity(this.tension ? tensionFor(countdown) : 0.35);
        }
        this.music.alarm =
          this.scene === 'playing' &&
          urgency === 'red' &&
          countdown !== null &&
          countdown < 6 &&
          this.phase === 'clearing';
      }),
      bus.on('session:phase', ({ phase }) => {
        this.phase = phase;
        if (phase === 'pathClear') {
          this.music.stinger('clear');
          this.music.alarm = false;
        }
        if (phase === 'failed') {
          this.music.alarm = false;
          this.music.setMood('silent');
          this.music.stinger('fail');
        }
        this.applyScene();
      }),
    );
  }

  /** Where the app's flow is: menus, play, pause and so on. */
  setScene(scene: AudioScene): void {
    this.scene = scene;
    this.applyScene();
  }

  /** A soft click for menu buttons. */
  click(): void {
    this.play((ctx, out, _noise, t) => {
      click(ctx, out, t);
    });
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.music.dispose();
    if (this.hum) {
      this.hum.a.stop();
      this.hum.b.stop();
    }
  }

  private applyScene(): void {
    const { music, engine } = this;
    switch (this.scene) {
      case 'menu':
        music.setMood('menu');
        engine.setMusicBrightness(0.75);
        break;
      case 'briefing':
        music.setMood('play');
        music.setIntensity(0.2);
        engine.setMusicBrightness(0.6);
        break;
      case 'playing':
        if (this.phase === 'failed') music.setMood('silent');
        else if (this.phase === 'pathClear') music.setMood('resolved');
        else music.setMood('play');
        engine.setMusicBrightness(1);
        break;
      case 'paused':
        engine.setMusicBrightness(0.12);
        break;
      case 'failed':
        music.setMood('silent');
        break;
      case 'results':
        music.setMood('resolved');
        engine.setMusicBrightness(0.55);
        break;
    }
    if (this.scene !== 'playing') this.updateLoops(0, Infinity);
  }

  private build(ctx: AudioContext): void {
    const out = this.engine.sfx;
    const noise = this.engine.noise;
    if (!out || !noise) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = 'square';
    b.detune.value = -1200;
    const bLevel = ctx.createGain();
    bLevel.gain.value = 0.5;
    a.connect(filter);
    b.connect(bLevel).connect(filter);
    filter.connect(gain).connect(out);
    a.start();
    b.start();
    this.hum = { a, b, filter, gain };

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    const actionGain = ctx.createGain();
    actionGain.gain.value = 0;
    src.connect(band).connect(actionGain).connect(out);
    src.start();
    this.action = { filter: band, gain: actionGain };

    // The Hauler's diesel drone, louder as it gets close to the player.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 260;
    for (const [frequency, type] of [
      [41, 'sawtooth'],
      [61.5, 'triangle'],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.connect(droneFilter);
      osc.start();
    }
    droneFilter.connect(droneGain).connect(out);
    this.drone = { gain: droneGain };
  }

  /** Follows the player's speed with the engine hum, and runs the action loop. */
  private updateLoops(speed: number, haulerDistance: number): void {
    const ctx = this.engine.context;
    if (!ctx || !this.hum || !this.action || !this.drone) return;
    const t = ctx.currentTime;
    const playing = this.scene === 'playing' && this.phase !== 'failed';
    const timbre = TIMBRES[this.vehicle];
    const pace = Math.min(1.3, Math.abs(speed) / timbre.topSpeed);
    const pitch = timbre.base * (1 + pace * 1.6);
    this.hum.a.frequency.setTargetAtTime(pitch, t, 0.12);
    this.hum.b.frequency.setTargetAtTime(pitch, t, 0.12);
    this.hum.filter.frequency.setTargetAtTime(timbre.cutoff * (1 + pace), t, 0.12);
    this.hum.gain.gain.setTargetAtTime(playing ? timbre.level * (0.55 + 0.45 * pace) : 0, t, 0.08);

    const sound = this.vehicle === 'pilot' ? undefined : ACTION_SOUNDS[this.vehicle];
    const on = playing && this.actionActive && sound !== undefined;
    if (sound) {
      this.action.filter.frequency.setTargetAtTime(sound.frequency * (1 + pace * 0.4), t, 0.05);
      this.action.filter.Q.value = sound.q;
    }
    const level = on ? sound.level : 0;
    this.action.gain.gain.setTargetAtTime(level, t, on ? 0.03 : 0.12);

    const near = Math.max(0, 1 - haulerDistance / 90);
    this.drone.gain.gain.setTargetAtTime(playing ? 0.05 + 0.25 * near * near : 0, t, 0.3);
  }

  private play(
    voice: (ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number) => void,
  ): void {
    const ctx = this.engine.context;
    const out = this.engine.sfx;
    const noise = this.engine.noise;
    if (!ctx || !out || !noise || ctx.state !== 'running') return;
    voice(ctx, out, noise, ctx.currentTime);
  }

  private playVoice(): void {
    const ctx = this.engine.context;
    const out = this.engine.voice;
    const noise = this.engine.noise;
    if (!ctx || !out || !noise || ctx.state !== 'running') return;
    squelch(ctx, out, noise, ctx.currentTime);
  }
}
