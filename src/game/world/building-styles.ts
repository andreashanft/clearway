import { type BufferGeometry, ConeGeometry, Euler, Quaternion, Vector3 } from 'three';
import { box, gable, merge, paint, place, shade, type Vec3 } from '../models/geometry';

export type BuildingStyle =
  | 'shed'
  | 'house'
  | 'barn'
  | 'stone-barn'
  | 'kiosk'
  | 'silo'
  | 'fence'
  | 'terrace'
  | 'shop'
  | 'signal-box'
  | 'warehouse'
  | 'station'
  | 'cabin'
  | 'gantry'
  | 'hangar'
  | 'crusher'
  | 'chimney'
  | 'hut'
  | 'container';

/** Every style, for tests and tools. */
export const BUILDING_STYLES: readonly BuildingStyle[] = [
  'shed',
  'house',
  'barn',
  'stone-barn',
  'kiosk',
  'silo',
  'fence',
  'terrace',
  'shop',
  'signal-box',
  'warehouse',
  'station',
  'cabin',
  'gantry',
  'hangar',
  'crusher',
  'chimney',
  'hut',
  'container',
];

/** One pre-fractured part of a building: it stands in place until the building collapses. */
export interface Piece {
  /** Vertex-coloured geometry centred on the piece's collider. */
  readonly geometry: BufferGeometry;
  /** Collider half extents. */
  readonly half: Vec3;
  /** Centre relative to the building's base centre (ground level). */
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

export interface BuildingShape {
  readonly pieces: Piece[];
  /** Concrete slab left behind when the building falls. */
  readonly foundation: BufferGeometry | null;
  /** Main colour, used to tint debris and dust. */
  readonly debrisColour: string;
}

/** A small seeded random generator so a building always fractures the same way. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const Y_AXIS = new Vector3(0, 1, 0);
const euler = new Euler();

/** Collects pieces in a local frame, then places them in the building frame. */
class PieceSet {
  readonly pieces: Piece[] = [];

  /**
   * Adds a piece built from `parts` (in piece-local coordinates). The geometry is
   * re-centred on its bounding box so the collider matches it.
   */
  add(parts: BufferGeometry[], at: Vec3, rotate: Vec3 = [0, 0, 0]): void {
    const geometry = merge(parts);
    const bounds = geometry.boundingBox;
    if (!bounds) return;
    const centre = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.computeBoundingSphere();
    const rotation = new Quaternion().setFromEuler(euler.set(...rotate));
    const position = new Vector3(...at).add(centre.applyQuaternion(rotation));
    this.pieces.push({
      geometry,
      half: [size.x / 2, size.y / 2, size.z / 2],
      position,
      rotation,
    });
  }

