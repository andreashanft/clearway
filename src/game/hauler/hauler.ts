import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { type Group, Matrix4, Quaternion, Vector3 } from 'three';
import { GROUP, interactionGroups } from '../../engine/collision-groups';
import { InterpolatedPose } from '../../engine/interpolation';
import type { Physics } from '../../engine/physics';
import { buildHaulerModel, HAULER_RIDE_HEIGHT, type HaulerModel } from '../models/hauler-model';
import type { Route } from '../route';
import type { Heightfield } from '../world/heightfield';
import { HAULER } from './route-sweep';

export type HaulerState = 'waiting' | 'rolling' | 'stalled' | 'parked' | 'destroyed';

/** A route gap: across it the Hauler rides on the bridge deck, if there is one. */
export interface HaulerGap {
  readonly from: number;
  readonly to: number;
  readonly deckHeight: number;
  bridged(): boolean;
}

/** Speed multiplier once the path is clear and the Hauler heads for the safe zone. */
export const SAFE_ZONE_SPEEDUP = 2.5;

/** What the Hauler's bumper sensor may touch: anything solid except rubble and the ground. */
const SENSOR_GROUPS = interactionGroups(
  GROUP.hauler,
  GROUP.building | GROUP.vehicle | GROUP.tnt | GROUP.pilot,
);
/** The Hauler's body pushes vehicles and the pilot aside. */
const BODY_GROUPS = interactionGroups(GROUP.hauler, GROUP.vehicle | GROUP.pilot | GROUP.tnt);

/**
 * The carrier. It follows the route spline at a fixed speed as a kinematic body, never
 * steering or stopping, and reports anything its bumper sensor touches.
 */
export class Hauler {
  readonly model: HaulerModel;
  readonly body: RigidBody;
  readonly sensor: Collider;
  readonly solid: Collider;
  state: HaulerState = 'waiting';
  /** Distance of the nose along the route, in metres. */
  distance = 0;
  /** Route gaps the Hauler must cross on a bridge. */
  gaps: HaulerGap[] = [];
  /** Seconds left on an easy-mode stall. */
  private stallLeft = 0;
  private speedFactor = 1;
  private readonly pose: InterpolatedPose;
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly right = new Vector3();
  private readonly basis = new Vector3();
  private readonly matrix = new Matrix4();
  private wheelSpin = 0;
  private alarm = 0;
  private time = 0;

