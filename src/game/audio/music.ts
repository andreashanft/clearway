import type { AudioEngine, Bus } from '../../engine/audio';
import type { SampleBank } from '../../engine/samples';
import type { SampleName } from './sample-data';
import { driveCurve, hit, semitones, strip, sustain, vary } from './sampler';

/** What the soundtrack is doing: it never stops abruptly except on a failure. */
export type MusicMood = 'menu' | 'play' | 'resolved' | 'silent';

/** Seconds of notes scheduled ahead of the audio clock. */
const LOOKAHEAD = 0.12;
const TICK_MS = 25;
/** How fast the intensity follows its target, per second. */
const INTENSITY_RATE = 0.35;
/** Bars in a phrase. Each phrase gets a new root and new patterns. */
export const PHRASE_BARS = 4;
const STEPS = 16;

/**
 * Tension from the countdown to the next impact: calm with 40 seconds or more to go,
 * full tilt with 4 seconds left.
 */
export function tensionFor(countdown: number | null): number {
  if (countdown === null) return 0.3;
  return Math.max(0.12, Math.min(1, 1 - (countdown - 4) / 36));
}

/**
 * Tempo in beats per minute: slow and heavy, pushing a little as the Hauler closes in.
 * The layers carry most of the tension, so the range is small enough not to lurch.
 */
export function tempoFor(intensity: number): number {
  return 92 + 16 * Math.max(0, Math.min(1, intensity));
}

/** How hard the percussion works. Each level has its own family of patterns. */
export type Level = 'calm' | 'pulse' | 'drive' | 'frenzy';

/** Intensity at which the ticking machinery and the bass join the pulse. */
const MACHINE = 0.42;
const BASS_IN = 0.5;

export function levelFor(intensity: number): Level {
  if (intensity < 0.28) return 'calm';
  if (intensity < 0.62) return 'pulse';
  if (intensity < 0.86) return 'drive';
  return 'frenzy';
}

/** Kick drum patterns, sixteen steps to the bar. A calm bar has no pattern: one boom opens the phrase. */
export const KICKS: Readonly<Record<Level, readonly string[]>> = {
  calm: ['................'],
  pulse: ['x.........x.....', 'x......x..x.....', 'x..x......x.....', 'x.........x..x..'],
  drive: ['x...x...x...x...', 'x...x..xx...x...', 'x..x..x.x...x.x.', 'x...x...x..xx...'],
  frenzy: ['x.x.x...x.x.x.xx', 'x..xx.x.x..xx.x.', 'x.x.x.x.x.x.xxxx'],
};

/** The slam that answers the kick: `X` is the full hit, `x` a clank. */
export const SLAMS: Readonly<Record<Level, readonly string[]>> = {
  calm: ['................'],
  pulse: ['........X.......', '........X.....x.', '........X..x....'],
  drive: ['....X.......X...', '....X.......X.x.', '....X..x....X...'],
  frenzy: ['....X.......X...', '....X.x.....X.xx', '....X..x....X.x.'],
};

/** Bass stabs on the root. */
export const BASS: Readonly<Record<Level, readonly string[]>> = {
  calm: ['................'],
  pulse: ['x...............', 'x.........x.....', 'x.....x.........'],
  drive: ['x..x..x...x..x..', 'x..x..x.x..x..x.', 'x.x...x.x.x...x.'],
  frenzy: ['x.xx.xx.x.xx.xx.', 'xx.xx.xxx.xx.xx.', 'x.xx.xx.xx.xx.xx'],
};

/**
 * Roots a phrase can move to, in semitones from the home note G. They are the dark
 * neighbours of G minor: E flat, F, A flat, D and B flat.
 */
export const ROOTS = [-4, -2, 1, -5, 3] as const;

