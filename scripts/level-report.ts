/**
 * Prints when the Hauler reaches each obstacle of a level and compares it with the brief's
 * target distances (`targets` in the level file). With `--fix`, slides each obstacle along
 * the route until its arrival matches the target, and saves the level.
 *
 * Usage: node scripts/level-report.ts hollow-creek [--fix]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweepRoute, type SweepTarget } from '../src/game/hauler/route-sweep.ts';
import { type Point2, Route } from '../src/game/route.ts';

interface BuildingEntry {
  id: string;
  pos: [number, number];
  size: [number, number, number];
  yaw?: number;
  group?: string;
}

interface LevelFile {
  hauler: { speed: number; leadIn: number; route: Point2[] };
  buildings?: BuildingEntry[];
  targets?: Record<string, number>;
}

const [id, flag] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node scripts/level-report.ts <level-id> [--fix]');
  process.exit(1);
}
const path = join(import.meta.dirname, '..', 'levels', `${id}.json`);
const level = JSON.parse(readFileSync(path, 'utf8')) as LevelFile;
const route = new Route(level.hauler.route);
const speed = level.hauler.speed;

const toTargets = (buildings: BuildingEntry[]): SweepTarget[] =>
  buildings.map((b) => ({
    id: b.id,
    group: b.group ?? b.id,
    footprint: {
      x: b.pos[0],
      z: b.pos[1],
      halfX: b.size[0] / 2,
      halfZ: b.size[2] / 2,
      yaw: ((b.yaw ?? 0) * Math.PI) / 180,
    },
  }));

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

if (flag === '--fix') {
  // Each pass moves every obstacle by its error; three passes settle the curves.
  for (let pass = 0; pass < 4; pass++) {
    const obstacles = sweepRoute(route, toTargets(level.buildings ?? []));
    for (const obstacle of obstacles) {
      const target = level.targets?.[obstacle.id];
      if (target === undefined) continue;
      const error = target - obstacle.distance;
      for (const member of level.buildings ?? []) {
        if ((member.group ?? member.id) !== obstacle.id) continue;
        const { along } = route.project(member.pos[0], member.pos[1]);
        const here = route.sampleAt(along);
        const there = route.sampleAt(along + error);
        member.pos = [
          Math.round((member.pos[0] + there.x - here.x) * 10) / 10,
          Math.round((member.pos[1] + there.z - here.z) * 10) / 10,
        ];
        const turn = Math.atan2(there.dx, there.dz) - Math.atan2(here.dx, here.dz);
        member.yaw = Math.round((member.yaw ?? 0) + (turn * 180) / Math.PI);
      }
    }
  }
  writeFileSync(path, `${JSON.stringify(level, null, 2)}\n`);
}

console.log(
  `${id}: route ${route.length.toFixed(0)} m at ${speed} m/s, lead-in ${level.hauler.leadIn} s`,
);
console.log('obstacle          distance  arrives   target    error');
for (const obstacle of sweepRoute(route, toTargets(level.buildings ?? []))) {
  const target = level.targets?.[obstacle.id];
  const arrival = obstacle.distance / speed;
  const targetText = target === undefined ? '—' : clock(target / speed);
  const errorText =
    target === undefined ? '' : `${(((obstacle.distance - target) / target) * 100).toFixed(1)}%`;
  console.log(
    `${obstacle.id.padEnd(16)} ${obstacle.distance.toFixed(1).padStart(7)} m  ${clock(arrival).padStart(6)}  ${targetText.padStart(6)}  ${errorText.padStart(7)}`,
  );
}