  /** Adds the pieces of another set, turned by `yaw` about the vertical and moved by `at`. */
  addAll(other: PieceSet, at: Vec3, yaw: number): void {
    const turn = new Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    for (const piece of other.pieces) {
      this.pieces.push({
        ...piece,
        position: piece.position
          .clone()
          .applyQuaternion(turn)
          .add(new Vector3(...at)),
        rotation: turn.clone().multiply(piece.rotation),
      });
    }
  }
}

interface WallOptions {
  readonly colour: string;
  readonly thickness: number;
  readonly panelWidth: number;
  /** Rows of windows per panel (0 for none). */
  readonly windowRows: number;
  readonly windowSize?: readonly [number, number];
  /** Index of the panel that gets a door, or −1. */
  readonly doorPanel: number;
  readonly doorSize?: readonly [number, number];
  readonly doorColour?: string;
  readonly trim?: string;
  readonly glass?: string;
  readonly rand: () => number;
}

/**
 * A straight wall of `length` × `height`, split into panels, outside face towards +z,
 * standing on y = 0 and centred on x = 0.
 */
function wall(length: number, height: number, o: WallOptions): PieceSet {
  const set = new PieceSet();
  const count = Math.max(1, Math.round(length / o.panelWidth));
  const pw = length / count;
  const t = o.thickness;
  const [ww, wh] = o.windowSize ?? [Math.min(1.3, pw * 0.45), 1.2];
  const [dw, dh] = o.doorSize ?? [1.1, 2.1];
  const trim = o.trim ?? '#F2EFE8';
  const glass = o.glass ?? '#3B5C74';
  for (let i = 0; i < count; i++) {
    const x = -length / 2 + pw * (i + 0.5);
    const tint = 0.94 + o.rand() * 0.1;
    const parts = [shade(box([pw, height, t], o.colour), tint)];
    const face = t / 2;
    const isDoor = i === o.doorPanel;
    if (isDoor) {
      parts.push(
        box([dw, dh, 0.1], o.doorColour ?? '#6E4A30', [0, -height / 2 + dh / 2, face + 0.03]),
      );
      parts.push(box([dw + 0.24, 0.14, 0.14], trim, [0, -height / 2 + dh + 0.07, face + 0.05]));
    }
    for (let row = 0; row < o.windowRows; row++) {
      if (isDoor && row === 0) continue;
      const y = -height / 2 + (height * (row + 0.62)) / (o.windowRows + 0.35);
      parts.push(box([ww, wh, 0.08], glass, [0, y, face + 0.02]));
      parts.push(box([ww + 0.24, 0.12, 0.12], trim, [0, y + wh / 2 + 0.06, face + 0.04]));
      parts.push(box([ww + 0.3, 0.14, 0.2], trim, [0, y - wh / 2 - 0.07, face + 0.07]));
      parts.push(box([0.12, wh, 0.12], trim, [-ww / 2 - 0.06, y, face + 0.04]));
      parts.push(box([0.12, wh, 0.12], trim, [ww / 2 + 0.06, y, face + 0.04]));
      parts.push(box([0.08, wh, 0.1], trim, [0, y, face + 0.05]));
    }
    set.add(parts, [x, height / 2, 0]);
  }
  return set;
}

/** Four walls around a W × D footprint. The front (+z) wall gets the door. */
function walls(width: number, depth: number, height: number, o: WallOptions): PieceSet {
  const set = new PieceSet();
  const t = o.thickness;
  set.addAll(wall(width, height, o), [0, 0, depth / 2 - t / 2], 0);
  set.addAll(wall(width, height, { ...o, doorPanel: -1 }), [0, 0, -depth / 2 + t / 2], Math.PI);
  const side = { ...o, doorPanel: -1, windowRows: Math.min(o.windowRows, 1) };
  set.addAll(wall(depth - 2 * t, height, side), [width / 2 - t / 2, 0, 0], Math.PI / 2);
  set.addAll(wall(depth - 2 * t, height, side), [-width / 2 + t / 2, 0, 0], -Math.PI / 2);
  return set;
}

interface RoofOptions {
  readonly colour: string;
  readonly overhang: number;
  readonly segmentWidth: number;
  readonly gableColour: string;
  readonly thickness?: number;
}

/** A pitched roof with its ridge along x, from eave height `eave` up to `ridge`. */
function gableRoof(
  width: number,
  depth: number,
  eave: number,
  ridge: number,
  o: RoofOptions,
): PieceSet {
  const set = new PieceSet();
  const rise = ridge - eave;
  const run = depth / 2;
  const pitch = Math.atan2(rise, run);
  const hyp = Math.hypot(rise, run);
  // Each slab runs from the ridge down past the eave by the overhang.
  const length = hyp + o.overhang;
  const across = run / hyp;
  const up = rise / hyp;
  const count = Math.max(1, Math.round((width + 2 * o.overhang) / o.segmentWidth));
  const segW = (width + 2 * o.overhang) / count;
  const thick = o.thickness ?? 0.24;
  for (const side of [1, -1]) {
    for (let i = 0; i < count; i++) {
      const x = -width / 2 - o.overhang + segW * (i + 0.5);
      // Halfway down the slope, lifted by half the thickness so the slab sits on it.
      const z = side * (across * (length / 2) + up * (thick / 2));
      const y = ridge - up * (length / 2) + across * (thick / 2);
      set.add([box([segW - 0.02, thick, length], o.colour)], [x, y, z], [side * pitch, 0, 0]);
    }
  }
  // Gable ends fill the triangle above the side walls.
  for (const end of [1, -1]) {
    const g = gable(depth, rise, 0.3, o.gableColour);
    set.add([g], [end * (width / 2 - 0.15), eave, 0], [0, Math.PI / 2, 0]);
  }
  return set;
}

/** A flat roof slab split into segments, with a parapet lip. */
function flatRoof(
  width: number,
  depth: number,
  height: number,
  colour: string,
  segment: number,
): PieceSet {
  const set = new PieceSet();
  const count = Math.max(1, Math.round(width / segment));
  const segW = width / count;
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + segW * (i + 0.5);
    set.add(
      [
        box([segW - 0.02, 0.3, depth], colour),
        box([segW, 0.4, 0.3], colour, [0, 0.3, depth / 2 - 0.15]),
      ],
      [x, height + 0.15, 0],
    );
  }
  return set;
}

