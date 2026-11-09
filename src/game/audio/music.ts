import type { AudioEngine } from '../../engine/audio';
import { bass, bell, hat, hiss, kick, pluck, snare, stab } from './synth';

/** What the soundtrack is doing: it never stops abruptly except on a failure. */
export type MusicMood = 'menu' | 'play' | 'resolved' | 'silent';

/** Seconds of notes scheduled ahead of the audio clock. */
const LOOKAHEAD = 0.12;
const TICK_MS = 25;
/** How fast the intensity follows its target, per second. */
const INTENSITY_RATE = 0.35;

/**
 * Tension from the countdown to the next impact: calm with 40 seconds or more to go,
 * full tilt with 4 seconds left.
 */
export function tensionFor(countdown: number | null): number {
  if (countdown === null) return 0.3;
  return Math.max(0.12, Math.min(1, 1 - (countdown - 4) / 36));
}

/** Tempo in beats per minute: the music speeds up as the Hauler closes in. */
export function tempoFor(intensity: number): number {
  return 104 + 40 * Math.max(0, Math.min(1, intensity));
}

interface Bar {
  /** Bass root, as a MIDI note. */
  readonly root: number;
  /** Stab voicing, as MIDI notes. */
  readonly chord: readonly number[];
}

/** Em7 – A7 – Em7 – B7: a four-bar funk turnaround in E. */
export const BARS: readonly Bar[] = [
  { root: 40, chord: [64, 67, 71, 74] },
  { root: 45, chord: [61, 64, 67, 69] },
  { root: 40, chord: [64, 67, 71, 74] },
  { root: 47, chord: [63, 66, 69, 71] },
];

/** Sixteen steps per bar; numbers are semitones above the bar's root, null is a rest. */
export const BASS_LINE: readonly (number | null)[] = [
  0,
  null,
  null,
  12,
  null,
  0,
  null,
  10,
  0,
  null,
  7,
  null,
  10,
  null,
  12,
  7,
];

/** The surf-guitar riff, in semitones above the root two octaves up. */
export const LEAD_RIFF: readonly (number | null)[] = [
  12,
  null,
  15,
  12,
  19,
  null,
  17,
  15,
  12,
  null,
  10,
  12,
  7,
  null,
  10,
  null,
];

const KICKS = new Set([0, 6, 8]);

/**
 * A procedural funk/surf soundtrack: drums, bass, stabs and a lead layer that come in as
 * the intensity rises, with the tempo rising too. Notes are scheduled slightly ahead
 * on the audio clock, so timing holds even when frames drop.
 */
export class Music {
  private gain: GainNode | null = null;
  private timer = 0;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private intensity = 0.15;
  private target = 0.15;
  private moodValue: MusicMood = 'menu';
  /** Beeps on the beat while the Hauler is seconds from an impact. */
  alarm = false;

  constructor(private readonly engine: AudioEngine) {
    engine.onReady((ctx) => {
      const out = engine.music;
      if (!out) return;
      this.gain = ctx.createGain();
      this.gain.connect(out);
      this.nextTime = ctx.currentTime + 0.1;
      this.applyMood(0.01);
      this.timer = window.setInterval(() => {
        this.schedule();
      }, TICK_MS);
    });
  }

  get mood(): MusicMood {
    return this.moodValue;
  }

  setMood(mood: MusicMood): void {
    if (mood === this.moodValue) return;
    this.moodValue = mood;
    this.applyMood(mood === 'silent' ? 0.25 : 0.6);
  }

  /** Target intensity, 0–1; the music eases towards it. */
  setIntensity(intensity: number): void {
    this.target = Math.max(0, Math.min(1, intensity));
  }

  /** A short musical cue over the loop. */
  stinger(kind: 'clear' | 'fail' | 'medal'): void {
    const ctx = this.engine.context;
    const out = this.engine.music;
    const noise = this.engine.noise;
    if (!ctx || !out || !noise) return;
    const t = ctx.currentTime + 0.05;
    if (kind === 'clear') {
      [64, 68, 71, 76, 80].forEach((note, i) => {
        bell(ctx, out, t + i * 0.09, note, 1.2, 1.2);
      });
      hiss(ctx, out, noise, t, 6000, 1.6, 0.6);
    } else if (kind === 'medal') {
      [71, 76, 80, 83].forEach((note, i) => {
        bell(ctx, out, t + i * 0.12, note, 1.4, 1);
      });
    } else {
      [64, 63, 62, 58].forEach((note, i) => {
        pluck(ctx, out, t + 0.5 + i * 0.22, note - 12, 0.5, 1.4);
      });
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.gain?.disconnect();
    this.gain = null;
  }

  private applyMood(seconds: number): void {
    const ctx = this.engine.context;
    if (!ctx || !this.gain) return;
    const level = this.moodValue === 'silent' ? 0 : 1;
    this.gain.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3);
    if (this.moodValue === 'menu') this.target = 0.15;
    if (this.moodValue === 'resolved') this.target = 0.3;
  }

  private schedule(): void {
    const ctx = this.engine.context;
    const out = this.gain;
    const noise = this.engine.noise;
    if (!ctx || !out || !noise || ctx.state !== 'running') return;
    // After a stall (a hidden tab), restart from now rather than catching up.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const stepSeconds = 60 / tempoFor(this.intensity) / 4;
      if (this.moodValue !== 'silent') this.playStep(ctx, out, noise, this.nextTime, stepSeconds);
      this.nextTime += stepSeconds;
      this.intensity += Math.max(
        -INTENSITY_RATE * stepSeconds,
        Math.min(INTENSITY_RATE * stepSeconds, this.target - this.intensity),
      );
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar = (this.bar + 1) % BARS.length;
    }
  }

  private playStep(
    ctx: AudioContext,
    out: AudioNode,
    noise: AudioBuffer,
    t: number,
    stepSeconds: number,
  ): void {
    const i = this.intensity;
    const s = this.step;
    const bar = BARS[this.bar] ?? BARS[0];
    if (!bar) return;

    if (KICKS.has(s) || (i > 0.5 && s === 14) || (i > 0.8 && s === 3)) kick(ctx, out, t);
    if (s === 4 || s === 12) snare(ctx, out, noise, t);
    else if (i > 0.45 && (s === 7 || s === 15)) snare(ctx, out, noise, t, 0.25);
    if (s % 2 === 0) hat(ctx, out, noise, t, i > 0.3 && s === 14, 0.7);
    else if (i > 0.55) hat(ctx, out, noise, t, false, 0.4);

    const b = BASS_LINE[s];
    if (b !== null && b !== undefined) bass(ctx, out, t, bar.root + b, stepSeconds * 1.6, i);

    if (i > 0.35 && (s === 3 || s === 10)) stab(ctx, out, t, bar.chord, Math.min(1, i * 1.3));

    if (i > 0.62) {
      const riff = LEAD_RIFF[s];
      const tremolo = i > 0.85;
      if (riff !== null && riff !== undefined) {
        pluck(ctx, out, t, bar.root + 24 + riff, stepSeconds * (tremolo ? 0.5 : 1.8));
        if (tremolo) pluck(ctx, out, t + stepSeconds / 2, bar.root + 24 + riff, stepSeconds * 0.5);
      }
    }

    const sfx = this.engine.sfx;
    if (this.alarm && sfx && s % 4 === 0) bell(ctx, sfx, t, s % 8 === 0 ? 88 : 83, 0.12, 0.8);
  }
}
