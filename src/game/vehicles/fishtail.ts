import type { Collider } from '@dimforge/rapier3d-compat';
import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ControlFrame } from '../../engine/input/controls';
import type { Physics } from '../../engine/physics';
import { stickToHeading, wrapAngle } from '../drive';
import { FINISH } from '../models/finish';
import { createReadyGlow } from '../models/materials';
import { ModelBuilder } from '../models/model-builder';
import { type ActionState, Vehicle, type VehicleSpec } from './vehicle';

const KMH = 1 / 3.6;
const RIDE_HEIGHT = 1.25;
const WHEEL_R = 0.55;
const DEG = Math.PI / 180;

/** Forward speed a slide needs to start, m/s: you can't skid from standstill. */
export const SLIDE_START_SPEED = 6;
/** A slide ends when the truck is slower than this along its course, m/s. */
export const SLIDE_END_SPEED = 4;
/** How far the truck turns away from its course in a slide: nearly broadside. */
export const SLIP_ANGLE = 78 * DEG;
/** Speed a slide loses each second, m/s². */
export const SLIDE_DRAG = 2;
/** How fast steering bends the course of a slide, rad/s. */
const COURSE_RATE = 1.1;
/** How fast the truck swings into and out of a slide, rad/s. */
const SWING_RATE = 5;
const SWING_GAIN = 9;
/** Grip of the tyres in a slide; the slide's own drag does the slowing. */
const SLIDE_FRICTION = 0.05;
/** Longest the truck takes to straighten up after a slide, seconds. */
const RECOVER_SECONDS = 0.6;
/** Share of the truck's speed that counts for a hit in a slide, however it glances. */
const SWEEP_SHARE = 0.9;

/**
 * Damage multipliers. A slide turns the whole truck into the weapon, the armoured tail
 * most of all; a plain ram with the cab does less.
 */
export const FISHTAIL_DAMAGE = { tailSliding: 2, bodySliding: 1.5, tail: 0.9, body: 0.6 } as const;

type Phase = 'grip' | 'slide' | 'recover';

export const FISHTAIL_SPEC: VehicleSpec = {
  type: 'fishtail',
  name: 'Fishtail',
  mass: 7500,
  chassis: { halfExtents: [1.25, 0.75, 3.3], offset: [0, 0.3, -0.1] },
  extraColliders: [{ halfExtents: [1.4, 0.65, 0.2], offset: [0, 0, -3.62] }],
  centreOfMassY: -0.5,
  wheels: {
    connectionY: -0.35,
    radius: WHEEL_R,
    suspensionRest: 0.45,
    suspensionTravel: 0.35,
    stiffness: 30,
    compression: 4.2,
    relaxation: 3,
    frictionSlip: 3.4,
    sideFriction: 1.2,
    layout: [
      { x: 1.12, z: 2.55, steer: 1, driven: false },
      { x: -1.12, z: 2.55, steer: 1, driven: false },
      { x: 1.12, z: -2.45, steer: 0, driven: true },
      { x: -1.12, z: -2.45, steer: 0, driven: true },
    ],
  },
  topSpeed: 125 * KMH,
  reverseSpeed: 50 * KMH,
  acceleration: 20,
  brakeDecel: 30,
  coastDecel: 4,
  maxSteer: 0.55,
  steerRate: 5,
  grip: 8,
  yawAssist: { maxRate: 2.6, strength: 0.35, pivotInPlace: false },
};

function wheel(): Group {
  const g = new Group();
  g.add(
    new ModelBuilder()
      .add(new CylinderGeometry(WHEEL_R, WHEEL_R, 0.5, 16), FINISH.rubber, {
        rotate: [0, 0, Math.PI / 2],
      })
      .add(new CylinderGeometry(0.3, 0.3, 0.52, 10), FINISH.steel, { rotate: [0, 0, Math.PI / 2] })
      .build('fishtail-wheel'),
  );
  return g;
}

