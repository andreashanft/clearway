import type { Collider } from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ControlFrame } from '../../engine/input/controls';
import type { Physics } from '../../engine/physics';
import { FINISH, type Finish } from '../models/finish';
import { createReadyGlow } from '../models/materials';
import { ModelBuilder } from '../models/model-builder';
import { type ActionState, Vehicle, type VehicleSpec } from './vehicle';

const KMH = 1 / 3.6;
const RIDE_HEIGHT = 1.0;
/** From the brief: rolls last 1.5 s at 90 km/h. */
export const ROLL_SECONDS = 1.5;
export const ROLL_SPEED = 90 * KMH;
export const ROLL_RECHARGE = 1.2;
/** A roll that hits within this many seconds of the last hit chains. */
export const CHAIN_WINDOW = 2;
export const CHAIN_BONUS = 0.25;
export const CHAIN_MAX = 3;
export const TUMBLER_DAMAGE = { roll: 0.5, walk: 0.15 } as const;

/**
 * Chain stacks for a new hit: one more than before if it lands within the chain window
 * of the last hit (up to the cap), otherwise none.
 */
export function chainStacks(previous: number, secondsSinceLastHit: number): number {
  return secondsSinceLastHit <= CHAIN_WINDOW ? Math.min(CHAIN_MAX, previous + 1) : 0;
}

/** Damage multiplier for a roll hit with `stacks` chained before it: +25% each. */
export function rollMultiplier(stacks: number): number {
  return TUMBLER_DAMAGE.roll * (1 + CHAIN_BONUS * Math.min(CHAIN_MAX, Math.max(0, stacks)));
}

export const TUMBLER_SPEC: VehicleSpec = {
  type: 'tumbler',
  name: 'Tumbler',
  mass: 20000,
  chassis: { halfExtents: [2.0, 1.8, 1.8], offset: [0, 1.6, 0] },
  centreOfMassY: -0.6,
  wheels: {
    connectionY: -0.3,
    radius: 0.6,
    suspensionRest: 0.45,
    suspensionTravel: 0.3,
    stiffness: 45,
    compression: 5,
    relaxation: 3.5,
    frictionSlip: 3,
    sideFriction: 1.6,
    layout: [
      { x: 1.5, z: 1.3, steer: 1, driven: true },
      { x: -1.5, z: 1.3, steer: 1, driven: true },
      { x: 1.5, z: -1.3, steer: -1, driven: true },
      { x: -1.5, z: -1.3, steer: -1, driven: true },
    ],
  },
  topSpeed: 66 * KMH,
  reverseSpeed: 30 * KMH,
  acceleration: 15,
  brakeDecel: 20,
  coastDecel: 8,
  maxSteer: 0.3,
  pivotSteer: 0.7,
  steerRate: 3,
  grip: 9,
  yawAssist: { maxRate: 1.7, strength: 0.35, pivotInPlace: true },
};

const STEEL: Finish = { colour: '#C9CED6', roughness: 0.35, metalness: 0.7 };
const STEEL_DARK: Finish = { colour: '#8E95A0', roughness: 0.4, metalness: 0.65 };

/**
 * The roll mech: slow and heavy on foot, devastating in a roll. Action curls it into a
 * 90 km/h roll for 1.5 s; rolls that land within 2 s of each other hit 25% harder, up to
 * three times. The only vehicle that can bring down concrete.
 */
export class Tumbler extends Vehicle {
  readonly rideHeight = RIDE_HEIGHT;
  readonly actionLabel = 'ROLL';
  private rollLeft = 0;
  private recharge = 0;
  private time = 0;
  private lastHit = -Infinity;
  private stacks = 0;
  private spin = 0;
  private stride = 0;
  private readonly body3d = new Group();
  private readonly legs: Group[] = [];
  private readonly ringMaterial = createReadyGlow();
  private readonly coreMaterial = new MeshStandardMaterial({
    color: '#FFC21A',
    emissive: new Color('#FFB000'),
    emissiveIntensity: 1.4,
  });
  private readonly ring: Mesh;
  private readonly forward = new Vector3();
  private readonly quat = new Quaternion();

  constructor(physics: Physics) {
    super(physics, TUMBLER_SPEC);
    this.ring = new Mesh(new TorusGeometry(2.6, 0.08, 6, 48), this.ringMaterial);
    this.root.add(this.buildModel());
  }

  get rolling(): boolean {
    return this.rollLeft > 0;
  }

  /** Chain stacks the next hit would get right now. */
  get chain(): number {
    return chainStacks(this.stacks, this.time - this.lastHit);
  }

  override get actionState(): ActionState {
    if (this.rollLeft > 0)
      return { ready: false, active: true, charge: this.rollLeft / ROLL_SECONDS };
    if (this.recharge > 0)
      return { ready: false, active: false, charge: 1 - this.recharge / ROLL_RECHARGE };
    return { ready: true, active: false, charge: 1 };
  }

  override impactMultiplier(_collider: Collider): number {
    return this.rolling ? rollMultiplier(this.chain) : TUMBLER_DAMAGE.walk;
  }

  onImpact(): void {
    if (!this.rolling) return;
    this.stacks = this.chain;
    this.lastHit = this.time;
  }

  protected handleAction(frame: ControlFrame): void {
    if (frame.actionPressed && this.rollLeft <= 0 && this.recharge <= 0) {
      this.rollLeft = ROLL_SECONDS;
    }
  }