/** Recordings the ticking machinery picks from, one per phrase. */
export const TICK_VOICES: readonly SampleName[] = [
  'glitch-4',
  'glitch-5',
  'hat-metal',
  'ind-a',
  'glitch-2',
  'hat-noise',
];
/** Toms a fill picks from, highest first. */
const TOMS: readonly SampleName[] = ['tom-high', 'tom-mid', 'tom-low', 'fuzz-tom'];
/** Sounds from far off that break the quiet. */
const FAR_SOUNDS = [
  'door',
  'clank',
  'bell-low',
  'pipe',
  'anvil',
  'hum',
] as const satisfies readonly SampleName[];

/**
 * Spreads `hits` as evenly as possible over `steps` and turns the result by `rotation`:
 * a Euclidean rhythm. Changing the count or the turn gives a new pattern that still
 * sounds deliberate, which keeps the machinery from repeating.
 */
export function euclid(hits: number, steps: number, rotation = 0): boolean[] {
  const count = Math.max(0, Math.min(steps, Math.round(hits)));
  const pattern: boolean[] = [];
  for (let i = 0; i < steps; i++) {
    const j = (((i + rotation) % steps) + steps) % steps;
    pattern.push((j * count) % steps < count);
  }
  return pattern;
}

export interface FarEvent {
  readonly bar: number;
  readonly step: number;
  readonly sound: (typeof FAR_SOUNDS)[number];
  /** −1 for the left, 1 for the right. */
  readonly side: -1 | 1;
  /** Pitch change in semitones. */
  readonly pitch: number;
}

/** What one phrase plays, decided when it starts. */
export interface Phrase {
  /** Root in semitones from G. */
  readonly root: number;
  /** Which pattern of each family the phrase uses. */
  readonly variant: number;
  /** How far the pattern of every second bar is from the first. */
  readonly alt: number;
  /** How far the ticking pattern is turned. */
  readonly rotation: number;
  /** Index into `TICK_VOICES`. */
  readonly tick: number;
  /** Toms for the last eight steps of the phrase, as indices into the toms, or null for a rest. */
  readonly fill: readonly (number | null)[];
  /** Whether the two-note warning figure sounds in this phrase. */
  readonly motif: boolean;
  readonly far: readonly FarEvent[];
}

/**
 * Plans a phrase. Every second phrase sits on the home note, so the music keeps a
 * centre; the ones between move to a random neighbour that differs from the last one.
 */
export function planPhrase(random: () => number, index: number, previous?: Phrase): Phrase {
  const pick = (count: number): number => Math.min(count - 1, Math.floor(random() * count));
  let root = 0;
  if (index % 2 === 1) {
    const choices = ROOTS.filter((candidate) => candidate !== previous?.root);
    root = choices[pick(choices.length)] ?? ROOTS[0];
  }
  let tick = pick(TICK_VOICES.length);
  if (tick === previous?.tick) tick = (tick + 1) % TICK_VOICES.length;
  const fill: (number | null)[] = [];
  let tom = pick(2);
  for (let i = 0; i < 8; i++) {
    // The fill thickens towards the bar line and works its way down the toms.
    const play = random() < 0.35 + 0.07 * i;
    fill.push(play ? tom : null);
    if (play && random() < 0.5) tom = Math.min(TOMS.length - 1, tom + 1);
  }
  fill[7] = TOMS.length - 2;
  const far: FarEvent[] = [];
  const events = 1 + pick(3);
  for (let i = 0; i < events; i++) {
    far.push({
      bar: pick(PHRASE_BARS),
      step: 2 + pick(STEPS - 2),
      sound: FAR_SOUNDS[pick(FAR_SOUNDS.length)] ?? 'door',
      side: random() < 0.5 ? -1 : 1,
      pitch: -pick(8),
    });
  }
  return {
    root,
    variant: pick(12),
    alt: 1 + pick(2),
    rotation: pick(STEPS),
    tick,
    fill,
    motif: random() < 0.4,
    far,
  };
}

/** The pattern a bar plays: the phrase picks one, and every second bar varies it. */
export function patternFor(family: readonly string[], phrase: Phrase, bar: number): string {
  const index = phrase.variant + (bar % 2 === 1 ? phrase.alt : 0);
  return family[index % family.length] ?? '';
}

