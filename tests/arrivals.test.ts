import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../src/game/campaign';
import { HAULER, sweepRoute } from '../src/game/hauler/route-sweep';
import type { LevelDefinition } from '../src/game/level-data';
import { Route } from '../src/game/route';
import { footprintOf } from '../src/game/world/footprint';
import { beaconPositions } from '../src/game/world/pickups';

const LEVELS = join(import.meta.dirname, '..', 'levels');
const levels = readdirSync(LEVELS)
  .filter((f) => /^[a-z-]+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(LEVELS, f), 'utf8')) as LevelDefinition);

/** Beacons per level, from the design brief's secrets. */
const BEACONS: Readonly<Record<string, number>> = {
  'hollow-creek': 30,
  'ferrow-junction': 40,
  'cinder-quarry': 50,
};

describe.each(levels)('$name', (level) => {
  const route = new Route(level.hauler.route);
  const swept = sweepRoute(
    route,
    (level.buildings ?? []).map((b) => ({
      id: b.id,
      group: b.group ?? b.id,
      footprint: footprintOf(b),
    })),
  );

  const gap = level.routeGap;
  const obstacles = gap
    ? [...swept, { id: gap.id, memberIds: [], distance: gap.from }].sort(
        (a, b) => a.distance - b.distance,
      )
    : swept;

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

  it('matches the campaign’s route length and Hauler time', () => {
    const entry = CAMPAIGN.find((c) => c.id === level.id);
    expect(entry).toBeDefined();
    expect(route.length).toBeCloseTo(entry?.routeLength ?? 0, 0);
    expect(route.length / level.hauler.speed).toBeCloseTo(entry?.routeSeconds ?? 0, 0);
  });

  it('keeps vehicles and TNT out of the Hauler’s path', () => {
    // A parked vehicle or crate on the route would stop the Hauler before the player acts.
    const clearance = HAULER.width / 2 + HAULER.sensorMargin + 2.5;
    const things = [...level.vehicles.map((v) => v.pos), ...(level.tnt ?? []).map((t) => t.pos)];
    for (const [x, z] of things) {
      expect(Math.abs(route.project(x, z).offset), `${x}, ${z}`).toBeGreaterThan(clearance);
    }
  });

  it('parks each locked vehicle inside the building that frees it', () => {
    for (const vehicle of level.vehicles.filter((v) => v.lockedBy)) {
      const building = level.buildings?.find((b) => b.id === vehicle.lockedBy);
      expect(building).toBeDefined();
      if (!building) continue;
      const f = footprintOf(building);
      const dx = vehicle.pos[0] - f.x;
      const dz = vehicle.pos[1] - f.z;
      const lx = dx * Math.cos(f.yaw) - dz * Math.sin(f.yaw);
      const lz = dx * Math.sin(f.yaw) + dz * Math.cos(f.yaw);
      expect(Math.abs(lx)).toBeLessThan(f.halfX - 2);
      expect(Math.abs(lz)).toBeLessThan(f.halfZ - 2);
    }
  });

  it('has the brief’s beacons and a relay dish, clear of every building', () => {
    const beacons = (level.beacons?.trails ?? []).flatMap((t) => beaconPositions(t));
    expect(beacons.length).toBe(BEACONS[level.id]);
    expect(level.relayDish).toBeDefined();
    for (const [x, z] of beacons) {
      for (const b of level.buildings ?? []) {
        const f = footprintOf(b);
        const dx = x - f.x;
        const dz = z - f.z;
        const lx = Math.abs(dx * Math.cos(f.yaw) - dz * Math.sin(f.yaw)) - f.halfX;
        const lz = Math.abs(dx * Math.sin(f.yaw) + dz * Math.cos(f.yaw)) - f.halfZ;
        expect(Math.max(lx, lz), `beacon ${x}, ${z} in ${b.id}`).toBeGreaterThan(1);
      }
    }
  });

  it.runIf(level.rail)('puts the Railbed slot across the route gap', () => {
    const { rail, routeGap } = level;
    if (!rail || !routeGap) throw new Error('A rail line needs a route gap');
    const slot = new Route(rail.points).sampleAt(rail.slot);
    const { along, offset } = route.project(slot.x, slot.z);
    expect(Math.abs(offset)).toBeLessThan(0.5);
    expect(along).toBeGreaterThan(routeGap.from);
    expect(along).toBeLessThan(routeGap.to);
  });
});
