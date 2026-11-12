/**
 * Prints when the Hauler reaches each obstacle of each level, next to the time that the design
 * brief expects. Use it to tune a level: move the start point, the heading, the speed or a
 * building until every arrival is within ±10 %.
 *
 * Run it with `npm run report:route`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import type { LevelData } from '../src/game/level';
import { createRoute, findObstacles } from '../src/game/route';
import { formatTime } from '../src/game/scoring';

const levelsDir = new URL('../levels/', import.meta.url);
const files = readdirSync(levelsDir).filter(
  (name) => name.endsWith('.json') && !name.endsWith('.terrain.json'),
);
const levels = files
  .map((name) => JSON.parse(readFileSync(new URL(name, levelsDir), 'utf8')) as LevelData)
  .sort((a, b) => a.index - b.index);

for (const level of levels) {
  const route = createRoute(level.hauler);
  const obstacles = findObstacles(route, level.buildings);
  const total = level.hauler.length / level.hauler.speed;
  console.log(
    `\n${level.index}. ${level.name}: ${level.hauler.length} m at ${level.hauler.speed} m/s = ${formatTime(total)}`,
  );
  console.log('  distance  arrives  expected  off     segments  obstacle');
  for (const obstacle of obstacles) {
    const seconds = obstacle.distance / level.hauler.speed;
    const expected = level.expected.arrivals.find((arrival) => arrival.obstacle === obstacle.id);
    const off = expected
      ? `${(((seconds - expected.seconds) / expected.seconds) * 100).toFixed(1)} %`
      : 'not expected';
    console.log(
      `  ${obstacle.distance.toFixed(0).padStart(5)} m  ${formatTime(seconds).padStart(7)}  ${(expected ? formatTime(expected.seconds) : '-').padStart(8)}  ${off.padEnd(7)} ${String(obstacle.segments.length).padStart(8)}  ${obstacle.id}`,
    );
  }
  for (const arrival of level.expected.arrivals) {
    if (!arrival.gap && !obstacles.some((obstacle) => obstacle.id === arrival.obstacle)) {
      console.log(`  MISSING: the line does not touch "${arrival.obstacle}".`);
    }
  }
}
