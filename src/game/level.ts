import type { Vec2 } from './math';

/** How strong a building is. Each strength has hit points in `world/damage.ts`. */
export type Strength = 'shed' | 'house' | 'brick' | 'concrete';

export type VehicleType = 'bruiser' | 'fishtail' | 'liftoff' | 'tumbler' | 'railbed' | 'pilot';

export type Lighting = 'morning' | 'dusk' | 'noon';

/** Parallel stripes inside a ground polygon, for example crop rows. */
export interface GroundRows {
  color: string;
  /** Direction of the stripes in degrees. 0 runs east to west. */
  angle: number;
  /** Distance between two stripes in metres. */
  spacing: number;
  /** Width of one stripe in metres. */
  width: number;
}

/** One painted shape of the ground texture. The painter draws the layers in order. */
export type GroundLayer =
  | { kind: 'polygon'; points: Vec2[]; color: string; rows?: GroundRows; tag?: GroundTag }
  | {
      kind: 'path';
      points: Vec2[];
      /** Stroke width in metres. */
      width: number;
      color: string;
      /** Dash and gap lengths in metres. */
      dash?: [number, number];
      tag?: GroundTag;
    }
  | { kind: 'ellipse'; center: Vec2; radius: Vec2; color: string; tag?: GroundTag };

/** Marks a ground layer that the mini-map also draws. */
export type GroundTag = 'water' | 'road' | 'rail';

export interface TerrainData {
  /** File name of the greyscale heightmap, next to the level file. */
  heightmap: string;
  /** Centre of the terrain square. */
  center: Vec2;
  /** Edge length of the terrain square in metres. */
  size: number;
  /** Height in metres that a white heightmap pixel stands for. */
  maxHeight: number;
  /** Height of the water surface in metres. Terrain below it is under water. */
  waterLevel?: number;
  /** Ground colour where no layer paints. */
  baseColor: string;
}

export interface BuildingColors {
  wall: string;
  roof: string;
}

export interface BuildingData {
  id: string;
  /** Name in lower case, as the fail screen shows it: "Hit the farmhouse". */
  name: string;
  kind:
    | 'house'
    | 'terrace'
    | 'barn'
    | 'shed'
    | 'silo'
    | 'tank'
    | 'greenhouse'
    | 'block'
    | 'gantry'
    | 'chimney';
  strength: Strength;
  pos: Vec2;
  /** Width along the local X axis, height, and depth along the local Z axis, in metres. */
  size: [number, number, number];
  /** Rotation in degrees, clockwise as seen from above. */
  yaw: number;
  colors: BuildingColors;
  /** Buildings with the same group count as one route obstacle. */
  group?: string;
  /** The building explodes when it is destroyed. */
  explodes?: boolean;
  /** Number of segments. Without it, the length of the building decides. A terrace has one per house. */
  segments?: number;
}

export interface VehicleSpawn {
  id: string;
  type: VehicleType;
  pos: Vec2;
  /** Heading in degrees. 0 points east and positive values turn clockwise. */
  yaw: number;
  /** The vehicle starts inside this building and is free once the building is destroyed. */
  lockedIn?: string;
  /** For the Railbed: the two ends of the straight track that it runs on. */
  rail?: [Vec2, Vec2];
}

/** A stretch of the Hauler's line without ground, for example across a rail cutting. */
export interface RouteGapData {
  id: string;
  /** Name in lower case, as the fail screen shows it: "Hit the rail cutting". */
  name: string;
  /** Where the Railbed must stand to bridge the gap. */
  slot: Vec2;
  /** Route distances at which the gap starts and ends. */
  from: number;
  to: number;
}

/** A fixed deck that vehicles can drive on, for example a road bridge over a rail cutting. */
export interface DeckData {
  center: Vec2;
  /** Size along the heading, and across it, in metres. */
  size: Vec2;
  /** Heading in degrees. */
  yaw: number;
  /** Height of the driving surface in metres. */
  top: number;
  color?: string;
}

export interface HaulerData {
  /** Constant speed in metres per second. */
  speed: number;
  /** Where the front of the Hauler is when the level starts. */
  start: Vec2;
  /** Heading of the straight line in degrees. */
  heading: number;
  /** Length of the line in metres. The level ends when the Hauler has driven it. */
  length: number;
}

export interface BeaconTrail {
  from: Vec2;
  to: Vec2;
  count: number;
}

export interface HintData {
  /** `start`, `near:<building id>`, `near:tnt` or `cleared:<obstacle id>`. */
  trigger: string;
  text: string;
}

export interface ExpectedArrival {
  /** Building id or group, or the id of a route gap. */
  obstacle: string;
  /** True when the obstacle is a route gap and not a building. */
  gap?: boolean;
  /** When the design brief says the Hauler arrives, in seconds from the level start. */
  seconds: number;
}

/** One campaign level, as stored in `levels/<id>.json`. All positions are in metres. */
export interface LevelData {
  id: string;
  /** Position in the campaign, starting at 1. */
  index: number;
  name: string;
  setting: string;
  timeOfDay: string;
  lighting: Lighting;
  terrain: TerrainData;
  /** The play area. Vehicles cannot leave it. */
  bounds: { min: Vec2; max: Vec2 };
  ground: GroundLayer[];
  scenery: {
    /** Each tree is `[x, z, crown radius]`. */
    trees: [number, number, number][];
    /** Each hedge is a polyline. Vehicles and the Hauler crush hedges. */
    hedges: Vec2[][];
  };
  hauler: HaulerData;
  routeGaps: RouteGapData[];
  /** Road bridges and other fixed decks. */
  decks?: DeckData[];
  player: { vehicle: string };
  vehicles: VehicleSpawn[];
  buildings: BuildingData[];
  tnt: { pos: Vec2 }[];
  beacons: { trails: BeaconTrail[] };
  relayDish: { pos: Vec2; hiddenBy?: string };
  hints: HintData[];
  medals: { silverBuildings: number; silverBeacons: number };
  expected: { lineSeconds: number; arrivals: ExpectedArrival[] };
}
