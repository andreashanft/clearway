/**
 * Rapier collision groups. Each collider has a 16-bit membership mask and a 16-bit filter
 * mask; two colliders interact only when each one's membership is in the other's filter.
 */
export const GROUP = {
  ground: 1 << 0,
  vehicle: 1 << 1,
  building: 1 << 2,
  chunk: 1 << 3,
  tnt: 1 << 4,
  hauler: 1 << 5,
  pilot: 1 << 6,
  sensor: 1 << 7,
} as const;

export const ALL_GROUPS = 0xffff;

/** Packs membership and filter masks into Rapier's 32-bit interaction groups. */
export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Interaction groups for each kind of collider in the game. */
export const COLLISION = {
  ground: interactionGroups(GROUP.ground, ALL_GROUPS),
  vehicle: interactionGroups(
    GROUP.vehicle,
    GROUP.ground | GROUP.vehicle | GROUP.building | GROUP.tnt | GROUP.hauler,
  ),
  building: interactionGroups(
    GROUP.building,
    GROUP.vehicle | GROUP.chunk | GROUP.tnt | GROUP.pilot | GROUP.hauler,
  ),
  // Flying chunks only land on the ground, standing buildings and each other: they never
  // block the Hauler, a vehicle, the pilot or a crate.
  chunk: interactionGroups(GROUP.chunk, GROUP.ground | GROUP.chunk | GROUP.building),
  tnt: interactionGroups(
    GROUP.tnt,
    GROUP.ground | GROUP.vehicle | GROUP.building | GROUP.tnt | GROUP.hauler,
  ),
} as const;

/** What a vehicle's wheel rays may stand on: the ground, buildings (roofs) and TNT. */
export const WHEEL_RAY_GROUPS = interactionGroups(
  ALL_GROUPS,
  GROUP.ground | GROUP.building | GROUP.tnt,
);
