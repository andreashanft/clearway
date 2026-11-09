import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { GROUP, interactionGroups } from '../engine/collision-groups';
import type { ControlFrame } from '../engine/input/controls';
import { InterpolatedPose } from '../engine/interpolation';
import type { Physics } from '../engine/physics';
import type { Finish } from './models/finish';
import { ModelBuilder } from './models/model-builder';

/** 12 km/h, from the brief. */
export const PILOT_SPEED = 12 / 3.6;
const HALF_HEIGHT = 0.55;
const RADIUS = 0.35;
/** Height of the body centre above the ground. */
export const PILOT_RIDE_HEIGHT = HALF_HEIGHT + RADIUS;
const GRAVITY = 9.81;

const PILOT_GROUPS = interactionGroups(
  GROUP.pilot,
  GROUP.ground | GROUP.building | GROUP.vehicle | GROUP.tnt | GROUP.hauler,
);
/** What the pilot walks on and bumps into. */
const WALK_GROUPS = interactionGroups(
  0xffff,
  GROUP.ground | GROUP.building | GROUP.vehicle | GROUP.tnt,
);

const F = {
  overalls: { colour: '#FF7A2E', roughness: 0.7, metalness: 0 },
  hiVis: { colour: '#F4F1EA', roughness: 0.5, metalness: 0 },
  hat: { colour: '#FFD23F', roughness: 0.4, metalness: 0.05 },
  skin: { colour: '#D9A07A', roughness: 0.8, metalness: 0 },
  boots: { colour: '#2B3038', roughness: 0.8, metalness: 0 },
} as const satisfies Record<string, Finish>;

/**
 * Converts a screen-space stick (x right, y up) into a world direction, given the camera
 * yaw. Returns the length too, so the pilot walks slower for a half-pushed stick.
 */
export function stickToWorld(
  x: number,
  y: number,
  cameraYaw: number,
): { dx: number; dz: number; magnitude: number } {
  const magnitude = Math.min(1, Math.hypot(x, y));
  if (magnitude < 0.01) return { dx: 0, dz: 0, magnitude: 0 };
  const cos = Math.cos(cameraYaw);
  const sin = Math.sin(cameraYaw);
  const dx = x * cos - y * sin;
  const dz = -x * sin - y * cos;
  const len = Math.hypot(dx, dz);
  return { dx: dx / len, dz: dz / len, magnitude };
}

/**
 * The crew member on foot: a capsule moved by Rapier's kinematic character controller.
 * Walks at 12 km/h, does no damage, and climbs into vehicles.
 */
export class Pilot {
  readonly root = new Group();
  readonly body: RigidBody;
  readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly pose: InterpolatedPose;
  private readonly legs: Group[] = [];
  private readonly marker: Group;
  private readonly velocity = new Vector3();
  private fallSpeed = 0;
  private walkPhase = 0;
  private headingValue = 0;
  private time = 0;
  active = false;

  constructor(private readonly physics: Physics) {
    const { rapier, world } = physics;
    this.body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(PILOT_GROUPS),
      this.body,
    );
    this.controller = world.createCharacterController(0.05);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.enableSnapToGround(0.4);
    this.controller.enableAutostep(0.4, 0.2, false);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.marker = this.buildModel();
    this.pose = new InterpolatedPose(this.body, this.root);
    this.setActive(false);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get heading(): number {
    return this.headingValue;
  }

  /** World velocity of the last step. */
  velocityOut(out: Vector3): Vector3 {
    return out.copy(this.velocity);
  }

  /** Shows or hides the pilot; a hidden pilot has no collider in the world. */
  setActive(active: boolean): void {
    this.active = active;
    this.root.visible = active;
    this.collider.setEnabled(active);
  }

  placeAt(x: number, groundY: number, z: number, heading: number): void {
    this.body.setTranslation({ x, y: groundY + PILOT_RIDE_HEIGHT + 0.05, z }, true);
    this.headingValue = heading;
    this.fallSpeed = 0;
    this.velocity.set(0, 0, 0);
    this.pose.snap();
  }

