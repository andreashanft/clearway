import type { AudioEngine } from '../../engine/audio';
import type { SampleBank } from '../../engine/samples';
import type { GameBus } from '../events';
import type { VehicleType } from '../level-data';
import type { Phase } from '../session';
import { Music, tensionFor } from './music';
import { SAMPLES, type SampleName } from './sample-data';
import { type LoopVoice, RoundRobin, hit, loop, semitones, strip, vary } from './sampler';

/**
 * Engine sound for each machine: the recording that idles, how fast it and the shared
 * recording of an engine under load play, top speed (m/s), level and number of gears.
 */
interface EngineSound {
  readonly idle: SampleName | null;
  readonly idleRate: number;
  readonly loadRate: number;
  readonly topSpeed: number;
  readonly level: number;
  readonly gears: number;
}

const ENGINES: Readonly<Record<VehicleType | 'pilot', EngineSound>> = {
  bruiser: {
    idle: 'engine-tractor',
    idleRate: 0.85,
    loadRate: 0.8,
    topSpeed: 26,
    level: 0.7,
    gears: 2,
  },
  fishtail: {
    idle: 'engine-truck',
    idleRate: 1,
    loadRate: 1,
    topSpeed: 35,
    level: 0.65,
    gears: 4,
  },
  liftoff: {
    idle: 'engine-idle',
    idleRate: 1.15,
    loadRate: 1.2,
    topSpeed: 35,
    level: 0.6,
    gears: 4,
  },
  tumbler: {
    idle: 'engine-tank',
    idleRate: 0.85,
    loadRate: 0.75,
    topSpeed: 25,
    level: 0.7,
    gears: 3,
  },
  railbed: {
    idle: 'engine-generator',
    idleRate: 0.9,
    loadRate: 0.7,
    topSpeed: 12.5,
    level: 0.65,
    gears: 2,
  },
  pilot: { idle: null, idleRate: 1, loadRate: 1, topSpeed: 4, level: 0, gears: 1 },
};

/**
 * Engine revs, 0–1, for a speed as a share of top speed. The revs climb through each
 * gear and drop at the shift, which is what makes it sound like an engine and not a siren.
 */
export function engineRevs(pace: number, gears: number): number {
  const p = Math.max(0, Math.min(1, pace));
  if (p >= 1) return 1;
  const position = p * gears;
  const gear = Math.min(gears - 1, Math.floor(position));
  const idle = 0.25 + 0.12 * gear;
  return idle + (1 - idle) * (position - gear);
}

/** The loop that runs while a machine's Action does: tyres, a rocket, or rolling steel. */
const ACTION_SOUNDS: Partial<
  Record<VehicleType, { sample: 'skid' | 'rocket' | 'tracks'; level: number; rate: number }>
> = {
  fishtail: { sample: 'skid', level: 0.5, rate: 0.9 },
  liftoff: { sample: 'rocket', level: 0.7, rate: 1 },
  tumbler: { sample: 'tracks', level: 0.7, rate: 1.3 },
};

/** How strong a hit must be to sound heavy, and to ring with metal. */
export const HEAVY_HIT = 0.35;
export const CRUSHING_HIT = 0.7;

/** The layers a hit of this strength (0–1) plays, and how loud each is. */
export function impactLayers(strength: number): {
  light: number;
  body: number;
  thud: number;
  metal: number;
} {
  const s = Math.max(0, Math.min(1, strength));
  if (s < HEAVY_HIT) return { light: 0.3 + s, body: 0, thud: 0, metal: 0 };
  return {
    light: 0,
    body: 0.4 + 0.5 * s,
    thud: s >= CRUSHING_HIT ? 0.5 * s : 0,
    metal: s >= CRUSHING_HIT ? 0.45 * s : 0,
  };
}

/** Where the app is in its flow, as far as sound cares. */
export type AudioScene = 'menu' | 'briefing' | 'playing' | 'paused' | 'failed' | 'results';

/** Seconds within which beacons count as a run, each one ringing a step higher. */
const BEACON_RUN = 1.6;
/** Steps of the G minor scale that a run of beacons climbs, in semitones. */
const BEACON_SCALE = [0, 2, 3, 5, 7, 8, 10, 12];
/** Shortest gap between two impact sounds, so a scrape doesn't machine-gun. */
const IMPACT_GAP = 0.09;
/** Within this many seconds of a collapse, the next one only adds rubble. */
const COLLAPSE_GAP = 0.3;

interface Loops {
  idle: LoopVoice | null;
  readonly load: LoopVoice | null;
  readonly hauler: LoopVoice | null;
  readonly skid: LoopVoice | null;
  readonly rocket: LoopVoice | null;
  readonly tracks: LoopVoice | null;
}

