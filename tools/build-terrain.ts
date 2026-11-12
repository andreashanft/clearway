/**
 * Paints the heightmap of each level from its terrain recipe.
 *
 * The tool reads `levels/<id>.terrain.json` and `levels/<id>.json`, and writes
 * `levels/<id>.height.png`: an 8-bit greyscale image in which white stands for the level's
 * `terrain.maxHeight`.
 *
 * Run it with `npm run build:terrain` after you change a recipe or move a building.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { LevelData } from '../src/game/level';
import {
  DEG,
  clamp,
  distanceToPolygonEdge,
  distanceToPolyline,
  pointInPolygon,
  seededRandom,
  smoothstep,
  toBoxLocal,
  type Vec2,
} from '../src/game/math';

/** Samples along each edge of the heightmap. */
const SAMPLES = 256;

type Operation =
  /** Sets every sample to one height. */
  | { op: 'base'; height: number }
  /** Adds smooth rolling noise. */
  | { op: 'noise'; amplitude: number; wavelength: number; seed: number }
  /** Sets the inside of a polygon to a height and blends to the surroundings over `falloff`. */
  | { op: 'plateau'; polygon: Vec2[]; height: number; falloff: number }
  /** Adds a round hill. A negative height makes a hollow. */
  | { op: 'mound'; center: Vec2; radius: number; height: number }
  /** Cuts a channel along a polyline down to `floor`, for example a creek or a rail cutting. */
  | { op: 'channel'; points: Vec2[]; width: number; floor: number; falloff: number }
  /** Cuts an elliptic basin down to `floor`, for example a pond. */
  | { op: 'basin'; center: Vec2; radius: Vec2; floor: number; falloff: number }
  /** Smooths the heights across a straight strip, so that the Hauler rolls evenly. */
  | { op: 'corridor'; from: Vec2; heading: number; length: number; width: number; falloff: number }
  /** A straight ramp between two points with a height at each end. */
  | {
      op: 'ramp';
      from: Vec2;
      to: Vec2;
      width: number;
      fromHeight: number;
      toHeight: number;
      falloff: number;
    }
  /** Flattens the ground under every building of the level. */
  | { op: 'pads'; margin: number };

interface Recipe {
  operations: Operation[];
}

const levelsDir = new URL('../levels/', import.meta.url);

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, levelsDir), 'utf8')) as T;
}

/** Smooth value noise from 0 to 1. */
function makeNoise(seed: number): (x: number, z: number) => number {
  const random = seededRandom(seed);
  const size = 64;
  const lattice = Float32Array.from({ length: size * size }, () => random());
  const at = (ix: number, iz: number): number =>
    lattice[(((iz % size) + size) % size) * size + (((ix % size) + size) % size)];
  return (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const tx = smoothstep(0, 1, x - ix);
    const tz = smoothstep(0, 1, z - iz);
    const top = at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx;
    const bottom = at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx;
    return top * (1 - tz) + bottom * tz;
  };
}

