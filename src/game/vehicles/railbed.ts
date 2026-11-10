import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { BoxGeometry, CylinderGeometry, Group, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLLISION } from '../../engine/collision-groups';
import type { ControlFrame } from '../../engine/input/controls';
import { InterpolatedPose } from '../../engine/interpolation';
import type { Physics } from '../../engine/physics';
import type { DriveOutput } from '../drive';
import { FINISH } from '../models/finish';
import { ModelBuilder } from '../models/model-builder';
import { stickToWorld } from '../pilot';
import type { Route } from '../route';
import type { Heightfield } from '../world/heightfield';
import type { ActionState, Machine, MachineSpec } from './vehicle';

const KMH = 1 / 3.6;
export const RAILBED_TOP_SPEED = 80 * KMH;
const ACCELERATION = 13;
const BRAKE = 20;
/** Height of the deck top above the rails; the cutting is this deep, so it bridges flush. */
export const DECK_HEIGHT = 1.6;
const HALF_HEIGHT = 0.7;
/** The Railbed snaps into its slot within this distance, below this speed. */
export const SNAP_DISTANCE = 3;
export const SNAP_SPEED = 3.5;
/** Side plates fold down from the deck edges to span the cutting's banks. */
const PLATE = { width: 2.6, length: 6, thickness: 0.16, seconds: 0.7 } as const;
const DECK_HALF_WIDTH = 1.5;

export const RAILBED_SPEC: MachineSpec = {
  type: 'railbed',
  name: 'Railbed',
  mass: 12000,
  chassis: { halfExtents: [1.5, HALF_HEIGHT, 4.2], offset: [0, 0, 0] },
};

/** Speed after one step: accelerate towards `throttle × top speed`, brake to a stop. */
export function railSpeed(speed: number, throttle: number, brake: boolean, dt: number): number {
  if (brake) return Math.sign(speed) * Math.max(0, Math.abs(speed) - BRAKE * dt);
  const target = throttle * RAILBED_TOP_SPEED;
  const delta = Math.max(-ACCELERATION * dt, Math.min(ACCELERATION * dt, target - speed));
  return speed + delta;
}

/** True when the Railbed should lock into its slot. */
export function shouldSnap(position: number, speed: number, slot: number): boolean {
  return Math.abs(position - slot) <= SNAP_DISTANCE && Math.abs(speed) <= SNAP_SPEED;
}

/**
 * The rail flatbed: moves only forward and back along its rails. Park it in the glowing
 * slot over the cutting and it locks there as a bridge for the Hauler.
 */
export class Railbed implements Machine {
  readonly spec = RAILBED_SPEC;
  readonly root = new Group();
  readonly body: RigidBody;
  readonly colliders: Collider[] = [];
  readonly actionLabel = '';
  readonly damageMultiplier = 0;
  readonly preStepVelocity = new Vector3();
  forwardSpeed = 0;
  locked = false;
  drive: DriveOutput = { steer: 0, throttle: 0 };
  routeAssist: ((x: number, z: number) => number | null) | null = null;
  /** Distance along the rails. */
  distance: number;
  /** Locked in the slot as a bridge. */
  snapped = false;
  private readonly plates: Group[] = [];
  /** 0 with the plates folded up, 1 with them down as a bridge. */
  private plateDeploy = 0;
  private readonly pose: InterpolatedPose;
  private readonly position3 = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private headingValue = 0;

