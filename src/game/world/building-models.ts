import * as THREE from 'three/webgpu';
import type { BuildingClass, BuildingColors } from '../level';
import type { OrientedBox, Vec2 } from '../math';
import { FLOOR_HEIGHT } from './building-class';
import { MeshBuilder, shade } from './mesh-builder';
import type { Piece } from './pieces';

/** Width of one window bay along a wall, in metres. */
const BAY_WIDTH = 3.2;
/** Plain surfaces repeat the crack texture once per this many metres. */
const PLAIN_UV_METRES = 9;
/** Walls of a cut inside a building are this much darker than the outer walls. */
const CUT_SHADE = -0.22;

/** The wall and roof colours of each building class. A building picks one by its id. */
const PALETTES: Record<BuildingClass, { walls: string[]; roofs: string[] }> = {
  shed: { walls: ['#b98a5a', '#9c7b5b', '#a3a08f'], roofs: ['#7a5236', '#5d6470'] },
  house: {
    walls: ['#e9dcc3', '#d9c1a0', '#cfd8dc', '#c8d6b9', '#efe3d0'],
    roofs: ['#b5533c', '#8c4a3a', '#5d6470'],
  },
  block: {
    walls: ['#a9644b', '#c08a6a', '#b7b0a2', '#d2c3a8', '#8e9aa6'],
    roofs: ['#5d6470', '#6b6f75'],
  },
  tower: {
    walls: ['#9fb4c8', '#c9d2da', '#7f93a8', '#d8d4cb', '#6d7f91'],
    roofs: ['#4c5560', '#5d6470'],
  },
};

/** Picks the colours of a building from the palette of its class, the same way every time. */
export function paletteColors(id: string, kind: BuildingClass): BuildingColors {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  }
  const palette = PALETTES[kind];
  return {
    wall: palette.walls[hash % palette.walls.length],
    roof: palette.roofs[(hash >>> 8) % palette.roofs.length],
  };
}

/** How to draw the pieces of one building. */
export interface PieceStyle {
  colors: BuildingColors;
  /** Height of the bottom and of the roof above the building's ground, in metres. */
  base: number;
  height: number;
  /** A small rectangular house gets a gabled roof over this rectangle. */
  gable?: OrientedBox;
}

/**
 * The geometry of one building piece. It has two groups: group 0 holds the outer walls, which
 * show windows, and group 1 holds the roof and the walls of cuts inside the building.
 *
 * @param origin The point of the ground plane that becomes the geometry's origin.
 */
