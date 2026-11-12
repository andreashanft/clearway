import type * as THREE from 'three/webgpu';
import type { BuildingData } from '../level';
import { MeshBuilder, shade } from './mesh-builder';
import type { SegmentLayout } from './segments';

const GLASS = 0x2f3d55;
const DOOR = 0x4e3626;
const FOUNDATION = 0x8c8c86;

/**
 * Builds the mesh of one building segment.
 *
 * The geometry is centred on the segment at ground level. Its X axis runs along the longer side
 * of the building.
 */
export function buildSegmentGeometry(
  data: BuildingData,
  layout: SegmentLayout,
  index: number,
): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const height = data.size[1];
  const wall = Number.parseInt(data.colors.wall.slice(1), 16);
  const roof = Number.parseInt(data.colors.roof.slice(1), 16);
  const { length, depth, count } = layout;
  const first = index === 0;
  const last = index === count - 1;

  switch (data.kind) {
    case 'house': {
      const roofHeight = Math.min(depth * 0.34, height * 0.42);
      const wallHeight = height - roofHeight;
      builder.box([length, 0.5, depth + 0.3], [0, 0.25, 0], FOUNDATION);
      builder.box([length, wallHeight, depth], [0, wallHeight / 2, 0], wall);
      builder.gable(
        length + (first || last ? 0.6 : 0),
        depth + 1.2,
        roofHeight,
        [0, wallHeight, 0],
        roof,
      );
      builder.box([length + 0.1, 0.35, depth + 0.5], [0, wallHeight - 0.1, 0], shade(roof, -0.1));
      // Windows on both long sides, and a door on the first segment.
      for (const side of [-1, 1]) {
        for (const x of [-length * 0.24, length * 0.24]) {
          const isDoor = first && side === 1 && x < 0;
          if (isDoor) {
            builder.box([2.4, 4.2, 0.3], [x, 2.6, (side * depth) / 2], DOOR);
          } else {
            builder.box([2.6, 2.4, 0.3], [x, wallHeight * 0.55, (side * depth) / 2], GLASS);
            builder.box(
              [3.0, 0.3, 0.4],
              [x, wallHeight * 0.55 - 1.35, (side * depth) / 2],
              0xffffff,
            );
          }
        }
      }
      if (first) {
        builder.box(
          [1.6, roofHeight + 1.6, 1.6],
          [-length * 0.18, wallHeight + roofHeight * 0.55, depth * 0.18],
          shade(wall, -0.3),
        );
      }
      break;
    }
    case 'terrace': {
      // One house of a terraced row: the ridge runs along the row, and every other house is a
      // shade darker, so that the row reads as separate houses.
      const roofHeight = Math.min(depth * 0.36, height * 0.42);
      const wallHeight = height - roofHeight;
      const tone = index % 2 === 0 ? 0 : -0.07;
      builder.box([length, wallHeight, depth], [0, wallHeight / 2, 0], shade(wall, tone));
      builder.gable(length, depth + 1.0, roofHeight, [0, wallHeight, 0], shade(roof, tone));
      builder.box([length + 0.05, 0.3, depth + 0.4], [0, wallHeight - 0.1, 0], shade(roof, -0.12));
      for (const side of [-1, 1]) {
        builder.box([2.2, 3.8, 0.3], [-length * 0.24, 2.3, (side * depth) / 2], DOOR);
        builder.box([2.6, 2.2, 0.3], [length * 0.22, wallHeight * 0.36, (side * depth) / 2], GLASS);
        builder.box([2.2, 1.8, 0.3], [-length * 0.24, wallHeight * 0.8, (side * depth) / 2], GLASS);
        builder.box([2.2, 1.8, 0.3], [length * 0.22, wallHeight * 0.8, (side * depth) / 2], GLASS);
      }
      builder.box(
        [1.3, roofHeight + 1.2, 1.3],
        [length * 0.36, wallHeight + roofHeight * 0.5, 0],
        shade(wall, -0.32),
      );
      break;
    }
    case 'gantry': {
      // A conveyor on steel legs: an enclosed belt housing high above the ground.
      const deck = height * 0.42;
      builder.box([length, deck, depth * 0.62], [0, height - deck / 2, 0], wall);
      builder.box([length + 0.1, 0.5, depth * 0.7], [0, height + 0.15, 0], roof);
      for (const x of [-length * 0.3, length * 0.3]) {
        for (const side of [-1, 1]) {
          builder.box(
            [1.1, height - deck, 1.1],
            [x, (height - deck) / 2, side * depth * 0.36],
            shade(wall, -0.2),
          );
        }
        builder.box([1.3, 0.6, depth * 0.9], [x, (height - deck) * 0.5, 0], shade(wall, -0.2));
      }
      for (const side of [-1, 1]) {
        builder.box(
          [length, 0.5, 0.25],
          [0, height - deck * 0.5, side * depth * 0.32],
          shade(wall, -0.14),
        );
      }
      break;
    }
    case 'barn': {
      const roofHeight = Math.min(depth * 0.3, height * 0.4);
      const wallHeight = height - roofHeight;
      builder.box([length, wallHeight, depth], [0, wallHeight / 2, 0], wall);
      builder.gable(
        length + (first || last ? 0.8 : 0),
        depth + 1.4,
        roofHeight,
        [0, wallHeight, 0],
        roof,
      );
      // Vertical battens give the walls the look of planks or corrugated sheet.
      const battens = Math.max(2, Math.round(length / 3));
      for (let i = 0; i < battens; i += 1) {
        const x = -length / 2 + ((i + 0.5) / battens) * length;
        for (const side of [-1, 1]) {
          builder.box(
            [0.3, wallHeight, 0.25],
            [x, wallHeight / 2, (side * depth) / 2],
            shade(wall, -0.1),
          );
        }
      }
      if (first) {
        builder.box(
          [0.3, wallHeight * 0.78, depth * 0.5],
          [-length / 2, wallHeight * 0.39, 0],
          shade(wall, -0.22),
        );
      }
      if (last) {
        builder.box(
          [0.3, wallHeight * 0.78, depth * 0.5],
          [length / 2, wallHeight * 0.39, 0],
          shade(wall, -0.22),
        );
      }
      break;
    }
    case 'shed': {
      const roofHeight = Math.min(1.4, height * 0.3);
      const wallHeight = height - roofHeight;
      builder.box([length, wallHeight, depth], [0, wallHeight / 2, 0], wall);
      builder.wedge(length + 0.8, depth + 0.9, roofHeight, [0, wallHeight, 0], roof);
      builder.box([length * 0.3, wallHeight * 0.75, 0.3], [0, wallHeight * 0.375, depth / 2], DOOR);
      break;
    }
    case 'greenhouse': {
      const roofHeight = height * 0.35;
      const wallHeight = height - roofHeight;
      builder.box([length, wallHeight, depth], [0, wallHeight / 2, 0], wall);
      builder.gable(length, depth + 0.2, roofHeight, [0, wallHeight, 0], roof);
      const ribs = Math.max(2, Math.round(length / 3.5));
      for (let i = 0; i <= ribs; i += 1) {
        const x = -length / 2 + (i / ribs) * length;
        builder.box([0.22, wallHeight + 0.1, depth + 0.2], [x, wallHeight / 2, 0], 0xffffff);
      }
      builder.box([length + 0.1, 0.25, 0.25], [0, height, 0], 0xffffff);
      break;
    }
    case 'block': {
      // An industrial block: a plain concrete or brick box with a parapet and roof machinery.
      builder.box([length, height, depth], [0, height / 2, 0], wall);
      builder.box([length + 0.3, 0.7, depth + 0.3], [0, height + 0.1, 0], roof);
      builder.box(
        [length * 0.3, 1.4, depth * 0.3],
        [length * 0.12, height + 0.9, -depth * 0.12],
        shade(roof, -0.12),
      );
      for (const side of [-1, 1]) {
        builder.box([length * 0.5, 1.2, 0.3], [0, height * 0.6, (side * depth) / 2], GLASS);
        builder.box([length, 0.5, 0.35], [0, height * 0.3, (side * depth) / 2], shade(wall, -0.12));
      }
      break;
    }
    case 'silo': {
      const radius = Math.min(data.size[0], data.size[2]) / 2;
      builder.cylinder(radius, radius, height * 0.86, [0, 0, 0], wall, 14);
      builder.cylinder(
        radius * 1.03,
        radius * 1.03,
        0.5,
        [0, height * 0.3, 0],
        shade(wall, -0.14),
        14,
      );
      builder.cylinder(
        radius * 1.03,
        radius * 1.03,
        0.5,
        [0, height * 0.6, 0],
        shade(wall, -0.14),
        14,
      );
      builder.cylinder(radius * 1.04, 0, height * 0.14, [0, height * 0.86, 0], roof, 14);
      break;
    }
    case 'chimney': {
      const radius = Math.min(data.size[0], data.size[2]) / 2;
      builder.cylinder(radius, radius * 0.72, height, [0, 0, 0], wall, 12);
      builder.cylinder(radius * 0.8, radius * 0.8, 1.2, [0, height - 1.2, 0], roof, 12);
      builder.box([radius * 2.6, 1.2, radius * 2.6], [0, 0.6, 0], FOUNDATION);
      break;
    }
    case 'tank': {
      // A fuel tank on its side, on a concrete pad, with a red band around the middle.
      const radius = Math.min(depth, height) * 0.42;
      builder.box([length + 2.6, 0.5, depth + 3.6], [0, 0.25, 0], 0x9a9890);
      builder.cylinder(radius, radius, length, [-length / 2, radius + 1.1, 0], wall, 12, 'x');
      builder.cylinder(
        radius * 1.04,
        radius * 1.04,
        length * 0.16,
        [-length * 0.08, radius + 1.1, 0],
        roof,
        12,
        'x',
      );
      for (const x of [-length * 0.3, length * 0.3]) {
        builder.box([0.9, radius + 1.0, depth * 0.8], [x, (radius + 1.0) / 2, 0], FOUNDATION);
      }
      break;
    }
  }
  return builder.build();
}
