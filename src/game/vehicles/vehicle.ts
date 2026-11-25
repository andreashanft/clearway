import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import { approach, clamp, damp, lerp, wrapAngle, type OrientedBox, type Vec2 } from '../math';
import {
  driveSpeed,
  fullLockTurnRate,
  nextSlide,
  slideTurnRate,
  tyreVelocity,
  NO_COMMAND,
  type DriveCommand,
} from './handling';
import type { VehicleModel } from './models';
import type { VehicleSpec } from './specs';

/**
 * Returns the height of the drivable ground below a point.
 *
 * @param fromY Height of the wheels of the asking vehicle. A deck well above that height does
 *   not count, so a vehicle under a bridge stays under it.
 */
export type GroundQuery = (x: number, z: number, fromY: number) => number;

/** Suspension stiffness per second squared. It holds the chassis at its ride height. */
const SPRING = 300;
/** Suspension damping per second. */
const SPRING_DAMPING = 30;
/** How far above its ride height a chassis still counts as on the ground, in metres. */
const GROUND_REACH = 0.45;
/** How strongly a slope speeds a vehicle up or slows it down, in m/s². */
const SLOPE_GRAVITY = 16;
/** Vehicles cannot climb ground that is steeper than this, in radians. */
const MAX_CLIMB = 0.72;

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
  /** Position of the steering wheel from -1 (full left) to 1 (full right). */
  steering = 0;
  /** How much the vehicle slides, from 0 (full grip) to 1 (full slide). */
  slide = 0;
  /**
   * Angle between the heading and the direction of travel, in radians. It is positive when the
   * nose points to the right of the direction of travel. It is 0 while the vehicle reverses or
   * moves forwards at less than 1 m/s.
   */
  slip = 0;
  grounded = true;
  /** Velocity before the latest physics step. The damage model reads it on impact. */
  readonly impactVelocity = new THREE.Vector3();
  /** Downward speed at the moment the vehicle last touched down, in m/s. */
  landingSpeed = 0;
  /** Seconds for which the driver has no control, for example after an explosion. */
  stunned = 0;
  /** Seconds until the next impact counts. It keeps one crash from counting twice. */
  impactCooldown = 0;
  /** Seconds since the vehicle left the ground. */
  airTime = 0;

  private yawRate = 0;
  private pitch = 0;
  private roll = 0;
  private readonly previousPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private previousHeading: number;
  private currentHeading: number;
  private readonly tilt: THREE.Group;

  constructor(
    readonly spec: VehicleSpec,
    private readonly model: VehicleModel,
    private readonly physics: PhysicsWorld,
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
    const solids = Layer.building | Layer.vehicle | Layer.crate | Layer.prop | Layer.bridge;
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.length / 2, spec.height / 2, spec.width / 2)
        .setMass(spec.mass)
        .setFriction(0.2)
        .setRestitution(0)
        .setCollisionGroups(collisionGroups(Layer.vehicle, solids | Layer.hauler)),
      this.body,
    );

    this.object = new THREE.Group();
    this.object.name = `vehicle-${spec.type}`;
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

  /** Returns the footprint of the vehicle on the ground plane. */
  get footprint(): OrientedBox {
    return {
      center: [this.currentPosition.x, this.currentPosition.z],
      half: [this.spec.length / 2, this.spec.width / 2],
      heading: this.heading,
    };
  }

  /** Runs one simulation step. Call it before the physics step. */
  step(dt: number, command: Readonly<DriveCommand>): void {
    const { spec, body } = this;
    const translation = body.translation();
    const velocity = body.linvel();
    this.heading = headingOf(body.rotation(), this.heading);

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
        // The height of the wheels decides whether a deck is above or below the vehicle.
        translation.y - spec.rideHeight,
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
      this.airTime = 0;
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
    } else {
      this.airTime += dt;
    }
    // A vehicle that rests on a roof or on another vehicle can still drive off it.
    const supported = !this.grounded && Math.abs(vertical) < 1 && this.airTime > 0.25;

    const stunned = this.stunned > 0;
    this.stunned = Math.max(0, this.stunned - dt);
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);

    // The steering wheel follows the input at a limited speed, so that a key press is no jolt.
    const wanted = stunned ? 0 : clamp(command.steer, -1, 1);
    this.steering = approach(this.steering, wanted, spec.steerSpeed * dt);

    const slopePitch = Math.atan2(front - rear, halfLength * 2);
    const slopeRoll = Math.atan2(right - left, halfWidth * 2);

    if ((this.grounded || supported) && stunned) {
      // Thrown by an explosion: the vehicle slides until the driver has control again.
      forward = approach(forward, 0, spec.coasting * 0.5 * dt);
      sideways *= Math.exp(-1.5 * dt);
      this.yawRate = lerp(this.yawRate, 0, damp(1.5, dt));
      // The driver's slide ends, so that it does not hold on after the controls come back.
      this.slide = nextSlide(spec, this.slide, forward, 0, NO_COMMAND, dt);
    } else if (this.grounded || supported) {
      const travelBefore = Math.atan2(sideways, forward);
      forward = driveSpeed(spec, forward, command, dt, sideways);
      if (this.grounded) {
        forward -= SLOPE_GRAVITY * Math.sin(slopePitch) * dt;
        // A bank that is too steep stops the vehicle like a wall.
        if (slopePitch > MAX_CLIMB && forward > 0) {
          forward = 0;
        } else if (slopePitch < -MAX_CLIMB && forward < 0) {
          forward = 0;
        }
      }
      this.slide = nextSlide(spec, this.slide, forward, this.steering, command, dt);
      ({ forward, sideways } = tyreVelocity(spec, forward, sideways, this.slide, dt));
      let target = this.steering * fullLockTurnRate(spec, forward);
      if (this.slide > 0 && forward > 1) {
        // In a slide, the steering sets the slip angle instead of the turn rate.
        const travel = Math.atan2(sideways, forward);
        const travelTurn = wrapAngle(travel - travelBefore) / dt;
        const slideRate = slideTurnRate(spec, -travel, travelTurn, this.steering);
        target = lerp(target, slideRate, this.slide);
      }
      this.yawRate = lerp(this.yawRate, target, damp(spec.turnResponse, dt));
    } else {
      // In the air the vehicle keeps its speed and stops turning.
      this.yawRate = lerp(this.yawRate, 0, damp(2, dt));
    }

    this.forwardSpeed = forward;
    this.slip = forward > 1 ? -Math.atan2(sideways, forward) : 0;
    body.setLinvel(
      { x: fx * forward - fz * sideways, y: vertical, z: fz * forward + fx * sideways },
      true,
    );
    body.setAngvel({ x: 0, y: -this.yawRate, z: 0 }, true);
    this.impactVelocity.set(fx * forward - fz * sideways, vertical, fz * forward + fx * sideways);

    // Body lean: the chassis follows the slope and leans into turns.
    const lean = clamp((this.yawRate * forward) / 220, -0.12, 0.12);
    const targetPitch = this.grounded ? slopePitch : clamp(vertical / 40, -0.35, 0.35);
    this.pitch = lerp(this.pitch, targetPitch, damp(10, dt));
    // A positive roll lowers the right side, so ground that is higher on the right rolls back.
    this.roll = lerp(this.roll, (this.grounded ? -slopeRoll : 0) + lean, damp(8, dt));
  }

  /** Records the body transform after the physics step, for interpolation. */
  capture(): void {
    this.previousPosition.copy(this.currentPosition);
    this.previousHeading = this.currentHeading;
    const translation = this.body.translation();
    this.currentPosition.set(translation.x, translation.y, translation.z);
    this.currentHeading = headingOf(this.body.rotation(), this.currentHeading);
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
      steering: this.steering,
      grounded: this.grounded,
    });
  }

  /**
   * Throws the vehicle, for example away from an explosion, and takes the controls from the
   * driver for a moment.
   */
  knock(velocity: THREE.Vector3, stunSeconds: number): void {
    const current = this.body.linvel();
    this.body.setLinvel(
      { x: current.x + velocity.x, y: current.y + velocity.y, z: current.z + velocity.z },
      true,
    );
    this.yawRate += (Math.random() - 0.5) * 6;
    this.stunned = Math.max(this.stunned, stunSeconds);
  }

  /** Sets the velocity of the body directly, for example to carry speed through a wall. */
  setVelocity(x: number, y: number, z: number): void {
    this.body.setLinvel({ x, y, z }, true);
  }

  /** Shows the model at a recorded pose, for the replay. It does not move the body. */
  showAt(position: THREE.Vector3, heading: number): void {
    this.object.position.copy(position);
    this.object.rotation.y = -heading;
  }

  /**
   * Moves the vehicle to a position and stops it.
   *
   * @param height Height of the chassis centre. Without it, the vehicle stands on the ground.
   */
  teleport(position: Vec2, heading: number, height?: number): void {
    const y = height ?? this.groundAt(position[0], position[1], Infinity) + this.spec.rideHeight;
    this.body.setTranslation({ x: position[0], y, z: position[1] }, true);
    this.body.setRotation(yawQuaternion(heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.yawRate = 0;
    this.forwardSpeed = 0;
    this.steering = 0;
    this.slide = 0;
    this.slip = 0;
    this.impactVelocity.set(0, 0, 0);
    this.currentPosition.set(position[0], y, position[1]);
    this.previousPosition.copy(this.currentPosition);
    this.currentHeading = heading;
    this.previousHeading = heading;
    this.heading = heading;
  }

  /** Removes the vehicle from the physics world and from the scene, and frees its geometry. */
  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
    this.object.removeFromParent();
    this.object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        (child.geometry as THREE.BufferGeometry).dispose();
      }
    });
  }
}

/** Quaternion of a body that points along a heading. */
function yawQuaternion(heading: number): { x: number; y: number; z: number; w: number } {
  const half = -heading / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/**
 * Heading of a body that only turns around the vertical axis.
 *
 * @param near A heading close to the true one. The result is the equivalent angle nearest to it.
 */
function headingOf(rotation: { y: number; w: number }, near: number): number {
  const heading = -2 * Math.atan2(rotation.y, rotation.w);
  return near + wrapAngle(heading - near);
}
