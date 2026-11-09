import type { LightingPreset } from './world/lighting';

/** A ground position in metres: [x, z]. Heights always come from the terrain. */
export type GroundPoint = readonly [number, number];

export type VehicleType = 'bruiser' | 'fishtail' | 'liftoff' | 'tumbler' | 'railbed';

export interface VehicleSpawn {
  readonly type: VehicleType;
  readonly pos: GroundPoint;
  /** Heading in degrees; 0 faces north (−z), 90 faces east (+x). */
  readonly yaw: number;
}

export interface LevelDefinition {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly setting: string;
  readonly lighting: LightingPreset;
  readonly terrain: {
    readonly heightmap: string;
    readonly colourmap: string;
    readonly props: string;
    readonly metersPerPixel: number;
    readonly maxHeight: number;
  };
  readonly hauler: {
    /** Metres per second. */
    readonly speed: number;
    /** Seconds before the Hauler starts rolling. */
    readonly startDelay: number;
    readonly route: readonly GroundPoint[];
  };
  readonly player: { readonly vehicle: VehicleType };
  readonly vehicles: readonly VehicleSpawn[];
}

// Level definitions are `<id>.json`; dotted names such as `<id>.props.json` are assets.
const definitions = import.meta.glob<LevelDefinition>(
  ['../../levels/*.json', '!../../levels/*.*.json'],
  { eager: true, import: 'default' },
);
const assetUrls = import.meta.glob<string>(['../../levels/*.png', '../../levels/*.props.json'], {
  eager: true,
  query: '?url',
  import: 'default',
});

/** All playable levels in campaign order. */
export const LEVELS: readonly LevelDefinition[] = Object.values(definitions).sort(
  (a, b) => a.index - b.index,
);

export function findLevel(id: string): LevelDefinition | undefined {
  return LEVELS.find((level) => level.id === id);
}

/** Resolves a file name from a level definition to a URL the browser can fetch. */
export function levelAssetUrl(file: string): string {
  const url = assetUrls[`../../levels/${file}`];
  if (!url) throw new Error(`Unknown level asset ${file}`);
  return url;
}
