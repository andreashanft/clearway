import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sweepRoute } from '../src/game/hauler/route-sweep';
import type { LevelDefinition } from '../src/game/level-data';
import { Route } from '../src/game/route';
import { footprintOf } from '../src/game/world/footprint';

const LEVELS = join(import.meta.dirname, '..', 'levels');
const levels = readdirSync(LEVELS)
  .filter((f) => /^[a-z-]+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(LEVELS, f), 'utf8')) as LevelDefinition);

describe.each(levels)('$name', (level) => {
  const route = new Route(level.hauler.route);
  const obstacles = sweepRoute(
    route,
    (level.buildings ?? []).map((b) => ({
      id: b.id,
      group: b.group ?? b.id,
      footprint: footprintOf(b),
    })),
  );

  it('meets every target obstacle, in order, within ±10% of the brief', () => {
    const targets = Object.entries(level.targets ?? {});
    expect(targets.length).toBeGreaterThan(0);
    for (const [id, distance] of targets) {
      const obstacle = obstacles.find((o) => o.id === id);
      expect(obstacle, `${id} is on the route`).toBeDefined();
      expect(Math.abs((obstacle?.distance ?? 0) - distance) / distance).toBeLessThanOrEqual(0.1);
    }
    const order = obstacles.map((o) => o.id).filter((id) => id in (level.targets ?? {}));
    const expected = targets.sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(order).toEqual(expected);
  });

  it('has no obstacles beyond the brief’s list', () => {
    for (const obstacle of obstacles) expect(level.targets ?? {}).toHaveProperty(obstacle.id);
  });
});
