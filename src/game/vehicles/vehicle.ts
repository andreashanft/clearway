import type {
  Collider,
  DynamicRayCastVehicleController,
  RigidBody,
} from '@dimforge/rapier3d-compat';
import { Group, type Object3D, Quaternion, Vector3 } from 'three';
import type { ControlFrame } from '../../engine/input/controls';
import { COLLISION, WHEEL_RAY_GROUPS } from '../../engine/collision-groups';
import { InterpolatedPose } from '../../engine/interpolation';
import type { Physics } from '../../engine/physics';
import { assistHeading, type DriveOutput, PointToDrive, stickToHeading } from '../drive';
import type { VehicleType } from '../level-data';

export interface WheelLayout {
  readonly x: number;
  readonly z: number;
  /** Which way this wheel steers: 1 with the front, −1 against it (rear steer), 0 fixed. */
  readonly steer: -1 | 0 | 1;
  readonly driven: boolean;
}

export interface BoxCollider {
  readonly halfExtents: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
}

export interface VehicleSpec {
  readonly type: VehicleType;
  readonly name: string;
  /** Kilograms. */
  readonly mass: number;
  /** Multiplies impact damage against buildings (default 1). */
  readonly damageMultiplier?: number;
  readonly chassis: BoxCollider;
  /** Extra massless collision boxes, such as a blade. */
  readonly extraColliders?: readonly BoxCollider[];
  /** Centre of mass height relative to the body origin; lower is more stable. */
  readonly centreOfMassY: number;
  readonly wheels: {
    readonly connectionY: number;
    readonly radius: number;
    readonly suspensionRest: number;
    readonly suspensionTravel: number;
    readonly stiffness: number;
    readonly compression: number;
    readonly relaxation: number;
    readonly frictionSlip: number;
    readonly sideFriction: number;
    readonly layout: readonly WheelLayout[];
  };
  /** Metres per second. */
  readonly topSpeed: number;
  readonly reverseSpeed: number;
  /** Peak acceleration from rest, m/s². */
  readonly acceleration: number;
  /** Deceleration with the brake held, m/s². */
  readonly brakeDecel: number;
  /** Deceleration when coasting with no throttle, m/s². */
  readonly coastDecel: number;
  /** Full steering lock in radians. */
  readonly maxSteer: number;
  /** Steering lock near standstill for vehicles that pivot in place. */
  readonly pivotSteer?: number;
  /** How fast the wheels reach the requested angle, rad/s. */
  readonly steerRate: number;
  /** Extra yaw control so turning feels responsive; tracked vehicles can pivot in place. */
  readonly yawAssist: {
    readonly maxRate: number;
    readonly strength: number;
    readonly pivotInPlace: boolean;
  };
}

/** The parts of a vehicle spec that every machine shares, wheeled or rail-bound. */
export interface MachineSpec {
  readonly type: VehicleType;
  readonly name: string;
  /** Kilograms. */
  readonly mass: number;
  readonly chassis: BoxCollider;
}

/**
 * Anything the player can drive. Wheeled vehicles extend `Vehicle`; the Railbed, which
 * runs on rails, implements this directly.
 */
export interface Machine {
  readonly spec: MachineSpec;
  readonly root: Group;
  readonly body: RigidBody;
  readonly colliders: readonly Collider[];
  readonly actionLabel: string;
  readonly actionState: ActionState;
  readonly damageMultiplier: number;
  readonly heading: number;
  readonly position: Vector3;
  readonly preStepVelocity: Vector3;
  forwardSpeed: number;
  locked: boolean;
  drive: DriveOutput;
  routeAssist: ((x: number, z: number) => number | null) | null;
  /** True while it is a bridge the Hauler may drive over, like the parked Railbed. */
  readonly bridging?: boolean;
  /** A touchdown on something after a jump, for the destruction system to consume. */
  landing?: { readonly collider: Collider; readonly speed: number } | null;
  /** Damage multiplier for a hit made with one of this machine's colliders. */
  impactMultiplier(collider: Collider, normal?: { x: number; y: number; z: number }): number;
  /** Called after this machine's hit damaged a building. */
  onImpact?(damage: number): void;
  /** Ghost trails and similar ground effects. */
  emitTrails?(frameSeconds: number, spawn: (at: Vector3) => void): void;
  place(x: number, groundY: number, z: number, heading: number): void;
  control(frame: ControlFrame, cameraYaw: number, dt: number): void;
  idle(dt: number): void;
  step(dt: number): void;
  afterStep(): void;
  render(alpha: number, frameSeconds: number): void;
  velocity(out: Vector3): Vector3;
  dispose(): void;
}

export interface ActionState {
  readonly ready: boolean;
  readonly active: boolean;
  readonly charge: number;
}

