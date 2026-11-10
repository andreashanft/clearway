import type { Collider } from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ControlFrame } from '../../engine/input/controls';
import type { Physics } from '../../engine/physics';
import { FINISH } from '../models/finish';
import { ModelBuilder } from '../models/model-builder';
import { type ActionState, Vehicle, type VehicleSpec } from './vehicle';

const KMH = 1 / 3.6;
const RIDE_HEIGHT = 1.05;
const WHEEL_R = 0.6;
/** Boost from the brief: 1 s of thrust, then 3 s to recharge. */
export const BOOST_SECONDS = 1;
export const BOOST_RECHARGE = 3;
/** Extra acceleration while boosting, m/s². */
const BOOST_ACCEL = 18;

/** Landing on a roof hurts far more than ramming a wall. */
export const LIFTOFF_DAMAGE = { landing: 14, ram: 2.5 } as const;

export const LIFTOFF_SPEC: VehicleSpec = {
  type: 'liftoff',
  name: 'Liftoff',
  mass: 1600,
  chassis: { halfExtents: [1.0, 0.4, 2.0], offset: [0, 0.1, 0] },
  centreOfMassY: -0.45,
  wheels: {
    connectionY: -0.15,
    radius: WHEEL_R,
    suspensionRest: 0.55,
    suspensionTravel: 0.5,
    stiffness: 24,
    compression: 3.6,
    relaxation: 2.6,
    frictionSlip: 3.2,
    sideFriction: 1.4,
    layout: [
      { x: 1.08, z: 1.35, steer: 1, driven: true },
      { x: -1.08, z: 1.35, steer: 1, driven: true },
      { x: 1.08, z: -1.35, steer: 0, driven: true },
      { x: -1.08, z: -1.35, steer: 0, driven: true },
    ],
  },
  topSpeed: 125 * KMH,
  reverseSpeed: 30 * KMH,
  acceleration: 22,
  brakeDecel: 30,
  coastDecel: 3,
  maxSteer: 0.5,
  steerRate: 6,
  grip: 7,
  yawAssist: { maxRate: 2.6, strength: 0.22, pivotInPlace: false },
};

/**
 * The rocket buggy: fast, light and springy. Action fires a one-second boost to clear
 * ramps; landing on a roof does heavy damage, scaled by the vertical speed.
 */
export class Liftoff extends Vehicle {
  readonly rideHeight = RIDE_HEIGHT;
  readonly actionLabel = 'BOOST';
  private boostLeft = 0;
  private recharge = 0;
  private readonly nozzleGlow = new MeshStandardMaterial({
    color: '#FF9A2E',
    emissive: new Color('#FF7A2E'),
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });
  private readonly flame: Mesh;
  private readonly flameLight = new PointLight('#FF9A2E', 0, 14, 1.8);
  private readonly forward = new Vector3();
  private readonly quat = new Quaternion();