  /** One fixed step of walking. Keyboard WASD moves relative to the camera, like the stick. */
  control(frame: ControlFrame, cameraYaw: number, dt: number): void {
    const stickX = frame.stickX !== 0 || frame.stickY !== 0 ? frame.stickX : frame.steer;
    const stickY = frame.stickX !== 0 || frame.stickY !== 0 ? frame.stickY : frame.throttle;
    const dir = stickToWorld(stickX, stickY, cameraYaw);
    const speed = PILOT_SPEED * dir.magnitude;
    this.velocity.set(dir.dx * speed, 0, dir.dz * speed);
    if (dir.magnitude > 0) this.headingValue = Math.atan2(dir.dx, dir.dz);
    this.move(dt);
  }

  idle(dt: number): void {
    this.velocity.set(0, 0, 0);
    this.move(dt);
  }

  afterStep(): void {
    if (this.active) this.pose.capture();
  }

  render(alpha: number, frameSeconds: number): void {
    if (!this.active) return;
    this.pose.apply(alpha);
    this.root.rotation.set(0, this.headingValue, 0);
    this.time += frameSeconds;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase += frameSeconds * speed * 3.2;
    const swing = Math.sin(this.walkPhase) * Math.min(1, speed / PILOT_SPEED) * 0.7;
    this.legs[0]?.rotation.set(swing, 0, 0);
    this.legs[1]?.rotation.set(-swing, 0, 0);
    this.marker.position.y = 2.9 + Math.sin(this.time * 3) * 0.15;
    this.marker.rotation.y = this.time * 1.5 - this.headingValue;
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
    this.root.removeFromParent();
  }

  private move(dt: number): void {
    if (!this.active) return;
    this.fallSpeed = Math.min(30, this.fallSpeed + GRAVITY * dt);
    const desired = { x: this.velocity.x * dt, y: -this.fallSpeed * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, undefined, WALK_GROUPS);
    const moved = this.controller.computedMovement();
    if (this.controller.computedGrounded()) this.fallSpeed = 0;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z });
  }

  /** Crew overalls with a hi-vis band, hard hat and boots; plus a ring and marker for readability. */
  private buildModel(): Group {
    const b = new ModelBuilder();
    const base = -PILOT_RIDE_HEIGHT;
    b.add(new CapsuleGeometry(0.3, 0.55, 4, 10), F.overalls, { at: [0, base + 1.2, 0] });
    b.add(new CylinderGeometry(0.31, 0.31, 0.1, 10), F.hiVis, { at: [0, base + 1.3, 0] });
    b.add(new SphereGeometry(0.2, 12, 8), F.skin, { at: [0, base + 1.72, 0] });
    b.add(new SphereGeometry(0.24, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), F.hat, {
      at: [0, base + 1.78, 0],
    });
    b.add(new CylinderGeometry(0.3, 0.3, 0.04, 12), F.hat, { at: [0, base + 1.78, 0.04] });
    for (const side of [-1, 1]) {
      b.add(new CapsuleGeometry(0.08, 0.45, 3, 6), F.overalls, {
        at: [side * 0.36, base + 1.22, 0],
        rotate: [0, 0, side * 0.2],
      });
    }
    this.root.add(b.build('pilot'));
    for (const side of [-1, 1]) {
      const leg = new Group();
      leg.position.set(side * 0.13, base + 0.85, 0);
      const parts = new ModelBuilder()
        .add(new CapsuleGeometry(0.1, 0.55, 3, 8), F.overalls, { at: [0, -0.38, 0] })
        .add(new CapsuleGeometry(0.11, 0.12, 3, 8), F.boots, { at: [0, -0.78, 0.05] })
        .build('pilot-leg');
      leg.add(parts);
      this.legs.push(leg);
      this.root.add(leg);
    }
    const ring = new Mesh(
      new RingGeometry(0.75, 0.95, 32),
      new MeshBasicMaterial({
        color: '#2EE6FF',
        transparent: true,
        opacity: 0.85,
        side: DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = base + 0.06;
    this.root.add(ring);
    const marker = new Group();
    const chevron = new Mesh(
      new ConeGeometry(0.35, 0.6, 4),
      new MeshBasicMaterial({ color: '#2EE6FF' }),
    );
    chevron.rotation.x = Math.PI;
    marker.add(chevron);
    this.root.add(marker);
    return marker;
  }
}
