/** Mini-map aspect (width / height), matching its box in the HUD. */
const MAP_ASPECT = 1.45;

/**
 * The area the mini-map shows: everything that matters, with a margin, widened to the
 * mini-map's shape so a straight route along one axis doesn't become a thin strip.
 */
export function mapBounds(points: readonly (readonly [number, number])[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const margin = 40;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x - margin);
    maxX = Math.max(maxX, x + margin);
    minZ = Math.min(minZ, z - margin);
    maxZ = Math.max(maxZ, z + margin);
  }
  const width = maxX - minX;
  const height = maxZ - minZ;
  if (width / height < MAP_ASPECT) {
    const grow = (height * MAP_ASPECT - width) / 2;
    minX -= grow;
    maxX += grow;
  } else {
    const grow = (width / MAP_ASPECT - height) / 2;
    minZ -= grow;
    maxZ += grow;
  }
  return { minX, maxX, minZ, maxZ };
}
