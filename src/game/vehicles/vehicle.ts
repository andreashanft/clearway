import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import { approach, clamp, damp, lerp, wrapAngle, type OrientedBox, type Vec2 } from '../math';
import type { DriveCommand } from './drive-control';
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
/** A vehicle that is faster than its engine allows, for example downhill, slows by this, in m/s². */
const OVERSPEED_DRAG = 1.5;
/** Vehicles cannot climb ground that is steeper than this, in radians. */
const MAX_CLIMB = 0.72;
/** How long a ram charge stays armed for its damage bonus after it fires, in seconds. */
const RAM_ARMED_SECONDS = 1.1;
/** The Fishtail only skids above this speed, in m/s. */
const SKID_MIN_SPEED = 7;
/** While it skids, the Fishtail slides on with its momentum, loses speed slowly and turns faster. */
const SKID_DRAG = 0.28;
const SKID_TURN_FACTOR = 1.9;
/** While it rolls, the Tumbler steers at this fraction of its turn rate. */
const ROLL_TURN_FACTOR = 0.5;
/** A roll that hits within this many seconds of the last hit builds the chain. */
export const ROLL_CHAIN_SECONDS = 2;
export const ROLL_CHAIN_MAX = 3;
/** Each step of the roll chain adds this much damage. */
export const ROLL_CHAIN_BONUS = 0.25;
/** The armoured tail of a skidding Fishtail multiplies its damage by this. */
export const SKID_DAMAGE_FACTOR = 3.6;
/** In a skid, the truck turns this far away from its direction of travel, in radians. */
export const SKID_SLIP_ANGLE = (62 * Math.PI) / 180;

/** The Action button as one simulation step sees it. */
export interface ActionInput {
  held: boolean;
  /** True in the step in which the button went down. */
  pressed: boolean;
  /**
   * Side on which the nearest wall lies: -1 left, 1 right, 0 none. With auto-skid on, a Fishtail
   * that gets no steering input swings its tail towards that side.
   */
  wallSide?: number;
}

const NO_ACTION: Readonly<ActionInput> = { held: false, pressed: false };

