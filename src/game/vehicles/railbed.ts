import * as THREE from 'three/webgpu';
import type { RouteGapData } from '../level';
import { clamp, type Vec2 } from '../math';
import type { Deck } from '../world/decks';
import { MeshBuilder } from '../world/mesh-builder';
import type { Vehicle } from './vehicle';

/** The Railbed bridges a gap when it stands this close to the slot, in metres along the track. */
const SLOT_TOLERANCE = 1.6;
/** Within this distance the Railbed drifts into the slot by itself once the driver lets go. */
const SLOT_PULL_RANGE = 8;
const SIGNAL = 0x2ee6ff;
const GO = 0x3df5a0;

/**
 * Keeps the Railbed on its track, pulls it into the slot of a route gap and reports whether it
 * bridges that gap.
 *
 * The Railbed only moves forwards and backwards. When it stands in the glowing slot, its deck
 * closes the gap, and the Hauler rolls across.
 */
export class RailbedController {
  /** The outline of the slot: dashed and cyan while empty, solid and green once filled. */
  readonly object = new THREE.Group();
  /** True while the Railbed stands in the slot. */
  bridged = false;

  private readonly start: Vec2;
  private readonly direction: Vec2;
  private readonly length: number;
  /** Distance of the slot from the start of the track. */
  private readonly slotAt: number;
  private readonly dashed: THREE.Mesh;
  private readonly solid: THREE.Mesh;
  private clock = 0;

  constructor(
    readonly vehicle: Vehicle,
    rail: [Vec2, Vec2],
    readonly gap: RouteGapData,
    slotHeight: number,
  ) {
    this.start = rail[0];
    const dx = rail[1][0] - rail[0][0];
    const dz = rail[1][1] - rail[0][1];
    this.length = Math.hypot(dx, dz);
    this.direction = [dx / this.length, dz / this.length];
    this.slotAt = this.along(gap.slot);

    const { length, width } = vehicle.spec;
    const material = new THREE.MeshBasicMaterial({ color: SIGNAL, toneMapped: false });
    this.dashed = new THREE.Mesh(frame(length, width, true), material);
    this.solid = new THREE.Mesh(frame(length, width, false), material);
    this.solid.visible = false;
    this.object.name = 'railbed-slot';
    this.object.add(this.dashed, this.solid);
    this.object.position.set(gap.slot[0], slotHeight + 0.2, gap.slot[1]);
    this.object.rotation.y = -Math.atan2(this.direction[1], this.direction[0]);
  }

  /** The deck of the Railbed, which vehicles and the Hauler can drive on. */
  get deck(): Deck {
    return {
      box: this.vehicle.footprint,
      top: this.vehicle.position.y + this.vehicle.spec.height / 2,
    };
  }

  /**
   * Throttle for the Railbed from a direction on the ground: full ahead when the stick points
   * along the track, and reverse when it points the other way.
   */
  throttleFor(heading: number, magnitude: number): number {
    return Math.cos(heading - this.vehicle.heading) * magnitude;
  }

  /**
   * Holds the Railbed on its track. Call it after the physics step.
   *
   * @param driven True while the player drives the Railbed and gives throttle.
   */
  constrain(driven: boolean): void {
    const { body } = this.vehicle;
    const position = body.translation();
    const along = clamp(this.along([position.x, position.z]), 0, this.length);
    const velocity = body.linvel();
    let speed = velocity.x * this.direction[0] + velocity.z * this.direction[1];
    if (along <= 0 && speed < 0) {
      speed = 0;
    } else if (along >= this.length && speed > 0) {
      speed = 0;
    }

    const offset = this.slotAt - along;
    if (!driven && Math.abs(offset) < SLOT_PULL_RANGE) {
      // Close to the slot the Railbed rolls into place by itself.
      speed = clamp(offset * 3, -4, 4);
    }
    this.bridged = Math.abs(offset) < SLOT_TOLERANCE && Math.abs(speed) < 3;

    body.setTranslation(
      {
        x: this.start[0] + this.direction[0] * along,
        y: position.y,
        z: this.start[1] + this.direction[1] * along,
      },
      true,
    );
    body.setLinvel(
      { x: this.direction[0] * speed, y: velocity.y, z: this.direction[1] * speed },
      true,
    );
  }

  /** Animates the slot outline. */
  sync(frameSeconds: number): void {
    this.clock += frameSeconds;
    this.dashed.visible = !this.bridged;
    this.solid.visible = this.bridged;
    const material = this.solid.material as THREE.MeshBasicMaterial;
    material.color.setHex(this.bridged ? GO : SIGNAL);
    if (!this.bridged) {
      material.color.multiplyScalar(0.75 + 0.25 * Math.sin(this.clock * 4));
    }
  }

  private along(point: Vec2): number {
    return (
      (point[0] - this.start[0]) * this.direction[0] +
      (point[1] - this.start[1]) * this.direction[1]
    );
  }
}

/** A flat rectangular outline, dashed or solid. */
function frame(length: number, width: number, dashed: boolean): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const line = 0.6;
  const side = (size: number, center: [number, number], alongX: boolean): void => {
    const pieces = dashed ? Math.max(3, Math.round(size / 4)) : 1;
    for (let i = 0; i < pieces; i += 1) {
      const offset = ((i + 0.5) / pieces - 0.5) * size;
      const piece = dashed ? (size / pieces) * 0.6 : size;
      builder.box(
        alongX ? [piece, 0.08, line] : [line, 0.08, piece],
        alongX ? [center[0] + offset, 0, center[1]] : [center[0], 0, center[1] + offset],
        0xffffff,
      );
    }
  };
  side(length + line, [0, width / 2], true);
  side(length + line, [0, -width / 2], true);
  side(width - line, [length / 2, 0], false);
  side(width - line, [-length / 2, 0], false);
  return builder.build();
}
