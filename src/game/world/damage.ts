import type { Vec2 } from '../math';

/*
 * The damage rules. A building's hit points grow with its volume, and a vehicle's ram deals
 * damage by its share of its top speed. The numbers are tuned so that a solid ram, at three
 * quarters of the top speed, breaks a house with any vehicle, and so that no building needs more
 * than a few rams at full speed.
 */

/** Volume of the reference house in cubic metres: 100 m² of floor and 8 m of height. */
export const HOUSE_VOLUME = 800;
/** Hit points of the reference house. */
export const HOUSE_HP = 100;
/** Hit points grow with the volume to this power, so that a large building is not a wall. */
const HP_EXPONENT = 0.6;
/** Every piece and every tower has at least and at most these hit points. */
export const MIN_HP = 30;
export const MAX_HP = 1200;

/** Returns the hit points of a building piece or a tower of a volume in cubic metres. */
export function hitPoints(volume: number): number {
  const hp = HOUSE_HP * Math.max(0, volume / HOUSE_VOLUME) ** HP_EXPONENT;
  return Math.min(MAX_HP, Math.max(MIN_HP, hp));
}

/** Impacts slower than this deal no damage, so scraping along a wall does nothing. */
export const MIN_IMPACT_SPEED = 4;
/** A ram faster than the top speed, for example in a slide downhill, deals at most this much more. */
const MAX_SPEED_SHARE = 1.2;

/**
 * Returns the damage of a ram.
 *
 * @param ram Damage of the vehicle's ram at its top speed.
 * @param speed Speed at which the vehicle hit, in m/s.
 * @param topSpeed The vehicle's top speed in m/s.
 */
export function ramDamage(ram: number, speed: number, topSpeed: number): number {
  if (speed < MIN_IMPACT_SPEED) {
    return 0;
  }
  return ram * Math.min(MAX_SPEED_SHARE, speed / topSpeed) ** 2;
}

/** A fallen piece weakens each neighbour by this share of the neighbour's hit points. */
export const COLLAPSE_FRACTION = 0.25;
/** The damage that a falling piece did not need carries on along the ram by this share. */
export const CARRY_FRACTION = 0.85;
/** The next piece along the ram lies within this angle of the ram's direction: cos 50°. */
const CARRY_COSINE = 0.64;

/** Damage of a TNT explosion at its centre. It falls off linearly to zero at the radius. */
export const TNT_DAMAGE = 3000;
/** Radius of a TNT explosion in metres. */
export const TNT_RADIUS = 22;
/** Seconds between the first push of a TNT crate and its explosion. */
export const TNT_FUSE_SECONDS = 10;

/** Damage and radius of the small explosion of a fuel tank. */
export const TANK_BLAST_DAMAGE = 450;
export const TANK_BLAST_RADIUS = 13;

/** Damage of an explosion at a distance from its centre. */
export function blastDamage(peak: number, radius: number, distance: number): number {
  return distance >= radius ? 0 : peak * (1 - distance / radius);
}

/** The parts of a building that the spread of damage needs. */
export interface PieceGraph {
  /** Full hit points of every piece. */
  maxHp: readonly number[];
  /** For each piece, the pieces that touch it. */
  neighbours: readonly (readonly number[])[];
  /** Centre of every piece on the ground plane. */
  centers: readonly Vec2[];
}

/**
 * Applies damage to one piece of a building and lets the collapse spread.
 *
 * When a piece falls, the damage that it did not need carries on to the next piece along the
 * direction of the ram, so that a fast ram punches through several pieces in a line. Every
 * neighbour of a fallen piece also loses a share of its hit points, which can bring it down too.
 *
 * @param hp Current hit points of every piece. The function updates them in place.
 * @param direction Direction of the ram on the ground plane, or undefined for a blast.
 * @returns The indices of the pieces that fell, in the order in which they fell.
 */
export function applyPieceDamage(
  hp: number[],
  graph: PieceGraph,
  index: number,
  damage: number,
  direction?: Vec2,
): number[] {
  const fallen: number[] = [];
  const queue: { index: number; damage: number; carry: boolean }[] = [
    { index, damage, carry: direction !== undefined },
  ];
  while (queue.length > 0) {
    const hit = queue.shift();
    if (!hit || hp[hit.index] <= 0 || hit.damage <= 0) {
      continue;
    }
    const before = hp[hit.index];
    hp[hit.index] = Math.max(0, before - hit.damage);
    if (hp[hit.index] > 0) {
      continue;
    }
    fallen.push(hit.index);
    const excess = hit.damage - before;
    const next = hit.carry && direction ? nextAlong(graph, hp, hit.index, direction) : undefined;
    if (next !== undefined && excess > 0) {
      queue.push({ index: next, damage: excess * CARRY_FRACTION, carry: true });
    }
    for (const neighbour of graph.neighbours[hit.index]) {
      queue.push({
        index: neighbour,
        damage: graph.maxHp[neighbour] * COLLAPSE_FRACTION,
        carry: false,
      });
    }
  }
  return fallen;
}

/** Returns the standing neighbour that lies most nearly along a direction, if any. */
function nextAlong(
  graph: PieceGraph,
  hp: readonly number[],
  index: number,
  direction: Vec2,
): number | undefined {
  const length = Math.hypot(direction[0], direction[1]);
  if (length < 1e-6) {
    return undefined;
  }
  const [dx, dz] = [direction[0] / length, direction[1] / length];
  const from = graph.centers[index];
  let best: number | undefined;
  let bestCosine = CARRY_COSINE;
  for (const neighbour of graph.neighbours[index]) {
    if (hp[neighbour] <= 0) {
      continue;
    }
    const to = graph.centers[neighbour];
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const cosine = ((to[0] - from[0]) * dx + (to[1] - from[1]) * dz) / Math.max(distance, 1e-6);
    if (cosine > bestCosine) {
      bestCosine = cosine;
      best = neighbour;
    }
  }
  return best;
}