/**
 * The skid dump truck. Hold Action at speed and it swings broadside and slides on along
 * its course, smashing what it sweeps through; steering bends the course. Let go and it
 * straightens up and drives on.
 */
export class Fishtail extends Vehicle {
  readonly rideHeight = RIDE_HEIGHT;
  readonly actionLabel = 'SKID';
  /**
   * Settings: straighten up along the course when a slide ends. Without it the truck
   * leaves the slide the way it points, which makes a slide a sharp turn.
   */
  autoSkid = true;
  private phase: Phase = 'grip';
  /** World heading the truck travels along while it slides. */
  private course = 0;
  /** Which way the nose turns off the course: 1 to the left, −1 to the right. */
  private side: 1 | -1 = 1;
  private recoverTime = 0;
  /** True once a slide has ended with Action still held; Action must be let go first. */
  private spent = false;
  private held = false;
  /** Course change the player asks for in a slide, rad/s. */
  private courseTurn = 0;
  private cameraYaw = 0;
  private readonly tailGlow = createReadyGlow();
  private glowTime = 0;
  private trailClock = 0;
  private readonly tmp = new Vector3();
  /** The second rear axle: each wheel copies the driven wheel in front of it. */
  private readonly twins: { readonly pivot: Group; readonly source: number }[] = [];

  constructor(physics: Physics) {
    super(physics, FISHTAIL_SPEC);
    this.root.add(this.buildModel());
  }

  get isSkidding(): boolean {
    return this.phase === 'slide';
  }

  override get actionState(): ActionState {
    return { ready: true, active: this.phase === 'slide', charge: 1 };
  }

  override impactMultiplier(collider: Collider): number {
    const tail = collider === this.colliders[1];
    if (this.phase === 'grip') return tail ? FISHTAIL_DAMAGE.tail : FISHTAIL_DAMAGE.body;
    return tail ? FISHTAIL_DAMAGE.tailSliding : FISHTAIL_DAMAGE.bodySliding;
  }

  /** A sliding truck sweeps through things, so a glancing hit counts nearly in full. */
  override impactSpeed(normalSpeed: number): number {
    if (this.phase === 'grip') return normalSpeed;
    const v = this.preStepVelocity;
    return Math.max(normalSpeed, Math.hypot(v.x, v.z) * SWEEP_SHARE);
  }

  /** Calls `spawn` with each wheel's ground point while sliding (ghost trails). */
  override emitTrails(frameSeconds: number, spawn: (at: Vector3, skid?: boolean) => void): void {
    if (this.phase !== 'slide') {
      super.emitTrails(frameSeconds, spawn);
      return;
    }
    this.trailClock -= frameSeconds;
    if (this.trailClock > 0) return;
    this.trailClock = 0.05;
    for (const wheel of FISHTAIL_SPEC.wheels.layout) {
      this.tmp.set(wheel.x, -RIDE_HEIGHT + 0.2, wheel.z);
      spawn(this.root.localToWorld(this.tmp.clone()), true);
    }
  }

  override place(x: number, groundY: number, z: number, heading: number): void {
    super.place(x, groundY, z, heading);
    this.phase = 'grip';
    this.spent = false;
  }

  override control(frame: ControlFrame, cameraYaw: number, dt: number): void {
    this.cameraYaw = cameraYaw;
    super.control(frame, cameraYaw, dt);
  }

  override idle(dt: number): void {
    this.held = false;
    this.phase = 'grip';
    super.idle(dt);
  }

