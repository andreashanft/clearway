import type { OrientedBox, Vec2 } from '../math';
import {
  centroid,
  cleanPolygon,
  clipPolygon,
  minimumRectangle,
  onOutline,
  polygonArea,
} from '../polygon';

/** A building is cut into pieces of about this edge length, in metres. */
export const PIECE_SIZE = 10;
/** A building has at most this many pieces. A larger building gets larger pieces. */
export const MAX_PIECES = 64;
/** A clipped piece smaller than this, in square metres, is dropped. */
const MIN_PIECE_AREA = 1;
/** A footprint that fills this share of its enclosing rectangle counts as rectangular. */
const RECTANGULAR_SHARE = 0.9;

/** One piece of a building's footprint. */
export interface Piece {
  /** Corners on the ground plane, anticlockwise. */
  polygon: Vec2[];
  center: Vec2;
  /** Area in square metres. */
  area: number;
  /** One flag per edge, from corner `i` to corner `i + 1`: true when the edge is an outer wall. */
  outer: boolean[];
  /**
   * One flag per edge: true when the edge has no width because it joins two separate parts of the
   * piece along a cut. Such an edge gets no wall.
   */
  bridge: boolean[];
  /** True when the piece is convex, so that one convex collider fits it. */
  convex: boolean;
}

/** A building footprint and the pieces that it is cut into. */
export interface BuildingShape {
  /** The cleaned footprint, anticlockwise. */
  outline: Vec2[];
  center: Vec2;
  /** Area in square metres. */
  area: number;
  /** The smallest rectangle around the footprint. Its first half extent is the longer one. */
  rect: OrientedBox;
  /** True when the footprint nearly fills its rectangle. */
  rectangular: boolean;
  pieces: Piece[];
  /** For each piece, the indices of the pieces that touch it. */
  neighbours: number[][];
}

/**
 * Cuts a footprint into pieces on a grid that runs along the footprint's enclosing rectangle.
 *
 * A small building stays one piece. A long building becomes a row of pieces, and a large block a
 * grid of them, so that a vehicle can carve a way through it.
 */
export function cutFootprint(footprint: readonly Vec2[], pieceSize = PIECE_SIZE): BuildingShape {
  const outline = cleanPolygon(footprint);
  const area = polygonArea(outline);
  const rect = minimumRectangle(outline);
  const [halfLength, halfWidth] = rect.half;

  let size = pieceSize;
  let columns = Math.max(1, Math.round((halfLength * 2) / size));
  let rows = Math.max(1, Math.round((halfWidth * 2) / size));
  while (columns * rows > MAX_PIECES) {
    size *= 1.15;
    columns = Math.max(1, Math.round((halfLength * 2) / size));
    rows = Math.max(1, Math.round((halfWidth * 2) / size));
  }

  const along: Vec2 = [Math.cos(rect.heading), Math.sin(rect.heading)];
  const across: Vec2 = [-along[1], along[0]];
  const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
  const centerAlong = dot(along, rect.center);
  const centerAcross = dot(across, rect.center);
  const columnLength = (halfLength * 2) / columns;
  const rowWidth = (halfWidth * 2) / rows;

  const pieces: Piece[] = [];
  const grid = new Map<string, number>();
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const u0 = centerAlong - halfLength + column * columnLength;
      const v0 = centerAcross - halfWidth + row * rowWidth;
      // The outermost cuts run a little outside the rectangle, so that rounding never trims a wall.
      const u1 = column === columns - 1 ? u0 + columnLength + 1 : u0 + columnLength;
      const v1 = row === rows - 1 ? v0 + rowWidth + 1 : v0 + rowWidth;
      const lowU = column === 0 ? u0 - 1 : u0;
      const lowV = row === 0 ? v0 - 1 : v0;
      let polygon: Vec2[] = outline;
      polygon = clipPolygon(polygon, along, u1);
      polygon = clipPolygon(polygon, [-along[0], -along[1]], -lowU);
      polygon = clipPolygon(polygon, across, v1);
      polygon = clipPolygon(polygon, [-across[0], -across[1]], -lowV);
      if (polygon.length < 3) {
        continue;
      }
      polygon = cleanPolygon(polygon);
      const pieceArea = polygonArea(polygon);
      if (polygon.length < 3 || pieceArea < MIN_PIECE_AREA) {
        continue;
      }
      const outer = polygon.map((corner, i) => {
        const next = polygon[(i + 1) % polygon.length];
        return onOutline([(corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2], outline);
      });
      grid.set(`${column},${row}`, pieces.length);
      pieces.push({
        polygon,
        center: centroid(polygon),
        area: pieceArea,
        outer,
        bridge: polygon.map((_, i) => isBridge(polygon, i)),
        convex: isConvex(polygon),
      });
    }
  }

  const neighbours: number[][] = pieces.map(() => []);
  for (const [key, index] of grid) {
    const [column, row] = key.split(',').map(Number);
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
    ]) {
      const other = grid.get(`${column + dc},${row + dr}`);
      if (other !== undefined && touch(pieces[index].polygon, pieces[other].polygon)) {
        neighbours[index].push(other);
        neighbours[other].push(index);
      }
    }
  }

  return {
    outline,
    center: centroid(outline),
    area,
    rect,
    rectangular: area >= RECTANGULAR_SHARE * 4 * halfLength * halfWidth,
    pieces,
    neighbours,
  };
}

/**
 * True when edge `i` lies on top of another edge of the same polygon. Clipping a concave footprint
 * joins its separate parts with such edges of no width.
 */
function isBridge(polygon: readonly Vec2[], i: number): boolean {
  const a = polygon[i];
  const b = polygon[(i + 1) % polygon.length];
  const middle: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (let j = 0; j < polygon.length; j += 1) {
    if (j === i) {
      continue;
    }
    const other = [polygon[j], polygon[(j + 1) % polygon.length]];
    if (onOutline(middle, other, 0.01)) {
      return true;
    }
  }
  return false;
}

/** True when every corner of an anticlockwise polygon turns the same way. */
function isConvex(polygon: readonly Vec2[]): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const c = polygon[(i + 2) % polygon.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross < -1e-6) {
      return false;
    }
  }
  return true;
}

/** True when two pieces share a stretch of a cut. A concave footprint can leave a gap. */
function touch(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  return a.some((p) => onOutline(p, b, 0.05)) || b.some((p) => onOutline(p, a, 0.05));
}
