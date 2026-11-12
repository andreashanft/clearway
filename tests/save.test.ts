import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SAVE_KEY, Save, medalSteps, type SaveStorage } from '../src/engine/save';
import type { LevelResult } from '../src/game/scoring';

/** A stand-in for `localStorage`. */
function memoryStorage(
  initial: Record<string, string> = {},
): SaveStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function result(overrides: Partial<LevelResult> = {}): LevelResult {
  return {
    pathCleared: true,
    obstaclesCleared: 6,
    obstaclesTotal: 6,
    buildingsDestroyed: 12,
    buildingsTotal: 14,
    beaconsLit: 26,
    beaconsTotal: 30,
    dishFound: false,
    clearSeconds: 112,
    bonusSeconds: 68,
    points: 5000,
    medal: 'silver',
    score: 6360,
    forGold: { buildings: 2, beacons: 4, dish: true },
    ...overrides,
  };
}

const LEVELS = ['one', 'two', 'three'];

describe('Save', () => {
  it('starts with default settings and no records', () => {
    const save = new Save(memoryStorage());
    expect(save.settings).toEqual(DEFAULT_SETTINGS);
    expect(save.record('one')).toBeUndefined();
  });

  it('stores settings under the versioned key', () => {
    const storage = memoryStorage();
    new Save(storage).updateSettings({ leftHanded: true, musicVolume: 20 });
    const reloaded = new Save(storage);
    expect(storage.values.has(SAVE_KEY)).toBe(true);
    expect(reloaded.settings.leftHanded).toBe(true);
    expect(reloaded.settings.musicVolume).toBe(20);
    expect(reloaded.settings.steeringAssist).toBe(true);
  });

  it('keeps medals, best times and counts across reloads', () => {
    const storage = memoryStorage();
    new Save(storage).recordResult('one', result());
    const record = new Save(storage).record('one');
    expect(record).toEqual({
      medal: 'silver',
      bestClearSeconds: 112,
      buildingsPercent: 86,
      beaconsFound: 26,
      dishFound: false,
      bestScore: 6360,
    });
  });

  it('only ever improves a record', () => {
    const save = new Save(memoryStorage());
    save.recordResult('one', result());
    const outcome = save.recordResult(
      'one',
      result({
        medal: 'bronze',
        clearSeconds: 140,
        buildingsDestroyed: 7,
        beaconsLit: 3,
        score: 100,
      }),
    );
    expect(outcome.newBestTime).toBe(false);
    expect(outcome.newMedal).toBe(false);
    expect(outcome.record.medal).toBe('silver');
    expect(outcome.record.bestClearSeconds).toBe(112);
    expect(outcome.record.buildingsPercent).toBe(86);
    expect(outcome.record.beaconsFound).toBe(26);
  });

  it('reports a new best time and a new medal', () => {
    const save = new Save(memoryStorage());
    expect(save.recordResult('one', result()).newBestTime).toBe(true);
    const outcome = save.recordResult(
      'one',
      result({ medal: 'gold', clearSeconds: 90, dishFound: true }),
    );
    expect(outcome.newBestTime).toBe(true);
    expect(outcome.newMedal).toBe(true);
    expect(outcome.record.dishFound).toBe(true);
  });

  it('ignores a run without a clear path', () => {
    const save = new Save(memoryStorage());
    save.recordResult('one', result({ pathCleared: false, medal: 'none' }));
    expect(save.record('one')).toBeUndefined();
    expect(save.isCleared('one')).toBe(false);
  });

  it('unlocks the next level on bronze', () => {
    const save = new Save(memoryStorage());
    expect(save.isUnlocked('one', LEVELS)).toBe(true);
    expect(save.isUnlocked('two', LEVELS)).toBe(false);
    save.recordResult('one', result({ medal: 'bronze' }));
    expect(save.isUnlocked('two', LEVELS)).toBe(true);
    expect(save.isUnlocked('three', LEVELS)).toBe(false);
  });

  it('counts medal steps', () => {
    const save = new Save(memoryStorage());
    save.recordResult('one', result({ medal: 'gold' }));
    save.recordResult('two', result({ medal: 'bronze' }));
    expect(medalSteps(save, LEVELS)).toBe(4);
  });

  it('survives damaged save data', () => {
    const save = new Save(memoryStorage({ [SAVE_KEY]: '{not json' }));
    expect(save.settings).toEqual(DEFAULT_SETTINGS);
    const partial = new Save(
      memoryStorage({ [SAVE_KEY]: '{"version":1,"settings":{"haptics":false}}' }),
    );
    expect(partial.settings.haptics).toBe(false);
    expect(partial.settings.minimap).toBe(true);
  });

  it('works without storage', () => {
    const save = new Save(undefined);
    save.updateSettings({ minimap: false });
    expect(save.settings.minimap).toBe(false);
  });

  it('resets to the defaults', () => {
    const storage = memoryStorage();
    const save = new Save(storage);
    save.recordResult('one', result());
    save.reset();
    expect(save.record('one')).toBeUndefined();
    expect(storage.values.has(SAVE_KEY)).toBe(false);
  });
});
