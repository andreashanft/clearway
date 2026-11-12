import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../engine/physics';
import type { OrientedBox } from './math';
import { HAULER_LENGTH, HAULER_WIDTH, routePoint, type Route, type Urgency } from './route';
import { MeshBuilder } from './world/mesh-builder';

/** Height of the Hauler's hull centre above the ground, in metres. */
const RIDE_HEIGHT = 3.3;
/** Distance of the axles from the front and the rear, for following the terrain. */
const AXLE_INSET = 4;
/** The crash sensor reaches this far ahead of the bumper, in metres. */
const SENSOR_AHEAD = 1.2;

const COLORS = {
  hull: 0x2b3038,
  cab: 0x3a414b,
  steel: 0x5d6470,
  glass: 0x7ec1dd,
  alarm: 0xff3d5a,
  white: 0xf4f1ea,
  beacon: 0xff6b6b,
  core: 0xffb0b0,
} as const;

/**
 * The Hauler: an autonomous carrier that drives one straight line at a constant speed.
 * It enters the level already rolling, and it never steers or stops.
 */
export class Hauler {
  readonly object = new THREE.Group();
  /** How far the front of the Hauler has driven along the route, in metres. */
  distance = 0;
  destroyed = false;

  private readonly body: RAPIER.RigidBody;
  private readonly sensor: RAPIER.Cuboid;
  private readonly position = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();
  private pitch = 0;
  private previousPitch = 0;
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly beaconMaterial: THREE.MeshBasicMaterial;
  private readonly auraMaterial: THREE.MeshBasicMaterial;
  private readonly beacons: THREE.Object3D[] = [];
  private clock = 0;

  constructor(
    readonly route: Route,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly physics: PhysicsWorld,
  ) {
    this.object.name = 'hauler';
    this.object.rotation.order = 'YZX';
    this.object.rotation.y = -route.heading;

    const hull = new THREE.Mesh(
      createHullGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.object.add(hull);

    // The glowing core housing: the Hauler must be the most noticeable object on the screen.
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: COLORS.alarm, toneMapped: false });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 1), this.coreMaterial);
    core.position.set(-3, 2.9, 0);
    const heart = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.1, 0),
      new THREE.MeshBasicMaterial({ color: COLORS.core, toneMapped: false }),
    );
    heart.position.copy(core.position);
    this.object.add(core, heart);

    this.beaconMaterial = new THREE.MeshBasicMaterial({ color: COLORS.beacon, toneMapped: false });
    const beaconGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.7, 8);
    for (const [x, z] of [
      [11.8, 3.3],
      [11.8, -3.3],
      [-12.2, 3.5],
      [-12.2, -3.5],
    ]) {
      const beacon = new THREE.Mesh(beaconGeometry, this.beaconMaterial);
      beacon.position.set(x, x > 0 ? 3.55 : 1.95, z);
      this.beacons.push(beacon);
      this.object.add(beacon);
    }

    this.auraMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.alarm,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const aura = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
      this.auraMaterial,
    );
    aura.scale.set(19, 1, 9);
    aura.position.y = -RIDE_HEIGHT + 0.25;
    this.object.add(aura);

    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // The hull shoves loose debris aside. Everything else is the business of the crash sensor.
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(HAULER_LENGTH / 2, 2.4, HAULER_WIDTH / 2).setCollisionGroups(
        collisionGroups(Layer.hauler, Layer.debris),
      ),
      this.body,
    );
    this.sensor = new RAPIER.Cuboid(
      HAULER_LENGTH / 2 + SENSOR_AHEAD / 2,
      2.2,
      HAULER_WIDTH / 2 + 0.15,
    );

    this.place();
    this.previousPosition.copy(this.position);
    this.previousPitch = this.pitch;
    this.body.setTranslation(this.position, true);
    this.body.setRotation(this.rotation(this.pitch), true);
    this.sync(1, 0, 'calm');
  }

  /** Footprint of the Hauler on the ground plane. */
  get footprint(): OrientedBox {
    return {
      center: [this.position.x, this.position.z],
      half: [HAULER_LENGTH / 2, HAULER_WIDTH / 2],
      heading: this.route.heading,
    };
  }

  /** Centre of the hull after the latest step. */
  get center(): THREE.Vector3 {
    return this.position;
  }

  /** The point at the front bumper, where a crash happens. */
  get front(): THREE.Vector3 {
    const [x, z] = routePoint(this.route, this.distance);
    return new THREE.Vector3(x, this.position.y, z);
  }

  /** Drives the Hauler forward by one step. */
  step(dt: number): void {
    this.previousPosition.copy(this.position);
    this.previousPitch = this.pitch;
    if (this.destroyed) {
      return;
    }
    this.distance += this.route.speed * dt;
    this.place();
    this.body.setNextKinematicTranslation(this.position);
    this.body.setNextKinematicRotation(this.rotation(this.pitch));
  }

  /**
   * Returns the first solid collider that the Hauler touches: a building, a vehicle, a TNT crate,
   * the pilot or a tree. Rubble does not count.
   */
  findCollision(): RAPIER.Collider | undefined {
    if (this.destroyed) {
      return undefined;
    }
    const [dx, dz] = this.route.direction;
    const center = {
      x: this.position.x + (dx * SENSOR_AHEAD) / 2,
      y: this.position.y,
      z: this.position.z + (dz * SENSOR_AHEAD) / 2,
    };
    let hit: RAPIER.Collider | undefined;
    this.physics.world.intersectionsWithShape(
      center,
      this.rotation(this.pitch),
      this.sensor,
      (collider) => {
        hit = collider;
        return false;
      },
      undefined,
      // Bridges are not in the list: the Hauler drives over the Railbed, it does not hit it.
      collisionGroups(
        0xffff,
        Layer.building | Layer.vehicle | Layer.crate | Layer.pilot | Layer.prop,
      ),
      undefined,
      this.body,
    );
    return hit;
  }

  /** Draws the Hauler between the previous and the current step and animates its lights. */
  sync(alpha: number, frameSeconds: number, urgency: Urgency): void {
    this.clock += frameSeconds;
    this.object.position.lerpVectors(this.previousPosition, this.position, alpha);
    this.object.rotation.z = this.previousPitch + (this.pitch - this.previousPitch) * alpha;

    // The core breathes. The warning beacons blink, and strobe when a crash is close.
    const breath = 0.8 + 0.2 * Math.sin(this.clock * 3.2);
    this.coreMaterial.color.setHex(COLORS.alarm).multiplyScalar(breath);
    const rate = urgency === 'critical' ? 18 : urgency === 'warning' ? 7 : 3;
    const on = Math.sin(this.clock * rate) > 0;
    this.beaconMaterial.color.setHex(on ? COLORS.beacon : 0x5a1f28);
    this.auraMaterial.opacity = urgency === 'critical' ? (on ? 0.34 : 0.14) : 0.16;
  }

  /** Hides the Hauler after it blew up. */
  destroy(): void {
    this.destroyed = true;
    this.object.visible = false;
  }

  /** Shows the Hauler at a recorded pose, for the replay. */
  showAt(position: THREE.Vector3, pitch: number): void {
    this.object.visible = true;
    this.object.position.copy(position);
    this.object.rotation.z = pitch;
  }

  /** The pose that the replay records. */
  get pose(): { position: THREE.Vector3; pitch: number } {
    return { position: this.position, pitch: this.pitch };
  }

  private place(): void {
    const { route } = this;
    const [dx, dz] = route.direction;
    const [fx, fz] = routePoint(route, this.distance);
    const frontAxle = this.heightAt(fx - dx * AXLE_INSET, fz - dz * AXLE_INSET);
    const rearAxle = this.heightAt(
      fx - dx * (HAULER_LENGTH - AXLE_INSET),
      fz - dz * (HAULER_LENGTH - AXLE_INSET),
    );
    this.position.set(
      fx - (dx * HAULER_LENGTH) / 2,
      (frontAxle + rearAxle) / 2 + RIDE_HEIGHT,
      fz - (dz * HAULER_LENGTH) / 2,
    );
    this.pitch = Math.atan2(frontAxle - rearAxle, HAULER_LENGTH - AXLE_INSET * 2);
  }

  private rotation(pitch: number): THREE.Quaternion {
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, -this.route.heading, pitch, 'YZX'),
    );
  }
}