/**
 * Turns game events into sound: the soundtrack's mood and tension, engines, action
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
  private loops: Loops | null = null;
  /** The machine whose idle recording is running. */
  private idleFor: VehicleType | 'pilot' | null = null;
  /** Channel strips: hits and blasts ring in the hall, bells more so, clicks stay dry. */
  private hits: AudioNode | null = null;
  private bells: AudioNode | null = null;
  private ui: AudioNode | null = null;
  private engines: AudioNode | null = null;
  private readonly light = new RoundRobin(['crack-1', 'crack-2']);
  private readonly bodies = new RoundRobin(['impact-1', 'impact-2', 'impact-3', 'impact-4']);
  private readonly thuds = new RoundRobin(['thud-1', 'thud-2']);
  private readonly metals = new RoundRobin(['metal-1', 'metal-2', 'kabong']);
  private readonly collapses = new RoundRobin(['collapse-1', 'collapse-2', 'collapse-3']);
  private readonly rubble = new RoundRobin(['rubble-1', 'rubble-2', 'rubble-3']);
  private readonly blasts = new RoundRobin(['blast-1', 'blast-2', 'blast-3']);
  private lastImpact = 0;
  private lastCollapse = 0;
  private lastBeacon = 0;
  private beaconRun = 0;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly engine: AudioEngine,
    bus: GameBus,
  ) {
    // The download starts before the music asks for its samples.
    engine.onReady((ctx) => {
      this.build(ctx);
    });
    this.music = new Music(engine);
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
        this.play(this.hits, (ctx, out, bank, t) => {
          if (t - this.lastImpact < IMPACT_GAP) return;
          this.lastImpact = t;
          const layers = impactLayers(strength);
          // A harder hit sounds lower as well as louder.
          const rate = vary(0.08) * (1.12 - 0.22 * strength);
          if (layers.light > 0)
            hit(ctx, out, this.light.next(bank), t, { level: layers.light, rate });
          if (layers.body > 0)
            hit(ctx, out, this.bodies.next(bank), t, { level: layers.body, rate });
          if (layers.thud > 0) hit(ctx, out, this.thuds.next(bank), t, { level: layers.thud });
          if (layers.metal > 0) {
            hit(ctx, out, this.metals.next(bank), t, { level: layers.metal, rate: vary(0.1) });
          }
        });
      }),
      bus.on('building:destroyed', () => {
        this.play(this.hits, (ctx, out, bank, t) => {
          // When a whole row goes at once, one collapse carries it and the rest add rubble.
          const first = t - this.lastCollapse > COLLAPSE_GAP;
          this.lastCollapse = t;
          if (first) {
            hit(ctx, out, this.collapses.next(bank), t, { level: 0.7, rate: vary(0.07) });
            hit(ctx, out, this.thuds.next(bank), t, { level: 0.45, rate: 0.85 });
            if (Math.random() < 0.4) hit(ctx, out, bank.get('glass'), t + 0.05, { level: 0.22 });
          }
          hit(ctx, out, this.rubble.next(bank), t + (first ? 0.25 : 0.05), {
            level: first ? 0.55 : 0.4,
            rate: vary(0.1),
          });
        });
      }),
      bus.on('explosion', ({ radius }) => {
        this.play(this.hits, (ctx, out, bank, t) => {
          const size = Math.min(1.6, Math.max(0.7, radius / 8));
          // A bigger blast is louder and lower.
          hit(ctx, out, this.blasts.next(bank), t, {
            level: Math.min(1, 0.7 * size),
            rate: vary(0.05) * (1.2 - 0.2 * size),
          });
          hit(ctx, out, bank.get('blast-crack'), t, { level: 0.5, rate: vary(0.08) });
          hit(ctx, out, bank.get('boom'), t, { level: 0.6 * size, rate: 0.8 });
        });
      }),
      bus.on('tnt:lit', ({ seconds }) => {
        this.play(this.hits, (ctx, out, bank, t) => {
          hit(ctx, out, bank.get('fuse'), t, { level: 0.45, length: seconds, release: 0.05 });
        });
      }),
      bus.on('pickup:beacon', () => {
        this.play(this.bells, (ctx, out, bank, t) => {
          this.beaconRun = t - this.lastBeacon < BEACON_RUN ? Math.min(7, this.beaconRun + 1) : 0;
          this.lastBeacon = t;
          const note = BEACON_SCALE[this.beaconRun] ?? 0;
          hit(ctx, out, bank.get('bell-low'), t, {
            level: 0.5,
            rate: semitones(note - 7),
            length: 1,
            release: 0.6,
          });
          hit(ctx, out, bank.get('anvil'), t, { level: 0.1, rate: semitones(note) });
        });
      }),
      bus.on('pickup:dish', () => {
        this.music.stinger('medal');
      }),
      bus.on('hint', () => {
        const ctx = this.engine.context;
        const out = this.engine.voice;
        const bank = this.engine.samples;
        if (!ctx || !out || !bank || ctx.state !== 'running') return;
        hit(ctx, out, bank.get('radio'), ctx.currentTime, { level: 0.5 });
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

  /** A soft tap for menu buttons. */
  click(): void {
    this.play(this.ui, (ctx, out, bank, t) => {
      hit(ctx, out, bank.get('click'), t, { level: 0.6, rate: vary(0.04) });
    });
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.music.dispose();
    const loops = this.loops;
    this.loops = null;
    if (loops) for (const voice of Object.values(loops)) (voice as LoopVoice | null)?.stop();
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
    const bus = this.engine.sfx;
    const bank = this.engine.samples;
    if (!bus || !bank) return;
    void bank.load(SAMPLES);
    this.hits = strip(ctx, bus, { level: 0.9, wet: 0.25 });
    this.bells = strip(ctx, bus, { level: 0.9, wet: 0.45 });
    this.ui = strip(ctx, bus, { level: 0.8 });
    const engines = strip(ctx, bus, { wet: 0.06 });
    this.engines = engines;
    // The loops start once their recordings have arrived; until then the machines are silent.
    bank.whenReady(() => {
      const start = (name: SampleName): LoopVoice | null => loop(ctx, engines, bank.get(name));
      this.loops = {
        idle: null,
        load: start('engine-load'),
        hauler: start('hauler'),
        skid: start('skid'),
        rocket: start('rocket'),
        tracks: start('tracks'),
      };
    });
  }

  /** Follows the player's speed with the engine sound, and runs the action loop. */
  private updateLoops(speed: number, haulerDistance: number): void {
    const ctx = this.engine.context;
    const bank = this.engine.samples;
    const loops = this.loops;
    if (!ctx || !bank || !loops || !this.engines) return;
    const t = ctx.currentTime;
    const playing = this.scene === 'playing' && this.phase !== 'failed';
    const sound = ENGINES[this.vehicle];

    // Each machine idles with its own recording: swap it when the player changes machine.
    if (this.idleFor !== this.vehicle) {
      this.idleFor = this.vehicle;
      const old = loops.idle;
      if (old) {
        old.gain.setTargetAtTime(0, t, 0.05);
        old.stopAt(t + 0.4);
      }
      loops.idle = sound.idle ? loop(ctx, this.engines, bank.get(sound.idle)) : null;
    }

    const pace = Math.min(1, Math.abs(speed) / sound.topSpeed);
    const revs = engineRevs(pace, sound.gears);
    const level = playing ? sound.level : 0;
    // At idle the machine's own clatter leads; under load the roar takes over.
    if (loops.idle) {
      loops.idle.rate.setTargetAtTime(sound.idleRate * (0.9 + 0.8 * revs), t, 0.12);
      loops.idle.gain.setTargetAtTime(level * (1 - 0.45 * revs), t, 0.1);
    }
    if (loops.load) {
      loops.load.rate.setTargetAtTime(sound.loadRate * (0.7 + 0.7 * revs), t, 0.12);
      loops.load.gain.setTargetAtTime(level * (0.1 + 0.9 * revs) * (0.4 + 0.6 * pace), t, 0.1);
    }

    const action = this.vehicle === 'pilot' ? undefined : ACTION_SOUNDS[this.vehicle];
    const on = playing && this.actionActive && action !== undefined;
    for (const name of ['skid', 'rocket', 'tracks'] as const) {
      const voice = loops[name];
      if (!voice) continue;
      let gain = on && action.sample === name ? action.level : 0;
      if (on && action.sample === name)
        voice.rate.setTargetAtTime(action.rate * (1 + 0.25 * pace), t, 0.05);
      // The Bruiser runs on tracks, which clatter as it moves.
      if (name === 'tracks' && playing && this.vehicle === 'bruiser') {
        gain = 0.3 * pace;
        voice.rate.setTargetAtTime(0.8 + 0.4 * pace, t, 0.1);
      }
      voice.gain.setTargetAtTime(gain, t, gain > 0 ? 0.04 : 0.12);
    }

    // The Hauler's engine, louder as it gets close to the player.
    if (loops.hauler) {
      const near = Math.max(0, 1 - haulerDistance / 90);
      loops.hauler.rate.value = 0.8;
      loops.hauler.gain.setTargetAtTime(playing ? 0.06 + 0.55 * near * near : 0, t, 0.3);
    }
  }

  private play(
    out: AudioNode | null,
    voice: (ctx: AudioContext, out: AudioNode, bank: SampleBank, t: number) => void,
  ): void {
    const ctx = this.engine.context;
    const bank = this.engine.samples;
    if (!ctx || !out || !bank || ctx.state !== 'running') return;
    voice(ctx, out, bank, ctx.currentTime);
  }
}
