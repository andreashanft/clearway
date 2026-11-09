/** Volumes from the settings, 0–100. */
export interface Volumes {
  readonly music: number;
  readonly sfx: number;
  readonly voice: number;
}

/**
 * The Web Audio graph: one context, created on the first tap or key press (browsers,
 * iOS Safari above all, only start audio from a user gesture), with music, effects and
 * voice buses into a gentle compressor. Suspends while the page is hidden.
 */
export class AudioEngine {
  private contextValue: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
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

  get music(): AudioNode | null {
    return this.musicFilter;
  }

  get sfx(): AudioNode | null {
    return this.sfxBus;
  }

  get voice(): AudioNode | null {
    return this.voiceBus;
  }

  /** One second of white noise, shared by every noisy sound. */
  get noise(): AudioBuffer | null {
    return this.noiseBuffer;
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
    if (!ctx || !this.musicFilter) return;
    const cutoff = 500 * Math.pow(36, Math.max(0, Math.min(1, open)));
    this.musicFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, seconds / 3);
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
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.Q.value = 0.5;
    this.musicBus = ctx.createGain();
    this.musicFilter.connect(this.musicBus).connect(compressor);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(compressor);
    this.voiceBus = ctx.createGain();
    this.voiceBus.connect(compressor);

    const length = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.applyVolumes();
    void ctx.resume();
    for (const callback of this.readyCallbacks.splice(0)) callback(ctx);
  }

  private applyVolumes(): void {
    const ctx = this.context;
    if (!ctx) return;
    // Squared so the sliders feel even to the ear.
    const level = (v: number): number => (Math.max(0, Math.min(100, v)) / 100) ** 2;
    this.musicBus?.gain.setTargetAtTime(level(this.volumes.music) * 0.55, ctx.currentTime, 0.05);
    this.sfxBus?.gain.setTargetAtTime(level(this.volumes.sfx), ctx.currentTime, 0.05);
    this.voiceBus?.gain.setTargetAtTime(level(this.volumes.voice), ctx.currentTime, 0.05);
  }
}
