import { SampleBank } from './samples';

/** Volumes from the settings, 0–100. */
export interface Volumes {
  readonly music: number;
  readonly sfx: number;
  readonly voice: number;
}

/** Where a sound goes: straight to the mix, and into the shared reverb. */
export interface Bus {
  readonly dry: AudioNode;
  readonly wet: AudioNode;
}

/** The mixing desk: buses for music, effects and voice, a reverb and a limiter. */
export interface Mix {
  readonly music: Bus;
  readonly sfx: Bus;
  readonly voice: AudioNode;
  readonly musicGain: GainNode;
  readonly musicWetGain: GainNode;
  readonly sfxGain: GainNode;
  readonly sfxWetGain: GainNode;
  readonly voiceGain: GainNode;
  readonly musicFilter: BiquadFilterNode;
}

/** Seconds the reverb rings for: a large, hard hall. */
const ROOM_SECONDS = 2.6;

/**
 * A room's impulse response: noise that dies away and gets duller as it does. The two
 * channels differ, which is what makes the reverb wide.
 */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * ROOM_SECONDS);
  const impulse = ctx.createBuffer(2, length, rate);
  const fadeIn = Math.floor(rate * 0.006);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      low += (0.5 - 0.38 * t) * (Math.random() * 2 - 1 - low);
      data[i] = low * Math.pow(1 - t, 2.4) * Math.min(1, i / fadeIn);
    }
  }
  return impulse;
}

/**
 * Builds the mix on any audio context, so the same graph plays live and renders offline.
 * Everything ends in a gentle compressor that glues the mix and a limiter that stops
 * a blast from clipping.
 */
export function createMix(ctx: BaseAudioContext): Mix {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  limiter.connect(ctx.destination);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 12;
  glue.ratio.value = 3;
  glue.attack.value = 0.012;
  glue.release.value = 0.25;
  glue.connect(limiter);

  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.9;
  reverb.connect(reverbReturn).connect(glue);

  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = 'lowpass';
  musicFilter.frequency.value = 18000;
  musicFilter.Q.value = 0.5;
  const musicGain = ctx.createGain();
  musicFilter.connect(musicGain).connect(glue);
  const musicWetGain = ctx.createGain();
  musicWetGain.connect(reverb);
  const sfxGain = ctx.createGain();
  sfxGain.connect(glue);
  const sfxWetGain = ctx.createGain();
  sfxWetGain.connect(reverb);
  const voiceGain = ctx.createGain();
  voiceGain.connect(glue);

  return {
    music: { dry: musicFilter, wet: musicWetGain },
    sfx: { dry: sfxGain, wet: sfxWetGain },
    voice: voiceGain,
    musicGain,
    musicWetGain,
    sfxGain,
    sfxWetGain,
    voiceGain,
    musicFilter,
  };
}

/** How loud the music bus is at full volume, next to effects at 1. */
const MUSIC_LEVEL = 0.4;

/**
 * The Web Audio graph: one context, created on the first tap or key press (browsers,
 * iOS Safari above all, only start audio from a user gesture), with music, effects and
 * voice buses, a shared reverb, a limiter and the bank of recordings. Suspends while the
 * page is hidden.
 */
export class AudioEngine {
  private contextValue: AudioContext | null = null;
  private mix: Mix | null = null;
  private bank: SampleBank | null = null;
  private volumes: Volumes = { music: 70, sfx: 80, voice: 80 };
  private readonly listeners: (() => void)[] = [];
  private readonly readyCallbacks: ((ctx: AudioContext) => void)[] = [];

  constructor() {
    const unlock = (): void => {
      this.unlock();
    };
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
      this.listeners.push(() => {
        window.removeEventListener(type, unlock, { capture: true });
      });
    }
    const onVisibility = (): void => {
      const ctx = this.contextValue;
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.listeners.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  /** The running context, or null before the first user gesture. */
  get context(): AudioContext | null {
    return this.contextValue && this.contextValue.state !== 'closed' ? this.contextValue : null;
  }

  get music(): Bus | null {
    return this.mix?.music ?? null;
  }

  get sfx(): Bus | null {
    return this.mix?.sfx ?? null;
  }

  get voice(): AudioNode | null {
    return this.mix?.voice ?? null;
  }

  /** The recordings, which load in the background once the context exists. */
  get samples(): SampleBank | null {
    return this.bank;
  }

  /** Runs once the context exists, straight away if it already does. */
  onReady(callback: (ctx: AudioContext) => void): void {
    if (this.context) callback(this.context);
    else this.readyCallbacks.push(callback);
  }

  setVolumes(volumes: Volumes): void {
    this.volumes = volumes;
    this.applyVolumes();
  }

  /**
   * Muffles the music, for menus and pause, with a low-pass filter. `open` runs from
   * 0 (muffled) to 1 (full brightness).
   */
  setMusicBrightness(open: number, seconds = 0.4): void {
    const ctx = this.context;
    if (!ctx || !this.mix) return;
    const cutoff = 500 * Math.pow(36, Math.max(0, Math.min(1, open)));
    this.mix.musicFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, seconds / 3);
  }

  dispose(): void {
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    void this.contextValue?.close();
    this.contextValue = null;
  }

  private unlock(): void {
    if (this.contextValue) {
      if (this.contextValue.state === 'suspended' && !document.hidden) {
        void this.contextValue.resume();
      }
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.contextValue = ctx;
    this.mix = createMix(ctx);
    this.bank = new SampleBank(ctx, new URL('audio/', document.baseURI).href);
    this.applyVolumes();
    void ctx.resume();
    for (const callback of this.readyCallbacks.splice(0)) callback(ctx);
  }

  private applyVolumes(): void {
    const ctx = this.context;
    const mix = this.mix;
    if (!ctx || !mix) return;
    // Squared so the sliders feel even to the ear.
    const level = (v: number): number => (Math.max(0, Math.min(100, v)) / 100) ** 2;
    const t = ctx.currentTime;
    const music = level(this.volumes.music) * MUSIC_LEVEL;
    mix.musicGain.gain.setTargetAtTime(music, t, 0.05);
    mix.musicWetGain.gain.setTargetAtTime(music, t, 0.05);
    mix.sfxGain.gain.setTargetAtTime(level(this.volumes.sfx), t, 0.05);
    mix.sfxWetGain.gain.setTargetAtTime(level(this.volumes.sfx), t, 0.05);
    mix.voiceGain.gain.setTargetAtTime(level(this.volumes.voice), t, 0.05);
  }
}