/** Steps until the next hit in a pattern, at most `most`. */
function gapAfter(pattern: string, step: number, most: number): number {
  for (let gap = 1; gap < most; gap++) {
    if (step + gap >= pattern.length || pattern[step + gap] !== '.') return gap;
  }
  return most;
}

/**
 * Semitones from the bass recordings' C to the phrase's root. Low roots go up a fifth
 * and high roots down a fourth, which keeps the bass between 49 and 87 Hz.
 */
export function bassShift(root: number): number {
  return root <= -2 ? root + 7 : root - 5;
}

/**
 * The machine room: drones, heavy drums, clanking metal and a bass, all recordings, each
 * group on its own channel strip. It plays one sixteenth at a time and adds layers as the
 * intensity rises. It only needs an audio context, a bus and the samples, so it plays
 * live and renders offline alike.
 */
export class Score {
  /** The step that `advance` played last, 0–15. */
  played = 0;
  private bar = 0;
  private step = 0;
  private phraseIndex = 0;
  private phrase: Phrase;
  /** Intensity for the layers, sampled once a bar so they come and go on the bar line. */
  private layer = 0.15;
  private readonly drums: AudioNode;
  private readonly slams: AudioNode;
  private readonly ticksLeft: AudioNode;
  private readonly ticksRight: AudioNode;
  private readonly bassOut: AudioNode;
  private readonly drones: AudioNode;
  private readonly farLeft: AudioNode;
  private readonly farRight: AudioNode;
  private readonly bells: AudioNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    bus: Bus,
    private readonly bank: SampleBank,
    private readonly random: () => number = Math.random,
  ) {
    this.phrase = planPhrase(random, 0);
    // Overdrive gives the drums and the bass harmonics that small speakers can play.
    const crush = ctx.createWaveShaper();
    crush.curve = driveCurve(2);
    crush.connect(strip(ctx, bus, { level: 0.5, wet: 0.1 }));
    this.drums = crush;
    this.slams = strip(ctx, bus, { level: 1.1, wet: 0.4 });
    this.ticksLeft = strip(ctx, bus, { level: 1, pan: -0.35, wet: 0.12 });
    this.ticksRight = strip(ctx, bus, { level: 1, pan: 0.35, wet: 0.12 });
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve(2.5);
    drive.connect(strip(ctx, bus, { level: 0.5, wet: 0.05 }));
    this.bassOut = drive;
    this.drones = strip(ctx, bus, { level: 1.25, wet: 0.35 });
    this.farLeft = strip(ctx, bus, { level: 0.8, pan: -0.7, wet: 0.9 });
    this.farRight = strip(ctx, bus, { level: 0.8, pan: 0.7, wet: 0.9 });
    this.bells = strip(ctx, bus, { level: 0.7, wet: 0.6 });
  }

  /** Plays the step due at `t` and moves on. Returns the seconds until the next step. */
  advance(t: number, intensity: number): number {
    const stepSeconds = 60 / tempoFor(intensity) / 4;
    if (this.step === 0) this.layer = intensity;
    this.playStep(t, stepSeconds);
    this.played = this.step;
    this.step = (this.step + 1) % STEPS;
    if (this.step === 0) {
      this.bar = (this.bar + 1) % PHRASE_BARS;
      if (this.bar === 0) {
        this.phraseIndex++;
        this.phrase = planPhrase(this.random, this.phraseIndex, this.phrase);
      }
    }
    return stepSeconds;
  }

  private sample(name: SampleName): ReturnType<SampleBank['get']> {
    return this.bank.get(name);
  }

  private playStep(t: number, stepSeconds: number): void {
    const { ctx, phrase, bar } = this;
    const i = this.layer;
    const s = this.step;
    const level = levelFor(i);
    const lastBar = bar === PHRASE_BARS - 1;
    const feel = vary(0.1);

    if (s === 0 && bar === 0) this.startDrones(t, stepSeconds * STEPS * PHRASE_BARS, i);

    // Kick. While it is calm, one boom opens the phrase and a softer one answers halfway.
    if (level === 'calm') {
      if (s === 0 && bar % 2 === 0) {
        hit(ctx, this.drums, this.sample('boom'), t, { level: bar === 0 ? 0.6 : 0.35 });
      }
    } else if (patternFor(KICKS[level], phrase, bar)[s] === 'x') {
      hit(ctx, this.drums, this.sample('kick'), t, { level: 0.75 * feel });
      if (level !== 'pulse') hit(ctx, this.drums, this.sample('kick-hard'), t, { level: 0.3 });
      if (s === 0) hit(ctx, this.drums, this.sample('boom'), t, { level: 0.25 });
      // A fuzzed tom gives the kick a knock above the sub-bass.
      hit(ctx, this.drums, this.sample('fuzz-tom'), t, { level: 0.35, rate: 0.8 });
    }

    // A fill of toms closes the phrase; otherwise the slam answers the kick.
    const fillFrom = level === 'pulse' ? 12 : 8;
    const filling = lastBar && level !== 'calm' && s >= fillFrom;
    if (filling) {
      const tom = phrase.fill[s - 8];
      if (tom !== null && tom !== undefined) {
        hit(ctx, this.drums, this.sample(TOMS[tom] ?? 'tom-low'), t, {
          level: 0.75 * feel,
          rate: vary(0.02),
        });
      }
    } else {
      const slam = patternFor(SLAMS[level], phrase, bar)[s];
      if (slam === 'X') {
        hit(ctx, this.slams, this.sample('slam'), t, { level: 0.9 });
        hit(ctx, this.slams, this.sample('snare'), t, { level: 0.45, rate: 0.8 });
        hit(ctx, this.slams, this.sample('snare-noise'), t, { level: 0.3, length: 0.22 });
        if (level !== 'pulse') {
          hit(ctx, this.slams, this.sample('anvil'), t, { level: 0.35, rate: vary(0.03) });
        }
      } else if (slam === 'x') {
        hit(ctx, this.slams, this.sample(bar % 2 === 0 ? 'clank' : 'ind-b'), t, {
          level: 0.4 * feel,
          rate: vary(0.04),
        });
      }
    }

    // War drums and a crash once the Hauler is nearly on top of something.
    if (level === 'frenzy') {
      if (s % 4 === 2 && !filling) {
        hit(ctx, this.drums, this.sample('tom-low'), t, { level: 0.5 * feel, rate: 0.9 });
      }
      if (s === 0) hit(ctx, this.slams, this.sample('crash'), t, { level: 0.5 });
    } else if (level === 'drive' && s === 0 && bar === 0) {
      hit(ctx, this.slams, this.sample('crash'), t, { level: 0.4 });
    }

    // The machinery: a ticking pattern that thickens with the tension.
    if (i >= MACHINE) {
      const ticks = euclid(3 + i * 8, STEPS, phrase.rotation);
      if (ticks[s]) {
        hit(ctx, this.ticksRight, this.sample(TICK_VOICES[phrase.tick] ?? 'glitch-4'), t, {
          level: (s % 4 === 0 ? 1 : 0.6) * feel,
          length: stepSeconds * 0.8,
          release: 0.03,
        });
      }
      if (level !== 'pulse') {
        const every = level === 'frenzy' ? 1 : 2;
        if (s % every === 0) {
          hit(ctx, this.ticksLeft, this.sample('hat'), t, {
            level: (s % 4 === 0 ? 0.8 : 0.45) * feel,
          });
        }
        const metal = euclid(level === 'frenzy' ? 5 : 3, STEPS, phrase.rotation + 2);
        if (metal[s]) {
          hit(ctx, this.ticksLeft, this.sample('pipe'), t, { level: 0.5 * feel, length: 0.25 });
        }
      }
    }

    // Bass.
    if (i >= BASS_IN) {
      const line = patternFor(BASS[level], phrase, bar);
      const shift = bassShift(phrase.root);
      if (line[s] === 'x') {
        const long = level === 'pulse';
        const steps = gapAfter(line, s, long ? 8 : 3);
        hit(ctx, this.bassOut, this.sample(long ? 'bass-sub' : 'bass-hard'), t, {
          level: 0.6 * feel,
          rate: semitones(shift),
          length: steps * stepSeconds * 0.9,
          release: 0.06,
        });
      }
      if (s === 0 && level !== 'pulse') {
        hit(ctx, this.bassOut, this.sample('bass-thick'), t, {
          level: 0.2,
          rate: semitones(shift),
          attack: 0.02,
          length: stepSeconds * 15,
          release: 0.1,
        });
      }
    }

    // A swell that leads into the next phrase.
    if (lastBar && s === 8 && level !== 'calm') {
      hit(ctx, this.drones, this.sample('woosh'), t, { level: 0.5 });
    }

    // The warning figure: two notes a semitone apart on a low bell.
    if (phrase.motif && bar === 1 && i >= 0.35 && (s === 0 || s === 6)) {
      hit(ctx, this.bells, this.sample('bell-low'), t, {
        level: 0.8,
        rate: semitones(phrase.root - 12 + (s === 0 ? 0 : 1)),
      });
    }

    // Sounds from far off, while there is room for them.
    if (level === 'calm' || level === 'pulse') {
      for (const event of phrase.far) {
        if (event.bar !== bar || event.step !== s) continue;
        hit(ctx, event.side < 0 ? this.farLeft : this.farRight, this.sample(event.sound), t, {
          level: 0.5 * feel,
          rate: semitones(event.pitch),
        });
      }
    }
  }

  /** Starts the drones for a phrase. They swell in as the last phrase's drones fade. */
  private startDrones(t: number, seconds: number, intensity: number): void {
    const { ctx, phrase } = this;
    const tense = levelFor(intensity) === 'drive' || levelFor(intensity) === 'frenzy';
    const shape = { attack: 3, length: seconds, release: 4 };
    const rate = semitones(phrase.root);
    // The drones stay above the sub-bass, which belongs to the drums and the bass.
    sustain(ctx, this.drones, this.sample('pad-low'), t, { ...shape, level: 0.35, rate });
    sustain(ctx, this.drones, this.sample('drone'), t, { ...shape, level: 0.25, rate });
    sustain(ctx, this.drones, this.sample(tense ? 'pad-tense' : 'pad-mid'), t, {
      ...shape,
      level: 0.6,
      rate,
    });
    // The same chord an octave up, thin and cold.
    sustain(ctx, this.drones, this.sample('pad-mid'), t, {
      ...shape,
      level: tense ? 0.3 : 0.2,
      rate: rate * 2,
    });
    // Machinery hums along once the pulse has started.
    if (levelFor(intensity) !== 'calm') {
      sustain(ctx, this.drones, this.sample('machine'), t, {
        ...shape,
        level: intensity >= MACHINE ? 0.3 : 0.2,
      });
    }
  }
}