  constructor(physics: Physics) {
    super(physics, LIFTOFF_SPEC);
    this.flame = new Mesh(
      new ConeGeometry(0.32, 1.6, 10),
      new MeshStandardMaterial({
        color: '#FFD23F',
        emissive: new Color('#FF9A2E'),
        emissiveIntensity: 3,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.root.add(this.buildModel());
  }

  get boosting(): boolean {
    return this.boostLeft > 0;
  }

  override get actionState(): ActionState {
    if (this.boostLeft > 0)
      return { ready: false, active: true, charge: this.boostLeft / BOOST_SECONDS };
    if (this.recharge > 0)
      return { ready: false, active: false, charge: 1 - this.recharge / BOOST_RECHARGE };
    return { ready: true, active: false, charge: 1 };
  }

  override impactMultiplier(
    _collider: Collider,
    normal?: { x: number; y: number; z: number },
  ): number {
    return normal && Math.abs(normal.y) > 0.6 ? LIFTOFF_DAMAGE.landing : LIFTOFF_DAMAGE.ram;
  }

  protected handleAction(frame: ControlFrame): void {
    if (frame.actionPressed && this.boostLeft <= 0 && this.recharge <= 0) {
      this.boostLeft = BOOST_SECONDS;
    }
  }

  override step(dt: number): void {
    if (this.boostLeft > 0) {
      this.boostLeft -= dt;
      const r = this.body.rotation();
      this.forward.set(0, 0, 1).applyQuaternion(this.quat.set(r.x, r.y, r.z, r.w));
      // Thrust along the nose, with a little lift so ramps launch cleanly.
      const impulse = LIFTOFF_SPEC.mass * BOOST_ACCEL * dt;
      this.body.applyImpulse(
        {
          x: this.forward.x * impulse,
          y: this.forward.y * impulse + impulse * 0.12,
          z: this.forward.z * impulse,
        },
        true,
      );
      if (this.boostLeft <= 0) this.recharge = BOOST_RECHARGE;
    } else if (this.recharge > 0) {
      this.recharge = Math.max(0, this.recharge - dt);
    }
    // Airborne: damp spin so it lands on its wheels.
    this.body.setAngularDamping(this.grounded ? 0.4 : 2.2);
    super.step(dt);
  }

  protected animate(_frameSeconds: number): void {
    const boosting = this.boostLeft > 0;
    this.flame.visible = boosting;
    this.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    this.flameLight.intensity = boosting ? 120 : 0;
    this.nozzleGlow.emissiveIntensity = boosting ? 4 : this.recharge > 0 ? 0.4 : 1.6;
  }

  private buildModel(): Group {
    const m = FINISH;
    const b = new ModelBuilder();
    const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
    const rbox = (w: number, h: number, d: number, r = 0.1): RoundedBoxGeometry =>
      new RoundedBoxGeometry(w, h, d, 2, r);
    const y0 = -RIDE_HEIGHT;
    // Armoured belly, low body tub and the red signature stripe.
    b.add(rbox(1.9, 0.25, 3.9, 0.08), m.darkSteel, { at: [0, y0 + 0.62, 0] });
    b.add(rbox(1.8, 0.45, 3.4, 0.16), m.hazardPaint, { at: [0, y0 + 0.95, 0.05] });
    b.add(
      box(0.3, 0.47, 3.42),
      { colour: '#F04848', roughness: 0.45, metalness: 0.1 },
      { at: [0, y0 + 0.96, 0.05] },
    );
    // Nose wedge and headlights.
    b.add(rbox(1.7, 0.35, 0.6, 0.1), m.hazardDeep, {
      at: [0, y0 + 0.85, 1.95],
      rotate: [0.35, 0, 0],
    });
    b.addMirrored(box(0.3, 0.14, 0.08), m.headlight, { at: [0.6, y0 + 0.98, 2.2] });
    // Seat in the open cockpit.
    b.add(rbox(0.7, 0.5, 0.7, 0.1), m.blackBand, { at: [0, y0 + 1.35, -0.2] });
    // Roll cage: hoops and side bars.
    for (const z of [0.55, -0.75]) {
      b.addMirrored(box(0.1, 1.0, 0.1), m.darkSteel, { at: [0.75, y0 + 1.65, z] });
      b.add(box(1.6, 0.1, 0.1), m.darkSteel, { at: [0, y0 + 2.15, z] });
    }
    b.addMirrored(box(0.1, 0.1, 1.4), m.darkSteel, { at: [0.75, y0 + 2.15, -0.1] });
    // Suspension arms to each wheel.
    for (const [x, z] of [
      [1, 1.35],
      [-1, 1.35],
      [1, -1.35],
      [-1, -1.35],
    ] as const) {
      b.add(box(0.6, 0.1, 0.16), m.steel, { at: [x * 0.75, y0 + 0.7, z] });
    }
    // Rocket pod and nozzle at the back.
    b.add(new CylinderGeometry(0.32, 0.38, 1.1, 14), m.steel, {
      at: [0, y0 + 1.2, -2.05],
      rotate: [Math.PI / 2, 0, 0],
    });
    b.add(new CylinderGeometry(0.44, 0.3, 0.4, 14), m.darkSteel, {
      at: [0, y0 + 1.2, -2.75],
      rotate: [Math.PI / 2, 0, 0],
    });
    const root = new Group();
    root.add(b.build('liftoff-body'));
    const nozzle = new Mesh(new CylinderGeometry(0.3, 0.3, 0.05, 14), this.nozzleGlow);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, y0 + 1.2, -2.96);
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.set(0, y0 + 1.2, -3.8);
    this.flame.visible = false;
    this.flameLight.position.set(0, y0 + 1.4, -3.4);
    root.add(nozzle, this.flame, this.flameLight);

    LIFTOFF_SPEC.wheels.layout.forEach((layout, i) => {
      const pivot = new Group();
      pivot.position.set(layout.x, 0, layout.z);
      pivot.add(
        new ModelBuilder()
          .add(new CylinderGeometry(WHEEL_R, WHEEL_R, 0.55, 16), m.rubber, {
            rotate: [0, 0, Math.PI / 2],
          })
          .add(new CylinderGeometry(0.34, 0.34, 0.57, 8), m.hazardDeep, {
            rotate: [0, 0, Math.PI / 2],
          })
          .build('liftoff-wheel'),
      );
      root.add(pivot);
      this.wheelMeshes[i] = pivot;
    });
    return root;
  }
}
