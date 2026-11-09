import type { ControlFrame } from '../../engine/input/controls';
import type { Physics } from '../../engine/physics';
import { BRUISER_RIDE_HEIGHT, type BruiserModel, buildBruiserModel } from '../models/bruiser-model';
import { type ActionState, Vehicle, type VehicleSpec } from './vehicle';

const KMH = 1 / 3.6;
const TRACK_HALF_SPAN = 1.3;
const BLADE_LIFT = 0.55;
const BLADE_SPEED = 2.5;

export const BRUISER_SPEC: VehicleSpec = {
  type: 'bruiser',
  name: 'Bruiser',
  mass: 9000,
  chassis: { halfExtents: [1.6, 0.6, 2.1], offset: [0, 0.05, -0.1] },
  extraColliders: [{ halfExtents: [1.86, 0.62, 0.2], offset: [0, -0.48, 3.0] }],
  centreOfMassY: -0.55,
  wheels: {
    connectionY: -0.3,
    radius: 0.45,
    suspensionRest: 0.5,
    suspensionTravel: 0.35,
    stiffness: 38,
    compression: 4.6,
    relaxation: 3.2,
    frictionSlip: 2.2,
    sideFriction: 1.4,
    layout: [
      { x: TRACK_HALF_SPAN, z: 1.5, steer: 1, driven: true },
      { x: -TRACK_HALF_SPAN, z: 1.5, steer: 1, driven: true },
      { x: TRACK_HALF_SPAN, z: -1.5, steer: -1, driven: true },
      { x: -TRACK_HALF_SPAN, z: -1.5, steer: -1, driven: true },
    ],
  },
  topSpeed: 50 * KMH,
  reverseSpeed: 20 * KMH,
  acceleration: 5,
  brakeDecel: 14,
  coastDecel: 4,
  maxSteer: 0.42,
  pivotSteer: 0.72,
  steerRate: 3,
  yawAssist: { maxRate: 1.4, strength: 0.3, pivotInPlace: true },
};

/**
 * The bulldozer: rams head-on and pushes crates. Action toggles push mode, which lifts
 * the blade (and its collider) clear of the ground.
 */
export class Bruiser extends Vehicle {
  readonly rideHeight = BRUISER_RIDE_HEIGHT;
  readonly actionLabel = 'BLADE';
  private readonly model: BruiserModel;
  private pushMode = false;
  private bladeLift = 0;
  private glowTime = 0;

  constructor(physics: Physics) {
    super(physics, BRUISER_SPEC);
    this.model = buildBruiserModel();
    this.root.add(this.model.root);
  }

  override get actionState(): ActionState {
    return { ready: true, active: this.pushMode, charge: 1 };
  }

  protected handleAction(frame: ControlFrame): void {
    if (frame.actionPressed) this.pushMode = !this.pushMode;
  }

  override step(dt: number): void {
    const target = this.pushMode ? 1 : 0;
    const delta = Math.max(-BLADE_SPEED * dt, Math.min(BLADE_SPEED * dt, target - this.bladeLift));
    if (delta !== 0) {
      this.bladeLift += delta;
      const blade = this.colliders[1];
      const [, y, z] = BRUISER_SPEC.extraColliders?.[0]?.offset ?? [0, 0, 0];
      blade?.setTranslationWrtParent({ x: 0, y: y + this.bladeLift * BLADE_LIFT, z });
    }
    super.step(dt);
  }

  protected animate(frameSeconds: number): void {
    const { model } = this;
    model.blade.position.y = this.bladeLift * BLADE_LIFT;
    model.blade.rotation.x = -this.bladeLift * 0.12;

    // Crawler tracks: the inner track runs slower in a turn.
    const left = this.forwardSpeed - this.yawRate * TRACK_HALF_SPAN;
    const right = this.forwardSpeed + this.yawRate * TRACK_HALF_SPAN;
    model.leftTrack.update(-left * frameSeconds);
    model.rightTrack.update(-right * frameSeconds);

    // The blade edge glows when ready, and pulses in push mode.
    this.glowTime += frameSeconds;
    model.bladeGlow.emissiveIntensity = this.pushMode
      ? 1.6 + Math.sin(this.glowTime * 6) * 0.8
      : 1.3;
  }
}
