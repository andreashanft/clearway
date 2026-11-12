import { describe, expect, it } from 'vitest';
import { leadIn } from '../src/engine/samples';
import { CRUSHING_HIT, HEAVY_HIT, engineRevs, impactLayers } from '../src/game/audio/game-audio';
import {
  BASS,
  KICKS,
  PHRASE_BARS,
  ROOTS,
  SLAMS,
  TICK_VOICES,
  bassShift,
  euclid,
  levelFor,
  patternFor,
  planPhrase,
  tempoFor,
  tensionFor,
} from '../src/game/audio/music';
import { SAMPLES } from '../src/game/audio/sample-data';
import { semitones } from '../src/game/audio/sampler';

/** A small seeded generator, so a test plans the same phrases every time. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('dynamic music', () => {
  it('rises in tension as the countdown shrinks', () => {
    expect(tensionFor(60)).toBeCloseTo(0.12);
    expect(tensionFor(22)).toBeCloseTo(0.5);
    expect(tensionFor(4)).toBe(1);
    expect(tensionFor(0)).toBe(1);
    expect(tensionFor(null)).toBe(0.3);
  });

  it('pushes from 92 to 108 beats per minute', () => {
    expect(tempoFor(0)).toBe(92);
    expect(tempoFor(1)).toBe(108);
    expect(tempoFor(2)).toBe(108);
  });

  it('works harder in four levels', () => {
    expect(levelFor(0.12)).toBe('calm');
    expect(levelFor(0.3)).toBe('pulse');
    expect(levelFor(0.7)).toBe('drive');
    expect(levelFor(1)).toBe('frenzy');
  });

  it('has sixteen steps in every pattern, and a kick on the first', () => {
    for (const family of [KICKS, SLAMS, BASS]) {
      for (const patterns of Object.values(family)) {
        expect(patterns.length).toBeGreaterThan(0);
        for (const pattern of patterns) expect(pattern).toMatch(/^[xX.]{16}$/);
      }
    }
    for (const level of ['pulse', 'drive', 'frenzy'] as const) {
      for (const pattern of KICKS[level]) expect(pattern[0]).toBe('x');
    }
  });

  it('spreads the hits of a Euclidean rhythm evenly', () => {
    const show = (pattern: boolean[]): string => pattern.map((on) => (on ? 'x' : '.')).join('');
    expect(show(euclid(4, 16))).toBe('x...x...x...x...');
    expect(show(euclid(3, 8))).toBe('x..x..x.');
    expect(show(euclid(3, 8, 1))).toBe('..x..x.x');
    expect(euclid(0, 16).some(Boolean)).toBe(false);
    expect(euclid(16, 16).every(Boolean)).toBe(true);
    for (let hits = 0; hits <= 16; hits++) {
      expect(euclid(hits, 16, 5).filter(Boolean)).toHaveLength(hits);
    }
  });

  it('plans phrases that come home to G every second time', () => {
    const random = seeded(7);
    let previous = planPhrase(random, 0);
    expect(previous.root).toBe(0);
    for (let index = 1; index < 40; index++) {
      const phrase = planPhrase(random, index, previous);
      if (index % 2 === 0) expect(phrase.root).toBe(0);
      else expect(ROOTS).toContain(phrase.root);
      expect(phrase.tick).not.toBe(previous.tick);
      expect(phrase.tick).toBeLessThan(TICK_VOICES.length);
      expect(phrase.fill).toHaveLength(8);
      expect(phrase.fill[7]).not.toBeNull();
      for (const event of phrase.far) {
        expect(event.bar).toBeLessThan(PHRASE_BARS);
        expect(event.step).toBeLessThan(16);
      }
      previous = phrase;
    }
  });

  it('does not repeat itself from phrase to phrase', () => {
    const random = seeded(3);
    const seen = new Set<string>();
    let previous = planPhrase(random, 0);
    for (let index = 1; index <= 24; index++) {
      previous = planPhrase(random, index, previous);
      seen.add(JSON.stringify(previous));
    }
    expect(seen.size).toBe(24);
  });

  it('varies the pattern on every second bar', () => {
    const phrase = planPhrase(seeded(1), 0);
    const family = KICKS.pulse;
    expect(patternFor(family, phrase, 0)).toBe(patternFor(family, phrase, 2));
    expect(patternFor(family, phrase, 1)).not.toBe(patternFor(family, phrase, 0));
  });

  it('keeps the bass between 49 and 87 Hz', () => {
    const c2 = 65.41;
    for (const root of [0, ...ROOTS]) {
      const hz = c2 * semitones(bassShift(root));
      expect(hz).toBeGreaterThan(48);
      expect(hz).toBeLessThan(88);
    }
  });
});

describe('samples', () => {
  it('lists every recording the music and the machines use', () => {
    for (const name of [...TICK_VOICES, 'kick', 'boom', 'pad-low', 'engine-load', 'hauler']) {
      expect(SAMPLES).toHaveProperty([name]);
    }
  });

  it('gives every loop a repeating part inside the file', () => {
    for (const info of Object.values(SAMPLES)) {
      if (!('loop' in info)) continue;
      const [start, end] = info.loop;
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start + 1);
      expect(end).toBeLessThan(info.seconds);
    }
  });

  it('measures the silence a decoder leaves at the start', () => {
    const data = new Float32Array(4410);
    data.fill(0.5, 441);
    expect(leadIn(data, 44100)).toBeCloseTo(0.01);
    expect(leadIn(new Float32Array(4410), 44100)).toBe(0);
    expect(leadIn(new Float32Array(100).fill(0.2), 44100)).toBe(0);
  });

  it('shifts pitch by semitones', () => {
    expect(semitones(12)).toBe(2);
    expect(semitones(-12)).toBe(0.5);
    expect(semitones(7)).toBeCloseTo(1.498, 3);
  });
});

describe('impacts', () => {
  it('plays a light crack for a nudge and the full weight for a crushing hit', () => {
    const nudge = impactLayers(0.12);
    expect(nudge.light).toBeGreaterThan(0);
    expect(nudge.body + nudge.thud + nudge.metal).toBe(0);
    const heavy = impactLayers(HEAVY_HIT);
    expect(heavy.light).toBe(0);
    expect(heavy.body).toBeGreaterThan(0);
    expect(heavy.thud).toBe(0);
    const crushing = impactLayers(CRUSHING_HIT);
    expect(crushing.thud).toBeGreaterThan(0);
    expect(crushing.metal).toBeGreaterThan(0);
    expect(impactLayers(5)).toEqual(impactLayers(1));
  });
});

describe('engine sound', () => {
  it('idles low, climbs through each gear and drops at the shift', () => {
    expect(engineRevs(0, 4)).toBeCloseTo(0.25);
    expect(engineRevs(0.24, 4)).toBeGreaterThan(0.9);
    expect(engineRevs(0.26, 4)).toBeLessThan(0.5);
    expect(engineRevs(1, 4)).toBe(1);
    expect(engineRevs(3, 4)).toBe(1);
  });
});
