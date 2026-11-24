import type { BuildingData, GroundLayer, LevelData } from './level';
import type { Vec2 } from './math';

/*
 * The test yard: a flat area for trying out how the vehicles drive.
 *
 * X points east and Z points south. The vehicle starts at the west end of the main straight and
 * looks east. The yard holds:
 *
 * - the main straight along Z = 0, with a cross line every 10 m and a stop box near its east end,
 * - two slalom lanes south of it, with cones every 24 m and every 15 m,
 * - three turning circles in the north-west, with radii of 8 m, 16 m and 32 m,
 * - a small street grid in the north-east, with houses on both sides of narrow streets,
 * - a row of sheds, houses and brick blocks to ram, north of the straight,
 * - a cone gate in the south-east that is only a little wider than the bulldozer,
 * - a downtown in the south: a street of houses, a block of flats around a courtyard, a tower of
 *   40 floors and the buildings around it.
 */

const ASPHALT = '#5b6472';
const ROAD = '#474f5c';
const LINE = '#e6ebf1';
const HAZARD = '#ffc21a';
const GRASS = '#6f9d54';

/** Half the edge length of the paved area, in metres. */
const YARD_HALF = 280;
const STRAIGHT_HALF_LENGTH = 250;
const STRAIGHT_WIDTH = 16;
const SLALOM_WIDE_Z = 44;
const SLALOM_TIGHT_Z = 78;
/** The street of houses and the avenue of the downtown in the south. */
const TOWN_STREET_Z = 130;
const TOWN_AVENUE_X = -120;

function line(points: Vec2[], width = 0.8, color = LINE, dash?: [number, number]): GroundLayer {
  return { kind: 'path', points, width, color, dash };
}

function road(points: Vec2[], width: number): GroundLayer {
  return { kind: 'path', points, width, color: ROAD, tag: 'road' };
}

/** A circle as a closed polyline. */
function circle(center: Vec2, radius: number): Vec2[] {
  const points: Vec2[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]);
  }
  return points;
}

function createGround(): GroundLayer[] {
  const layers: GroundLayer[] = [
    {
      kind: 'polygon',
      points: [
        [-YARD_HALF, -YARD_HALF],
        [YARD_HALF, -YARD_HALF],
        [YARD_HALF, YARD_HALF],
        [-YARD_HALF, YARD_HALF],
      ],
      color: ASPHALT,
    },
    // Main straight with a cross line every 10 m. Every fifth line is yellow.
    road(
      [
        [-STRAIGHT_HALF_LENGTH, 0],
        [STRAIGHT_HALF_LENGTH, 0],
      ],
      STRAIGHT_WIDTH,
    ),
  ];
  const half = STRAIGHT_WIDTH / 2;
  for (let x = -STRAIGHT_HALF_LENGTH; x <= STRAIGHT_HALF_LENGTH; x += 10) {
    if (x % 50 === 0) {
      layers.push(
        line(
          [
            [x, -half],
            [x, half],
          ],
          1,
          HAZARD,
        ),
      );
      continue;
    }
    // A short tick at each edge of the road.
    for (const side of [-1, 1]) {
      layers.push(
        line([
          [x, side * half],
          [x, side * (half - 3)],
        ]),
      );
    }
  }
  // Stop box: brake so that the vehicle comes to rest inside it.
  const box: Vec2[] = [
    [196, -5],
    [208, -5],
    [208, 5],
    [196, 5],
    [196, -5],
  ];
  layers.push(line(box, 1, HAZARD));

  // Slalom lanes
  for (const z of [SLALOM_WIDE_Z, SLALOM_TIGHT_Z]) {
    layers.push(
      road(
        [
          [-190, z],
          [190, z],
        ],
        20,
      ),
      line(
        [
          [-190, z],
          [190, z],
        ],
        0.6,
        LINE,
        [3, 5],
      ),
    );
  }

  // Turning circles
  for (const radius of [8, 16, 32]) {
    layers.push(line(circle([-150, -140], radius), 0.9, radius === 16 ? HAZARD : LINE));
  }

  // Street grid
  for (const z of [-200, -150, -100]) {
    layers.push(
      road(
        [
          [60, z],
          [250, z],
        ],
        11,
      ),
    );
  }
  for (const x of [80, 155, 230]) {
    layers.push(
      road(
        [
          [x, -215],
          [x, -85],
        ],
        11,
      ),
    );
  }
  layers.push(
    road(
      [
        [-235, TOWN_STREET_Z],
        [60, TOWN_STREET_Z],
      ],
      11,
    ),
    road(
      [
        [TOWN_AVENUE_X, TOWN_STREET_Z],
        [TOWN_AVENUE_X, 265],
      ],
      14,
    ),
    road(
      [
        [TOWN_AVENUE_X, 164],
        [70, 164],
      ],
      11,
    ),
  );
  return layers;
}

function createCones(): Vec2[] {
  const cones: Vec2[] = [];
  for (let x = -168; x <= 168; x += 24) {
    cones.push([x, SLALOM_WIDE_Z]);
  }
  for (let x = -165; x <= 165; x += 15) {
    cones.push([x, SLALOM_TIGHT_Z]);
  }
  // Cone gate: two rows that leave a lane of 5.5 m.
  for (let x = 120; x <= 180; x += 6) {
    cones.push([x, 140 - 2.75], [x, 140 + 2.75]);
  }
  return cones;
}

