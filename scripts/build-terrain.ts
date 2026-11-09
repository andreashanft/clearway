/**
 * Bakes each level's terrain from a recipe into the files the game loads:
 *
 *   levels/<id>.terrain.json  (input)  hills, slopes, pits, channels, fields, scatter rules
 *   levels/<id>.json          (input)  route and building footprints to flatten
 *   levels/<id>.height.png    (output) 8-bit grayscale heightmap
 *   levels/<id>.colour.png    (output) RGB ground colour texture
 *   levels/<id>.props.json    (output) trees, bushes and water surfaces
 *
 * Run with `npm run terrain`. The outputs are committed, so you can also hand-edit the
 * heightmap PNG in an image editor; rerunning the script overwrites it.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { sampleCatmullRom } from '../src/game/route.ts';

type Vec2 = [number, number];

interface Recipe {
  heightmap: { size: number; metersPerPixel: number; maxHeight: number };
  colourmap: { size: number };
  seed: number;
  profileX?: Vec2[];
  profileZ?: Vec2[];
  noise?: { amplitude: number; scale: number };
  hills?: { at: Vec2; radius: number; height: number }[];
  terraces?: { at: Vec2; radii: number[]; heights: number[]; blend: number }[];
  /**
   * Rounded rectangles flattened to a fixed height, applied in order: list the outer
   * level first to dig a stepped pit such as a quarry.
   */
  pits?: {
    min: Vec2;
    max: Vec2;
    radius: number;
    height: number;
    blend: number;
    /** Ground colours of the pit floor, mixed by noise like grass. */
    colours?: [string, string];
  }[];
  ramps?: { from: Vec2; to: Vec2; width: number; rise: number }[];
  channels?: {
    points: Vec2[];
    width: number;
    bank: number;
    depth: number;
    water?: number;
    /** Cut after the route and pads are levelled, so the channel breaks the road. */
    afterRoute?: boolean;
    bankColour?: string;
    bedColour?: string;
  }[];
  route?: { width: number; blend: number; smoothing: number; colour: string };
  pads?: { at: Vec2; size: Vec2; yaw?: number; blend: number }[];
  padBlend?: number;
  colours: {
    grass: [string, string];
    slope: string;
    bank: string;
    bed: string;
  };
  fields?: {
    polygon: Vec2[];
    colours: [string, string];
    stripeAngle: number;
    stripeWidth: number;
  }[];
  scatter?: {
    type: string;
    count: number;
    region: [Vec2, Vec2];
    minSpacing: number;
    scale: [number, number];
    keepOut: number;
    /** Keep these props out of every pit, such as trees around a quarry. */
    outsidePits?: boolean;
  }[];
  rows?: { type: string; points: Vec2[]; spacing: number; scale: [number, number] }[];
}

interface LevelFile {
  hauler?: { route?: Vec2[] };
  buildings?: { pos: Vec2; size: [number, number, number]; yaw?: number }[];
}

interface Prop {
  type: string;
  x: number;
  z: number;
  scale: number;
  yaw: number;
}

const LEVELS_DIR = join(import.meta.dirname, '..', 'levels');

// ---------------------------------------------------------------------------
// Small maths helpers

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz) * 2 - 1;
}

function fbm(x: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o * 17);
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function profile(points: Vec2[] | undefined, v: number): number {
  if (!points || points.length === 0) return 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (v <= first[0]) return first[1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (v <= b[0]) return lerp(a[1], b[1], smoothstep(a[0], b[0], v));
  }
  return last[1];
}

/** Distance from p to a polyline, and the distance along the polyline of the closest point. */
function polylineDistance(points: Vec2[], x: number, z: number): { d: number; along: number } {
  let best = Infinity;
  let bestAlong = 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]!;
    const [bx, bz] = points[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);
    const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bestAlong = acc + t * len;
    }
    acc += len;
  }
  return { d: best, along: bestAlong };
}