/**
 * The soundtrack: dark and industrial, built from recordings of drums, metal and drones.
 * It has more tension than tune, and its patterns change with every phrase. Notes are
 * scheduled slightly ahead on the audio clock, so timing holds even when frames drop.
 */
export class Music {
  private score: Score | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private cues: AudioNode | null = null;
  private warning: AudioNode | null = null;
  private timer = 0;
  private nextTime = 0;
  private intensity = 0.15;
  private target = 0.15;
  private moodValue: MusicMood = 'menu';
  /** Sounds a factory buzzer on the beat while the Hauler is seconds from an impact. */
  alarm = false;

  constructor(private readonly engine: AudioEngine) {
    engine.onReady((ctx) => {
      const bus = engine.music;
      const sfx = engine.sfx;
      const bank = engine.samples;
      if (!bus || !sfx || !bank) return;
      // The mood fades the score in and out; cues play over it at full level.
      this.dry = ctx.createGain();
      this.dry.connect(bus.dry);
      this.wet = ctx.createGain();
      this.wet.connect(bus.wet);
      this.cues = strip(ctx, bus, { wet: 0.45 });
      this.warning = strip(ctx, sfx, { level: 0.8, wet: 0.2 });
      this.applyMood(0.01);
      const dry = this.dry;
      const wet = this.wet;
      // The score starts once its recordings have arrived, so its first drone is whole.
      bank.whenReady(() => {
        this.score = new Score(ctx, { dry, wet }, bank);
        this.nextTime = ctx.currentTime + 0.1;
        this.timer = window.setInterval(() => {
          this.schedule();
        }, TICK_MS);
      });
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

  /** A short cue over the music. */
  stinger(kind: 'clear' | 'fail' | 'medal'): void {
    const ctx = this.engine.context;
    const out = this.cues;
    const bank = this.engine.samples;
    if (!ctx || !out || !bank) return;
    const t = ctx.currentTime + 0.05;
    if (kind === 'clear') {
      // One great blow, then a bell that rises through the home chord.
      hit(ctx, out, bank.get('boom'), t, { level: 1 });
      hit(ctx, out, bank.get('slam'), t, { level: 0.9 });
      hit(ctx, out, bank.get('crash'), t, { level: 0.45 });
      [-12, -5, 0].forEach((note, index) => {
        hit(ctx, out, bank.get('bell-low'), t + 0.12 + index * 0.16, {
          level: 0.6,
          rate: semitones(note),
        });
      });
      sustain(ctx, out, bank.get('pad-mid'), t, {
        level: 0.35,
        attack: 0.3,
        length: 2.2,
        release: 2.5,
      });
    } else if (kind === 'medal') {
      [-5, 0].forEach((note, index) => {
        hit(ctx, out, bank.get('bell-low'), t + index * 0.14, {
          level: 0.6,
          rate: semitones(note),
        });
      });
      hit(ctx, out, bank.get('chime'), t + 0.28, { level: 0.25 });
    } else {
      hit(ctx, out, bank.get('bass-drop'), t + 0.4, { level: 0.8, rate: 0.75 });
      hit(ctx, out, bank.get('door'), t + 0.4, { level: 0.9, rate: 0.7 });
      hit(ctx, out, bank.get('woosh'), t + 0.5, { level: 0.6, rate: 0.7 });
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.dry?.disconnect();
    this.wet?.disconnect();
    this.score = null;
  }

  private applyMood(seconds: number): void {
    const ctx = this.engine.context;
    if (!ctx || !this.dry || !this.wet) return;
    const level = this.moodValue === 'silent' ? 0 : 1;
    this.dry.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3);
    this.wet.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3);
    if (this.moodValue === 'menu') this.target = 0.12;
    if (this.moodValue === 'resolved') this.target = 0.2;
  }

  private schedule(): void {
    const ctx = this.engine.context;
    const score = this.score;
    if (!ctx || !score || ctx.state !== 'running') return;
    // After a stall (a hidden tab), restart from now rather than catching up.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const t = this.nextTime;
      const playing = this.moodValue !== 'silent';
      // A silent score still keeps time, so the music carries on where it would have been.
      const stepSeconds = playing
        ? score.advance(t, this.intensity)
        : 60 / tempoFor(this.intensity) / 4;
      if (playing && this.alarm && this.warning && score.played % 8 === 0) {
        hit(ctx, this.warning, this.engine.samples?.get('alarm'), t, {
          level: 0.7,
          // Played slower, the buzzer is lower and less shrill.
          rate: 0.6,
          lowpass: 3000,
          length: stepSeconds * 5,
          release: 0.08,
        });
      }
      this.nextTime += stepSeconds;
      this.intensity += Math.max(
        -INTENSITY_RATE * stepSeconds,
        Math.min(INTENSITY_RATE * stepSeconds, this.target - this.intensity),
      );
    }
  }
}
