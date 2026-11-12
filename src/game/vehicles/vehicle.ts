import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import { approach, clamp, damp, lerp, wrapAngle, type Vec2 } from '../math';
import type { DriveCommand } from './drive-control';
import type { VehicleModel } from './models';
import type { VehicleSpec } from './specs';

/** Returns the height of the drivable ground below a point. */
export type GroundQuery = (x: number, z: number, fromY: number) => number;

/** Suspension stiffness per second squared. It holds the chassis at its ride height. */
const SPRING = 300;
/** Suspension damping per second. */
const SPRING_DAMPING = 30;
/** How far above its ride height a chassis still counts as on the ground, in metres. */
const GROUND_REACH = 0.45;
/** How strongly a slope speeds a vehicle up or slows it down, in m/s². */
const SLOPE_GRAVITY = 13;
/** While the ram charge burns, the top speed and the acceleration rise by these factors. */
const RAM_SPEED_FACTOR = 1.6;
const RAM_ACCELERATION_FACTOR = 3;
/** How long a ram charge stays armed for its damage bonus after it fires, in seconds. */
const RAM_ARMED_SECONDS = 1.1;

/** The Action button as one simulation step sees it. */
export interface ActionInput {
  held: boolean;
  /** True in the step in which the button went down. */
  pressed: boolean;
}