export function buildPieceGeometry(
  piece: Piece,
  origin: Vec2,
  style: PieceStyle,
): THREE.BufferGeometry {
  const walls = new Surface();
  const plain = new Surface();
  const wall = new THREE.Color(style.colors.wall);
  const cut = new THREE.Color(shade(style.colors.wall, CUT_SHADE));
  const roof = new THREE.Color(style.colors.roof);
  const roofHeight = style.gable ? gableHeight(style.gable, style.height) : 0;
  const top = style.height - roofHeight;
  const local = piece.polygon.map((p): Vec2 => [p[0] - origin[0], p[1] - origin[1]]);

  for (let i = 0; i < local.length; i += 1) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-3 || piece.bridge[i]) {
      continue;
    }
    // Outward normal of an anticlockwise polygon in the X-Z plane, seen from above with Y up.
    const normal = new THREE.Vector3((b[1] - a[1]) / length, 0, -(b[0] - a[0]) / length);
    if (piece.outer[i]) {
      // Whole bays, centred on the wall.
      const bays = length / BAY_WIDTH;
      const start = -(bays - Math.floor(bays)) / 2;
      walls.quad(
        a,
        b,
        style.base,
        top,
        normal,
        wall,
        [start, start + bays],
        [style.base / FLOOR_HEIGHT, top / FLOOR_HEIGHT],
      );
    } else {
      plain.quad(
        a,
        b,
        style.base,
        top,
        normal,
        cut,
        [0, length / PLAIN_UV_METRES],
        [style.base / PLAIN_UV_METRES, top / PLAIN_UV_METRES],
      );
    }
  }

  if (style.gable) {
    plain.append(gableGeometry(style.gable, origin, top, roofHeight, style.colors));
  } else {
    plain.cap(local, top, roof);
  }

  const geometry = new THREE.BufferGeometry();
  const merged = Surface.merge(walls, plain);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(merged.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(merged.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(merged.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(merged.uvs, 2));
  geometry.addGroup(0, walls.count, 0);
  geometry.addGroup(walls.count, plain.count, 1);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Height of a gabled roof above the eaves. */
function gableHeight(rect: OrientedBox, height: number): number {
  return Math.min(rect.half[1] * 0.75, height * 0.42);
}

/** A gabled roof over a rectangle, with its ridge along the rectangle's heading. */
function gableGeometry(
  rect: OrientedBox,
  origin: Vec2,
  eaves: number,
  roofHeight: number,
  colors: BuildingColors,
): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  // MeshBuilder turns around Y the other way round than headings do.
  builder.place([rect.center[0] - origin[0], eaves, rect.center[1] - origin[1]], -rect.heading);
  const length = rect.half[0] * 2;
  const width = rect.half[1] * 2;
  const roof = Number.parseInt(colors.roof.slice(1), 16);
  builder.gable(length + 0.6, width + 1.2, roofHeight, [0, 0, 0], roof);
  builder.box([length + 0.1, 0.3, width + 0.5], [0, -0.1, 0], shade(roof, -0.1));
  // The gable ends close the walls up to the ridge.
  const wall = Number.parseInt(colors.wall.slice(1), 16);
  builder.gable(length, width, roofHeight * 0.98, [0, 0, 0], wall);
  return builder.build();
}

/** Vertex arrays of one group of a piece geometry. */
class Surface {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];

  /** Number of vertices. */
  get count(): number {
    return this.positions.length / 3;
  }

  /** Adds an upright wall between two ground points, from `bottom` to `top`. */
  quad(
    a: Vec2,
    b: Vec2,
    bottom: number,
    top: number,
    normal: THREE.Vector3,
    color: THREE.Color,
    u: [number, number],
    v: [number, number],
  ): void {
    const corners: [number, number, number, number, number][] = [
      [a[0], bottom, a[1], u[0], v[0]],
      [b[0], bottom, b[1], u[1], v[0]],
      [b[0], top, b[1], u[1], v[1]],
      [a[0], top, a[1], u[0], v[1]],
    ];
    // Anticlockwise as seen from outside, so that the wall faces outwards.
    for (const index of [0, 2, 1, 0, 3, 2]) {
      const [x, y, z, cu, cv] = corners[index];
      this.positions.push(x, y, z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(color.r, color.g, color.b);
      this.uvs.push(cu, cv);
    }
  }

  /** Adds a flat roof over an anticlockwise polygon. */
  cap(polygon: readonly Vec2[], height: number, color: THREE.Color): void {
    const contour = polygon.map((p) => new THREE.Vector2(p[0], p[1]));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i0, i1, i2] of triangles) {
      const [a, b, c] = [polygon[i0], polygon[i1], polygon[i2]];
      // Anticlockwise in the X-Z plane faces down, so such a triangle is turned round.
      const down = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      for (const index of down ? [i0, i2, i1] : [i0, i1, i2]) {
        const [x, z] = polygon[index];
        this.positions.push(x, height, z);
        this.normals.push(0, 1, 0);
        this.colors.push(color.r, color.g, color.b);
        this.uvs.push(x / PLAIN_UV_METRES, z / PLAIN_UV_METRES);
      }
    }
  }

  /** Appends a finished geometry without an index. */
  append(geometry: THREE.BufferGeometry): void {
    const read = (name: string): ArrayLike<number> => geometry.getAttribute(name).array;
    this.positions.push(...Array.from(read('position')));
    this.normals.push(...Array.from(read('normal')));
    this.colors.push(...Array.from(read('color')));
    this.uvs.push(...Array.from(read('uv')));
    geometry.dispose();
  }

  static merge(first: Surface, second: Surface): Surface {
    const merged = new Surface();
    for (const surface of [first, second]) {
      merged.positions.push(...surface.positions);
      merged.normals.push(...surface.normals);
      merged.colors.push(...surface.colors);
      merged.uvs.push(...surface.uvs);
    }
    return merged;
  }
}

/** Glass and frame colours of the window texture. The wall colour multiplies them. */
const GLASS = '#3b4b63';
const GLASS_LIGHT = '#6f86a6';
const SILL = '#d9d6cf';

/**
 * Paints one window bay: a wall of white, which the wall colour tints, and a dark window. With
 * `cracked`, it adds cracks over it.
 */
export function createWindowTexture(cracked: boolean): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('The browser cannot create a 2D canvas for the window texture.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  const left = size * 0.24;
  const width = size * 0.52;
  const top = size * 0.2;
  const height = size * 0.52;
  context.fillStyle = GLASS;
  context.fillRect(left, top, width, height);
  context.fillStyle = GLASS_LIGHT;
  context.fillRect(left, top, width, height * 0.22);
  context.fillStyle = SILL;
  context.fillRect(left - 4, top + height, width + 8, 6);
  // A floor band between the storeys.
  context.fillStyle = '#e6e2da';
  context.fillRect(0, size - 6, size, 6);
  if (cracked) {
    paintCracks(context, size, 7);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Paints jagged dark lines on a light ground, for roofs and cut walls of a cracked building. */
export function createCrackTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('The browser cannot create a 2D canvas for the crack texture.');
  }
  context.fillStyle = '#d9d2c8';
  context.fillRect(0, 0, size, size);
  paintCracks(context, size, 9);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paintCracks(context: CanvasRenderingContext2D, size: number, count: number): void {
  let seed = 99;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const step = size / 20;
  for (let crack = 0; crack < count; crack += 1) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    context.strokeStyle = crack % 3 === 0 ? '#3a3632' : '#5b554e';
    context.lineWidth = (size / 128) * (1 + random() * 1.5);
    context.beginPath();
    context.moveTo(x, y);
    for (let i = 0; i < 9; i += 1) {
      angle += (random() - 0.5) * 1.6;
      x += Math.cos(angle) * (step + random() * step * 2);
      y += Math.sin(angle) * (step + random() * step * 2);
      context.lineTo(x, y);
    }
    context.stroke();
  }
}