  constructor(
    private readonly physics: Physics,
    private readonly rail: Route,
    private readonly field: Heightfield,
    start: number,
    /** Distance along the rails where the slot is. */
    readonly slot: number,
  ) {
    const { rapier, world } = physics;
    this.distance = start;
    this.computePose();
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.position3.x, this.position3.y, this.position3.z)
        .setRotation(this.rotation),
    );
    const [hx, hy, hz] = this.spec.chassis.halfExtents;
    this.colliders.push(
      world.createCollider(
        rapier.ColliderDesc.cuboid(hx, hy, hz)
          .setCollisionGroups(COLLISION.vehicle)
          .setFriction(0.9),
        this.body,
      ),
    );
    this.root.add(this.buildModel());
    this.pose = new InterpolatedPose(this.body, this.root);
  }

  get heading(): number {
    return this.headingValue;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get bridging(): boolean {
    return this.snapped;
  }

  get actionState(): ActionState {
    return { ready: false, active: this.snapped, charge: 0 };
  }

  impactMultiplier(): number {
    return 0;
  }

  /** Rail vehicles can't be placed freely; they stay on their rails. */
  place(): void {
    this.computePose();
    this.body.setTranslation(this.position3, true);
    this.body.setRotation(this.rotation, true);
    this.pose.snap();
  }

  control(frame: ControlFrame, cameraYaw: number, dt: number): void {
    let throttle = frame.throttle;
    if (frame.stickX !== 0 || frame.stickY !== 0) {
      // Point-to-drive: push along the rails the way the stick points.
      const dir = stickToWorld(frame.stickX, frame.stickY, cameraYaw);
      const t = this.rail.sampleAt(this.distance);
      const along = dir.dx * t.dx + dir.dz * t.dz;
      throttle = Math.abs(along) > 0.3 ? Math.sign(along) * dir.magnitude : 0;
    }
    this.drive = { steer: 0, throttle };
    this.move(throttle, frame.brake, dt);
  }

  idle(dt: number): void {
    this.drive = { steer: 0, throttle: 0 };
    this.move(0, true, dt);
  }

  step(): void {
    this.computePose();
    this.body.setNextKinematicTranslation(this.position3);
    this.body.setNextKinematicRotation(this.rotation);
  }

  afterStep(): void {
    this.pose.capture();
  }

  render(alpha: number): void {
    this.pose.apply(alpha);
    const t = this.plateDeploy;
    const angle = (Math.PI / 2) * (1 - t * t * (3 - 2 * t));
    this.plates[0]?.rotation.set(0, 0, angle);
    this.plates[1]?.rotation.set(0, 0, -angle);
  }

  velocity(out: Vector3): Vector3 {
    const t = this.rail.sampleAt(this.distance);
    return out.set(t.dx * this.forwardSpeed, 0, t.dz * this.forwardSpeed);
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
    this.root.removeFromParent();
  }

  private move(throttle: number, brake: boolean, dt: number): void {
    if (this.snapped) {
      this.forwardSpeed = 0;
      this.plateDeploy = Math.min(1, this.plateDeploy + dt / PLATE.seconds);
      return;
    }
    this.forwardSpeed = railSpeed(this.forwardSpeed, throttle, brake, dt);
    this.distance = Math.max(0, Math.min(this.rail.length, this.distance + this.forwardSpeed * dt));
    if (this.distance === 0 || this.distance === this.rail.length) this.forwardSpeed = 0;
    if (shouldSnap(this.distance, this.forwardSpeed, this.slot)) {
      this.distance = this.slot;
      this.forwardSpeed = 0;
      this.snapped = true;
      this.addPlateColliders();
    }
    this.preStepVelocity.copy(this.velocity(this.preStepVelocity));
  }

  /** Once the plates are down, other vehicles can drive across the whole span. */
  private addPlateColliders(): void {
    const { rapier, world } = this.physics;
    for (const side of [1, -1]) {
      this.colliders.push(
        world.createCollider(
          rapier.ColliderDesc.cuboid(PLATE.width / 2, PLATE.thickness / 2, PLATE.length / 2)
            .setTranslation(
              side * (DECK_HALF_WIDTH + PLATE.width / 2),
              HALF_HEIGHT - PLATE.thickness / 2,
              0,
            )
            .setCollisionGroups(COLLISION.vehicle)
            .setFriction(0.9),
          this.body,
        ),
      );
    }
  }

  private computePose(): void {
    const s = this.rail.sampleAt(this.distance);
    // Rails sit on the cutting floor; the deck top is DECK_HEIGHT above them.
    const ground = this.field.heightAt(s.x, s.z);
    this.position3.set(s.x, ground + DECK_HEIGHT - HALF_HEIGHT, s.z);
    this.headingValue = Math.atan2(s.dx, s.dz);
    this.rotation.setFromAxisAngle(this.up, this.headingValue);
  }

  private buildModel(): Group {
    const m = FINISH;
    const b = new ModelBuilder();
    const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
    const y0 = -HALF_HEIGHT;
    // Deck (its top flush with the collider), ribs, buffers and a hazard-yellow cab.
    const deckTop = HALF_HEIGHT;
    b.add(
      box(3.0, 0.3, 8.4),
      { colour: '#5D6470', roughness: 0.6, metalness: 0.5 },
      { at: [0, deckTop - 0.15, 0] },
    );
    for (let k = 0; k < 8; k++)
      b.add(box(3.02, 0.06, 0.12), m.darkSteel, { at: [0, deckTop + 0.01, -3.7 + k * 1.05] });
    b.add(box(2.6, 0.5, 8.0), m.darkSteel, { at: [0, y0 + 0.85, 0] });
    b.add(new RoundedBoxGeometry(2.6, 1.6, 1.8, 2, 0.12), m.hazardPaint, {
      at: [0, deckTop + 0.8, 3.2],
    });
    b.add(box(2.2, 0.6, 0.08), m.glass, { at: [0, deckTop + 1.15, 4.11] });
    b.addMirrored(box(0.3, 0.3, 0.3), m.darkSteel, { at: [0.9, y0 + 0.95, 4.3] });
    b.addMirrored(box(0.3, 0.3, 0.3), m.darkSteel, { at: [0.9, y0 + 0.95, -4.3] });
    // Two bogies of four wheels each.
    for (const z of [2.6, -2.6]) {
      b.add(box(2.2, 0.4, 2.0), m.blackBand, { at: [0, y0 + 0.65, z] });
      for (const dz of [-0.6, 0.6]) {
        b.addMirrored(new CylinderGeometry(0.42, 0.42, 0.18, 12), m.steel, {
          at: [0.75, y0 + 0.45, z + dz],
          rotate: [0, 0, Math.PI / 2],
        });
      }
    }
    const root = new Group().add(b.build('railbed'));
    // Hinged side plates, folded up while travelling.
    for (const side of [1, -1]) {
      const hinge = new Group();
      hinge.position.set(side * DECK_HALF_WIDTH, deckTop - PLATE.thickness / 2, 0);
      const plate = new ModelBuilder()
        .add(box(PLATE.width, PLATE.thickness, PLATE.length), m.hazardPaint, {
          at: [(side * PLATE.width) / 2, 0, 0],
        })
        .add(box(0.12, PLATE.thickness + 0.02, PLATE.length), m.blackBand, {
          at: [side * (PLATE.width - 0.06), 0, 0],
        })
        .build('railbed-plate');
      hinge.add(plate);
      this.plates.push(hinge);
      root.add(hinge);
    }
    return root;
  }
}
