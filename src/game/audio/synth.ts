/**
 * Small synthesised sounds for the soundtrack and effects. Every function schedules a
 * short-lived voice at time `t` on `out` and cleans up after itself; there are no
 * sample files, so nothing needs downloading or licensing.
 */

/** Frequency of a MIDI note number. */
export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** An attack-decay envelope on a fresh gain node. */
function envelope(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  gain.connect(out);
  return gain;
}

function noiseSource(ctx: BaseAudioContext, noise: AudioBuffer, t: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  // Start somewhere random in the buffer so repeated hits don't sound identical.
  src.start(t, Math.random() * 0.9);
  return src;
}

export function kick(ctx: BaseAudioContext, out: AudioNode, t: number, level = 1): void {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  osc.connect(envelope(ctx, out, t, 0.9 * level, 0.002, 0.28));
  osc.start(t);
  osc.stop(t + 0.32);
}

export function snare(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  level = 1,
): void {
  const src = noiseSource(ctx, noise, t);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1900;
  band.Q.value = 0.8;
  src.connect(band).connect(envelope(ctx, out, t, 0.55 * level, 0.002, 0.16));
  src.stop(t + 0.2);
  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(190, t);
  body.frequency.exponentialRampToValueAtTime(140, t + 0.08);
  body.connect(envelope(ctx, out, t, 0.35 * level, 0.002, 0.09));
  body.start(t);
  body.stop(t + 0.12);
}

export function hat(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  open = false,
  level = 1,
): void {
  const src = noiseSource(ctx, noise, t);
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 7200;
  const decay = open ? 0.22 : 0.035;
  src.connect(high).connect(envelope(ctx, out, t, 0.22 * level, 0.001, decay));
  src.stop(t + decay + 0.02);
}

/** A plucky synth bass, its filter opening with `bright` (0–1). */
export function bass(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  note: number,
  length: number,
  bright: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = midiToHz(note);
  const sub = ctx.createOscillator();
  sub.type = 'square';
  sub.frequency.value = midiToHz(note - 12);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  const top = 500 + 1500 * bright;
  filter.frequency.setValueAtTime(top, t);
  filter.frequency.exponentialRampToValueAtTime(180, t + length);
  const gain = envelope(ctx, out, t, 0.32, 0.005, length);
  osc.connect(filter);
  const subGain = ctx.createGain();
  subGain.gain.value = 0.35;
  sub.connect(subGain).connect(filter);
  filter.connect(gain);
  for (const o of [osc, sub]) {
    o.start(t);
    o.stop(t + length + 0.05);
  }
}

/** A twangy, detuned surf-guitar pluck. */
export function pluck(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  note: number,
  length: number,
  level = 1,
): void {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3800, t);
  filter.frequency.exponentialRampToValueAtTime(900, t + length);
  filter.Q.value = 3;
  filter.connect(envelope(ctx, out, t, 0.16 * level, 0.003, length));
  for (const detune of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToHz(note);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }
}

/** A short organ-like chord stab. */
export function stab(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  notes: readonly number[],
  level = 1,
): void {
  const gain = envelope(ctx, out, t, 0.07 * level, 0.004, 0.14);
  for (const note of notes) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = midiToHz(note);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

/** A clean bell tone, for chimes and fanfares. */
export function bell(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  note: number,
  length = 0.5,
  level = 1,
): void {
  const gain = envelope(ctx, out, t, 0.25 * level, 0.004, length);
  for (const [ratio, amount] of [
    [1, 1],
    [2.01, 0.35],
    [3.02, 0.12],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(note) * ratio;
    const partial = ctx.createGain();
    partial.gain.value = amount;
    osc.connect(partial).connect(gain);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }
}

/** A low thump with a noisy crack on top, for hits; `strength` runs 0–1. */
export function thump(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  strength: number,
): void {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.2);
  osc.connect(envelope(ctx, out, t, 0.5 + 0.5 * strength, 0.003, 0.3));
  osc.start(t);
  osc.stop(t + 0.35);
  const src = noiseSource(ctx, noise, t);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200 + 3500 * strength, t);
  filter.frequency.exponentialRampToValueAtTime(300, t + 0.25);
  src.connect(filter).connect(envelope(ctx, out, t, 0.25 + 0.45 * strength, 0.002, 0.25));
  src.stop(t + 0.3);
}

/** Masonry crumbling: a falling rumble with a scatter of clacks. */
export function crumble(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  size: number,
): void {
  const src = noiseSource(ctx, noise, t);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, t);
  filter.frequency.exponentialRampToValueAtTime(160, t + 1.4);
  src.connect(filter).connect(envelope(ctx, out, t, 0.5 * size, 0.03, 1.3));
  src.stop(t + 1.5);
  for (let i = 0; i < 6; i++) {
    const at = t + 0.05 + Math.random() * 0.7;
    const clack = noiseSource(ctx, noise, at);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 600 + Math.random() * 1800;
    band.Q.value = 4;
    clack.connect(band).connect(envelope(ctx, out, at, 0.35 * size, 0.002, 0.06));
    clack.stop(at + 0.1);
  }
}

/** A big blast: a noise roar sweeping down over a sub-bass drop. */
export function blast(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  size: number,
): void {
  const src = noiseSource(ctx, noise, t);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, t);
  filter.frequency.exponentialRampToValueAtTime(120, t + 1.6 * size);
  src.connect(filter).connect(envelope(ctx, out, t, 0.9, 0.005, 1.7 * size));
  src.stop(t + 1.8 * size + 0.1);
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(70, t);
  sub.frequency.exponentialRampToValueAtTime(24, t + 0.9);
  sub.connect(envelope(ctx, out, t, 1, 0.005, 1.1));
  sub.start(t);
  sub.stop(t + 1.2);
}

/** A short burst of filtered noise, for a lit fuse, a boost or a whoosh. */
export function hiss(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  frequency: number,
  length: number,
  level = 1,
): void {
  const src = noiseSource(ctx, noise, t);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = frequency;
  band.Q.value = 1.2;
  src.connect(band).connect(envelope(ctx, out, t, 0.3 * level, 0.02, length));
  src.stop(t + length + 0.05);
}

/** A radio squelch, played before a crew hint. */
export function squelch(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
): void {
  hiss(ctx, out, noise, t, 2400, 0.09, 0.8);
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1400, t + 0.08);
  osc.frequency.setValueAtTime(1050, t + 0.13);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1500;
  osc.connect(band).connect(envelope(ctx, out, t + 0.08, 0.08, 0.004, 0.12));
  osc.start(t + 0.08);
  osc.stop(t + 0.22);
}

/** A soft click for menu buttons. */
export function click(ctx: BaseAudioContext, out: AudioNode, t: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.03);
  osc.connect(envelope(ctx, out, t, 0.12, 0.001, 0.04));
  osc.start(t);
  osc.stop(t + 0.06);
}
