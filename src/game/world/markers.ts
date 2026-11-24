import * as THREE from 'three/webgpu';
import type { Building } from './buildings';
import type { Vec2 } from '../math';
import { MeshBuilder } from './mesh-builder';

const ALARM = 0xff3d5a;
const AMBER = 0xff9a2e;
/** The outline runs this far outside the footprint of the building, in metres. */
const MARGIN = 1.6;
const LINE_WIDTH = 0.55;

interface Marker {
  building: Building;
  group: THREE.Group;
}

/**
 * Outlines on the ground around the route obstacles: red around every building in the Hauler's
 * way and amber around the next one.
 *
 * With pattern markings on, the outline of the next obstacle is dashed, so that it does not
 * depend on colour alone.
 */
export class ObstacleMarkers {
  readonly object = new THREE.Group();

  private readonly markers: Marker[] = [];
  private readonly line = new THREE.MeshBasicMaterial({ color: ALARM, toneMapped: false });
  private readonly glow = new THREE.MeshBasicMaterial({
    color: ALARM,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly nextLine = new THREE.MeshBasicMaterial({ color: AMBER, toneMapped: false });
  private readonly nextGlow = this.glow.clone();
  private clock = 0;

  constructor(buildings: readonly Building[]) {
    this.object.name = 'obstacle-markers';
    this.nextGlow.color.setHex(AMBER);
    for (const building of buildings) {
      const group = new THREE.Group();
      const [cx, cz] = building.center;
      group.position.set(cx, building.baseY + 0.18, cz);
      const outline = building.shape.outline.map((p): Vec2 => [p[0] - cx, p[1] - cz]);
      group.add(
        new THREE.Mesh(frameGeometry(outline, LINE_WIDTH * 3.2, false), this.glow),
        new THREE.Mesh(frameGeometry(outline, LINE_WIDTH, false), this.line),
        new THREE.Mesh(frameGeometry(outline, LINE_WIDTH, true), this.nextLine),
      );
      group.children[2].visible = false;
      this.object.add(group);
      this.markers.push({ building, group });
    }
  }

  /** Frees the materials. Some of them may not be on any mesh at the moment. */
  dispose(): void {
    for (const material of [this.line, this.glow, this.nextLine, this.nextGlow]) {
      material.dispose();
    }
  }

  /**
   * Shows the outlines of the buildings that still block the route.
   *
   * @param blocking Buildings with at least one standing segment in the Hauler's strip.
   * @param next Buildings of the next obstacle.
   * @param patterns True when the pattern markings setting is on.
   */
  update(
    frameSeconds: number,
    blocking: ReadonlySet<Building>,
    next: ReadonlySet<Building>,
    patterns: boolean,
  ): void {
    this.clock += frameSeconds;
    this.nextGlow.opacity = 0.3 + 0.16 * Math.sin(this.clock * 5);
    for (const { building, group } of this.markers) {
      group.visible = blocking.has(building);
      if (!group.visible) {
        continue;
      }
      const isNext = next.has(building);
      const [glow, solid, dashed] = group.children as THREE.Mesh[];
      glow.material = isNext ? this.nextGlow : this.glow;
      solid.material = isNext ? this.nextLine : this.line;
      solid.visible = !(isNext && patterns);
      dashed.visible = isNext && patterns;
    }
  }
}

/**
 * A flat frame that runs around an anticlockwise footprint, a little outside it.
 *
 * @param outline Corners relative to the frame's origin.
 */
function frameGeometry(
  outline: readonly Vec2[],
  width: number,
  dashed: boolean,
): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.2) {
      continue;
    }
    const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
    // Outward normal of an anticlockwise polygon.
    const nx = (b[1] - a[1]) / length;
    const nz = -(b[0] - a[0]) / length;
    const pieces = dashed ? Math.max(1, Math.round(length / 5)) : 1;
    for (let piece = 0; piece < pieces; piece += 1) {
      const t = (piece + 0.5) / pieces;
      const size = dashed ? (length / pieces) * 0.6 : length + MARGIN * 2;
      builder
        .place(
          [a[0] + (b[0] - a[0]) * t + nx * MARGIN, 0, a[1] + (b[1] - a[1]) * t + nz * MARGIN],
          -heading,
        )
        .box([size, 0.05, width], [0, 0, 0], 0xffffff);
    }
  }
  return builder.build();
}
