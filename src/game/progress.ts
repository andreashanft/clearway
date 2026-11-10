import type { SaveSchema } from '../engine/save';
import { type LevelStats, type Medal, medalFor, medalRank } from './scoring';

/** Best results kept for one level. */
export interface LevelRecord {
  readonly medal: Medal | null;
  /** Fastest path-clear time in seconds. */
  readonly bestTime: number | null;
  /** Best share of buildings destroyed, 0–1. */
  readonly buildings: number;
  readonly beacons: number;
  readonly dish: boolean;
  /** Best score; missing in saves from before scoring. */
  readonly bestScore?: number;
}

export type ControlLayout = 'point' | 'classic';
export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  readonly controlLayout: ControlLayout;
  readonly leftHanded: boolean;
  readonly steeringAssist: boolean;
  readonly autoSkid: boolean;
  readonly haptics: boolean;
  readonly easyMode: boolean;
  readonly minimap: boolean;
  readonly fullShake: boolean;
  readonly patternMarkings: boolean;
  readonly graphics: GraphicsQuality | 'auto';
  readonly tensionMusic: boolean;
  readonly subtitles: boolean;
  /** Volumes 0–100. */
  readonly music: number;
  readonly sfx: number;
  readonly voice: number;
}

export interface SaveData {
  readonly levels: Readonly<Record<string, LevelRecord>>;
  readonly settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  controlLayout: 'point',
  leftHanded: false,
  steeringAssist: true,
  autoSkid: true,
  haptics: true,
  easyMode: false,
  minimap: true,
  fullShake: false,
  patternMarkings: true,
  graphics: 'auto',
  tensionMusic: true,
  subtitles: true,
  music: 70,
  sfx: 85,
  voice: 80,
};

/** The save file: `clearway.save.v1` in localStorage. */
export const SAVE_SCHEMA: SaveSchema<SaveData> = {
  key: 'clearway.save.v1',
  version: 1,
  defaults: () => ({ levels: {}, settings: DEFAULT_SETTINGS }),
  // Version 1 is the first format; later versions upgrade from here.
  migrate: () => null,
};

/** Merges a finished run into the saved record, keeping the best of each value. */
export function recordRun(previous: LevelRecord | undefined, stats: LevelStats): LevelRecord {
  const medal = medalFor(stats);
  const share = (found: number, total: number): number => (total > 0 ? found / total : 0);
  const bestTime =
    stats.clearTime === null
      ? (previous?.bestTime ?? null)
      : Math.min(previous?.bestTime ?? Infinity, stats.clearTime);
  return {
    medal:
      medalRank(medal) > medalRank(previous?.medal ?? null) ? medal : (previous?.medal ?? null),
    bestTime,
    buildings: Math.max(
      previous?.buildings ?? 0,
      share(stats.buildingsDestroyed, stats.buildingsTotal),
    ),
    beacons: Math.max(previous?.beacons ?? 0, share(stats.beaconsFound, stats.beaconsTotal)),
    dish: (previous?.dish ?? false) || stats.dishFound,
    bestScore: Math.max(previous?.bestScore ?? 0, stats.score),
  };
}

/** A level unlocks when the one before it has at least bronze; the first is always open. */
export function isUnlocked(
  order: readonly string[],
  levels: SaveData['levels'],
  id: string,
): boolean {
  const index = order.indexOf(id);
  if (index <= 0) return index === 0;
  const before = order[index - 1];
  return before !== undefined && medalRank(levels[before]?.medal ?? null) >= 1;
}

/** Total medals earned across levels, counting bronze 1, silver 2 and gold 3. */
export function medalPoints(levels: SaveData['levels']): number {
  return Object.values(levels).reduce((sum, record) => sum + medalRank(record.medal), 0);
}