/**
 * A drivable vehicle.
 *
 * The vehicle is an arcade model on top of a physics body. The body only turns around the
 * vertical axis, so a vehicle cannot flip. Each step, the model reads the body's velocity,
 * changes it by what the engine, the brakes, the grip and the slope allow, and writes it back.
 * Rapier still resolves every collision, so walls stop a vehicle and crates get pushed.
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Root of the visual model. Its position and heading follow the body. */
  readonly object: THREE.Group;

  /** Heading in radians. 0 points east and positive headings turn clockwise from above. */
  heading: number;
  /** Speed along the heading in m/s. Negative when reversing. */
  forwardSpeed = 0;
  grounded = true;
  /** Charge of the action from 0 (empty) to 1 (ready). */
  actionCharge = 1;
  /** True while the action runs, for example during the ram burst. */
  actionActive = false;
  /** True while the next hit deals the ram bonus damage. */
  ramArmed = false;
  /** Velocity before the latest physics step. The damage model reads it on impact. */
  readonly impactVelocity = new THREE.Vector3();
  /** Downward speed at the moment the vehicle last touched down, in m/s. */
  landingSpeed = 0;

  private yawRate = 0;
  private actionTimer = 0;
  private armedTimer = 0;
  private pitch = 0;
  private roll = 0;
  private readonly previousPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private previousHeading: number;
  private currentHeading: number;
  private readonly tilt: THREE.Group;

  constructor(
    readonly id: string,
    readonly spec: VehicleSpec,
    private readonly model: VehicleModel,
    physics: PhysicsWorld,
    private readonly groundAt: GroundQuery,
    position: Vec2,
    heading: number,
  ) {
    this.heading = heading;
    this.previousHeading = heading;
    this.currentHeading = heading;

    const y = groundAt(position[0], position[1], Infinity) + spec.rideHeight;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], y, position[1])
        .setRotation(yawQuaternion(heading))
        .enabledRotations(false, true, false)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.length / 2, spec.height / 2, spec.width / 2)
        .setMass(spec.mass)
        .setFriction(0.2)
        .setRestitution(0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(
          collisionGroups(
            Layer.vehicle,
            Layer.building | Layer.vehicle | Layer.debris | Layer.crate | Layer.prop | Layer.hauler,
          ),
        ),
      this.body,
    );

    this.object = new THREE.Group();
    this.object.name = `vehicle-${id}`;
    this.tilt = new THREE.Group();
    this.tilt.add(model.object);
    this.object.add(this.tilt);

    this.currentPosition.set(position[0], y, position[1]);
    this.previousPosition.copy(this.currentPosition);
    this.sync(1, 0);
  }

  /** Position of the chassis centre after the latest step. */
  get position(): THREE.Vector3 {
    return this.currentPosition;
  }

  /** Runs one simulation step. Call it before the physics step. */
  step(dt: number, command: Readonly<DriveCommand>, action: Readonly<ActionInput>): void {
    const { spec, body } = this;
    const translation = body.translation();
    const velocity = body.linvel();
    this.heading = headingOf(body.rotation());

    const fx = Math.cos(this.heading);
    const fz = Math.sin(this.heading);
    let forward = velocity.x * fx + velocity.z * fz;
    let sideways = -velocity.x * fz + velocity.z * fx;
    let vertical = velocity.y;

    // Ground contact: probe the ground under the front, the rear and both sides.
    const halfLength = spec.length * 0.38;
    const halfWidth = spec.width * 0.38;
    const probe = (alongX: number, alongZ: number): number =>
      this.groundAt(
        translation.x + fx * alongX - fz * alongZ,
        translation.z + fz * alongX + fx * alongZ,
        translation.y,
      );
    const front = probe(halfLength, 0);
    const rear = probe(-halfLength, 0);
    const left = probe(0, -halfWidth);
    const right = probe(0, halfWidth);
    const ground = Math.max((front + rear) / 2, (left + right) / 2);
    const gap = translation.y - (ground + spec.rideHeight);

    const wasGrounded = this.grounded;
    this.grounded = gap < GROUND_REACH;
    if (this.grounded) {
      if (!wasGrounded) {
        this.landingSpeed = Math.max(0, -vertical);
      }
      // The suspension pushes the chassis up, but it never pulls it down. A vehicle that leaves
      // a ramp at speed therefore flies.
      const lift = Math.max(0, -SPRING * gap - SPRING_DAMPING * vertical);
      vertical += lift * dt;
      if (gap < -spec.rideHeight * 0.6) {
        // The chassis is about to hit the ground after a hard landing. Hold it above the ground.
        body.setTranslation(
          { x: translation.x, y: ground + spec.rideHeight * 0.4, z: translation.z },
          true,
        );
        vertical = Math.max(vertical, 0);
      }
    }

    this.updateAction(dt, action);

    const slopePitch = Math.atan2(front - rear, halfLength * 2);
    const slopeRoll = Math.atan2(right - left, halfWidth * 2);

    if (this.grounded) {
      const boost = this.actionActive && spec.actionKind === 'ram';
      const topSpeed = spec.topSpeed * (boost ? RAM_SPEED_FACTOR : 1);
      const acceleration = spec.acceleration * (boost ? RAM_ACCELERATION_FACTOR : 1);
      const throttle = boost ? 1 : clamp(command.throttle, -1, 1);
      const target = throttle >= 0 ? throttle * topSpeed : throttle * spec.reverseSpeed;

      if (command.brake && !boost) {
        forward = approach(forward, 0, spec.braking * dt);
      } else if (throttle === 0) {
        forward = approach(forward, 0, spec.coasting * dt);
      } else if (Math.sign(target) !== Math.sign(forward) && Math.abs(forward) > 0.5) {
        // Throttle against the direction of travel brakes first.
        forward = approach(forward, 0, spec.braking * dt);
      } else if (Math.abs(forward) <= Math.abs(target)) {
        forward = approach(forward, target, acceleration * dt);
      } else {
        // Faster than the engine can go, for example downhill: lose the extra speed slowly.
        forward = approach(forward, target, spec.coasting * 0.4 * dt);
      }
      forward -= SLOPE_GRAVITY * Math.sin(slopePitch) * dt;
      sideways *= Math.exp(-spec.grip * dt);

      // Steering. A wheeled vehicle needs speed to turn; a tracked vehicle turns on the spot.
      const reversing = forward < -0.5;
      const turnFactor = spec.pivots
        ? reversing
          ? -1
          : 1
        : clamp(forward / spec.fullTurnSpeed, -1, 1);
      const targetYawRate = clamp(command.steer, -1, 1) * spec.turnRate * turnFactor;
      this.yawRate = lerp(this.yawRate, targetYawRate, damp(spec.turnResponse, dt));
    } else {
      this.yawRate = lerp(this.yawRate, 0, damp(2, dt));
    }

    this.forwardSpeed = forward;
    body.setLinvel(
      { x: fx * forward - fz * sideways, y: vertical, z: fz * forward + fx * sideways },
      true,
    );
    body.setAngvel({ x: 0, y: -this.yawRate, z: 0 }, true);
    this.impactVelocity.set(fx * forward - fz * sideways, vertical, fz * forward + fx * sideways);

    // Body lean: the chassis follows the slope, dips under braking and rolls into turns.
    const lean = clamp((this.yawRate * forward) / 60, -0.16, 0.16);
    const targetPitch = this.grounded ? slopePitch : clamp(vertical / 40, -0.35, 0.35);
    this.pitch = lerp(this.pitch, targetPitch, damp(10, dt));
    this.roll = lerp(this.roll, (this.grounded ? slopeRoll : 0) + lean, damp(8, dt));
  }

  /** Records the body transform after the physics step, for interpolation. */
  capture(): void {
    this.previousPosition.copy(this.currentPosition);
    this.previousHeading = this.currentHeading;
    const translation = this.body.translation();
    this.currentPosition.set(translation.x, translation.y, translation.z);
    this.currentHeading = headingOf(this.body.rotation());
    this.heading = this.currentHeading;
  }

  /**
   * Moves the visual model to the interpolated transform.
   *
   * @param alpha Blend factor between the previous and the current step.
   * @param frameSeconds Real time since the last frame, for animations.
   */
  sync(alpha: number, frameSeconds: number): void {
    this.object.position.lerpVectors(this.previousPosition, this.currentPosition, alpha);
    const heading =
      this.previousHeading + wrapAngle(this.currentHeading - this.previousHeading) * alpha;
    this.object.rotation.y = -heading;
    // The model looks along +X, so pitch turns around Z and roll turns around X.
    this.tilt.rotation.set(this.roll, 0, this.pitch);
    this.model.update({
      frameSeconds,
      forwardSpeed: this.forwardSpeed,
      actionCharge: this.actionCharge,
      actionActive: this.actionActive,
      grounded: this.grounded,
    });
  }

  /** Moves the vehicle to a position and stops it. */
  teleport(position: Vec2, heading: number): void {
    const y = this.groundAt(position[0], position[1], Infinity) + this.spec.rideHeight;
    this.body.setTranslation({ x: position[0], y, z: position[1] }, true);
    this.body.setRotation(yawQuaternion(heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.yawRate = 0;
    this.forwardSpeed = 0;
    this.currentPosition.set(position[0], y, position[1]);
    this.previousPosition.copy(this.currentPosition);
    this.currentHeading = heading;
    this.previousHeading = heading;
    this.heading = heading;
  }

  private updateAction(dt: number, action: Readonly<ActionInput>): void {
    const { spec } = this;
    if (this.armedTimer > 0) {
      this.armedTimer -= dt;
      if (this.armedTimer <= 0) {
        this.ramArmed = false;
      }
    }
    if (spec.actionKind !== 'ram') {
      return;
    }
    if (this.actionActive) {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0) {
        this.actionActive = false;
      }
      return;
    }
    if (this.actionCharge < 1) {
      this.actionCharge = Math.min(1, this.actionCharge + dt / spec.actionRecharge);
    } else if (action.pressed) {
      this.actionActive = true;
      this.actionTimer = spec.actionDuration;
      this.actionCharge = 0;
      this.ramArmed = true;
      this.armedTimer = RAM_ARMED_SECONDS;
    }
  }
}

/** Quaternion of a body that points along a heading. */
function yawQuaternion(heading: number): { x: number; y: number; z: number; w: number } {
  const half = -heading / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/** Heading of a body that only turns around the vertical axis. */
function headingOf(rotation: { y: number; w: number }): number {
  return wrapAngle(-2 * Math.atan2(rotation.y, rotation.w));
}
