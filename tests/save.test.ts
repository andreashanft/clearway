import { describe, expect, it } from 'vitest';
import { load, save, type SaveSchema, type Storage } from '../src/engine/save';
import {
  DEFAULT_SETTINGS,
  isUnlocked,
  medalPoints,
  recordRun,
  SAVE_SCHEMA,
} from '../src/game/progress';
import type { LevelStats } from '../src/game/scoring';

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('save and load', () => {
  it('round-trips data and fills new fields from the defaults', () => {
    const storage = new MemoryStorage();
    save(SAVE_SCHEMA, storage, { levels: {}, settings: { ...DEFAULT_SETTINGS, music: 10 } });
    const loaded = load(SAVE_SCHEMA, storage);
    expect(loaded.settings.music).toBe(10);
    expect(storage.items.has('clearway.save.v1')).toBe(true);
  });

  it('falls back to defaults for missing, corrupt or unavailable storage', () => {
    expect(load(SAVE_SCHEMA, null).settings).toEqual(DEFAULT_SETTINGS);
    const storage = new MemoryStorage();
    storage.setItem('clearway.save.v1', '{not json');
    expect(load(SAVE_SCHEMA, storage).levels).toEqual({});
    const broken: Storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(load(SAVE_SCHEMA, broken).levels).toEqual({});
    expect(save(SAVE_SCHEMA, broken, SAVE_SCHEMA.defaults())).toBe(false);
  });

  it('migrates older versions through the schema', () => {
    const schema: SaveSchema<{ name: string; count: number }> = {
      key: 'test',
      version: 2,
      defaults: () => ({ name: 'none', count: 0 }),
      migrate: (data, from) =>
        from === 1 ? { name: (data as { title: string }).title, count: 1 } : null,
    };
    const storage = new MemoryStorage();
    storage.setItem('test', JSON.stringify({ version: 1, data: { title: 'old' } }));
    expect(load(schema, storage)).toEqual({ name: 'old', count: 1 });
    storage.setItem('test', JSON.stringify({ version: 0, data: {} }));
    expect(load(schema, storage)).toEqual({ name: 'none', count: 0 });
  });
});

const run = (overrides: Partial<LevelStats>): LevelStats => ({
  pathCleared: true,
  clearTime: 150,
  buildingsDestroyed: 8,
  buildingsTotal: 10,
  beaconsFound: 0,
  beaconsTotal: 0,
  dishFound: false,
  dishExists: false,
  score: 0,
  ...overrides,
});

describe('recordRun', () => {
  it('keeps the best medal, time and shares across runs', () => {
    const first = recordRun(undefined, run({}));
    expect(first.medal).toBe('silver');
    expect(first.bestTime).toBe(150);
    const slowerButFuller = recordRun(first, run({ clearTime: 170, buildingsDestroyed: 10 }));
    expect(slowerButFuller.medal).toBe('gold');
    expect(slowerButFuller.bestTime).toBe(150);
    expect(slowerButFuller.buildings).toBe(1);
    const failed = recordRun(slowerButFuller, run({ pathCleared: false, clearTime: null }));
    expect(failed.medal).toBe('gold');
    expect(failed.bestTime).toBe(150);
  });
});

describe('campaign progress', () => {
  const order = ['a', 'b', 'c'];
  it('opens the first level and each next one on bronze', () => {
    expect(isUnlocked(order, {}, 'a')).toBe(true);
    expect(isUnlocked(order, {}, 'b')).toBe(false);
    const levels = { a: recordRun(undefined, run({ buildingsDestroyed: 1 })) };
    expect(levels.a.medal).toBe('bronze');
    expect(isUnlocked(order, levels, 'b')).toBe(true);
    expect(isUnlocked(order, levels, 'c')).toBe(false);
    expect(isUnlocked(order, levels, 'missing')).toBe(false);
    expect(medalPoints(levels)).toBe(1);
  });
});