/** Catmull-Rom resample of a polyline, shared with the game's route so both line up. */
function smoothPolyline(points: Vec2[], step: number): Vec2[] {
  return sampleCatmullRom(points, step).map(([x, z]) => [x, z]);
}

/** Signed distance from a point to a rounded rectangle: negative inside. */
function roundedRectDistance(
  rect: { min: Vec2; max: Vec2; radius: number },
  x: number,
  z: number,
): number {
  const cx = (rect.min[0] + rect.max[0]) / 2;
  const cz = (rect.min[1] + rect.max[1]) / 2;
  const qx = Math.abs(x - cx) - ((rect.max[0] - rect.min[0]) / 2 - rect.radius);
  const qz = Math.abs(z - cz) - ((rect.max[1] - rect.min[1]) / 2 - rect.radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qz), 0) - rect.radius;
}

function pointInPolygon(poly: Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ---------------------------------------------------------------------------
// PNG encoding (8-bit grayscale or RGB, no interlace)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width: number, height: number, channels: 1 | 3, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 1 ? 0 : 2;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

// ---------------------------------------------------------------------------
// Terrain baking

function buildPads(recipe: Recipe, level: LevelFile): NonNullable<Recipe['pads']> {
  const pads = [...(recipe.pads ?? [])];
  for (const b of level.buildings ?? []) {
    pads.push({
      at: b.pos,
      size: [b.size[0] + 4, b.size[2] + 4],
      yaw: b.yaw ?? 0,
      blend: recipe.padBlend ?? 8,
    });
  }
  return pads;
}

function bake(id: string): void {
  const recipe = JSON.parse(readFileSync(join(LEVELS_DIR, `${id}.terrain.json`), 'utf8')) as Recipe;
  const level = JSON.parse(readFileSync(join(LEVELS_DIR, `${id}.json`), 'utf8')) as LevelFile;
  const { size, metersPerPixel, maxHeight } = recipe.heightmap;
  const extent = (size - 1) * metersPerPixel;
  const half = extent / 2;
  const seed = recipe.seed;

  // 1. Natural shape: slopes, hills, terraces and noise.
  const natural = (x: number, z: number): number => {
    let h = profile(recipe.profileX, x) + profile(recipe.profileZ, z);
    for (const hill of recipe.hills ?? []) {
      const d2 = (x - hill.at[0]) ** 2 + (z - hill.at[1]) ** 2;
      h += hill.height * Math.exp(-d2 / (2 * (hill.radius / 2) ** 2));
    }
    if (recipe.noise) {
      h += recipe.noise.amplitude * fbm(x / recipe.noise.scale, z / recipe.noise.scale, seed);
    }
    for (const pit of recipe.pits ?? []) {
      const d = roundedRectDistance(pit, x, z);
      h = lerp(h, pit.height, 1 - smoothstep(-pit.blend, pit.blend, d));
    }
    for (const t of recipe.terraces ?? []) {
      const d = Math.hypot(x - t.at[0], z - t.at[1]);
      // Rings from the outside in: each ring sets a level, blended at its edge.
      for (let i = 0; i < t.radii.length; i++) {
        const w = 1 - smoothstep(t.radii[i]! - t.blend, t.radii[i]! + t.blend, d);
        h = lerp(h, t.heights[i]!, w);
      }
    }
    return h;
  };

  // 2. The route profile: natural height along the route, heavily smoothed so the road
  //    runs on an embankment over dips such as the creek.
  const route = level.hauler?.route ? smoothPolyline(level.hauler.route, 2) : [];
  const routeProfile: number[] = route.map(([x, z]) => natural(x, z));
  const smoothing = recipe.route?.smoothing ?? 10;
  const smoothedProfile = routeProfile.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -smoothing; k <= smoothing; k++) {
      const v = routeProfile[clamp(i + k, 0, routeProfile.length - 1)];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    return sum / n;
  });
  const routeHeightAt = (along: number): number => {
    const idx = clamp(along / 2, 0, smoothedProfile.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(smoothedProfile.length - 1, i0 + 1);
    return lerp(smoothedProfile[i0] ?? 0, smoothedProfile[i1] ?? 0, idx - i0);
  };

  const channels = (recipe.channels ?? []).map((c) => ({
    ...c,
    points: smoothPolyline(c.points, 3),
    bankRgb: hexToRgb(c.bankColour ?? recipe.colours.bank),
    bedRgb: hexToRgb(c.bedColour ?? recipe.colours.bed),
  }));
  const pads = buildPads(recipe, level);
  const padTargets = pads.map((p) => natural(p.at[0], p.at[1]));

  const finalHeight = (x: number, z: number): number => {
    let h = natural(x, z);
    for (const ramp of recipe.ramps ?? []) {
      const dx = ramp.to[0] - ramp.from[0];
      const dz = ramp.to[1] - ramp.from[1];
      const len = Math.hypot(dx, dz);
      const along = ((x - ramp.from[0]) * dx + (z - ramp.from[1]) * dz) / len;
      const across = Math.abs((x - ramp.from[0]) * -dz + (z - ramp.from[1]) * dx) / len;
      if (along >= 0 && along <= len && across <= ramp.width / 2 + 3) {
        const base = natural(ramp.from[0], ramp.from[1]);
        const target = base + ramp.rise * (along / len);
        const w = 1 - smoothstep(ramp.width / 2, ramp.width / 2 + 3, across);
        h = lerp(h, Math.max(h, target), w);
      }
    }
    const cut = (c: (typeof channels)[number]): void => {
      const { d } = polylineDistance(c.points, x, z);
      h -= c.depth * (1 - smoothstep(c.width / 2, c.width / 2 + c.bank, d));
    };
    for (const c of channels) if (!c.afterRoute) cut(c);
    if (route.length > 1 && recipe.route) {
      const { d, along } = polylineDistance(route, x, z);
      const w =
        1 - smoothstep(recipe.route.width / 2, recipe.route.width / 2 + recipe.route.blend, d);
      if (w > 0) h = lerp(h, routeHeightAt(along), w);
    }
    pads.forEach((pad, i) => {
      const yaw = ((pad.yaw ?? 0) * Math.PI) / 180;
      const lx = (x - pad.at[0]) * Math.cos(yaw) - (z - pad.at[1]) * Math.sin(yaw);
      const lz = (x - pad.at[0]) * Math.sin(yaw) + (z - pad.at[1]) * Math.cos(yaw);
      const ex = Math.max(0, Math.abs(lx) - pad.size[0] / 2);
      const ez = Math.max(0, Math.abs(lz) - pad.size[1] / 2);
      const w = 1 - smoothstep(0, pad.blend, Math.hypot(ex, ez));
      if (w > 0) h = lerp(h, padTargets[i] ?? h, w);
    });
    for (const c of channels) if (c.afterRoute) cut(c);
    return clamp(h, 0, maxHeight);
  };

  // Heightmap.
  const heights = new Float32Array(size * size);
  const heightPixels = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -half + i * metersPerPixel;
      const z = -half + j * metersPerPixel;
      const h = finalHeight(x, z);
      heights[j * size + i] = h;
      heightPixels[j * size + i] = Math.round((h / maxHeight) * 255);
    }
  }
  writeFileSync(join(LEVELS_DIR, `${id}.height.png`), encodePng(size, size, 1, heightPixels));

  const sampleHeight = (x: number, z: number): number => {
    const fi = clamp((x + half) / metersPerPixel, 0, size - 1);
    const fj = clamp((z + half) / metersPerPixel, 0, size - 1);
    const i0 = Math.floor(fi);
    const j0 = Math.floor(fj);
    const i1 = Math.min(size - 1, i0 + 1);
    const j1 = Math.min(size - 1, j0 + 1);
    const a = heights[j0 * size + i0]!;
    const b = heights[j0 * size + i1]!;
    const c = heights[j1 * size + i0]!;
    const d = heights[j1 * size + i1]!;
    return lerp(lerp(a, b, fi - i0), lerp(c, d, fi - i0), fj - j0);
  };

  // Colour map.
  const csize = recipe.colourmap.size;
  const colourPixels = new Uint8Array(csize * csize * 3);
  const grassA = hexToRgb(recipe.colours.grass[0]);
  const grassB = hexToRgb(recipe.colours.grass[1]);
  const slopeCol = hexToRgb(recipe.colours.slope);
  const roadCol = hexToRgb(recipe.route?.colour ?? '#c8b48a');
  const pits = (recipe.pits ?? [])
    .filter((pit) => pit.colours)
    .map((pit) => ({
      ...pit,
      a: hexToRgb(pit.colours?.[0] ?? '#000000'),
      b: hexToRgb(pit.colours?.[1] ?? '#000000'),
    }));
  const fields = (recipe.fields ?? []).map((f) => ({
    ...f,
    a: hexToRgb(f.colours[0]),
    b: hexToRgb(f.colours[1]),
    dir: [Math.cos((f.stripeAngle * Math.PI) / 180), Math.sin((f.stripeAngle * Math.PI) / 180)],
  }));

  for (let v = 0; v < csize; v++) {
    for (let u = 0; u < csize; u++) {
      const x = -half + (extent * (u + 0.5)) / csize;
      const z = -half + (extent * (v + 0.5)) / csize;
      const n = fbm(x / 40, z / 40, seed + 101);
      let col = mixRgb(grassA, grassB, clamp(0.5 + n, 0, 1));
      // Fine speckle so flat areas don't look plastic.
      const speckle = (hash(u, v, seed + 7) - 0.5) * 10;
      col = [col[0] + speckle, col[1] + speckle, col[2] + speckle * 0.6];

      for (const pit of pits) {
        const w = 1 - smoothstep(-pit.blend, pit.blend, roundedRectDistance(pit, x, z));
        if (w > 0) col = mixRgb(col, mixRgb(pit.a, pit.b, clamp(0.5 + n, 0, 1)), w);
      }

      const e = 1.5;
      const slope =
        Math.hypot(
          sampleHeight(x + e, z) - sampleHeight(x - e, z),
          sampleHeight(x, z + e) - sampleHeight(x, z - e),
        ) /
        (2 * e);
      col = mixRgb(col, slopeCol, smoothstep(0.25, 0.7, slope));

      for (const f of fields) {
        if (pointInPolygon(f.polygon, x, z)) {
          const s = (x * f.dir[0]! + z * f.dir[1]!) / f.stripeWidth;
          const stripe = Math.sin(s * Math.PI) > 0 ? 1 : 0;
          col = mixRgb(f.a, f.b, stripe * 0.85 + 0.15 * (0.5 + n));
        }
      }
      for (const c of channels) {
        const { d } = polylineDistance(c.points, x, z);
        col = mixRgb(
          col,
          c.bankRgb,
          1 - smoothstep(c.width / 2 + c.bank * 0.4, c.width / 2 + c.bank, d),
        );
        col = mixRgb(col, c.bedRgb, 1 - smoothstep(c.width / 2 - 1, c.width / 2 + 1, d));
      }
      if (route.length > 1 && recipe.route) {
        const { d } = polylineDistance(route, x, z);
        const roadW = recipe.route.width / 2;
        // A road cut by a channel shows the channel, not the road surface.
        const inCut = channels.some(
          (c) => c.afterRoute && polylineDistance(c.points, x, z).d < c.width / 2 + c.bank * 0.6,
        );
        if (inCut) {
          const o = (v * csize + u) * 3;
          colourPixels[o] = clamp(Math.round(col[0]), 0, 255);
          colourPixels[o + 1] = clamp(Math.round(col[1]), 0, 255);
          colourPixels[o + 2] = clamp(Math.round(col[2]), 0, 255);
          continue;
        }
        const tread = hash(Math.floor(x / 2), Math.floor(z / 2), seed + 3) * 18 - 9;
        const dirt: [number, number, number] = [
          roadCol[0] + tread,
          roadCol[1] + tread,
          roadCol[2] + tread,
        ];
        col = mixRgb(col, dirt, 1 - smoothstep(roadW - 1.5, roadW + 1.5, d));
      }
      const o = (v * csize + u) * 3;
      colourPixels[o] = clamp(Math.round(col[0]), 0, 255);
      colourPixels[o + 1] = clamp(Math.round(col[1]), 0, 255);
      colourPixels[o + 2] = clamp(Math.round(col[2]), 0, 255);
    }
  }
  writeFileSync(join(LEVELS_DIR, `${id}.colour.png`), encodePng(csize, csize, 3, colourPixels));

  // Props: scattered trees and rows of bushes, kept off the route, water, fields and pads.
  const rand = mulberry32(seed + 999);
  const props: Prop[] = [];
  const blocked = (x: number, z: number, margin: number): boolean => {
    if (
      route.length > 1 &&
      polylineDistance(route, x, z).d < (recipe.route?.width ?? 8) / 2 + margin
    ) {
      return true;
    }
    for (const c of channels) {
      if (polylineDistance(c.points, x, z).d < c.width / 2 + c.bank + 2) return true;
    }
    for (const f of fields) if (pointInPolygon(f.polygon, x, z)) return true;
    for (const pad of pads) {
      if (
        Math.hypot(x - pad.at[0], z - pad.at[1]) <
        Math.max(pad.size[0], pad.size[1]) / 2 + margin
      ) {
        return true;
      }
    }
    return false;
  };
  for (const rule of recipe.scatter ?? []) {
    const [[x0, z0], [x1, z1]] = rule.region;
    let placed = 0;
    for (let attempt = 0; attempt < rule.count * 30 && placed < rule.count; attempt++) {
      const x = lerp(x0, x1, rand());
      const z = lerp(z0, z1, rand());
      if (blocked(x, z, rule.keepOut)) continue;
      if (rule.outsidePits && recipe.pits?.some((pit) => roundedRectDistance(pit, x, z) < 4)) {
        continue;
      }
      if (props.some((p) => Math.hypot(p.x - x, p.z - z) < rule.minSpacing)) continue;
      props.push({
        type: rule.type,
        x: round1(x),
        z: round1(z),
        scale: round2(lerp(rule.scale[0], rule.scale[1], rand())),
        yaw: Math.round(rand() * 360),
      });
      placed++;
    }
  }
  for (const row of recipe.rows ?? []) {
    const pts = smoothPolyline(row.points, row.spacing);
    for (const [x, z] of pts) {
      props.push({
        type: row.type,
        x: round1(x + (rand() - 0.5) * row.spacing * 0.4),
        z: round1(z + (rand() - 0.5) * row.spacing * 0.4),
        scale: round2(lerp(row.scale[0], row.scale[1], rand())),
        yaw: Math.round(rand() * 360),
      });
    }
  }

  const water = channels
    .filter((c) => c.water !== undefined)
    .map((c) => ({
      width: c.width + 2,
      points: c.points
        .filter((_, i) => i % 2 === 0)
        .map(([x, z]) => [round1(x), round2(sampleHeight(x, z) + (c.water ?? 0)), round1(z)]),
    }));

  writeFileSync(
    join(LEVELS_DIR, `${id}.props.json`),
    `${JSON.stringify({ props, water }, null, 0).replace(/\},\{/g, '},\n{')}\n`,
  );
  console.info(`${id}: ${size}² heightmap, ${csize}² colour map, ${props.length} props`);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

const only = process.argv[2];
const ids = readdirSync(LEVELS_DIR)
  .filter((f) => f.endsWith('.terrain.json'))
  .map((f) => f.replace('.terrain.json', ''))
  .filter((id) => !only || id === only);
for (const id of ids) bake(id);
