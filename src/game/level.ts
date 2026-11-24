import type { Vec2 } from './math';

/**
 * What a building is by its size: a shed, a house, a block or a tower. It decides the sound, the
 * palette and how the building falls. `world/building-class.ts` sorts buildings.
 */
export type BuildingClass = 'shed' | 'house' | 'block' | 'tower';

/** The three vehicles that the player can drive. */
export type VehicleType = 'dozer' | 'flail' | 'buggy';

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
  /** URL of a greyscale heightmap. Without it, the ground is flat at height zero. */
  heightmap?: string;
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

/**
 * One building, in the form that map data gives it: a footprint and heights.
 *
 * The footprint is a simple polygon in metres, in either winding order, without a repeated first
 * corner. The game cuts it into pieces and draws it in its own style.
 */
export interface BuildingData {
  id: string;
  /** Name in lower case, as the fail screen shows it: "Hit the house". Without it, the size decides. */
  name?: string;
  footprint: Vec2[];
  /** Height of the roof above the ground, in metres. */
  height: number;
  /** Height of the bottom above the ground, for a part that stands on another. Default 0. */
  base?: number;
  /** Without colours, the palette picks them by the building's size. */
  colors?: BuildingColors;
  /** Buildings with the same group count as one route obstacle. */
  group?: string;
  /** The building explodes when it is destroyed. */
  explodes?: boolean;
}

/** A fixed deck that vehicles can drive on, for example a road bridge. */
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

/**
 * One playable area. All positions are in metres.
 *
 * An area without a `hauler` is a free-driving area: nothing moves along a line, and the run
 * never ends. The test yard is such an area.
 */
export interface LevelData {
  id: string;
  name: string;
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
  /** Where the player's vehicle starts. The heading is in degrees: 0 points east. */
  spawn: { pos: Vec2; yaw: number };
  /** The line of the Hauler. */
  hauler?: HaulerData;
  /** Road bridges and other fixed decks. */
  decks?: DeckData[];
  buildings: BuildingData[];
  /** Traffic cones. A vehicle knocks them over. */
  cones?: Vec2[];
  tnt?: { pos: Vec2 }[];
  beacons?: { trails: BeaconTrail[] };
  relayDish?: { pos: Vec2; hiddenBy?: string };
  hints?: HintData[];
  /** The share of buildings and beacons that the silver medal asks for, from 0 to 1. */
  medals?: { silverBuildings: number; silverBeacons: number };
}
