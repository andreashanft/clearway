import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups } from '../../engine/physics';
import { lerp, wrapAngle } from '../math';
import type { Vehicle } from '../vehicles/vehicle';
import type { PieceRef } from '../world/buildings';
import { EFFECT_COLORS } from '../world/effects';
import type { Weapon, WeaponContext, WeaponStatus } from './weapon';

/** Distance of the ball from the middle of the car while it spins, in metres. */
export const CHAIN_LENGTH = 7;
/** Distance of the ball from the middle of the car while it trails behind, in metres. */
const TRAIL_LENGTH = 4.5;
/** Radius of the spiked ball, in metres. */
const BALL_RADIUS = 0.9;
/** Height of the ball above the ground while it spins, in metres. */
const BALL_HEIGHT = 1.8;
/** Turn rate of the ball at full spin, in radians per second: about 1.1 turns. */
export const MAX_SPIN = 7;
/** Seconds that the ball takes to reach full spin. */
const SPIN_UP_SECONDS = 0.5;
/** Seconds that the ball takes to stop after the button is released. */
const SPIN_DOWN_SECONDS = 0.9;
/** Damage of a hit at full spin. It falls with the square of the share of full spin. */
export const FLAIL_DAMAGE = 150;
/** The ball deals no damage below this share of full spin. */
const MIN_HIT_SHARE = 0.3;
/** A section that the ball hit takes no new hit for this many seconds. */
const HIT_COOLDOWN = 0.3;
/** A wall that holds throws the ball back with this share of its spin. */
const BOUNCE = 0.35;
/** Number of links that draw the chain. */
const LINKS = 12;

/**
 * The flail car's morning star: a spiked ball on a chain. While the action button is down, the
 * ball circles the car and breaks the buildings that it touches. When the button is up, the ball
 * slows down and trails behind the car.
 */
