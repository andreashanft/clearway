import type { BuildingDefinition } from './world/buildings';
import type { BeaconTrail, RelayDishDefinition } from './world/pickups';
import type { LightingPreset } from './world/lighting';

/** A ground position in metres: [x, z]. Heights always come from the terrain. */
export type GroundPoint = readonly [number, number];

export type VehicleType = 'bruiser' | 'fishtail' | 'liftoff' | 'tumbler' | 'railbed';

export interface VehicleSpawn {
  readonly type: VehicleType;
  readonly pos: GroundPoint;
  /** Heading in degrees; 0 faces north (−z), 90 faces east (+x). */
  readonly yaw: number;
  /** The vehicle can't be entered until this building falls (the Tumbler in its hangar). */
  readonly lockedBy?: string;
}

/** A rail line with the Railbed on it and the slot where it bridges the route. */
export interface RailLine {
  readonly points: readonly GroundPoint[];
  /** Railbed start, as a distance along the rails. */
  readonly railbed: number;
  /** Slot position, as a distance along the rails. */
  readonly slot: number;
}

/** A stretch of route the Hauler can only cross over the parked Railbed. */
export interface RouteGap {
  readonly id: string;
  /** Route distances (Hauler nose) where the gap starts and ends. */
  readonly from: number;
  readonly to: number;
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
    /**
     * Seconds the Hauler takes to reach the start of its route: it begins this far back,
     * already at full speed.
     */
    readonly leadIn: number;
    readonly route: readonly GroundPoint[];
  };
  readonly player: { readonly vehicle: VehicleType };
  readonly vehicles: readonly VehicleSpawn[];
  readonly buildings?: readonly BuildingDefinition[];
  readonly tnt?: readonly { readonly pos: GroundPoint }[];
  readonly rail?: RailLine;
  readonly routeGap?: RouteGap;
  /** Pickups lit by driving or walking past, for silver and gold. */
  readonly beacons?: { readonly trails: readonly BeaconTrail[] };
  /** The hidden relay dish, needed for gold. */
  readonly relayDish?: RelayDishDefinition;
  /** The brief's route distance for each obstacle, keyed by building id or group. */
  readonly targets?: Readonly<Record<string, number>>;
  /** One-line goal shown on the briefing screen. */
  readonly description?: string;
  /** Hints shown in the HUD: `start`, or an obstacle id when it becomes the next one. */
  readonly hints?: Readonly<Record<string, string>>;
  /** Tips on the fail screen, keyed by the obstacle the Hauler hit. */
  readonly tips?: Readonly<Record<string, string>>;
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