function foundation(width: number, depth: number): BufferGeometry {
  return box([width + 0.8, 0.35, depth + 0.8], '#8F8B80', [0, 0.05, 0]);
}

/** Builds the pieces of a building of `style` with footprint and height `size` [w, h, d]. */
export function buildShape(style: BuildingStyle, size: Vec3, seed: number): BuildingShape {
  const rand = seededRandom(seed);
  const [w, h, d] = size;
  const set = new PieceSet();

  switch (style) {
    case 'shed': {
      const eave = h * 0.72;
      set.addAll(
        walls(w, d, eave, {
          colour: rand() > 0.5 ? '#9A7A55' : '#8A6A47',
          thickness: 0.18,
          panelWidth: 2.4,
          windowRows: 0,
          doorPanel: Math.floor(Math.max(1, Math.round(w / 2.4)) / 2),
          doorSize: [1.6, 2.2],
          doorColour: '#5E3822',
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(
        gableRoof(w, d, eave, h, {
          colour: '#9AA3AD',
          overhang: 0.35,
          segmentWidth: 2.6,
          gableColour: '#856745',
          thickness: 0.14,
        }),
        [0, 0, 0],
        0,
      );
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#8A6A47' };
    }

    case 'house': {
      const eave = h * 0.62;
      const roofColour = ['#B4553E', '#3E6C8F', '#6F7476'][Math.floor(rand() * 3)] ?? '#B4553E';
      const wallColour = rand() > 0.5 ? '#D8C8A8' : '#E6DFD0';
      set.addAll(
        walls(w, d, eave, {
          colour: wallColour,
          thickness: 0.3,
          panelWidth: 3.2,
          windowRows: eave > 4.5 ? 2 : 1,
          doorPanel: Math.floor(Math.max(1, Math.round(w / 3.2)) / 2),
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(
        gableRoof(w, d, eave, h, {
          colour: roofColour,
          overhang: 0.5,
          segmentWidth: 3.4,
          gableColour: wallColour,
        }),
        [0, 0, 0],
        0,
      );
      set.add(
        [box([0.9, 2.2, 0.9], '#9C5A44'), box([1.1, 0.2, 1.1], '#7E4535', [0, 1.1, 0])],
        [w * 0.28, h - 0.3, -d * 0.12],
      );
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: wallColour };
    }

    case 'barn': {
      // An open-fronted hay barn: posts, a red roof, plank back and sides, and hay bales.
      const eave = h * 0.6;
      const postX = [-w / 2 + 0.3, 0, w / 2 - 0.3];
      for (const x of postX) {
        set.add([box([0.4, eave, 0.4], '#6E5338')], [x, eave / 2, d / 2 - 0.3]);
      }
      const plank = {
        colour: '#8F3F2D',
        thickness: 0.2,
        panelWidth: 3,
        windowRows: 0,
        doorPanel: -1,
        rand,
      };
      set.addAll(wall(w, eave, plank), [0, 0, -d / 2 + 0.1], Math.PI);
      set.addAll(wall(d - 0.4, eave, plank), [w / 2 - 0.1, 0, 0], Math.PI / 2);
      set.addAll(wall(d - 0.4, eave, plank), [-w / 2 + 0.1, 0, 0], -Math.PI / 2);
      set.addAll(
        gableRoof(w, d, eave, h, {
          colour: '#7A4A2E',
          overhang: 0.6,
          segmentWidth: 3,
          gableColour: '#8F3F2D',
        }),
        [0, 0, 0],
        0,
      );
      const bale: Vec3 = [1.5, 0.9, 1];
      for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 2; j++) {
            const x = -w / 2 + 1.6 + i * 1.65 + layer * 0.4;
            const z = -d / 2 + 1.2 + j * 1.15;
            set.add(
              [box(bale, '#D8B45A'), box([bale[0] + 0.02, 0.06, 0.1], '#B99440', [0, 0, 0.3])],
              [x, 0.45 + layer * 0.92, z],
            );
          }
        }
      }
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#8F3F2D' };
    }

    case 'stone-barn': {
      const eave = h * 0.6;
      set.addAll(
        walls(w, d, eave, {
          colour: '#BDB6A6',
          thickness: 0.6,
          panelWidth: 3.2,
          windowRows: 1,
          windowSize: [0.8, 0.9],
          doorPanel: Math.floor(Math.max(1, Math.round(w / 3.2)) / 2),
          doorSize: [2.6, 3.2],
          doorColour: '#5E3822',
          trim: '#A39C8C',
          glass: '#2E3A44',
          rand,
        }),
        [0, 0, 0],
        0,
      );
      // Quoins: darker corner stones.
      for (const [x, z] of [
        [w / 2 - 0.3, d / 2 - 0.3],
        [-w / 2 + 0.3, d / 2 - 0.3],
        [w / 2 - 0.3, -d / 2 + 0.3],
        [-w / 2 + 0.3, -d / 2 + 0.3],
      ] as const) {
        set.add([box([0.75, eave, 0.75], '#A39C8C')], [x, eave / 2, z]);
      }
      set.addAll(
        gableRoof(w, d, eave, h, {
          colour: '#5F6466',
          overhang: 0.4,
          segmentWidth: 3.2,
          gableColour: '#BDB6A6',
          thickness: 0.3,
        }),
        [0, 0, 0],
        0,
      );
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#BDB6A6' };
    }

    case 'kiosk': {
      // A small shop at the back and a canopy over two pumps at the front.
      const shopD = d * 0.42;
      const shopW = w * 0.55;
      const shopZ = -d / 2 + shopD / 2;
      set.addAll(
        walls(shopW, shopD, 2.8, {
          colour: '#ECEAE4',
          thickness: 0.2,
          panelWidth: 2,
          windowRows: 1,
          windowSize: [1.4, 1.1],
          doorPanel: 0,
          doorColour: '#3B5C74',
          trim: '#D43C3C',
          rand,
        }),
        [0, 0, shopZ],
        0,
      );
      set.addAll(flatRoof(shopW, shopD, 2.8, '#D43C3C', 2), [0, 0, shopZ], 0);
      const canopyY = h - 0.3;
      for (const [x, z] of [
        [-w / 2 + 0.6, d / 2 - 0.6],
        [w / 2 - 0.6, d / 2 - 0.6],
        [-w / 2 + 0.6, 0],
        [w / 2 - 0.6, 0],
      ] as const) {
        set.add([box([0.25, canopyY, 0.25], '#8E95A0')], [x, canopyY / 2, z]);
      }
      for (const x of [-w / 4, w / 4]) {
        set.add(
          [
            box([w / 2, 0.35, d * 0.62], '#F2EFE8'),
            box([w / 2, 0.36, 0.08], '#D43C3C', [0, 0, d * 0.31]),
          ],
          [x, canopyY + 0.17, d * 0.18],
        );
      }
      for (const x of [-w * 0.18, w * 0.18]) {
        set.add(
          [
            box([0.7, 1.5, 0.45], '#D43C3C'),
            box([0.72, 0.3, 0.47], '#F2EFE8', [0, 0.6, 0]),
            box([0.4, 0.3, 0.05], '#2B3038', [0, 0.25, 0.25]),
          ],
          [x, 0.75, d * 0.2],
        );
      }
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#ECEAE4' };
    }

    case 'silo': {
      // An octagonal tower in three rings with a conical cap and a ladder.
      const radius = Math.min(w, d) / 2;
      const sides = 8;
      const rings = 3;
      const ringH = (h - radius * 0.8) / rings;
      const panelW = 2 * radius * Math.tan(Math.PI / sides) + 0.05;
      const apothem = radius * Math.cos(Math.PI / sides);
      for (let r = 0; r < rings; r++) {
        for (let s = 0; s < sides; s++) {
          const angle = (s / sides) * Math.PI * 2;
          const parts = [
            shade(box([panelW, ringH, 0.35], '#D9D6CC'), 0.95 + rand() * 0.08),
            box([panelW, 0.18, 0.42], '#BFBCB2', [0, ringH / 2 - 0.09, 0]),
          ];
          if (s === 0) {
            parts.push(box([0.08, ringH, 0.1], '#3A414B', [-0.3, 0, 0.25]));
            parts.push(box([0.08, ringH, 0.1], '#3A414B', [0.3, 0, 0.25]));
            for (let k = 0; k < 4; k++) {
              parts.push(
                box([0.6, 0.06, 0.06], '#3A414B', [0, -ringH / 2 + (k + 0.5) * (ringH / 4), 0.27]),
              );
            }
          }
          set.add(
            parts,
            [Math.sin(angle) * apothem, ringH * (r + 0.5), Math.cos(angle) * apothem],
            [0, angle, 0],
          );
        }
      }
      const cone = paint(new ConeGeometry(radius + 0.25, radius * 0.8, sides), '#A9A69C');
      place(cone, [0, 0, 0], [0, Math.PI / sides, 0]);
      set.add([cone], [0, ringH * rings + radius * 0.4, 0]);
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#D9D6CC' };
    }

    case 'terrace': {
      // A row of narrow houses sharing side walls, each with its own colours and chimney.
      const units = Math.max(2, Math.round(w / 5.5));
      const unitW = w / units;
      const eave = h * 0.64;
      const wallColours = ['#B98C6A', '#C9A27E', '#A87A5A', '#BE9573'];
      const roofColours = ['#6F4A3A', '#5F6466', '#7A5240', '#4E5A63'];
      const doorColours = ['#2E4A6B', '#6B2E2E', '#2E5B3A'];
      for (let u = 0; u < units; u++) {
        const unit = new PieceSet();
        const colour = wallColours[u % wallColours.length] ?? '#B98C6A';
        const face = {
          colour,
          thickness: 0.3,
          panelWidth: unitW,
          windowRows: 2,
          windowSize: [1.1, 1.1] as const,
          doorPanel: 0,
          doorColour: doorColours[u % doorColours.length] ?? '#2E4A6B',
          rand,
        };
        unit.addAll(wall(unitW, eave, face), [0, 0, d / 2 - 0.15], 0);
        unit.addAll(wall(unitW, eave, { ...face, doorPanel: -1 }), [0, 0, -d / 2 + 0.15], Math.PI);
        // Only the two end houses have exposed side walls.
        if (u === 0 || u === units - 1) {
          const side = u === 0 ? -1 : 1;
          unit.addAll(
            wall(d - 0.6, eave, { ...face, panelWidth: 3.2, windowRows: 0, doorPanel: -1 }),
            [side * (unitW / 2 - 0.15), 0, 0],
            side * (Math.PI / 2),
          );
        }
        unit.addAll(
          gableRoof(unitW, d, eave, h, {
            colour: roofColours[u % roofColours.length] ?? '#6F4A3A',
            overhang: 0.3,
            segmentWidth: unitW + 0.6,
            gableColour: colour,
          }),
          [0, 0, 0],
          0,
        );
        unit.add([box([0.7, 1.6, 0.7], '#8F5A44')], [unitW * 0.3, h - 0.2, 0]);
        set.addAll(unit, [-w / 2 + unitW * (u + 0.5), 0, 0], 0);
      }
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#B98C6A' };
    }

    case 'shop': {
      // A brick corner shop with flats above, a striped awning and a fascia sign.
      const eave = h * 0.82;
      set.addAll(
        walls(w, d, eave, {
          colour: '#9C5A44',
          thickness: 0.35,
          panelWidth: 3,
          windowRows: 2,
          windowSize: [1.3, 1.2],
          doorPanel: 0,
          doorColour: '#2E4A6B',
          trim: '#EDE6D6',
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(flatRoof(w, d, eave, '#4E4A48', 3), [0, 0, 0], 0);
      const stripes = Math.max(2, Math.round(w / 1.2));
      const stripeW = w / stripes;
      for (let k = 0; k < stripes; k++) {
        set.add(
          [box([stripeW, 0.12, 1.4], k % 2 === 0 ? '#2E7D5B' : '#EDE6D6')],
          [-w / 2 + stripeW * (k + 0.5), 3.1, d / 2 + 0.6],
          [0.35, 0, 0],
        );
      }
      set.add(
        [box([w * 0.7, 0.6, 0.15], '#1F3A5F'), box([w * 0.6, 0.3, 0.17], '#FFD23F')],
        [0, 3.8, d / 2 + 0.1],
      );
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#9C5A44' };
    }

    case 'signal-box': {
      // A concrete base, a glazed operating room on top and a slate roof.
      const base = h * 0.45;
      const room = h * 0.35;
      set.addAll(
        walls(w, d, base, {
          colour: '#A8A49A',
          thickness: 0.5,
          panelWidth: 2.4,
          windowRows: 0,
          doorPanel: 0,
          doorColour: '#3A414B',
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(
        walls(w, d, room, {
          colour: '#C8C4B8',
          thickness: 0.3,
          panelWidth: 2.2,
          windowRows: 1,
          windowSize: [1.6, 1.4],
          doorPanel: -1,
          trim: '#5E3822',
          rand,
        }),
        [0, base, 0],
        0,
      );
      set.addAll(
        gableRoof(w, d, base + room, h, {
          colour: '#4E5458',
          overhang: 0.5,
          segmentWidth: 2.4,
          gableColour: '#C8C4B8',
        }),
        [0, 0, 0],
        0,
      );
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#A8A49A' };
    }

    case 'warehouse': {
      const eave = h * 0.72;
      set.addAll(
        walls(w, d, eave, {
          colour: '#8A4E3C',
          thickness: 0.35,
          panelWidth: 4,
          windowRows: 1,
          windowSize: [1.6, 0.9],
          doorPanel: Math.floor(Math.max(1, Math.round(w / 4)) / 2),
          doorSize: [4, 4.2],
          doorColour: '#4E5A63',
          trim: '#C9BFA8',
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(
        gableRoof(w, d, eave, h, {
          colour: '#7F8A93',
          overhang: 0.4,
          segmentWidth: 4,
          gableColour: '#8A4E3C',
          thickness: 0.18,
        }),
        [0, 0, 0],
        0,
      );
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#8A4E3C' };
    }

    case 'station': {
      // A small station building with a platform canopy on posts along the front.
      const eave = h * 0.6;
      set.addAll(
        walls(w, d, eave, {
          colour: '#C9B48A',
          thickness: 0.35,
          panelWidth: 3.2,
          windowRows: 1,
          doorPanel: 1,
          trim: '#6B2E2E',
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(
        gableRoof(w, d, eave, h, {
          colour: '#5F6466',
          overhang: 0.6,
          segmentWidth: 3.4,
          gableColour: '#C9B48A',
        }),
        [0, 0, 0],
        0,
      );
      for (let k = 0; k <= 4; k++) {
        set.add([box([0.2, 3.4, 0.2], '#3A414B')], [-w / 2 + (w * k) / 4, 1.7, d / 2 + 3]);
      }
      set.add([box([w + 1, 0.2, 4], '#6F7476')], [0, 3.5, d / 2 + 2]);
      return { pieces: set.pieces, foundation: foundation(w, d + 4), debrisColour: '#C9B48A' };
    }

    case 'cabin': {
      // A site cabin: a ribbed steel box on blocks, with windows and a door.
      const colour = rand() > 0.5 ? '#D9DCE0' : '#3E6C8F';
      set.addAll(
        walls(w, d, h - 0.6, {
          colour,
          thickness: 0.15,
          panelWidth: 2.2,
          windowRows: 1,
          windowSize: [1.0, 0.7],
          doorPanel: 0,
          doorColour: '#2B3038',
          trim: '#8E95A0',
          rand,
        }),
        [0, 0.3, 0],
        0,
      );
      set.addAll(flatRoof(w, d, h - 0.3, '#8E95A0', 2.2), [0, 0, 0], 0);
      for (const x of [-w / 2 + 0.4, w / 2 - 0.4]) {
        set.add([box([0.5, 0.3, d - 0.4], '#5E5A54')], [x, 0.15, 0]);
      }
      return { pieces: set.pieces, foundation: null, debrisColour: colour };
    }

    case 'gantry': {
      // A conveyor on steel trestles, rising gently along its length, low enough to hit
      // from a jump, with a belt and a side rail.
      const slope = Math.atan2(h * 0.28, w);
      const legs = Math.max(2, Math.round(w / 6));
      for (let k = 0; k < legs; k++) {
        const x = -w / 2 + 1 + ((w - 2) * k) / (legs - 1);
        const legH = h * (0.42 + 0.28 * (k / (legs - 1)));
        set.add(
          [
            box([0.35, legH, 0.35], '#3A414B', [0, 0, -d / 2 + 0.25]),
            box([0.35, legH, 0.35], '#3A414B', [0, 0, d / 2 - 0.25]),
            box([0.2, 0.2, d], '#FFC21A'),
          ],
          [x, legH / 2, 0],
        );
      }
      const segments = Math.max(2, Math.round(w / 4));
      const segW = w / segments / Math.cos(slope);
      for (let k = 0; k < segments; k++) {
        const x = -w / 2 + (w / segments) * (k + 0.5);
        const y = h * (0.42 + 0.28 * ((k + 0.5) / segments)) + 0.3;
        set.add(
          [
            box([segW, 0.5, d], '#6E7177'),
            box([segW, 0.1, d - 0.6], '#2B3038', [0, 0.3, 0]),
            box([segW, 0.6, 0.08], '#FFC21A', [0, 0.55, d / 2 - 0.04]),
          ],
          [x, y, 0],
          [0, 0, slope],
        );
      }
      return { pieces: set.pieces, foundation: null, debrisColour: '#6E7177' };
    }

    case 'hangar': {
      // Low walls under an arched roof of curved segments, with big doors at the front.
      const wallH = h * 0.4;
      set.addAll(
        walls(w, d, wallH, {
          colour: '#7F8A93',
          thickness: 0.3,
          panelWidth: 4,
          windowRows: 0,
          doorPanel: -1,
          rand,
        }),
        [0, 0, 0],
        0,
      );
      const arcs = 6;
      const rise = h - wallH;
      const bays = Math.max(1, Math.round(w / 5));
      for (let k = 0; k < arcs; k++) {
        const a0 = Math.PI - (Math.PI * k) / arcs;
        const a1 = Math.PI - (Math.PI * (k + 1)) / arcs;
        const z0 = (Math.cos(a0) * d) / 2;
        const z1 = (Math.cos(a1) * d) / 2;
        const y0 = wallH + Math.sin(a0) * rise;
        const y1 = wallH + Math.sin(a1) * rise;
        const length = Math.hypot(z1 - z0, y1 - y0);
        const tilt = Math.atan2(y1 - y0, z1 - z0);
        for (let j = 0; j < bays; j++) {
          set.add(
            [box([w / bays - 0.02, 0.22, length + 0.05], k % 2 === 0 ? '#9AA3AD' : '#8E97A1')],
            [-w / 2 + (w / bays) * (j + 0.5), (y0 + y1) / 2, (z0 + z1) / 2],
            [-tilt, 0, 0],
          );
        }
      }
      set.add([box([w * 0.7, wallH * 0.95, 0.2], '#C9A227')], [0, wallH * 0.48, d / 2 + 0.1]);
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#9AA3AD' };
    }

    case 'crusher': {
      // A heavy concrete block with a steel hopper on top and a discharge chute.
      const base = h * 0.65;
      set.addAll(
        walls(w, d, base, {
          colour: '#9E9A90',
          thickness: 0.8,
          panelWidth: 3,
          windowRows: 0,
          doorPanel: -1,
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(flatRoof(w, d, base, '#8A867C', 3), [0, 0, 0], 0);
      set.add(
        [
          box([w * 0.7, h * 0.3, d * 0.7], '#C9A227'),
          box([w * 0.5, 0.4, d * 0.5], '#2B3038', [0, h * 0.16, 0]),
        ],
        [0, h * 0.82, 0],
      );
      set.add([box([1.4, 0.4, 3], '#5D6470')], [w * 0.2, h * 0.35, d / 2 + 1.2], [0.5, 0, 0]);
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#9E9A90' };
    }

    case 'chimney': {
      // A tall chimney in tapering courses, with a sooty band near the top.
      const courses = Math.max(3, Math.round(h / 4));
      const courseH = h / courses;
      for (let c = 0; c < courses; c++) {
        const width = w * (1 - 0.35 * (c / courses));
        const colour = c === courses - 1 ? '#3A3836' : '#A8988A';
        set.add(
          [
            shade(box([width, courseH, width], colour), 0.95 + rand() * 0.08),
            box([width + 0.1, 0.15, width + 0.1], '#8E7F72', [0, courseH / 2 - 0.08, 0]),
          ],
          [0, courseH * (c + 0.5), 0],
        );
      }
      return { pieces: set.pieces, foundation: foundation(w, d), debrisColour: '#A8988A' };
    }

    case 'hut': {
      set.addAll(
        walls(w, d, h * 0.7, {
          colour: rand() > 0.5 ? '#9A7A55' : '#7F8A6A',
          thickness: 0.15,
          panelWidth: 2,
          windowRows: 1,
          windowSize: [0.7, 0.6],
          doorPanel: 0,
          rand,
        }),
        [0, 0, 0],
        0,
      );
      set.addAll(
        gableRoof(w, d, h * 0.7, h, {
          colour: '#6E7177',
          overhang: 0.25,
          segmentWidth: 2.5,
          gableColour: '#856745',
          thickness: 0.12,
        }),
        [0, 0, 0],
        0,
      );
      return { pieces: set.pieces, foundation: null, debrisColour: '#9A7A55' };
    }

    case 'container': {
      // A shipping container in three sections, with corrugation ribs.
      const colour =
        ['#B4553E', '#3E6C8F', '#2E7D5B', '#C9A227'][Math.floor(rand() * 4)] ?? '#B4553E';
      const sectionW = w / 3;
      for (let k = 0; k < 3; k++) {
        const parts = [box([sectionW, h, d], colour)];
        for (let r = 0; r < Math.floor(sectionW / 0.6); r++) {
          const x = -sectionW / 2 + 0.3 + r * 0.6;
          parts.push(shade(box([0.08, h - 0.2, d + 0.04], colour, [x, 0, 0]), 0.85));
        }
        set.add(parts, [-w / 2 + sectionW * (k + 0.5), h / 2, 0]);
      }
      return { pieces: set.pieces, foundation: null, debrisColour: colour };
    }

    case 'fence': {
      const bays = Math.max(1, Math.round(w / 2.5));
      const bay = w / bays;
      for (let i = 0; i < bays; i++) {
        const x = -w / 2 + bay * (i + 0.5);
        set.add(
          [
            box([0.16, h, 0.16], '#8A7458', [-bay / 2 + 0.08, 0, 0]),
            box([bay, 0.12, 0.07], '#A08A6A', [0, h * 0.25, 0]),
            box([bay, 0.12, 0.07], '#A08A6A', [0, -h * 0.15, 0]),
          ],
          [x, h / 2, 0],
        );
      }
      return { pieces: set.pieces, foundation: null, debrisColour: '#A08A6A' };
    }
  }
}