/** A rectangle footprint around a centre, turned by a heading in degrees. */
function rect(x: number, z: number, width: number, depth: number, yaw = 0): Vec2[] {
  const cos = Math.cos((yaw * Math.PI) / 180);
  const sin = Math.sin((yaw * Math.PI) / 180);
  return (
    [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ] as Vec2[]
  ).map(([u, v]): Vec2 => [x + u * cos - v * sin, z + u * sin + v * cos]);
}

/** A square footprint with cut corners, like many towers. */
function chamfered(x: number, z: number, size: number, cut: number): Vec2[] {
  const h = size / 2;
  return [
    [x - h + cut, z - h],
    [x + h - cut, z - h],
    [x + h, z - h + cut],
    [x + h, z + h - cut],
    [x + h - cut, z + h],
    [x - h + cut, z + h],
    [x - h, z + h - cut],
    [x - h, z - h + cut],
  ];
}

function createBuildings(): BuildingData[] {
  const buildings: BuildingData[] = [];
  const add = (name: string, footprint: Vec2[], height: number): void => {
    buildings.push({ id: `${name}-${buildings.length + 1}`, name, footprint, height });
  };

  // Ram targets north of the main straight: sheds, then houses, then two low blocks.
  for (let i = 0; i < 6; i += 1) {
    add('shed', rect(-120 + i * 14, -30, 6, 5), 3.6);
  }
  for (let i = 0; i < 4; i += 1) {
    add('house', rect(-10 + i * 20, -32, 11, 9), 7);
  }
  for (let i = 0; i < 2; i += 1) {
    add('block', rect(95 + i * 34, -36, 24, 12), 11);
  }

  // Street grid: houses along the three east-west streets, between the cross streets.
  for (const streetZ of [-200, -150, -100]) {
    for (const blockX of [117.5, 192.5]) {
      for (const offset of [-18, 0, 18]) {
        for (const side of [-1, 1]) {
          // The middle street has houses on both sides. The outer streets only on the inside.
          const inner = streetZ === -150 || (streetZ === -200 ? side === 1 : side === -1);
          if (inner) {
            add('house', rect(blockX + offset, streetZ + side * 13, 12, 9), 7);
          }
        }
      }
    }
  }

  // Downtown in the south: a street of houses along Z = 130. The south side has a terrace of
  // four houses and an L-shaped house.
  for (let x = -222; x <= -60; x += 16) {
    if (Math.abs(x - TOWN_AVENUE_X) < 12) {
      continue;
    }
    add('house', rect(x, TOWN_STREET_Z - 11, 12, 9), 7);
    if (x < -168) {
      continue;
    }
    if (x === -142) {
      add(
        'house',
        [
          [x - 6, TOWN_STREET_Z + 7],
          [x + 6, TOWN_STREET_Z + 7],
          [x + 6, TOWN_STREET_Z + 13],
          [x, TOWN_STREET_Z + 13],
          [x, TOWN_STREET_Z + 19],
          [x - 6, TOWN_STREET_Z + 19],
        ],
        7,
      );
    } else {
      add('house', rect(x, TOWN_STREET_Z + 11, 12, 9), 7);
    }
  }
  add('terrace', rect(-196, TOWN_STREET_Z + 12, 44, 10), 8);

  // A large block of flats around a courtyard: it breaks in pieces.
  add(
    'block of flats',
    [
      [-210, 160],
      [-150, 160],
      [-150, 220],
      [-168, 220],
      [-168, 178],
      [-192, 178],
      [-192, 220],
      [-210, 220],
    ],
    12,
  );

  // The tower of 40 floors and the buildings around it, for chain reactions.
  add('tower', chamfered(-50, 205, 26, 4), 120);
  add('tower', rect(-90, 200, 20, 30), 36);
  add('tower', rect(-10, 230, 22, 22), 54);
  add('office block', rect(-50, 245, 40, 14), 12);
  add('office tower', rect(40, 215, 16, 40), 24);
  for (const x of [-40, -24, -8]) {
    add('house', rect(x, 178, 12, 9), 7);
  }
  return buildings;
}

function createTrees(): [number, number, number][] {
  const trees: [number, number, number][] = [];
  const edge = YARD_HALF + 14;
  for (let offset = -YARD_HALF; offset <= YARD_HALF; offset += 40) {
    const radius = 4.5 + ((offset / 40) % 3 === 0 ? 1.2 : 0);
    trees.push([offset, -edge, radius], [offset, edge, radius], [-edge, offset, radius]);
    trees.push([edge, offset, radius]);
  }
  return trees;
}

/** Builds the test yard. */
export function createYard(): LevelData {
  return {
    id: 'yard',
    name: 'Test yard',
    lighting: 'noon',
    terrain: { center: [0, 0], size: 720, maxHeight: 1, baseColor: GRASS },
    bounds: { min: [-YARD_HALF, -YARD_HALF], max: [YARD_HALF, YARD_HALF] },
    ground: createGround(),
    scenery: { trees: createTrees(), hedges: [] },
    spawn: { pos: [-230, 0], yaw: 0 },
    buildings: createBuildings(),
    cones: createCones(),
  };
}