  protected handleAction(frame: ControlFrame): void {
    this.held = frame.action;
    if (!frame.action) this.spent = false;
    const stick = Math.hypot(frame.stickX, frame.stickY) > 0.01;
    const wanted = stick ? stickToHeading(frame.stickX, frame.stickY, this.cameraYaw) : null;

    if (this.phase !== 'slide') {
      const start =
        frame.action && !this.spent && this.grounded && this.forwardSpeed > SLIDE_START_SPEED;
      if (!start) return;
      const v = this.body.linvel();
      this.course = Math.atan2(v.x, v.z);
      // Turn the nose the way the player steers, or the way the truck is already turning.
      const lean = wanted !== null ? wrapAngle(wanted - this.course) : -frame.steer;
      if (Math.abs(lean) > 0.05) this.side = lean > 0 ? 1 : -1;
      else if (Math.abs(this.yawRate) > 0.15) this.side = this.yawRate > 0 ? 1 : -1;
      else this.side = this.side === 1 ? -1 : 1;
      this.phase = 'slide';
    }
    // The stick points where the slide should go; classic steering bends it.
    if (wanted !== null) {
      this.courseTurn = Math.max(
        -COURSE_RATE,
        Math.min(COURSE_RATE, wrapAngle(wanted - this.course) * 4),
      );
    } else {
      this.courseTurn = -frame.steer * COURSE_RATE;
    }
  }

  override step(dt: number): void {
    if (this.phase !== 'grip') this.slide(dt);
    const sliding = this.phase !== 'grip';
    // A slide needs the tyres to let go, so the arcade grip and the yaw assist do too.
    this.gripScale = sliding ? 0 : 1;
    this.yawAssistScale = sliding ? 0 : 1;
    const { frictionSlip, sideFriction } = FISHTAIL_SPEC.wheels;
    for (let i = 0; i < FISHTAIL_SPEC.wheels.layout.length; i++) {
      this.controller.setWheelFrictionSlip(i, sliding ? SLIDE_FRICTION : frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, sliding ? SLIDE_FRICTION : sideFriction);
      if (sliding) {
        this.controller.setWheelEngineForce(i, 0);
        this.controller.setWheelBrake(i, 0);
      }
    }
    super.step(dt);
  }

  /** Carries the truck along its course and swings it broadside, or straight again. */
  private slide(dt: number): void {
    if (!this.grounded) return;
    const recovering = this.phase === 'recover';
    this.course = wrapAngle(this.course + this.courseTurn * dt);
    const cx = Math.sin(this.course);
    const cz = Math.cos(this.course);
    const v = this.body.linvel();
    const along = Math.max(0, v.x * cx + v.z * cz - (recovering ? 0 : SLIDE_DRAG * dt));
    this.body.setLinvel({ x: cx * along, y: v.y, z: cz * along }, true);

    const target = recovering ? this.course : this.course + this.side * SLIP_ANGLE;
    const error = wrapAngle(target - this.heading);
    const wanted = Math.max(-SWING_RATE, Math.min(SWING_RATE, error * SWING_GAIN));
    const spin = this.body.angvel();
    const yaw = spin.y + (wanted - spin.y) * Math.min(1, 14 * dt);
    this.body.setAngvel({ x: spin.x, y: yaw, z: spin.z }, true);

    if (recovering) {
      this.recoverTime += dt;
      if (Math.abs(error) < 5 * DEG || this.recoverTime > RECOVER_SECONDS) this.phase = 'grip';
      return;
    }
    if (this.held && along >= SLIDE_END_SPEED) return;
    this.spent = this.held;
    this.recoverTime = 0;
    // Too slow to straighten up, as after hitting a wall: just grip again.
    this.phase = this.autoSkid && along > SLIDE_END_SPEED / 2 ? 'recover' : 'grip';
  }

  protected animate(frameSeconds: number): void {
    for (const { pivot, source } of this.twins) {
      const lead = this.wheelMeshes[source];
      if (!lead) continue;
      pivot.position.y = lead.position.y;
      pivot.rotation.copy(lead.rotation);
    }
    this.glowTime += frameSeconds;
    this.tailGlow.emissiveIntensity = this.isSkidding
      ? 2.6
      : 1.1 + Math.sin(this.glowTime * 3.3) * 0.2;
  }

