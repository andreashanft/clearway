import * as THREE from 'three/webgpu';
import type { Building } from './buildings';
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
      group.position.set(building.data.pos[0], building.baseY + 0.18, building.data.pos[1]);
      group.rotation.y = -building.heading;
      const { half } = building.footprint;
      const round = building.layout.round;
      group.add(
        new THREE.Mesh(frameGeometry(half[0], half[1], LINE_WIDTH * 3.2, round, false), this.glow),
        new THREE.Mesh(frameGeometry(half[0], half[1], LINE_WIDTH, round, false), this.line),
        new THREE.Mesh(frameGeometry(half[0], half[1], LINE_WIDTH, round, true), this.nextLine),
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

/** A flat frame around a rectangle, or a ring around a round footprint. */
function frameGeometry(
  halfLength: number,
  halfDepth: number,
  width: number,
  round: boolean,
  dashed: boolean,
): THREE.BufferGeometry {
  if (round) {
    const radius = Math.min(halfLength, halfDepth) + MARGIN;
    if (!dashed) {
      return new THREE.RingGeometry(radius - width / 2, radius + width / 2, 36).rotateX(
        -Math.PI / 2,
      );
    }
    const builder = new MeshBuilder();
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      builder
        .place([Math.cos(angle) * radius, 0, Math.sin(angle) * radius], -angle + Math.PI / 2)
        .box([radius * 0.3, 0.05, width], [0, 0, 0], 0xffffff);
    }
    return builder.build();
  }
  const builder = new MeshBuilder();
  const x = halfLength + MARGIN;
  const z = halfDepth + MARGIN;
  const side = (length: number, center: [number, number, number], alongX: boolean): void => {
    const pieces = dashed ? Math.max(2, Math.round(length / 5)) : 1;
    for (let i = 0; i < pieces; i += 1) {
      const offset = ((i + 0.5) / pieces - 0.5) * length;
      const piece = dashed ? (length / pieces) * 0.6 : length;
      builder.box(
        alongX ? [piece, 0.05, width] : [width, 0.05, piece],
        alongX ? [center[0] + offset, 0, center[2]] : [center[0], 0, center[2] + offset],
        0xffffff,
      );
    }
  };
  side(x * 2 + width, [0, 0, z], true);
  side(x * 2 + width, [0, 0, -z], true);
  side(z * 2 - width, [x, 0, 0], false);
  side(z * 2 - width, [-x, 0, 0], false);
  return builder.build();
}
