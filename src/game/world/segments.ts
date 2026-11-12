import type { BuildingData } from '../level';
import { DEG, headingVector, type OrientedBox } from '../math';

/** The longest side of one building segment in metres. Longer buildings get more segments. */
const SEGMENT_LENGTH = 12.5;
const MAX_SEGMENTS = 6;

/** How a building is cut into segments along its longer side. */
export interface SegmentLayout {
  count: number;
  /** True when the longer side runs along the local X axis. */
  alongX: boolean;
  /** Length of one segment along the longer side. */
  length: number;
  /** Size of the building across the longer side. */
  depth: number;
  /** Heading of the longer side in radians. */
  heading: number;
  /** True for silos, tanks and chimneys, which have a round footprint. */
  round: boolean;
}

/** Decides how many segments a building has. A house has two, a long warehouse five. */
export function segmentLayout(data: BuildingData): SegmentLayout {
  const [width, , depth] = data.size;
  const alongX = width >= depth;
  const long = alongX ? width : depth;
  const short = alongX ? depth : width;
  const round = data.kind === 'silo' || data.kind === 'chimney';
  const single = round || data.kind === 'tank';
  const count = single ? 1 : Math.min(MAX_SEGMENTS, Math.max(1, Math.round(long / SEGMENT_LENGTH)));
  return {
    count,
    alongX,
    length: long / count,
    depth: short,
    heading: (data.yaw + (alongX ? 0 : 90)) * DEG,
    round,
  };
}

/** Returns the footprint of every segment of a building on the ground plane. */
export function segmentBoxes(data: BuildingData, layout = segmentLayout(data)): OrientedBox[] {
  const [forwardX, forwardZ] = headingVector(layout.heading);
  const boxes: OrientedBox[] = [];
  for (let index = 0; index < layout.count; index += 1) {
    const offset = (index - (layout.count - 1) / 2) * layout.length;
    boxes.push({
      center: [data.pos[0] + forwardX * offset, data.pos[1] + forwardZ * offset],
      half: [layout.length / 2, layout.depth / 2],
      heading: layout.heading,
    });
  }
  return boxes;
}