  private buildModel(): Group {
    const m = FINISH;
    const b = new ModelBuilder();
    const rbox = (w: number, h: number, d: number, r = 0.08): RoundedBoxGeometry =>
      new RoundedBoxGeometry(w, h, d, 2, r);
    const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
    // Chassis rails and fenders.
    b.add(box(1.9, 0.4, 7.2), m.darkSteel, { at: [0, 0.95, -0.2] });
    // Cab: rounded block with a wide windscreen, black grille and a roof beacon.
    b.add(rbox(2.4, 1.7, 1.9, 0.14), m.hazardPaint, { at: [0, 1.95, 2.75] });
    b.add(rbox(2.2, 0.75, 0.1, 0.04), m.glass, { at: [0, 2.3, 3.71] });
    b.addMirrored(rbox(0.08, 0.6, 1.2, 0.03), m.glass, { at: [1.21, 2.3, 2.75] });
    b.add(box(1.8, 0.5, 0.12), m.blackBand, { at: [0, 1.45, 3.72] });
    b.addMirrored(box(0.36, 0.18, 0.08), m.headlight, { at: [0.85, 1.45, 3.76] });
    b.add(new CylinderGeometry(0.14, 0.14, 0.2, 10), m.beaconAmber, { at: [0.6, 2.9, 2.5] });
    // Tipper body with ribs and a load of rubble.
    b.add(rbox(2.6, 1.5, 4.9, 0.08), m.hazardPaint, { at: [0, 2.05, -0.95] });
    b.add(box(2.3, 0.2, 4.6), m.darkSteel, { at: [0, 2.72, -0.95] });
    for (let k = 0; k < 5; k++) {
      b.addMirrored(box(0.1, 1.5, 0.22), m.hazardDeep, { at: [1.33, 2.05, -3.0 + k * 1.05] });
    }
    b.add(box(2.64, 0.14, 4.94), m.hazardDeep, { at: [0, 2.82, -0.95] });
    // The armoured tail plate.
    b.add(rbox(2.75, 1.3, 0.38, 0.06), m.steel, { at: [0, 1.6, -3.62] });
    for (let k = 0; k < 4; k++) {
      b.add(box(0.12, 1.2, 0.1), m.darkSteel, { at: [-1.0 + k * 0.66, 1.6, -3.84] });
    }
    b.addMirrored(box(0.26, 0.14, 0.06), m.tailLight, { at: [1.1, 2.05, -3.83] });
    const root = new Group();
    root.add(b.build('fishtail-body'));
    const glow = new Mesh(box(2.7, 0.08, 0.08), this.tailGlow);
    glow.position.set(0, 2.3, -3.85);
    root.add(glow);

    // Wheels follow the ray-cast controller; the rear axle is doubled for looks.
    FISHTAIL_SPEC.wheels.layout.forEach((layout, i) => {
      const pivot = new Group();
      pivot.position.set(layout.x, 0, layout.z);
      const w = wheel();
      pivot.add(w);
      root.add(pivot);
      this.wheelMeshes[i] = pivot;
      if (layout.z < 0) {
        // On its own pivot one metre back, so it spins about its own axle and doesn't
        // swing round the driven wheel's.
        const twin = new Group();
        twin.position.set(layout.x, 0, layout.z - 1.0);
        twin.add(wheel());
        root.add(twin);
        this.twins.push({ pivot: twin, source: i });
      }
    });
    // The wheel pivots are positioned in body space; the model root is not offset.
    const wrapper = new Group();
    wrapper.add(root);
    // Shift the drawn body (built with the ground at y = 0) but keep wheel pivots in body space.
    for (const child of root.children) {
      const wheelPivot =
        this.wheelMeshes.includes(child) || this.twins.some((twin) => twin.pivot === child);
      if (!wheelPivot) child.position.y -= RIDE_HEIGHT;
    }
    return wrapper;
  }
}