  override step(dt: number): void {
    this.time += dt;
    if (this.rollLeft > 0) {
      this.rollLeft -= dt;
      const r = this.body.rotation();
      this.forward.set(0, 0, 1).applyQuaternion(this.quat.set(r.x, r.y, r.z, r.w));
      this.forward.y = 0;
      this.forward.normalize();
      // Hold the roll at full speed straight ahead; collisions still slow it down.
      const v = this.body.linvel();
      const along = v.x * this.forward.x + v.z * this.forward.z;
      if (along < ROLL_SPEED) {
        const boost = Math.min(ROLL_SPEED - along, 40 * dt);
        this.body.setLinvel(
          { x: v.x + this.forward.x * boost, y: v.y, z: v.z + this.forward.z * boost },
          true,
        );
      }
      if (this.rollLeft <= 0) this.recharge = ROLL_RECHARGE;
    } else if (this.recharge > 0) {
      this.recharge = Math.max(0, this.recharge - dt);
    }
    super.step(dt);
  }

  protected animate(frameSeconds: number): void {
    // The body tucks and spins while rolling; legs stride with speed while walking.
    if (this.rolling) this.spin += frameSeconds * (ROLL_SPEED / 2.2);
    else this.spin = this.spin % (Math.PI * 2) > 0.05 ? this.spin + frameSeconds * 6 : 0;
    if (this.spin >= Math.PI * 2) this.spin = 0;
    this.body3d.rotation.x = this.spin;
    this.stride += frameSeconds * Math.abs(this.forwardSpeed) * 0.9;
    const swing = Math.sin(this.stride) * Math.min(0.5, Math.abs(this.forwardSpeed) / 10);
    this.legs[0]?.rotation.set(swing, 0, 0);
    this.legs[1]?.rotation.set(-swing, 0, 0);
    const ready = this.actionState.ready;
    this.ring.visible = ready || this.rolling;
    this.ring.rotation.z += frameSeconds * 1.5;
    this.ringMaterial.emissiveIntensity = this.rolling ? 3 : 1.2 + 0.4 * Math.sin(this.time * 4);
    this.coreMaterial.emissiveIntensity = 1.2 + this.chain * 0.6;
  }

  private buildModel(): Group {
    const m = FINISH;
    const y0 = -RIDE_HEIGHT;
    const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
    const rbox = (w: number, h: number, d: number, r = 0.2): RoundedBoxGeometry =>
      new RoundedBoxGeometry(w, h, d, 3, r);

    // Torso, cockpit, shoulder and the one big arm: this part spins in a roll.
    const torso = new ModelBuilder()
      .add(rbox(3.4, 3.0, 2.8, 0.45), STEEL, { at: [0, 0, 0] })
      .add(rbox(2.2, 1.2, 0.3, 0.12), m.glass, { at: [0, 0.75, 1.4] })
      .add(rbox(3.0, 0.4, 2.4, 0.15), STEEL_DARK, { at: [0, 1.6, -0.1] })
      .add(rbox(1.2, 1.2, 1.4, 0.3), STEEL_DARK, { at: [-2.0, 0.8, 0] })
      .add(new CylinderGeometry(0.55, 0.55, 2.4, 14), STEEL_DARK, {
        at: [2.1, 0.3, 0.2],
        rotate: [0.3, 0, 0],
      })
      .add(rbox(1.6, 1.6, 1.8, 0.35), m.hazardPaint, { at: [2.2, -1.1, 0.8] })
      .add(box(1.7, 0.25, 1.9), m.blackBand, { at: [2.2, -0.6, 0.8] })
      .add(rbox(0.9, 0.5, 0.9, 0.15), m.hazardDeep, { at: [0, -1.6, 0] })
      .build('tumbler-torso');
    const core = new Mesh(new SphereGeometry(0.45, 16, 10), this.coreMaterial);
    core.position.set(0, -0.3, 1.38);
    this.body3d.add(torso, core);
    this.body3d.position.set(0, y0 + 4.6, 0);
    this.ring.rotation.x = Math.PI / 2;
    this.body3d.add(this.ring);

    const root = new Group();
    root.add(this.body3d);
    // Hips and two thick legs with knees and big feet.
    root.add(
      new ModelBuilder()
        .add(rbox(2.6, 0.8, 1.6, 0.25), STEEL_DARK, { at: [0, y0 + 2.9, 0] })
        .build('tumbler-hips'),
    );
    for (const side of [-1, 1]) {
      const leg = new Group();
      leg.position.set(side * 1.1, y0 + 2.8, 0);
      leg.add(
        new ModelBuilder()
          .add(rbox(0.9, 1.4, 1.0, 0.2), STEEL, { at: [0, -0.7, 0] })
          .add(new SphereGeometry(0.5, 12, 8), STEEL_DARK, { at: [0, -1.45, 0.1] })
          .add(rbox(0.8, 1.2, 0.9, 0.2), STEEL, { at: [0, -2.1, 0] })
          .add(rbox(1.3, 0.4, 1.8, 0.12), m.darkSteel, { at: [0, -2.7, 0.25] })
          .add(box(0.2, 0.42, 1.8), m.hazardPaint, { at: [0, -2.7, 0.25] })
          .build('tumbler-leg'),
      );
      this.legs.push(leg);
      root.add(leg);
    }
    return root;
  }
}