/**
 * A drivable vehicle, or the pilot on foot.
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
  /** False while the vehicle is out of play: the pilot inside a vehicle, or a locked vehicle. */
  enabled = true;
  /** True while the vehicle cannot be entered, for example the Tumbler inside its hangar. */
  locked = false;
  /** Charge of the action from 0 (empty) to 1 (ready). */
  actionCharge = 1;
  /** True while the action runs: the ram burst, the boost, the roll or the skid. */
  actionActive = false;
  /** True while the next hit deals the ram bonus damage. */
  ramArmed = false;
  /** Number of chained roll hits. Each one adds damage to the next. */
  rollChain = 0;
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
  private actionTimer = 0;
  private armedTimer = 0;
  private chainTimer = 0;
  private skidSign = 1;
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
    // The Railbed never turns. Every other vehicle turns around the vertical axis only.
    const turns = spec.turnRate > 0;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], y, position[1])
        .setRotation(yawQuaternion(heading))
        .enabledRotations(false, turns, false)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.length / 2, spec.height / 2, spec.width / 2)
        .setMass(spec.mass)
        .setFriction(0.2)
        .setRestitution(0)
        .setCollisionGroups(layerGroups(spec)),
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

  /** True while the Fishtail skids. Its tail then deals the damage. */
  get skidding(): boolean {
    return this.spec.actionKind === 'skid' && this.actionActive;
  }

  /** The way the truck turns in a skid: -1 to the left, 1 to the right. */
  get skidDirection(): number {
    return this.skidSign;
  }

  /** True while the Tumbler rolls. */
  get rolling(): boolean {
    return this.spec.actionKind === 'roll' && this.actionActive;
  }

  /** Returns the footprint of the vehicle on the ground plane. */
  get footprint(): OrientedBox {
    return {
      center: [this.currentPosition.x, this.currentPosition.z],
      half: [this.spec.length / 2, this.spec.width / 2],
      heading: this.heading,
    };
  }

  /** Takes the vehicle out of play or brings it back. A disabled vehicle is invisible. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.body.setEnabled(enabled);
    this.object.visible = enabled;
    if (!enabled) {
      this.actionActive = false;
    }
  }

  /** Runs one simulation step. Call it before the physics step. */
  step(dt: number, command: Readonly<DriveCommand>, action: Readonly<ActionInput>): void {
    if (!this.enabled) {
      return;
    }
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
    this.updateAction(dt, stunned ? NO_ACTION : action, command, Math.hypot(forward, sideways));

    const slopePitch = Math.atan2(front - rear, halfLength * 2);
    const slopeRoll = Math.atan2(right - left, halfWidth * 2);
    const burst =
      this.actionActive &&
      (spec.actionKind === 'ram' || spec.actionKind === 'boost' || this.rolling);

    if ((this.grounded || supported) && stunned) {
      // Thrown by an explosion: the vehicle slides until the driver has control again.
      forward = approach(forward, 0, spec.coasting * 0.5 * dt);
      sideways *= Math.exp(-1.5 * dt);
      this.yawRate = lerp(this.yawRate, 0, damp(1.5, dt));
    } else if (this.grounded && this.skidding) {
      // A skid: the engine is out of the game. The truck slides on in the direction in which it
      // was moving, while its body turns across that direction.
      const keep = Math.exp(-SKID_DRAG * dt);
      forward *= keep;
      sideways *= keep;
      const steer = Math.abs(command.steer) > 0.2 ? clamp(command.steer, -1, 1) : this.skidSign;
      const target = steer * spec.turnRate * SKID_TURN_FACTOR;
      this.yawRate = lerp(this.yawRate, target, damp(spec.turnResponse, dt));
    } else if (this.grounded || supported) {
      const topSpeed = spec.topSpeed * (burst ? spec.actionSpeed : 1);
      const acceleration = spec.acceleration * (burst ? spec.actionAcceleration : 1);
      const throttle = burst ? 1 : clamp(command.throttle, -1, 1);
      const target = throttle >= 0 ? throttle * topSpeed : throttle * spec.reverseSpeed;

      if (command.brake && !burst) {
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
        forward = approach(forward, target, OVERSPEED_DRAG * dt);
      }
      if (this.grounded) {
        forward -= SLOPE_GRAVITY * Math.sin(slopePitch) * dt;
        // A bank that is too steep stops the vehicle like a wall.
        if (slopePitch > MAX_CLIMB && forward > 0) {
          forward = 0;
        } else if (slopePitch < -MAX_CLIMB && forward < 0) {
          forward = 0;
        }
      }
      sideways *= Math.exp(-spec.grip * dt);

      // Steering. A wheeled vehicle needs speed to turn; a tracked vehicle turns on the spot.
      const reversing = forward < -0.5;
      const turnFactor = spec.pivots
        ? reversing
          ? -1
          : 1
        : clamp(forward / spec.fullTurnSpeed, -1, 1);
      const steer = clamp(command.steer, -1, 1);
      const turnRate = spec.turnRate * (this.rolling ? ROLL_TURN_FACTOR : 1);
      this.yawRate = lerp(this.yawRate, steer * turnRate * turnFactor, damp(spec.turnResponse, dt));
    } else {
      // In the air: the rocket of the Liftoff still pushes, everything else just flies.
      if (burst && spec.actionKind === 'boost') {
        forward = approach(forward, spec.topSpeed * spec.actionSpeed, spec.acceleration * dt);
      }
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
    if (!this.enabled) {
      return;
    }
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
      actionCharge: this.actionCharge,
      actionActive: this.actionActive,
      grounded: this.grounded,
    });
  }

  /**
   * Counts a roll hit for the chain and returns the damage factor of this hit.
   * Each roll that hits within two seconds of the last one adds a quarter, up to three times.
   */
  registerRollHit(): number {
    this.rollChain = this.chainTimer > 0 ? Math.min(ROLL_CHAIN_MAX, this.rollChain + 1) : 0;
    this.chainTimer = ROLL_CHAIN_SECONDS;
    return 1 + ROLL_CHAIN_BONUS * this.rollChain;
  }

  /**
   * Throws the vehicle, for example away from an explosion, and takes the controls from the
   * driver for a moment.
   */
  knock(velocity: THREE.Vector3, stunSeconds: number): void {
    if (!this.enabled) {
      return;
    }
    const current = this.body.linvel();
    this.body.setLinvel(
      { x: current.x + velocity.x, y: current.y + velocity.y, z: current.z + velocity.z },
      true,
    );
    this.yawRate += (Math.random() - 0.5) * 6;
    this.stunned = Math.max(this.stunned, stunSeconds);
    this.actionActive = false;
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
    this.currentPosition.set(position[0], y, position[1]);
    this.previousPosition.copy(this.currentPosition);
    this.currentHeading = heading;
    this.previousHeading = heading;
    this.heading = heading;
  }

  private updateAction(
    dt: number,
    action: Readonly<ActionInput>,
    command: Readonly<DriveCommand>,
    speed: number,
  ): void {
    const { spec } = this;
    if (this.armedTimer > 0) {
      this.armedTimer -= dt;
      if (this.armedTimer <= 0) {
        this.ramArmed = false;
      }
    }
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) {
        this.rollChain = 0;
      }
    }

    if (spec.actionKind === 'none') {
      return;
    }
    if (spec.actionKind === 'skid') {
      // The skid lasts as long as the button is held and the truck is fast enough.
      const wasSkidding = this.actionActive;
      this.actionActive = action.held && speed > SKID_MIN_SPEED;
      if (this.actionActive && !wasSkidding) {
        const steer = command.steer;
        this.skidSign =
          Math.abs(steer) > 0.2 ? Math.sign(steer) : action.wallSide ? -action.wallSide : 1;
      }
      this.actionCharge = 1;
      return;
    }

    // Ram, boost and roll: a timed burst, then a recharge.
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
      if (spec.actionKind === 'ram') {
        this.ramArmed = true;
        this.armedTimer = RAM_ARMED_SECONDS;
      }
    }
  }
}

/** Collision layers of a vehicle type. */
function layerGroups(spec: VehicleSpec): number {
  const solids = Layer.building | Layer.vehicle | Layer.crate | Layer.prop | Layer.bridge;
  if (spec.type === 'pilot') {
    return collisionGroups(Layer.pilot, solids | Layer.hauler);
  }
  if (spec.type === 'railbed') {
    // The Railbed is a moving bridge. The Hauler's crash sensor ignores bridges.
    return collisionGroups(Layer.bridge, Layer.vehicle | Layer.pilot | Layer.crate | Layer.debris);
  }
  return collisionGroups(Layer.vehicle, solids | Layer.debris | Layer.hauler | Layer.pilot);
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