/** The dark hull of the Hauler: chassis, wheels, cargo bed, core housing, cab and hazard stripes. */
function createHullGeometry(): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const floor = -RIDE_HEIGHT;
  // Chassis and five axles
  builder.box([HAULER_LENGTH, 1.2, 7.4], [0, floor + 2.3, 0], COLORS.hull);
  for (const x of [-10.5, -6, -1.5, 5, 9.5]) {
    for (const side of [-1, 1]) {
      builder.cylinder(1.6, 1.6, 1.7, [x, floor + 1.6, side * 3.2 - 0.85], 0x15181d, 10, 'z');
    }
  }
  // Cargo bed with the core housing
  builder.box([17.5, 1.6, 7.8], [-3.5, floor + 3.6, 0], COLORS.hull);
  builder.cylinder(3.3, 2.9, 2.2, [-3, floor + 4.4, 0], COLORS.steel, 12);
  for (const x of [-9.5, 3.5]) {
    builder.box([1.2, 2.6, 6.2], [x, floor + 5.6, 0], COLORS.steel);
  }
  // Hazard chevrons along both flanks and across the tail
  for (let i = 0; i < 8; i += 1) {
    const x = -11.6 + i * 2.2;
    for (const side of [-1, 1]) {
      builder.box(
        [1.1, 1.3, 0.2],
        [x, floor + 3.6, side * 3.95],
        i % 2 === 0 ? COLORS.alarm : COLORS.white,
      );
    }
  }
  for (let i = 0; i < 6; i += 1) {
    builder.box(
      [0.3, 1.5, 1.3],
      [-13, floor + 3.5, -3.25 + i * 1.3],
      i % 2 === 0 ? COLORS.alarm : COLORS.white,
    );
  }
  // Cab
  builder.box([5.2, 3.6, 7.2], [10.2, floor + 4.6, 0], COLORS.cab);
  builder.box([0.3, 1.4, 6.2], [12.82, floor + 5.3, 0], COLORS.glass);
  builder.box([1.0, 1.0, 7.8], [12.6, floor + 2.3, 0], COLORS.steel);
  builder.box([5.4, 0.3, 7.4], [10.2, floor + 6.5, 0], COLORS.hull);
  return builder.build();
}