  constructor(
    private readonly physics: Physics,
    private readonly route: Route,
    private readonly field: Heightfield,
    readonly speed: number,
  ) {
    const { rapier, world } = physics;
    this.model = buildHaulerModel();
    this.computePose(0);
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.position.x, this.position.y, this.position.z)
        .setRotation(this.rotation),
    );
    this.solid = world.createCollider(
      rapier.ColliderDesc.cuboid(HAULER.width / 2, 1.5, HAULER.length / 2)
        .setTranslation(0, 0.9, 0)
        .setCollisionGroups(BODY_GROUPS),
      this.body,
    );
    this.sensor = world.createCollider(
      rapier.ColliderDesc.cuboid(
        HAULER.width / 2 + HAULER.sensorMargin,
        1.6,
        HAULER.sensorDepth / 2,
      )
        .setTranslation(0, 0.9, HAULER.length / 2 + HAULER.sensorDepth / 2)
        .setSensor(true)
        .setCollisionGroups(SENSOR_GROUPS)
        .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(
          rapier.ActiveCollisionTypes.DEFAULT |
            rapier.ActiveCollisionTypes.KINEMATIC_FIXED |
            rapier.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
        ),
      this.body,
    );
    this.pose = new InterpolatedPose(this.body, this.model.root);
  }

  get root(): Group {
    return this.model.root;
  }

  /** World position of the Hauler's centre (interpolated, for the camera and HUD). */
  get worldPosition(): Vector3 {
    return this.model.root.position;
  }

  /** True when the Hauler has reached the end of its route. */
  get atSafeZone(): boolean {
    return this.distance >= this.route.length;
  }

  start(): void {
    if (this.state === 'waiting') this.state = 'rolling';
  }

  /** Jumps the nose to `distance` with no blending (title-screen loop). */
  resetTo(distance: number): void {
    this.distance = distance;
    this.computePose(distance);
    this.body.setTranslation(this.position, true);
    this.body.setRotation(this.rotation, true);
    this.pose.snap();
  }

  /** Overrides the cruise speed multiplier (title-screen loop, safe-zone run). */
  setSpeedFactor(factor: number): void {
    this.speedFactor = factor;
  }

  /** Easy mode: pauses the Hauler once for `seconds`. */
  stall(seconds: number): void {
    if (this.state !== 'rolling') return;
    this.state = 'stalled';
    this.stallLeft = seconds;
  }

  /** Path clear: hurry on to the safe zone. */
  headForSafeZone(): void {
    this.speedFactor = SAFE_ZONE_SPEEDUP;
    if (this.state === 'waiting' || this.state === 'stalled') this.state = 'rolling';
  }

  /** 0 = calm, 1 = under 5 s to impact (beacons strobe). */
  setAlarm(level: number): void {
    this.alarm = level;
  }

  destroy(): void {
    this.state = 'destroyed';
    this.model.root.visible = false;
    this.physics.world.removeRigidBody(this.body);
  }

  step(dt: number): void {
    if (this.state === 'stalled') {
      this.stallLeft -= dt;
      if (this.stallLeft <= 0) this.state = 'rolling';
    }
    if (this.state !== 'rolling') return;
    const advance = this.speed * this.speedFactor * dt;
    this.distance = Math.min(this.route.length, this.distance + advance);
    this.wheelSpin += advance / 0.58;
    if (this.atSafeZone) this.state = 'parked';
    this.computePose(this.distance);
    this.body.setNextKinematicTranslation(this.position);
    this.body.setNextKinematicRotation(this.rotation);
  }

  afterStep(): void {
    if (this.state !== 'destroyed') this.pose.capture();
  }

  render(alpha: number, frameSeconds: number): void {
    if (this.state === 'destroyed') return;
    this.pose.apply(alpha);
    this.time += frameSeconds;
    for (const wheel of this.model.wheels) wheel.rotation.x = this.wheelSpin;
    // Beacons pulse slowly when calm and strobe hard under five seconds to impact.
    const rate = 2 + this.alarm * 10;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * rate * Math.PI);
    this.model.beaconMaterial.emissiveIntensity = 0.8 + pulse * (1.2 + this.alarm * 2.5);
    this.model.coreMaterial.emissiveIntensity = 1.9 + 0.5 * Math.sin(this.time * 2.2);
    this.model.coreLight.intensity = 50 + 25 * Math.sin(this.time * 2.2) + this.alarm * pulse * 60;
  }

  dispose(): void {
    this.model.root.removeFromParent();
    if (this.state !== 'destroyed') this.physics.world.removeRigidBody(this.body);
  }

  /** Places the body on the terrain for a given nose distance, pitched to the slope. */
  private computePose(noseDistance: number): void {
    const centre = noseDistance - HAULER.length / 2;
    const front = this.groundPoint(centre + HAULER.length * 0.35);
    const rear = this.groundPoint(centre - HAULER.length * 0.35);
    const mid = this.groundPoint(centre);
    this.forward.copy(front).sub(rear).normalize();
    this.basis.set(0, 1, 0);
    this.right.crossVectors(this.basis, this.forward).normalize();
    this.up.crossVectors(this.forward, this.right).normalize();
    // Columns: x = right-handed side (left of travel), y = up, z = forward.
    const m = this.matrix.makeBasis(this.right, this.up, this.forward);
    this.rotation.setFromRotationMatrix(m);
    this.position
      .set(mid.x, (front.y + rear.y) / 2, mid.z)
      .addScaledVector(this.up, HAULER_RIDE_HEIGHT);
  }

  /** Ground point at a route distance; before the start it extends the first tangent. */
  private groundPoint(distance: number): Vector3 {
    const s = this.route.sampleAt(distance);
    const extra = Math.min(0, distance);
    const x = s.x + s.dx * extra;
    const z = s.z + s.dz * extra;
    let y = this.field.heightAt(x, z);
    for (const gap of this.gaps) {
      if (distance > gap.from - 3 && distance < gap.to + 3 && gap.bridged()) y = gap.deckHeight;
    }
    return new Vector3(x, y, z);
  }
}
