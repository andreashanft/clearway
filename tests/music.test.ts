import { describe, expect, it } from 'vitest';
import { BARS, BASS_LINE, LEAD_RIFF, tempoFor, tensionFor } from '../src/game/audio/music';
import { midiToHz } from '../src/game/audio/synth';

describe('dynamic music', () => {
  it('rises in tension as the countdown shrinks', () => {
    expect(tensionFor(60)).toBeCloseTo(0.12);
    expect(tensionFor(22)).toBeCloseTo(0.5);
    expect(tensionFor(4)).toBe(1);
    expect(tensionFor(0)).toBe(1);
    expect(tensionFor(null)).toBe(0.3);
  });

  it('speeds up from 104 to 144 beats per minute', () => {
    expect(tempoFor(0)).toBe(104);
    expect(tempoFor(1)).toBe(144);
    expect(tempoFor(2)).toBe(144);
  });

  it('has sixteen steps per pattern and four bars', () => {
    expect(BASS_LINE).toHaveLength(16);
    expect(LEAD_RIFF).toHaveLength(16);
    expect(BARS).toHaveLength(4);
  });

  it('tunes A4 to 440 Hz', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
});