export class Flail implements Weapon {
  readonly object = new THREE.Group();
  /** Angle of the ball around the car, relative to the car's heading. */
  private angle = Math.PI;
  private previousAngle = Math.PI;
  /** Turn rate of the ball in radians per second. Positive turns clockwise from above. */
  private spin = 0;
  private radius = TRAIL_LENGTH;
  private previousRadius = TRAIL_LENGTH;
  private readonly cooldowns = new Map<string, number>();
  private readonly ball: THREE.Group;
  private readonly links: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly shape = new RAPIER.Ball(BALL_RADIUS);
  private readonly ballPosition = new THREE.Vector3();
  private readonly drum = new THREE.Vector3();
  private readonly link = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly context: WeaponContext) {
    this.object.name = 'flail';
    const steel = new THREE.MeshLambertMaterial({ color: 0x4a5058, flatShading: true });
    const spikeSteel = new THREE.MeshLambertMaterial({ color: 0xc9d0d6, flatShading: true });
    this.materials.push(steel, spikeSteel);

    this.ball = new THREE.Group();
    const core = new THREE.IcosahedronGeometry(0.62, 0);
    const spike = new THREE.ConeGeometry(0.16, 0.6, 5);
    this.geometries.push(core, spike);
    const coreMesh = new THREE.Mesh(core, steel);
    coreMesh.castShadow = true;
    this.ball.add(coreMesh);
    const directions = new THREE.IcosahedronGeometry(1, 0).getAttribute('position');
    const seen = new Set<string>();
    for (let i = 0; i < directions.count; i += 1) {
      const direction = new THREE.Vector3().fromBufferAttribute(directions, i).normalize();
      const key = direction
        .toArray()
        .map((value) => value.toFixed(2))
        .join();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const mesh = new THREE.Mesh(spike, spikeSteel);
      mesh.position.copy(direction).multiplyScalar(0.72);
      mesh.quaternion.setFromUnitVectors(this.up, direction);
      this.ball.add(mesh);
    }
    this.object.add(this.ball);

    const linkGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.5);
    this.geometries.push(linkGeometry);
    this.links = new THREE.InstancedMesh(linkGeometry, steel, LINKS);
    this.links.frustumCulled = false;
    this.object.add(this.links);
  }

  step(dt: number, vehicle: Vehicle, held: boolean): void {
    this.previousAngle = this.angle;
    this.previousRadius = this.radius;
    if (held) {
      const target = MAX_SPIN;
      this.spin = Math.min(target, this.spin + (MAX_SPIN / SPIN_UP_SECONDS) * dt);
    } else {
      const slow = (MAX_SPIN / SPIN_DOWN_SECONDS) * dt;
      this.spin = Math.abs(this.spin) <= slow ? 0 : this.spin - Math.sign(this.spin) * slow;
    }
    const share = Math.abs(this.spin) / MAX_SPIN;
    if (share < MIN_HIT_SHARE && !held) {
      // The slow ball drags behind the car.
      const behind = wrapAngle(Math.PI - this.angle);
      this.angle += behind * Math.min(1, 3 * dt);
    }
    this.angle = wrapAngle(this.angle + this.spin * dt);
    // While the button is down, the chain stays long, also when a bounce slows the ball for a moment.
    const extension = held ? 1 : Math.min(1, share / MIN_HIT_SHARE);
    this.radius = lerp(TRAIL_LENGTH, CHAIN_LENGTH, extension);

    for (const [key, seconds] of this.cooldowns) {
      if (seconds <= dt) {
        this.cooldowns.delete(key);
      } else {
        this.cooldowns.set(key, seconds - dt);
      }
    }
    if (share >= MIN_HIT_SHARE) {
      this.hit(vehicle, share);
    }
  }

  /** Damages the building sections and pushes the loose objects that the ball touches. */
  private hit(vehicle: Vehicle, share: number): void {
    const position = this.place(vehicle, this.angle, this.radius, this.ballPosition);
    const world = this.context.physics.world;
    const sections = new Map<string, PieceRef>();
    const loose = new Map<number, RAPIER.RigidBody>();
    world.intersectionsWithShape(
      position,
      { x: 0, y: 0, z: 0, w: 1 },
      this.shape,
      (collider) => {
        const ref = this.context.buildings.lookup(collider.handle);
        if (ref) {
          sections.set(`${ref.building.data.id}/${ref.index}/${ref.level ?? 0}`, ref);
        } else {
          const body = collider.parent();
          if (body?.isDynamic()) {
            loose.set(body.handle, body);
          }
        }
        return true;
      },
      undefined,
      collisionGroups(Layer.vehicle, Layer.building | Layer.prop | Layer.crate),
      vehicle.collider,
      vehicle.body,
    );

    // The ball moves along its circle, and the car carries it along.
    const travelAngle = vehicle.heading + this.angle;
    const speed = this.spin * this.radius;
    const car = vehicle.impactVelocity;
    const velocity = new THREE.Vector3(
      -Math.sin(travelAngle) * speed + car.x,
      0,
      Math.cos(travelAngle) * speed + car.z,
    );
    // Each loose body takes one push per cooldown, however many of its colliders the ball touches.
    for (const [handle, body] of loose) {
      const key = `body/${handle}`;
      if (this.cooldowns.has(key)) {
        continue;
      }
      this.cooldowns.set(key, HIT_COOLDOWN * 2);
      const mass = body.mass();
      body.applyImpulse(
        { x: velocity.x * mass * 0.5, y: 4 * mass, z: velocity.z * mass * 0.5 },
        true,
      );
    }

    let struck = false;
    let broke = false;
    for (const [key, ref] of sections) {
      if (this.cooldowns.has(key)) {
        continue;
      }
      this.cooldowns.set(key, HIT_COOLDOWN);
      struck = true;
      const fallen = this.context.buildings.damage(ref, FLAIL_DAMAGE * share * share, velocity, 0);
      broke ||= fallen > 0;
    }
    if (!struck) {
      return;
    }
    this.context.effects.sparks(position, 8, 12);
    if (!broke) {
      // A wall that holds throws the ball back.
      this.spin = -this.spin * BOUNCE;
      this.context.effects.dust(position, 1.5, 3, EFFECT_COLORS.dustDark);
    }
    this.context.events.emit('flailHit', { position: position.clone(), broke });
  }

  /** Writes the position of the ball at an angle and a radius around the car. */
  private place(
    vehicle: Vehicle,
    angle: number,
    radius: number,
    target: THREE.Vector3,
    center: THREE.Vector3 = vehicle.position,
    heading: number = vehicle.heading,
  ): THREE.Vector3 {
    const world = heading + angle;
    const ground = center.y - vehicle.spec.rideHeight;
    return target.set(
      center.x + Math.cos(world) * radius,
      ground + BALL_HEIGHT,
      center.z + Math.sin(world) * radius,
    );
  }

  sync(alpha: number, vehicle: Vehicle): void {
    const center = vehicle.object.position;
    const heading = -vehicle.object.rotation.y;
    const angle = this.previousAngle + wrapAngle(this.angle - this.previousAngle) * alpha;
    const radius = lerp(this.previousRadius, this.radius, alpha);
    this.place(vehicle, angle, radius, this.ball.position, center, heading);
    this.ball.rotation.set(angle * 2, angle * 3, 0);

    // The chain hangs from the drum at the front of the car.
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    this.drum.set(
      center.x + fx * 3.7,
      center.y - vehicle.spec.rideHeight + 1.25,
      center.z + fz * 3.7,
    );
    const share = Math.abs(this.spin) / MAX_SPIN;
    // A slow chain sags towards the ground.
    const sag = (1 - Math.min(1, share * 2)) * 0.8;
    for (let i = 0; i < LINKS; i += 1) {
      const t = (i + 0.5) / LINKS;
      this.link.lerpVectors(this.drum, this.ball.position, t);
      this.link.y -= Math.sin(Math.PI * t) * sag;
      const next = (i + 1.5) / LINKS;
      const ahead = new THREE.Vector3().lerpVectors(this.drum, this.ball.position, next);
      this.rotation.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        ahead.sub(this.link).normalize(),
      );
      this.matrix.compose(this.link, this.rotation, this.scale);
      this.links.setMatrixAt(i, this.matrix);
    }
    this.links.instanceMatrix.needsUpdate = true;
  }

  status(): WeaponStatus {
    const share = Math.abs(this.spin) / MAX_SPIN;
    return {
      label: 'FLAIL',
      meter: share,
      value: share >= 0.99 ? 'FULL' : share > 0 ? 'SPIN' : 'HOLD',
      ready: true,
      active: share >= MIN_HIT_SHARE,
    };
  }

  addAmmo(): boolean {
    return false;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.links.dispose();
  }
}
