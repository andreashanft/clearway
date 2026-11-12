/** What the build script records about one sample file. */
export interface SampleInfo {
  /** Seconds of sound in the file. */
  readonly seconds: number;
  /** For a loop: where the repeating part starts and ends, in seconds from the first sound. */
  readonly loop?: readonly [start: number, end: number];
}

/** A decoded recording, ready to play. */
export interface Sample {
  readonly buffer: AudioBuffer;
  /**
   * Seconds of silence at the start of the buffer. MP3 decoders differ in how much
   * padding they leave, so each buffer is measured after decoding.
   */
  readonly lead: number;
  readonly loop?: readonly [start: number, end: number];
}

/** Level below which the start of a buffer counts as silence. */
const SILENCE = 0.003;
/** Longest padding an MP3 decoder leaves, with some margin, in seconds. */
const MAX_LEAD = 0.06;

/** Seconds before the first sample that rises above silence. */
export function leadIn(data: Float32Array, sampleRate: number): number {
  const limit = Math.min(data.length, Math.floor(sampleRate * MAX_LEAD));
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i] ?? 0) > SILENCE) return i / sampleRate;
  }
  return 0;
}

/**
 * The recordings the game plays: drums, drones, engines and effects. It downloads and
 * decodes them in the background; a sound that is asked for before it has arrived stays
 * silent, so nothing waits on the network.
 */
export class SampleBank {
  private readonly samples = new Map<string, Sample>();
  private readonly waiting: (() => void)[] = [];
  private pending = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    /** Folder the files are in, with a trailing slash. */
    private readonly base: string,
  ) {}

  /** True once every sample asked for so far has arrived or failed. */
  get ready(): boolean {
    return this.pending === 0;
  }

  get(name: string): Sample | undefined {
    return this.samples.get(name);
  }

  /** Runs once every load started so far has finished. */
  whenReady(callback: () => void): void {
    if (this.ready) callback();
    else this.waiting.push(callback);
  }

  /** Downloads and decodes the named samples. A file that fails is skipped. */
  async load(info: Readonly<Record<string, SampleInfo>>, names?: readonly string[]): Promise<void> {
    const wanted = (names ?? Object.keys(info)).filter((name) => !this.samples.has(name));
    this.pending += wanted.length;
    await Promise.all(
      wanted.map(async (name) => {
        try {
          const response = await fetch(`${this.base}${name}.mp3`);
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
          const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
          const lead = leadIn(buffer.getChannelData(0), buffer.sampleRate);
          this.samples.set(name, { buffer, lead, loop: info[name]?.loop });
        } catch (error) {
          console.warn(`Sample ${name} did not load`, error);
        } finally {
          this.pending--;
        }
      }),
    );
    if (this.ready) for (const callback of this.waiting.splice(0)) callback();
  }
}
