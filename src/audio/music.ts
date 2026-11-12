import type { AudioEngine } from './engine';

/** How tense the music is. The tempo and the number of layers rise with it. */
export type Mood = 'off' | 'menu' | 'calm' | 'warning' | 'critical' | 'bonus';

interface Groove {
  /** Beats per minute. */
  tempo: number;
  /** One entry per sixteenth note of a bar. A number is a volume from 0 to 1. */
  kick: number[];
  snare: number[];
  hat: number[];
  /** Bass notes in semitones above C, or -1 for a rest. */
  bass: number[];
  bassSound: string;
  /** A percussion accent on top, or '' for none. */
  extra: string;
  extraSteps: number[];
}

const _ = 0;
const R = -1;

/**
 * The grooves of the soundtrack: a funk bass line over drums. They share one riff, so that a
 * change of mood sounds like the same tune played harder and faster.
 */
const GROOVES: Record<Exclude<Mood, 'off'>, Groove> = {
  menu: {
    tempo: 84,
    kick: [0.7, _, _, _, _, _, _, _, 0.5, _, _, _, _, _, _, _],
    snare: [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    hat: [_, _, 0.2, _, _, _, 0.2, _, _, _, 0.2, _, _, _, 0.2, _],
    bass: [0, R, R, R, R, R, 7, R, 3, R, R, R, R, R, 5, R],
    bassSound: 'bass-sub',
    extra: '',
    extraSteps: [],
  },
  calm: {
    tempo: 104,
    kick: [0.9, _, _, _, _, _, 0.6, _, 0.9, _, _, 0.5, _, _, _, _],
    snare: [_, _, _, _, 0.8, _, _, _, _, _, _, _, 0.8, _, _, 0.3],
    hat: [0.3, _, 0.3, _, 0.3, _, 0.3, 0.2, 0.3, _, 0.3, _, 0.3, _, 0.3, 0.2],
    bass: [0, R, 0, R, R, 3, R, 5, 0, R, R, 7, R, 5, 3, R],
    bassSound: 'bass-sub',
    extra: '',
    extraSteps: [],
  },
  warning: {
    tempo: 124,
    kick: [1, _, _, 0.6, _, _, 0.7, _, 1, _, 0.5, _, _, _, 0.6, _],
    snare: [_, _, _, _, 0.9, _, _, 0.3, _, _, _, _, 0.9, _, 0.3, _],
    hat: [0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.3],
    bass: [0, 0, R, 3, R, 5, R, 7, 0, 0, R, 10, R, 7, 5, 3],
    bassSound: 'bass-hard',
    extra: 'tom-mid',
    extraSteps: [14],
  },
  critical: {
    tempo: 152,
    kick: [1, _, 0.7, _, 1, _, 0.7, _, 1, _, 0.7, _, 1, _, 0.7, 0.7],
    snare: [_, _, _, _, 1, _, _, 0.4, _, _, _, _, 1, _, 0.5, 0.5],
    hat: [0.5, 0.3, 0.5, 0.3, 0.5, 0.3, 0.5, 0.3, 0.5, 0.3, 0.5, 0.3, 0.5, 0.3, 0.5, 0.3],
    bass: [0, 0, 12, 0, 3, 3, 12, 3, 5, 5, 12, 5, 7, 10, 12, 10],
    bassSound: 'bass-hard',
    extra: 'hat-metal',
    extraSteps: [2, 6, 10, 14],
  },
  bonus: {
    tempo: 112,
    kick: [0.9, _, _, _, _, _, 0.6, _, 0.9, _, _, _, _, 0.5, _, _],
    snare: [_, _, _, _, 0.7, _, _, _, _, _, _, _, 0.7, _, _, _],
    hat: [0.3, _, 0.3, 0.2, 0.3, _, 0.3, _, 0.3, _, 0.3, 0.2, 0.3, _, 0.3, _],
    bass: [0, R, 4, R, 7, R, 4, R, 5, R, 9, R, 7, R, 4, R],
    bassSound: 'bass-thick',
    extra: 'chime',
    extraSteps: [0],
  },
};

/**
 * A small step sequencer for the soundtrack. It plays drum and bass recordings on a grid of
 * sixteenth notes, and it gets faster and busier as the Hauler closes in.
 */
export class Music {
  private mood: Mood = 'off';
  private step = 0;
  /** Seconds until the next sixteenth note. */
  private untilStep = 0;
  private bar = 0;

  constructor(private readonly audio: AudioEngine) {
    audio.preload(['kick', 'snare', 'hat', 'bass-sub', 'bass-hard', 'bass-thick']);
  }

  /** Changes the mood. The new groove starts on the next bar line. */
  setMood(mood: Mood): void {
    if (mood === this.mood) {
      return;
    }
    if (this.mood === 'off') {
      this.step = 0;
      this.untilStep = 0;
    }
    this.mood = mood;
  }

  /** Advances the sequencer. Call it once per frame with real time. */
  update(frameSeconds: number): void {
    if (this.mood === 'off') {
      return;
    }
    // After a long pause, do not play the missed notes all at once.
    this.untilStep -= Math.min(frameSeconds, 0.1);
    while (this.untilStep <= 0) {
      const groove = GROOVES[this.mood];
      this.playStep(groove, this.step);
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar += 1;
      }
      this.untilStep += 60 / groove.tempo / 4;
    }
  }

  private playStep(groove: Groove, step: number): void {
    const play = (name: string, volume: number, rate = 1): void => {
      if (volume > 0) {
        this.audio.play(name, { volume, rate, bus: 'music' });
      }
    };
    play('kick', groove.kick[step] * 0.9);
    play('snare', groove.snare[step] * 0.55);
    play('hat', groove.hat[step] * 0.4);
    const note = groove.bass[step];
    if (note >= 0) {
      // Every fourth bar the riff moves up a fourth, for a turnaround.
      const shift = this.bar % 4 === 3 ? 5 : 0;
      play(groove.bassSound, 0.7, 2 ** ((note + shift) / 12));
    }
    if (groove.extra && groove.extraSteps.includes(step)) {
      play(groove.extra, 0.35);
    }
  }
}
