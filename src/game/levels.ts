import type { LevelData } from './level';

const levelModules = import.meta.glob<LevelData>(
  ['../../levels/*.json', '!../../levels/*.terrain.json'],
  { eager: true, import: 'default' },
);
const heightmapUrls = import.meta.glob<string>('../../levels/*.height.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Every campaign level, ordered by its index. */
export const LEVELS: LevelData[] = Object.values(levelModules).sort((a, b) => a.index - b.index);

/** Returns a level by id. */
export function getLevel(id: string): LevelData {
  const level = LEVELS.find((candidate) => candidate.id === id);
  if (!level) {
    throw new Error(`There is no level with the id "${id}".`);
  }
  return level;
}

/** Returns the URL of the heightmap image of a level. */
export function heightmapUrl(level: LevelData): string {
  const entry = Object.entries(heightmapUrls).find(([path]) =>
    path.endsWith(`/${level.terrain.heightmap}`),
  );
  if (!entry) {
    throw new Error(`The heightmap "${level.terrain.heightmap}" is missing from levels/.`);
  }
  return entry[1];
}
