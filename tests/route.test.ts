import { describe, expect, it } from 'vitest';
import type { BuildingData, LevelData } from '../src/game/level';
import {
  HAULER_WIDTH,
  createRoute,
  findObstacles,
  secondsUntil,
  sweepPolygon,
  toRoute,
  urgencyOf,
} from '../src/game/route';

const route = createRoute({ speed: 4, start: [0, 0], heading: 0, length: 400 });

function box(id: string, x: number, z: number, size = 10, group?: string): BuildingData {
  return {
    id,
    name: id,
    kind: 'shed',
    strength: 'shed',
    pos: [x, z],
    size: [size, 4, size],
    yaw: 0,
    colors: { wall: '#ffffff', roof: '#ffffff' },
    group,
  };
}

describe('toRoute', () => {
  it('measures the distance along the line and the offset to the right', () => {
    const diagonal = createRoute({ speed: 3, start: [10, 10], heading: 90, length: 100 });
    const [along, right] = toRoute(diagonal, [7, 30]);
    expect(along).toBeCloseTo(20);
    expect(right).toBeCloseTo(3);
  });
});

describe('sweepPolygon', () => {
  it('returns the stretch on which the strip overlaps a box', () => {
    const range = sweepPolygon(route, [
      [100, -5],
      [110, -5],
      [110, 5],
      [100, 5],
    ]);
    expect(range?.[0]).toBeCloseTo(100);
    expect(range?.[1]).toBeCloseTo(110);
  });

  it('misses a box beside the strip', () => {
    const offset = HAULER_WIDTH / 2 + 1;
    expect(
      sweepPolygon(route, [
        [100, offset],
        [110, offset],
        [110, offset + 10],
        [100, offset + 10],
      ]),
    ).toBeUndefined();
  });

  it('clips a box that only reaches into the strip with one corner', () => {
    // A diamond whose left tip pokes 2 m into the strip.
    const edge = route.halfWidth;
    const range = sweepPolygon(route, [
      [100, edge - 2],
      [110, edge + 8],
      [100, edge + 18],
      [90, edge + 8],
    ]);
    expect(range?.[0]).toBeCloseTo(98);
    expect(range?.[1]).toBeCloseTo(102);
  });

  it('ignores boxes beyond the end of the line', () => {
    expect(
      sweepPolygon(route, [
        [500, -5],
        [510, -5],
        [510, 5],
        [500, 5],
      ]),
    ).toBeUndefined();
  });
});

describe('findObstacles', () => {
  it('lists the buildings on the line in the order in which the Hauler reaches them', () => {
    const obstacles = findObstacles(route, [
      box('far', 300, 0),
      box('aside', 200, 40),
      box('near', 100, 2),
    ]);
    expect(obstacles.map((obstacle) => obstacle.id)).toEqual(['near', 'far']);
    expect(obstacles[0].distance).toBeCloseTo(95);
  });

  it('counts grouped buildings as one obstacle', () => {
    const obstacles = findObstacles(route, [
      box('a', 100, 0, 10, 'row'),
      box('b', 120, 0, 10, 'row'),
    ]);
    expect(obstacles).toHaveLength(1);
    expect(obstacles[0].segments).toHaveLength(2);
    expect(obstacles[0].distance).toBeCloseTo(95);
  });

  it('only lists the segments of a long building that stand in the strip', () => {
    // A 50 m building across the line has four segments. The strip is about 9 m wide.
    const long: BuildingData = { ...box('long', 200, 0), size: [10, 4, 50] };
    const [obstacle] = findObstacles(route, [long]);
    expect(obstacle.segments.length).toBeLessThan(4);
    expect(obstacle.segments.length).toBeGreaterThan(0);
  });
});

describe('timing', () => {
  it('converts distance into seconds', () => {
    expect(secondsUntil(route, 20, 100)).toBeCloseTo(20);
    expect(secondsUntil(route, 120, 100)).toBe(0);
  });

  it('grades the urgency', () => {
    expect(urgencyOf(20)).toBe('calm');
    expect(urgencyOf(14.9)).toBe('warning');
    expect(urgencyOf(4.9)).toBe('critical');
  });
});

/**
 * The tuning rule of the code brief: the Hauler must reach each obstacle within ±10 % of the
 * time that the design brief gives.
 */
const levels = Object.values(
  import.meta.glob<LevelData>(['../levels/*.json', '!../levels/*.terrain.json'], {
    eager: true,
    import: 'default',
  }),
);

describe.each(levels)('arrival times of $name', (level) => {
  const levelRoute = createRoute(level.hauler);
  const obstacles = findObstacles(levelRoute, level.buildings);

  it('drives the whole line in the given time', () => {
    expect(level.hauler.length / level.hauler.speed).toBeCloseTo(level.expected.lineSeconds, 0);
  });

  it('meets exactly the expected building obstacles', () => {
    const expected = level.expected.arrivals
      .filter((arrival) => !arrival.gap)
      .map((arrival) => arrival.obstacle);
    expect(obstacles.map((obstacle) => obstacle.id)).toEqual(expected);
  });

  it.each(level.expected.arrivals.filter((arrival) => !arrival.gap))(
    'reaches $obstacle at about $seconds s',
    (arrival) => {
      const obstacle = obstacles.find((candidate) => candidate.id === arrival.obstacle);
      expect(obstacle).toBeDefined();
      const seconds = (obstacle?.distance ?? 0) / level.hauler.speed;
      expect(seconds).toBeGreaterThan(arrival.seconds * 0.9);
      expect(seconds).toBeLessThan(arrival.seconds * 1.1);
    },
  );
});
