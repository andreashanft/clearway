/**
 * Prints a level's route length and where given route distances fall, to help place
 * obstacles. Usage: `node scripts/route-report.ts hollow-creek 90 150 210`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Route, type Point2 } from '../src/game/route.ts';

const [id, ...distances] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node scripts/route-report.ts <level-id> [distance …]');
  process.exit(1);
}
const level = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'levels', `${id}.json`), 'utf8'),
) as { hauler: { route: Point2[]; speed: number } };
const route = new Route(level.hauler.route);
console.log(
  `${id}: route ${route.length.toFixed(1)} m, ${(route.length / level.hauler.speed).toFixed(1)} s at ${level.hauler.speed} m/s`,
);
for (const d of distances.map(Number)) {
  const s = route.sampleAt(d);
  const bearing = ((Math.atan2(s.dx, -s.dz) * 180) / Math.PI + 360) % 360;
  console.log(
    `${String(d).padStart(5)} m  x ${s.x.toFixed(1).padStart(7)}  z ${s.z.toFixed(1).padStart(7)}  bearing ${bearing.toFixed(0)}°`,
  );
}