const UP = new Vector3(0, 1, 0);
const FLIP_RECOVER_SECONDS = 1.5;

/**
 * A drivable vehicle: a Rapier rigid body on a ray-cast wheel controller, with the
 * point-to-drive and classic control schemes, arcade assists and an interpolated model.
 */
export abstract class Vehicle implements Machine {
  readonly root = new Group();
  /** Height of the body origin above flat ground at rest. */
  abstract readonly rideHeight: number;
  /** Short label for the Action button, such as BLADE or BOOST. */
  abstract readonly actionLabel: string;
  readonly body: RigidBody;
  readonly controller: DynamicRayCastVehicleController;
  readonly colliders: Collider[] = [];
  protected readonly pose: InterpolatedPose;
  protected readonly physics: Physics;
  private readonly pointDrive = new PointToDrive();
  private steerAngle = 0;
  private upsideDownTime = 0;
  /** Signed speed along the vehicle's forward axis, m/s. */
  forwardSpeed = 0;
  /** Yaw rate about +y, rad/s (positive turns left). */
  yawRate = 0;
  /** True while at least one wheel touches the ground. */
  grounded = false;
  /**
   * Set on the step the wheels touch down after a jump: what they landed on and how fast
   * the vehicle was falling. The destruction system reads and clears it.
   */
  landing: { readonly collider: Collider; readonly speed: number } | null = null;
  private fallSpeed = 0;
  /** A locked vehicle can't be entered (the Tumbler until its hangar falls). */
  locked = false;
  /** Velocity just before the latest physics step, for measuring impacts. */
  readonly preStepVelocity = new Vector3();
  /**
   * Steering assist: returns the route's heading near (x, z), or null when the vehicle
   * isn't near the route or assist is off.
   */
  routeAssist: ((x: number, z: number) => number | null) | null = null;
  /** The current drive request after control mapping, for animation and debug. */
  drive: DriveOutput = { steer: 0, throttle: 0 };
  braking = false;

  private readonly tmpQuat = new Quaternion();
  private readonly tmpForward = new Vector3();
  private readonly tmpUp = new Vector3();

  protected constructor(
    physics: Physics,
    readonly spec: VehicleSpec,
  ) {
    this.physics = physics;
    const { rapier, world } = physics;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setCanSleep(false)
        .setLinearDamping(0.05)
        .setAngularDamping(0.4),
    );

    const [hx, hy, hz] = spec.chassis.halfExtents;
    const [ox, oy, oz] = spec.chassis.offset;
    const inertia = {
      x: (spec.mass / 3) * (hy * hy + hz * hz),
      y: (spec.mass / 3) * (hx * hx + hz * hz),
      z: (spec.mass / 3) * (hx * hx + hy * hy),
    };
    this.colliders.push(
      world.createCollider(
        rapier.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(ox, oy, oz)
          .setMassProperties(spec.mass, { x: 0, y: spec.centreOfMassY - oy, z: 0 }, inertia, {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
          })
          .setFriction(0.6)
          .setCollisionGroups(COLLISION.vehicle),
        this.body,
      ),
    );
    for (const extra of spec.extraColliders ?? []) {
      const [ex, ey, ez] = extra.halfExtents;
      const [px, py, pz] = extra.offset;
      this.colliders.push(
        world.createCollider(
          rapier.ColliderDesc.cuboid(ex, ey, ez)
            .setTranslation(px, py, pz)
            .setDensity(0)
            .setFriction(0.5)
            .setCollisionGroups(COLLISION.vehicle),
          this.body,
        ),
      );
    }

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const w = spec.wheels;
    spec.wheels.layout.forEach((wheel, i) => {
      this.controller.addWheel(
        { x: wheel.x, y: w.connectionY, z: wheel.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        w.suspensionRest,
        w.radius,
      );
      this.controller.setWheelSuspensionStiffness(i, w.stiffness);
      this.controller.setWheelSuspensionCompression(i, w.compression);
      this.controller.setWheelSuspensionRelaxation(i, w.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, w.suspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, spec.mass * 9.81 * 3);
      this.controller.setWheelFrictionSlip(i, w.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, w.sideFriction);
    });

    this.root.name = spec.name;
    this.pose = new InterpolatedPose(this.body, this.root);
  }

