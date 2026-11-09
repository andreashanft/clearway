import type { VehicleType } from './level-data';

export type Strength = 'shed' | 'house' | 'brick' | 'concrete';

/** Hit points per building strength, from the code brief. */
export const STRENGTH_HP: Readonly<Record<Strength, number>> = {
  shed: 100,
  house: 250,
  brick: 600,
  concrete: 1500,
};

/**
 * Impact energy (joules) per hit point. A Bruiser ramming at its 50 km/h top speed deals
 * about 248 damage, and about 135 at the 37 km/h a short run-up gives: a shed falls to one
 * ram, a house to two.
 */
export const JOULES_PER_HP = 3500;
/** Hits slower than this (m/s along the contact normal) do nothing, so scraping is harmless. */
export const MIN_IMPACT_SPEED = 3;
/** HP fraction at which a building shows cracks. */
export const CRACK_THRESHOLD = 0.5;

export type DamageSource =
  { readonly kind: 'vehicle'; readonly vehicle: VehicleType } | { readonly kind: 'explosion' };

/** Damage from a vehicle hit: ½ × mass × speed² × multiplier, scaled to HP. */
export function impactDamage(mass: number, speed: number, multiplier: number): number {
  if (speed < MIN_IMPACT_SPEED || multiplier <= 0) return 0;
  return (0.5 * mass * speed * speed * multiplier) / JOULES_PER_HP;
}

/** Distance within which an explosion deals its full damage. */
export const BLAST_CORE = 2;
/**
 * Concrete takes this much more from explosions, so one TNT crate pushed against it is
 * enough: level 2's concrete signal box has only one crate.
 */
export const CONCRETE_BLAST_FACTOR = 2;

/**
 * Explosion damage at `distance`: full within `BLAST_CORE`, then falling off linearly to
 * zero at `radius`.
 */
export function explosionDamage(distance: number, radius: number, maxDamage: number): number {
  if (distance >= radius) return 0;
  if (distance <= BLAST_CORE) return maxDamage;
  return maxDamage * (1 - (distance - BLAST_CORE) / (radius - BLAST_CORE));
}

/** Multiplier on damage from `source` against a building of `strength`. */
export function damageFactor(strength: Strength, source: DamageSource): number {
  return source.kind === 'explosion' && strength === 'concrete' ? CONCRETE_BLAST_FACTOR : 1;
}

/** Concrete ignores every vehicle except the Tumbler; explosions damage everything. */
export function canDamage(strength: Strength, source: DamageSource): boolean {
  if (source.kind === 'explosion') return true;
  return strength !== 'concrete' || source.vehicle === 'tumbler';
}
