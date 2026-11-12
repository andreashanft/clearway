import type { Strength, VehicleType } from '../level';

/** Hit points of one building segment, by strength. */
export const STRENGTH_HP: Record<Strength, number> = {
  shed: 100,
  house: 250,
  brick: 600,
  concrete: 1500,
};

/**
 * Joules of impact energy that remove one hit point.
 * The value is tuned so that the Bruiser deals 200 damage when it rams at its top speed.
 */
const JOULES_PER_HP = 4350;

/** Impacts slower than this deal no damage, so scraping along a wall does nothing. */
export const MIN_IMPACT_SPEED = 4;

/** A ram charge multiplies the damage of the next hit. */
export const RAM_DAMAGE_FACTOR = 1.8;

/** A destroyed segment weakens each neighbour by this fraction of the neighbour's hit points. */
export const COLLAPSE_FRACTION = 0.5;

/** Damage of a TNT explosion at its centre. It falls off linearly to zero at the radius. */
export const TNT_DAMAGE = 3000;
/** Radius of a TNT explosion in metres. */
export const TNT_RADIUS = 22;
/** Seconds between the first push of a TNT crate and its explosion. */
export const TNT_FUSE_SECONDS = 10;

/** Damage and radius of the small explosion of a fuel tank. */
export const TANK_BLAST_DAMAGE = 450;
export const TANK_BLAST_RADIUS = 13;

export interface ImpactInput {
  /** Mass of the vehicle in kilograms. */
  mass: number;
  /** Speed that the vehicle lost in the impact, in m/s. */
  speed: number;
  /** Damage multiplier of the vehicle type. */
  vehicleFactor: number;
  /** True when a ram charge is armed. */
  ramArmed: boolean;
  /** Extra factor of the vehicle's action, for example chained Tumbler rolls. */
  actionFactor?: number;
}

/**
 * Damage of a vehicle impact: half the mass times the speed squared, scaled to hit points.
 * The model is an arcade one. The houses behave as if they were made of cardboard.
 */
export function impactDamage(input: Readonly<ImpactInput>): number {
  if (input.speed < MIN_IMPACT_SPEED) {
    return 0;
  }
  const energy = 0.5 * input.mass * input.speed * input.speed;
  const ram = input.ramArmed ? RAM_DAMAGE_FACTOR : 1;
  return (energy / JOULES_PER_HP) * input.vehicleFactor * ram * (input.actionFactor ?? 1);
}

/** Returns true when a vehicle type can damage a strength. Only the Tumbler cracks concrete. */
export function canDamage(vehicle: VehicleType, strength: Strength): boolean {
  return strength !== 'concrete' || vehicle === 'tumbler';
}

/** Damage of an explosion at a distance from its centre. */
export function blastDamage(peak: number, radius: number, distance: number): number {
  return distance >= radius ? 0 : peak * (1 - distance / radius);
}

/**
 * Applies damage to one segment of a row of segments and lets the collapse spread.
 *
 * When a segment falls, the damage that it did not need passes on to both neighbours, and each
 * neighbour also loses a fraction of its full hit points. A strong hit on one end of a house can
 * therefore bring the whole house down.
 *
 * @param hp Current hit points of every segment. The function updates them in place.
 * @param maxHp Full hit points of one segment.
 * @returns The indices of the segments that fell, in the order in which they fell.
 */
export function applySegmentDamage(
  hp: number[],
  maxHp: number,
  index: number,
  damage: number,
): number[] {
  const fallen: number[] = [];
  const queue: { index: number; damage: number }[] = [{ index, damage }];
  while (queue.length > 0) {
    const hit = queue.shift();
    if (!hit || hit.index < 0 || hit.index >= hp.length || hp[hit.index] <= 0) {
      continue;
    }
    const before = hp[hit.index];
    hp[hit.index] = Math.max(0, before - hit.damage);
    if (hp[hit.index] > 0) {
      continue;
    }
    fallen.push(hit.index);
    const passedOn = hit.damage - before + maxHp * COLLAPSE_FRACTION;
    queue.push(
      { index: hit.index - 1, damage: passedOn },
      { index: hit.index + 1, damage: passedOn },
    );
  }
  return fallen;
}
