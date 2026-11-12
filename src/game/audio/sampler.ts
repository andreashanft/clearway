import type { Bus } from '../../engine/audio';
import type { Sample, SampleBank } from '../../engine/samples';

/**
 * Plays recordings: single hits with a level, pitch and envelope, and loops whose level
 * and pitch a caller keeps steering. Every voice cleans up after itself.
 */

export interface StripOptions {
  readonly level?: number;
  /** Stereo position, −1 left to 1 right. */
  readonly pan?: number;
  /** How much of the sound goes into the reverb, 0–1. */
  readonly wet?: number;
}

/**
 * A channel strip: the level, stereo position and reverb send for a group of voices.
 * Voices connect to the node it returns.
 */
export function strip(ctx: BaseAudioContext, bus: Bus, options: StripOptions = {}): GainNode {
  const { level = 1, pan = 0, wet = 0 } = options;
  const input = ctx.createGain();
  input.gain.value = level;
  let node: AudioNode = input;
  if (pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    input.connect(panner);
    node = panner;
  }
  node.connect(bus.dry);
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send).connect(bus.wet);
  }
  return input;
}

/** A soft-clipping curve for a wave shaper: adds grit and keeps peaks down. */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1025);
  const scale = Math.tanh(amount);
  for (let i = 0; i < curve.length; i++) {
    curve[i] = Math.tanh(amount * ((i / (curve.length - 1)) * 2 - 1)) / scale;
  }
  return curve;
}

/** The playback rate that shifts a recording by a number of semitones. */
export function semitones(count: number): number {
  return Math.pow(2, count / 12);
}

/** A small random change in pitch or level, so repeats don't sound stamped out. */
export function vary(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}

export interface HitOptions {
  readonly level?: number;
  /** Playback rate: 2 is an octave up and half as long. */
  readonly rate?: number;
  /** Seconds into the recording to start from. */
  readonly offset?: number;
  /** Seconds to fade in over; 0 keeps the recording's own attack. */
  readonly attack?: number;
  /** Seconds after which the sound is faded out; without it the recording plays through. */
  readonly length?: number;
  /** Seconds the fade-out takes. */
  readonly release?: number;
  /** Cuts everything above this frequency (Hz). */
  readonly lowpass?: number;
  /** Cuts everything below this frequency (Hz). */
  readonly highpass?: number;
}

/** Plays a recording once at time `t`. */
export function hit(
  ctx: BaseAudioContext,
  out: AudioNode,
  sample: Sample | undefined,
  t: number,
  options: HitOptions = {},
): void {
  if (!sample) return;
  const { level = 1, rate = 1, offset = 0, attack = 0, length, release = 0.08 } = options;
  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  if (attack > 0) {
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + attack);
  } else {
    gain.gain.setValueAtTime(level, t);
  }
  let node: AudioNode = source;
  if (options.lowpass !== undefined) node = node.connect(biquad(ctx, 'lowpass', options.lowpass));
  if (options.highpass !== undefined) {
    node = node.connect(biquad(ctx, 'highpass', options.highpass));
  }
  node.connect(gain).connect(out);
  source.start(t, sample.lead + offset);
  if (length !== undefined) {
    const end = t + Math.max(attack, length);
    gain.gain.setTargetAtTime(0, end, release / 3);
    source.stop(end + release * 2);
  }
}

function biquad(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = 0.7;
  return node;
}

/** A loop that is running: steer it through `gain` and `rate`. */
export interface LoopVoice {
  readonly gain: AudioParam;
  readonly rate: AudioParam;
  stop(): void;
  /** Stops the loop at a time on the audio clock. */
  stopAt(when: number): void;
}

/**
 * Starts a recording that repeats until stopped, silent at first. The build script makes
 * the repeating part seamless, so the loop points only need to land near it.
 */
export function loop(
  ctx: BaseAudioContext,
  out: AudioNode,
  sample: Sample | undefined,
  t = 0,
): LoopVoice | null {
  if (!sample) return null;
  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  source.loop = true;
  const [start, end] = sample.loop ?? [0, sample.buffer.duration - sample.lead];
  source.loopStart = sample.lead + start;
  source.loopEnd = sample.lead + end;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain).connect(out);
  // Start somewhere random in the loop, so two loops of one recording don't line up.
  source.start(t, sample.lead + start + Math.random() * (end - start));
  source.onended = () => {
    gain.disconnect();
  };
  return {
    gain: gain.gain,
    rate: source.playbackRate,
    stop: () => {
      source.stop();
    },
    stopAt: (when) => {
      source.stop(when);
    },
  };
}

export interface SustainOptions {
  readonly level?: number;
  readonly rate?: number;
  /** Seconds the sound takes to swell in. */
  readonly attack?: number;
  /** Seconds from the start until the sound begins to fade. */
  readonly length: number;
  /** Seconds the fade-out takes. */
  readonly release?: number;
}

/** Holds a looped recording for a while: a drone that swells in, stays and fades. */
export function sustain(
  ctx: BaseAudioContext,
  out: AudioNode,
  sample: Sample | undefined,
  t: number,
  options: SustainOptions,
): void {
  const voice = loop(ctx, out, sample, t);
  if (!voice) return;
  const { level = 1, rate = 1, attack = 1, length, release = 2 } = options;
  voice.rate.value = rate;
  voice.gain.setValueAtTime(0, t);
  voice.gain.linearRampToValueAtTime(level, t + attack);
  const end = t + Math.max(attack, length);
  voice.gain.setValueAtTime(level, end);
  voice.gain.linearRampToValueAtTime(0, end + release);
  voice.stopAt(end + release + 0.1);
}

/** Picks from a list without repeating the last pick, so a run of hits varies. */
export class RoundRobin {
  private last = -1;

  constructor(private readonly names: readonly string[]) {}

  next(bank: SampleBank): Sample | undefined {
    if (this.names.length === 0) return undefined;
    let index = Math.floor(Math.random() * this.names.length);
    if (index === this.last) index = (index + 1) % this.names.length;
    this.last = index;
    return bank.get(this.names[index] ?? '');
  }
}