function paint(level: LevelData, recipe: Recipe): Float32Array {
  const { center, size } = level.terrain;
  const spacing = size / (SAMPLES - 1);
  const heights = new Float32Array(SAMPLES * SAMPLES);

  /** Runs `update` for every sample with its world position and current height. */
  const each = (update: (p: Vec2, height: number) => number): void => {
    for (let iz = 0; iz < SAMPLES; iz += 1) {
      for (let ix = 0; ix < SAMPLES; ix += 1) {
        const p: Vec2 = [center[0] - size / 2 + ix * spacing, center[1] - size / 2 + iz * spacing];
        const index = iz * SAMPLES + ix;
        heights[index] = update(p, heights[index]);
      }
    }
  };

  for (const operation of recipe.operations) {
    switch (operation.op) {
      case 'base':
        heights.fill(operation.height);
        break;
      case 'noise': {
        const noise = makeNoise(operation.seed);
        each(
          (p, h) =>
            h +
            (noise(p[0] / operation.wavelength, p[1] / operation.wavelength) - 0.5) *
              2 *
              operation.amplitude,
        );
        break;
      }
      case 'plateau':
        each((p, h) => {
          const distance = pointInPolygon(p, operation.polygon)
            ? 0
            : distanceToPolygonEdge(p, operation.polygon);
          const blend = 1 - smoothstep(0, operation.falloff, distance);
          return h + (operation.height - h) * blend;
        });
        break;
      case 'mound':
        each((p, h) => {
          const distance = Math.hypot(p[0] - operation.center[0], p[1] - operation.center[1]);
          return h + operation.height * (1 - smoothstep(0, operation.radius, distance));
        });
        break;
      case 'channel':
        each((p, h) => {
          const distance = distanceToPolyline(p, operation.points) - operation.width / 2;
          const blend = 1 - smoothstep(0, operation.falloff, distance);
          return h + (Math.min(h, operation.floor) - h) * blend;
        });
        break;
      case 'basin':
        each((p, h) => {
          const nx = (p[0] - operation.center[0]) / operation.radius[0];
          const nz = (p[1] - operation.center[1]) / operation.radius[1];
          const distance = (Math.hypot(nx, nz) - 1) * Math.min(...operation.radius);
          const blend = 1 - smoothstep(0, operation.falloff, distance);
          return h + (Math.min(h, operation.floor) - h) * blend;
        });
        break;
      case 'corridor': {
        // Average the heights across the strip, so that the strip does not tilt sideways, and
        // smooth them along the strip, so that the Hauler does not pitch.
        const heading = operation.heading * DEG;
        const along: Vec2 = [Math.cos(heading), Math.sin(heading)];
        const snapshot = heights.slice();
        const sampleSnapshot = (p: Vec2): number => {
          const gx = clamp((p[0] - (center[0] - size / 2)) / spacing, 0, SAMPLES - 1);
          const gz = clamp((p[1] - (center[1] - size / 2)) / spacing, 0, SAMPLES - 1);
          return snapshot[Math.round(gz) * SAMPLES + Math.round(gx)];
        };
        const window = 24;
        const profile = (d: number): number => {
          let sum = 0;
          let count = 0;
          for (let offset = -window; offset <= window; offset += 4) {
            const t = clamp(d + offset, 0, operation.length);
            sum += sampleSnapshot([
              operation.from[0] + along[0] * t,
              operation.from[1] + along[1] * t,
            ]);
            count += 1;
          }
          return sum / count;
        };
        each((p, h) => {
          const dx = p[0] - operation.from[0];
          const dz = p[1] - operation.from[1];
          const d = dx * along[0] + dz * along[1];
          if (d < -operation.falloff || d > operation.length + operation.falloff) {
            return h;
          }
          const side = Math.abs(-dx * along[1] + dz * along[0]) - operation.width / 2;
          const blend = 1 - smoothstep(0, operation.falloff, side);
          return blend <= 0 ? h : h + (profile(d) - h) * blend;
        });
        break;
      }
      case 'ramp': {
        const dx = operation.to[0] - operation.from[0];
        const dz = operation.to[1] - operation.from[1];
        const length = Math.hypot(dx, dz);
        const along: Vec2 = [dx / length, dz / length];
        each((p, h) => {
          const px = p[0] - operation.from[0];
          const pz = p[1] - operation.from[1];
          const d = px * along[0] + pz * along[1];
          const side = Math.abs(-px * along[1] + pz * along[0]) - operation.width / 2;
          const outside = Math.max(side, -d, d - length);
          const blend = 1 - smoothstep(0, operation.falloff, outside);
          if (blend <= 0) {
            return h;
          }
          const t = clamp(d / length, 0, 1);
          const target = operation.fromHeight + (operation.toHeight - operation.fromHeight) * t;
          return h + (target - h) * blend;
        });
        break;
      }
      case 'pads':
        for (const building of level.buildings) {
          const box = {
            center: building.pos,
            half: [building.size[0] / 2, building.size[2] / 2] as Vec2,
            heading: building.yaw * DEG,
          };
          // The pad takes the height that the ground has at the centre of the building.
          const gx = Math.round((building.pos[0] - (center[0] - size / 2)) / spacing);
          const gz = Math.round((building.pos[1] - (center[1] - size / 2)) / spacing);
          const padHeight =
            heights[clamp(gz, 0, SAMPLES - 1) * SAMPLES + clamp(gx, 0, SAMPLES - 1)];
          each((p, h) => {
            const local = toBoxLocal(p, box);
            const outside = Math.max(
              Math.abs(local[0]) - box.half[0],
              Math.abs(local[1]) - box.half[1],
            );
            const blend = 1 - smoothstep(operation.margin, operation.margin + 8, outside);
            return h + (padHeight - h) * blend;
          });
        }
        break;
    }
  }
  return heights;
}

function writeHeightmap(level: LevelData, heights: Float32Array): void {
  const png = new PNG({ width: SAMPLES, height: SAMPLES, colorType: 0 });
  let clipped = 0;
  for (let i = 0; i < heights.length; i += 1) {
    const normalised = heights[i] / level.terrain.maxHeight;
    if (normalised < 0 || normalised > 1) {
      clipped += 1;
    }
    const grey = Math.round(clamp(normalised, 0, 1) * 255);
    png.data[i * 4] = grey;
    png.data[i * 4 + 1] = grey;
    png.data[i * 4 + 2] = grey;
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(new URL(level.terrain.heightmap, levelsDir), PNG.sync.write(png, { colorType: 0 }));
  const note =
    clipped > 0 ? ` ${clipped} samples were outside 0 to ${level.terrain.maxHeight} m.` : '';
  console.log(`Wrote levels/${level.terrain.heightmap}.${note}`);
}

const recipeFiles = readdirSync(levelsDir).filter((name) => name.endsWith('.terrain.json'));
for (const recipeFile of recipeFiles) {
  const id = recipeFile.replace('.terrain.json', '');
  const level = readJson<LevelData>(`${id}.json`);
  const recipe = readJson<Recipe>(recipeFile);
  writeHeightmap(level, paint(level, recipe));
}
