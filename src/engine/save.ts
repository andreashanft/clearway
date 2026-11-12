import { betterMedal, type LevelResult, type Medal } from '../game/scoring';

/** Key of the save data in `localStorage`. The version is part of the key. */
export const SAVE_KEY = 'clearway.save.v1';
const SAVE_VERSION = 1;

/** Everything that the Settings screen can change. */
export interface Settings {
  /** Touch layout: point the stick where to go, or steer with separate pedals. */
  touchLayout: 'point' | 'classic';
  leftHanded: boolean;
  steeringAssist: boolean;
  /** The Fishtail starts its skid by itself next to a wall. */
  autoSkid: boolean;
  haptics: boolean;
  minimap: boolean;
  /** Full camera shake. When off, the shake is reduced. */
  fullCameraShake: boolean;
  /** Dashed outline for the next obstacle, so that it does not rely on colour. */
  patternMarkings: boolean;
  /** The music speeds up as the Hauler closes in. */
  tensionMusic: boolean;
  subtitles: boolean;
  /** Volumes from 0 to 100. */
  musicVolume: number;
  effectsVolume: number;
  voiceVolume: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  touchLayout: 'point',
  leftHanded: false,
  steeringAssist: true,
  autoSkid: true,
  haptics: true,
  minimap: true,
  fullCameraShake: false,
  patternMarkings: false,
  tensionMusic: true,
  subtitles: true,
  musicVolume: 70,
  effectsVolume: 85,
  voiceVolume: 80,
};

/** The best that the player has achieved in one level. */
export interface LevelRecord {
  medal: Medal;
  /** Fastest time to a clear path, in seconds. */
  bestClearSeconds: number;
  /** Highest share of destroyed buildings, from 0 to 100. */
  buildingsPercent: number;
  /** Most beacons lit in one run. */
  beaconsFound: number;
  dishFound: boolean;
  bestScore: number;
}

export interface SaveData {
  version: number;
  levels: Record<string, LevelRecord>;
  settings: Settings;
}

/** What `Save.recordResult` reports back, for the result screen. */
export interface RecordOutcome {
  record: LevelRecord;
  /** True when the clear time beat the stored best, or when there was none. */
  newBestTime: boolean;
  /** True when the medal is better than the stored one. */
  newMedal: boolean;
}

/** The part of the Web Storage API that the save uses. Tests pass a stand-in. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function emptySave(): SaveData {
  return { version: SAVE_VERSION, levels: {}, settings: { ...DEFAULT_SETTINGS } };
}

/**
 * Brings save data of an older version up to date.
 *
 * Version 1 is the first version, so there is nothing to migrate yet. When the format changes,
 * add one step per version here, for example `if (data.version === 1) { ...; data.version = 2; }`.
 */
function migrate(data: SaveData): SaveData {
  return data;
}

/** Reads raw save data defensively. Missing or damaged parts fall back to defaults. */
function parse(raw: string | null): SaveData {
  if (!raw) {
    return emptySave();
  }
  try {
    const stored = JSON.parse(raw) as Partial<SaveData> | null;
    if (!stored || typeof stored !== 'object' || typeof stored.version !== 'number') {
      return emptySave();
    }
    const data = migrate({
      version: stored.version,
      levels: stored.levels && typeof stored.levels === 'object' ? stored.levels : {},
      settings: { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) },
    });
    data.version = SAVE_VERSION;
    return data;
  } catch {
    return emptySave();
  }
}

/** Medals, best times and settings, kept in `localStorage`. */
export class Save {
  private data: SaveData;

  constructor(private readonly storage: SaveStorage | undefined = defaultStorage()) {
    this.data = parse(this.read());
  }

  get settings(): Readonly<Settings> {
    return this.data.settings;
  }

  /** Changes settings and stores them. */
  updateSettings(changes: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...changes };
    this.write();
  }

  /** Returns the record of a level, or `undefined` when the level was never cleared. */
  record(levelId: string): LevelRecord | undefined {
    return this.data.levels[levelId];
  }

  /** Returns true when a level counts as cleared: it has at least a bronze medal. */
  isCleared(levelId: string): boolean {
    const medal = this.data.levels[levelId]?.medal ?? 'none';
    return medal !== 'none';
  }

  /**
   * Returns true when a level can be played. The first level is always open, and each further
   * level opens when the level before it has a bronze medal.
   *
   * @param levelIds Ids of every level in campaign order.
   */
  isUnlocked(levelId: string, levelIds: readonly string[]): boolean {
    const index = levelIds.indexOf(levelId);
    return index <= 0 || this.isCleared(levelIds[index - 1]);
  }

  /** Stores the result of a run. Each value only ever improves. */
  recordResult(levelId: string, result: Readonly<LevelResult>): RecordOutcome {
    const previous = this.data.levels[levelId];
    const percent =
      result.buildingsTotal === 0
        ? 100
        : Math.round((result.buildingsDestroyed / result.buildingsTotal) * 100);
    if (!result.pathCleared) {
      // A run without a clear path earns nothing and changes nothing.
      const record = previous ?? {
        medal: 'none',
        bestClearSeconds: 0,
        buildingsPercent: 0,
        beaconsFound: 0,
        dishFound: false,
        bestScore: 0,
      };
      return { record, newBestTime: false, newMedal: false };
    }
    const newBestTime = !previous || result.clearSeconds < previous.bestClearSeconds;
    const medal = betterMedal(previous?.medal ?? 'none', result.medal);
    const record: LevelRecord = {
      medal,
      bestClearSeconds: newBestTime ? result.clearSeconds : (previous?.bestClearSeconds ?? 0),
      buildingsPercent: Math.max(previous?.buildingsPercent ?? 0, percent),
      beaconsFound: Math.max(previous?.beaconsFound ?? 0, result.beaconsLit),
      dishFound: (previous?.dishFound ?? false) || result.dishFound,
      bestScore: Math.max(previous?.bestScore ?? 0, result.score),
    };
    this.data.levels[levelId] = record;
    this.write();
    return { record, newBestTime, newMedal: medal !== (previous?.medal ?? 'none') };
  }

  /** Deletes every record and restores the default settings. */
  reset(): void {
    this.data = emptySave();
    try {
      this.storage?.removeItem(SAVE_KEY);
    } catch {
      // Storage can be unavailable, for example in a private window. The game still runs.
    }
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage can be full or blocked. Progress then lasts until the page closes.
    }
  }
}

function defaultStorage(): SaveStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Number of medal steps across a set of levels: bronze counts 1, silver 2 and gold 3. */
export function medalSteps(save: Save, levelIds: readonly string[]): number {
  const steps: Record<Medal, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };
  return levelIds.reduce((sum, id) => sum + steps[save.record(id)?.medal ?? 'none'], 0);
}
