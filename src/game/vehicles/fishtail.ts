import type { Collider } from '@dimforge/rapier3d-compat';
import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ControlFrame } from '../../engine/input/controls';
import type { Physics } from '../../engine/physics';
import { FINISH } from '../models/finish';
import { createReadyGlow } from '../models/materials';
import { ModelBuilder } from '../models/model-builder';
import { type ActionState, Vehicle, type VehicleSpec } from './vehicle';

const KMH = 1 / 3.6;
const RIDE_HEIGHT = 1.25;
const WHEEL_R = 0.55;
/** Speed below which Action does nothing: you can't skid from standstill. */
const MIN_SKID_SPEED = 5;
/** Yaw rate the skid aims for, rad/s. */
const SKID_YAW_RATE = 2.4;

/** Damage multipliers: the armoured tail is the weapon, the cab is not. */
export const FISHTAIL_DAMAGE = { tailSkidding: 1.8, tail: 0.9, body: 0.4 } as const;

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
    frictionSlip: 2.6,
    sideFriction: 1.2,
    layout: [
      { x: 1.12, z: 2.55, steer: 1, driven: false },
      { x: -1.12, z: 2.55, steer: 1, driven: false },
      { x: 1.12, z: -2.45, steer: 0, driven: true },
      { x: -1.12, z: -2.45, steer: 0, driven: true },
    ],
  },
  topSpeed: 80 * KMH,
  reverseSpeed: 25 * KMH,
  acceleration: 6,
  brakeDecel: 12,
  coastDecel: 2.5,
  maxSteer: 0.55,
  steerRate: 3,
  yawAssist: { maxRate: 1.3, strength: 0.14, pivotInPlace: false },
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
 * The skid dump truck. Hold Action at speed to drop the rear wheels' grip and swing the
 * armoured tail into walls; the tail does the damage. Auto-skid holds the swing for you.
 */
export class Fishtail extends Vehicle {
  readonly rideHeight = RIDE_HEIGHT;
  readonly actionLabel = 'SKID';
  /** Settings: keep the tail swinging without steering. */
  autoSkid = true;
  private skidding = false;
  private skidDirection = 1;
  private readonly tailGlow = createReadyGlow();
  private glowTime = 0;
  private trailClock = 0;
  private readonly tmp = new Vector3();

  constructor(physics: Physics) {
    super(physics, FISHTAIL_SPEC);
    this.root.add(this.buildModel());
  }

  get isSkidding(): boolean {
    return this.skidding;
  }

  override get actionState(): ActionState {
    return { ready: true, active: this.skidding, charge: 1 };
  }

  override impactMultiplier(collider: Collider): number {
    if (collider === this.colliders[1]) {
      return this.skidding ? FISHTAIL_DAMAGE.tailSkidding : FISHTAIL_DAMAGE.tail;
    }
    return FISHTAIL_DAMAGE.body;
  }

  /** Calls `spawn` with each rear wheel's ground point while skidding (ghost trails). */
  emitTrails(frameSeconds: number, spawn: (at: Vector3) => void): void {
    if (!this.skidding) return;
    this.trailClock -= frameSeconds;
    if (this.trailClock > 0) return;
    this.trailClock = 0.05;
    for (const x of [1.12, -1.12]) {
      this.tmp.set(x, -RIDE_HEIGHT + 0.2, -2.45);
      spawn(this.root.localToWorld(this.tmp.clone()));
    }
  }

  protected handleAction(frame: ControlFrame): void {
    const wasSkidding = this.skidding;
    this.skidding = frame.action && Math.abs(this.forwardSpeed) > MIN_SKID_SPEED;
    if (this.skidding && !wasSkidding) {
      // Swing the way the player steers, or away from the current turn.
      this.skidDirection = frame.steer !== 0 ? Math.sign(frame.steer) : this.yawRate > 0 ? -1 : 1;
    }
    if (this.skidding && frame.steer !== 0 && !this.autoSkid)
      this.skidDirection = Math.sign(frame.steer);
  }

  override step(dt: number): void {
    const rearGrip = this.skidding ? 0.55 : FISHTAIL_SPEC.wheels.frictionSlip;
    const rearSide = this.skidding ? 0.25 : FISHTAIL_SPEC.wheels.sideFriction;
    for (const i of [2, 3]) {
      this.controller.setWheelFrictionSlip(i, rearGrip);
      this.controller.setWheelSideFrictionStiffness(i, rearSide);
    }
    if (this.skidding && this.grounded) {
      // Kick the rear out: aim for a strong yaw rate in the skid direction.
      const steerInput = this.autoSkid ? 1 : Math.min(1, Math.abs(this.drive.steer) + 0.35);
      const desired = -this.skidDirection * SKID_YAW_RATE * steerInput;
      const inertia = this.body.principalInertia().y;
      const impulse = (desired - this.yawRate) * inertia * 0.12;
      this.body.applyTorqueImpulse({ x: 0, y: impulse * dt * 60, z: 0 }, true);
    }
    super.step(dt);
  }

  protected animate(frameSeconds: number): void {
    this.glowTime += frameSeconds;
    this.tailGlow.emissiveIntensity = this.skidding
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
      if (layout.z < 0) {
        const twin = wheel();
        twin.position.z = -1.0;
        pivot.add(twin);
      }
      root.add(pivot);
      this.wheelMeshes[i] = pivot;
    });
    // The wheel pivots are positioned in body space; the model root is not offset.
    const wrapper = new Group();
    wrapper.add(root);
    // Shift the drawn body (built with the ground at y = 0) but keep wheel pivots in body space.
    for (const child of root.children) {
      if (!this.wheelMeshes.includes(child)) child.position.y -= RIDE_HEIGHT;
    }
    return wrapper;
  }
}