  /** World-space heading (rotation about +y); 0 faces +z. */
  get heading(): number {
    const r = this.body.rotation();
    this.tmpQuat.set(r.x, r.y, r.z, r.w);
    this.tmpForward.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    return Math.atan2(this.tmpForward.x, this.tmpForward.z);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  /** By default every collider hits with the vehicle's damage multiplier. */
  impactMultiplier(_collider: Collider, _normal?: { x: number; y: number; z: number }): number {
    return this.damageMultiplier;
  }

  /** Multiplies impact damage against buildings; 0 means this vehicle can't damage. */
  get damageMultiplier(): number {
    return this.spec.damageMultiplier ?? 1;
  }

  /** Whether Action can fire now, whether its effect is on, and its charge (0–1). */
  get actionState(): ActionState {
    return { ready: true, active: false, charge: 1 };
  }

  /** World-space linear velocity, written into `out`. */
  velocity(out: Vector3): Vector3 {
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  /** Puts the vehicle at rest at a ground position. */
  place(x: number, groundY: number, z: number, heading: number): void {
    this.body.setTranslation({ x, y: groundY + this.rideHeight + 0.15, z }, true);
    this.tmpQuat.setFromAxisAngle(UP, heading);
    this.body.setRotation(this.tmpQuat, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.pointDrive.reset();
    this.pose.snap();
  }

  /** Applies one fixed step of player control. `cameraYaw` maps the stick to the world. */
  control(frame: ControlFrame, cameraYaw: number, dt: number): void {
    this.drive = this.mapControls(frame, cameraYaw);
    this.braking = frame.brake;
    this.applyDrive(this.drive, frame.brake, dt);
    this.handleAction(frame);
  }

  /** Leaves the vehicle without a driver: brakes held, wheels straight. */
  idle(dt: number): void {
    this.drive = { steer: 0, throttle: 0 };
    this.braking = true;
    this.applyDrive(this.drive, true, dt);
  }

  /** Advances the wheel controller. Call once per fixed step before the world steps. */
  step(dt: number): void {
    this.controller.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);
    const v = this.body.linvel();
    this.preStepVelocity.set(v.x, v.y, v.z);
    this.readMotion();
    this.recoverIfFlipped(dt);
  }

  /** Call after the physics world has stepped. */
  afterStep(): void {
    this.pose.capture();
  }

  /** Wheel meshes, by wheel index, that follow suspension, steering and spin. */
  protected readonly wheelMeshes: (Object3D | undefined)[] = [];

  /** Interpolates the model and runs visual animation. */
  render(alpha: number, frameSeconds: number): void {
    this.pose.apply(alpha);
    this.updateWheelMeshes();
    this.animate(frameSeconds);
  }

  dispose(): void {
    this.physics.world.removeVehicleController(this.controller);
    this.physics.world.removeRigidBody(this.body);
    this.root.removeFromParent();
  }

  private updateWheelMeshes(): void {
    const { controller } = this;
    this.wheelMeshes.forEach((mesh, i) => {
      if (!mesh) return;
      const connection = controller.wheelChassisConnectionPointCs(i)?.y ?? 0;
      const suspension = controller.wheelSuspensionLength(i) ?? 0;
      mesh.position.y = connection - suspension;
      mesh.rotation.set(
        controller.wheelRotation(i) ?? 0,
        controller.wheelSteering(i) ?? 0,
        0,
        'YXZ',
      );
    });
  }

  /** Per-frame visual animation (tracks, glows, moving parts). */
  protected abstract animate(frameSeconds: number): void;

  /** Reacts to the Action button; called every fixed step while driven. */
  protected abstract handleAction(frame: ControlFrame): void;

  private mapControls(frame: ControlFrame, cameraYaw: number): DriveOutput {
    const magnitude = Math.min(1, Math.hypot(frame.stickX, frame.stickY));
    if (magnitude > 0.01) {
      let target = stickToHeading(frame.stickX, frame.stickY, cameraYaw);
      const p = this.body.translation();
      const routeHeading = this.routeAssist?.(p.x, p.z) ?? null;
      if (routeHeading !== null) target = assistHeading(target, routeHeading);
      return this.pointDrive.update(this.heading, target, magnitude);
    }
    this.pointDrive.reset();
    return { steer: frame.steer, throttle: frame.throttle };
  }

  private applyDrive(drive: DriveOutput, brake: boolean, dt: number): void {
    const { spec, controller } = this;
    const driven = spec.wheels.layout.filter((w) => w.driven).length || 1;
    const maxForce = (spec.mass * spec.acceleration) / driven;
    const speed = this.forwardSpeed;

    let engine = 0;
    let brakeDecel = brake ? spec.brakeDecel : 0;
    if (drive.throttle > 0.02) {
      if (speed < -0.8) brakeDecel = Math.max(brakeDecel, spec.brakeDecel);
      else engine = drive.throttle * maxForce * taper(speed / spec.topSpeed);
    } else if (drive.throttle < -0.02) {
      if (speed > 0.8) brakeDecel = Math.max(brakeDecel, spec.brakeDecel);
      else engine = drive.throttle * maxForce * 0.7 * taper(-speed / spec.reverseSpeed);
    } else {
      brakeDecel = Math.max(brakeDecel, spec.coastDecel);
    }
    if (brake) engine = 0;

    // The controller treats brake as a per-step impulse limit on each wheel.
    const wheelCount = spec.wheels.layout.length;
    const brakeImpulse = (spec.mass * brakeDecel * dt) / wheelCount;

    // Less steering lock at speed keeps fast vehicles stable; pivoting vehicles get extra
    // lock near standstill so their wheels line up with the turn.
    const speedFactor = 1 - 0.55 * Math.min(1, Math.abs(speed) / Math.max(1, spec.topSpeed));
    const pivotBlend = spec.pivotSteer ? 1 - Math.min(1, Math.abs(speed) / 3) : 0;
    const lock = spec.maxSteer + ((spec.pivotSteer ?? spec.maxSteer) - spec.maxSteer) * pivotBlend;
    const targetSteer = -drive.steer * lock * speedFactor;
    const maxDelta = spec.steerRate * dt;
    this.steerAngle += Math.max(-maxDelta, Math.min(maxDelta, targetSteer - this.steerAngle));

    spec.wheels.layout.forEach((wheel, i) => {
      controller.setWheelEngineForce(i, wheel.driven ? engine : 0);
      controller.setWheelBrake(i, brakeImpulse);
      controller.setWheelSteering(i, this.steerAngle * wheel.steer);
    });

    this.applyYawAssist(drive, speed);
  }

  private applyYawAssist(drive: DriveOutput, speed: number): void {
    const { yawAssist, topSpeed } = this.spec;
    if (!this.grounded || yawAssist.strength <= 0) return;
    // Turn the way the driver means to travel; when coasting, the way the vehicle rolls.
    let direction = speed < -0.5 ? -1 : 1;
    if (drive.throttle > 0.02) direction = 1;
    else if (drive.throttle < -0.02) direction = -1;
    // Wheeled vehicles need some speed to turn; tracked ones pivot from standstill.
    const speedGate = yawAssist.pivotInPlace ? 1 : Math.min(1, Math.abs(speed) / 3);
    const atSpeed = 1 - 0.4 * Math.min(1, Math.abs(speed) / topSpeed);
    const desired = -drive.steer * yawAssist.maxRate * speedGate * atSpeed * direction;
    const current = this.body.angvel().y;
    const inertia = this.body.principalInertia().y;
    const impulse = (desired - current) * inertia * yawAssist.strength;
    this.body.applyTorqueImpulse({ x: 0, y: impulse, z: 0 }, true);
  }

  private readMotion(): void {
    const v = this.body.linvel();
    const r = this.body.rotation();
    this.tmpQuat.set(r.x, r.y, r.z, r.w);
    this.tmpForward.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    this.forwardSpeed = v.x * this.tmpForward.x + v.y * this.tmpForward.y + v.z * this.tmpForward.z;
    this.yawRate = this.body.angvel().y;
    let contact = false;
    let ground: Collider | null = null;
    for (let i = 0; i < this.controller.numWheels(); i++) {
      if (!this.controller.wheelIsInContact(i)) continue;
      contact = true;
      ground ??= this.controller.wheelGroundObject(i);
    }
    // Wheels touch roofs only with their rays, so a landing never collides with the
    // chassis. Track the fall instead and report the touchdown.
    if (!contact) this.fallSpeed = Math.max(this.fallSpeed, -v.y);
    else if (!this.grounded && ground && this.fallSpeed > 0) {
      this.landing = { collider: ground, speed: this.fallSpeed };
    }
    if (contact) this.fallSpeed = 0;
    this.grounded = contact;
  }

  private recoverIfFlipped(dt: number): void {
    const r = this.body.rotation();
    this.tmpQuat.set(r.x, r.y, r.z, r.w);
    this.tmpUp.set(0, 1, 0).applyQuaternion(this.tmpQuat);
    const slow = this.body.linvel().y ** 2 + this.forwardSpeed ** 2 < 4;
    if (this.tmpUp.y < 0.3 && slow) {
      this.upsideDownTime += dt;
      if (this.upsideDownTime > FLIP_RECOVER_SECONDS) {
        const t = this.body.translation();
        this.tmpQuat.setFromAxisAngle(UP, this.heading);
        this.body.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true);
        this.body.setRotation(this.tmpQuat, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.upsideDownTime = 0;
      }
    } else {
      this.upsideDownTime = 0;
    }
  }
}

/** Engine force falls off towards top speed and is zero beyond it. */
function taper(speedRatio: number): number {
  if (speedRatio >= 1) return 0;
  if (speedRatio <= 0) return 1;
  return 1 - speedRatio * speedRatio;
}
