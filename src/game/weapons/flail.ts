import * as THREE from 'three/webgpu';
import { STEP_SECONDS } from '../../engine/loop';
import { Layer, RAPIER, collisionGroups } from '../../engine/physics';
import type { Vehicle } from '../vehicles/vehicle';
import type { PieceRef } from '../world/buildings';
import { EFFECT_COLORS } from '../world/effects';
import type { Weapon, WeaponContext, WeaponStatus } from './weapon';

/** Length of the chain while the action button is up, in metres. */
export const SHORT_CHAIN = 3.5;
/** Length of the chain while the action button is held, in metres. */
export const LONG_CHAIN = 10;
/** How fast the chain pays out and winds in, in metres per second. */
const EXTEND_RATE = 14;
const RETRACT_RATE = 9;
/** Radius and mass of the spiked ball. */
const BALL_RADIUS = 0.9;
const BALL_MASS = 600;
/** The hitch sits this far behind the middle of the car, and this high above the ground. */
const HITCH_BACK = 2.9;
const HITCH_HEIGHT = 1.1;
/** A hit at this speed, in m/s, deals `FLAIL_DAMAGE`. The damage grows with the square of it. */
const FULL_HIT_SPEED = 16;
/** Damage of a hit at `FULL_HIT_SPEED`, and the most that a hit deals as a multiple of it. */
export const FLAIL_DAMAGE = 150;
const MAX_HIT_SHARE = 1.6;
/** A hit slower than this, in m/s, deals no damage. */
const MIN_HIT_SPEED = 5;
/** A section that the ball hit takes no new hit for this many seconds. */
const HIT_COOLDOWN = 0.3;
/** The ball's speed that counts as full for the sound of the chain, in m/s. */
const LOUD_SPEED = 25;
/** The chain throws the ball back with this share of its outward speed when it snaps tight. */
const ROPE_BOUNCE = 0.15;
/** Number of links that draw the chain. */
const LINKS = 14;

/**
 * The flail car's morning star: a spiked ball on a chain behind the car. The ball is a physics
 * body. It rolls behind the car on a short chain, swings out in turns and whips round in a slide.
 * While the action button is held, the chain pays out and the ball swings wide. When it is
 * released, the chain winds in again. The ball breaks the buildings that it hits hard enough.
 */
export class Flail implements Weapon {
  readonly object = new THREE.Group();
  private length = SHORT_CHAIN;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly cooldowns = new Map<string, number>();
  private readonly ball: THREE.Group;
  private readonly links: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly previous = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  private readonly previousRotation = new THREE.Quaternion();
  private readonly currentRotation = new THREE.Quaternion();
  /** Velocity of the ball before the physics step, to judge the speed of a hit. */
  private readonly velocity = new THREE.Vector3();
  private readonly hitch = new THREE.Vector3();
  private readonly link = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor(
    private readonly context: WeaponContext,
    vehicle: Vehicle,
  ) {
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
    const up = new THREE.Vector3(0, 1, 0);
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
      mesh.quaternion.setFromUnitVectors(up, direction);
      this.ball.add(mesh);
    }
    this.object.add(this.ball);

    const linkGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.5);
    this.geometries.push(linkGeometry);
    this.links = new THREE.InstancedMesh(linkGeometry, steel, LINKS);
    this.links.frustumCulled = false;
    this.object.add(this.links);

    // The ball starts on the ground behind the car, at the end of the short chain.
    this.placeHitch(vehicle, vehicle.position, vehicle.heading, this.hitch);
    const back = new THREE.Vector3(-Math.cos(vehicle.heading), 0, -Math.sin(vehicle.heading));
    const start = this.hitch.clone().addScaledVector(back, SHORT_CHAIN - 0.5);
    start.y = context.groundAt(start.x, start.z, start.y + 2) + BALL_RADIUS;
    this.body = context.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setLinearDamping(0.15)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    // A prop, so that it hits buildings, cones, crates and its own car, which it bounces off.
    this.collider = context.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setMass(BALL_MASS)
        .setFriction(0.5)
        .setRestitution(0.3)
        .setCollisionGroups(
          collisionGroups(
            Layer.prop,
            Layer.terrain | Layer.building | Layer.prop | Layer.crate | Layer.vehicle,
          ),
        ),
      this.body,
    );
    this.current.copy(start);
    this.previous.copy(start);
  }

  step(dt: number, _vehicle: Vehicle, held: boolean): void {
    const target = held ? LONG_CHAIN : SHORT_CHAIN;
    const rate = held ? EXTEND_RATE : RETRACT_RATE;
    const gap = target - this.length;
    this.length += Math.sign(gap) * Math.min(rate * dt, Math.abs(gap));

    for (const [key, seconds] of this.cooldowns) {
      if (seconds <= dt) {
        this.cooldowns.delete(key);
      } else {
        this.cooldowns.set(key, seconds - dt);
      }
    }
    const linvel = this.body.linvel();
    this.velocity.set(linvel.x, linvel.y, linvel.z);
    this.breakAhead();
  }

  /**
   * Breaks the sections that the ball reaches in the next physics step and that its hit breaks,
   * so that the ball flies through them instead of bouncing off.
   */
  private breakAhead(): void {
    const world = this.context.physics.world;
    const velocity = this.velocity;
    if (velocity.length() < MIN_HIT_SPEED) {
      return;
    }
    const passed = new Set<number>();
    for (let i = 0; i < 3; i += 1) {
      const hit = world.castShape(
        this.body.translation(),
        { x: 0, y: 0, z: 0, w: 1 },
        velocity,
        this.collider.shape,
        0.02,
        STEP_SECONDS * 1.5,
        true,
        undefined,
        collisionGroups(Layer.prop, Layer.building),
        this.collider,
        this.body,
        (collider) =>
          !passed.has(collider.handle) &&
          this.context.buildings.lookup(collider.handle) !== undefined,
      );
      const ref = hit ? this.context.buildings.lookup(hit.collider.handle) : undefined;
      if (!hit || !ref) {
        return;
      }
      passed.add(hit.collider.handle);
      const normal = hit.normal1;
      const approach = -(velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z);
      const damage = this.damageAt(approach);
      if (damage > 0 && this.context.buildings.wouldBreak(ref, damage)) {
        this.strike(ref, damage, true);
      }
    }
  }

  /** Damage of a hit at a speed along the contact normal. */
  private damageAt(speed: number): number {
    if (speed < MIN_HIT_SPEED) {
      return 0;
    }
    return FLAIL_DAMAGE * Math.min(MAX_HIT_SHARE, (speed / FULL_HIT_SPEED) ** 2);
  }

  /** Damages a section, unless the ball hit it a moment ago. */
  private strike(ref: PieceRef, damage: number, ahead: boolean): void {
    const key = `${ref.building.data.id}/${ref.index}/${ref.level ?? 0}`;
    if (this.cooldowns.has(key)) {
      return;
    }
    this.cooldowns.set(key, HIT_COOLDOWN);
    const broke = this.context.buildings.damage(ref, damage, this.velocity, 0) > 0;
    const position = new THREE.Vector3().copy(this.body.translation());
    this.context.effects.sparks(position, 8, 12);
    if (!broke && !ahead) {
      this.context.effects.dust(position, 1.5, 3, EFFECT_COLORS.dustDark);
    }
    this.context.events.emit('flailHit', { position, broke });
  }

  /**
   * Damages the walls that the ball hit, and holds the ball on the chain. Call it after the
   * physics step, once the car has moved.
   */
  settle(vehicle: Vehicle): void {
    const world = this.context.physics.world;
    // The walls that the ball touches held its hit, or they would be gone already.
    const hits: { ref: PieceRef; speed: number }[] = [];
    world.contactPairsWith(this.collider, (other: RAPIER.Collider | null) => {
      if (!other) {
        return;
      }
      const ref = this.context.buildings.lookup(other.handle);
      if (!ref) {
        return;
      }
      let speed = 0;
      world.contactPair(this.collider, other, (manifold) => {
        if (manifold.numContacts() > 0) {
          const normal = manifold.normal();
          const v = this.velocity;
          speed = Math.max(speed, Math.abs(v.x * normal.x + v.y * normal.y + v.z * normal.z));
        }
      });
      hits.push({ ref, speed });
    });
    for (const { ref, speed } of hits) {
      const damage = this.damageAt(speed);
      if (damage > 0) {
        this.strike(ref, damage, false);
      }
    }

    // The chain: the ball may come closer to the hitch, but never further than the chain's length.
    this.placeHitch(vehicle, vehicle.position, vehicle.heading, this.hitch);
    const position = this.body.translation();
    const linvel = this.body.linvel();
    const dx = position.x - this.hitch.x;
    const dy = position.y - this.hitch.y;
    const dz = position.z - this.hitch.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > this.length && distance > 1e-6) {
      const nx = dx / distance;
      const ny = dy / distance;
      const nz = dz / distance;
      this.body.setTranslation(
        {
          x: this.hitch.x + nx * this.length,
          y: this.hitch.y + ny * this.length,
          z: this.hitch.z + nz * this.length,
        },
        true,
      );
      // Take away the speed away from the hitch, relative to the moving car.
      const car = vehicle.impactVelocity;
      const outward = (linvel.x - car.x) * nx + (linvel.y - car.y) * ny + (linvel.z - car.z) * nz;
      if (outward > 0) {
        const cut = outward * (1 + ROPE_BOUNCE);
        this.body.setLinvel(
          { x: linvel.x - nx * cut, y: linvel.y - ny * cut, z: linvel.z - nz * cut },
          true,
        );
      }
    }
    this.previous.copy(this.current);
    this.current.copy(this.body.translation());
    this.previousRotation.copy(this.currentRotation);
    this.currentRotation.copy(this.body.rotation());
  }

  /** Writes the hitch point at the back of the car. */
  private placeHitch(
    vehicle: Vehicle,
    center: THREE.Vector3,
    heading: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    return target.set(
      center.x - Math.cos(heading) * HITCH_BACK,
      center.y - vehicle.spec.rideHeight + HITCH_HEIGHT,
      center.z - Math.sin(heading) * HITCH_BACK,
    );
  }

  sync(alpha: number, vehicle: Vehicle): void {
    this.ball.position.lerpVectors(this.previous, this.current, alpha);
    this.ball.quaternion.slerpQuaternions(this.previousRotation, this.currentRotation, alpha);
    const hitch = this.placeHitch(
      vehicle,
      vehicle.object.position,
      -vehicle.object.rotation.y,
      this.hitch,
    );
    // A slack chain sags towards the ground.
    const span = hitch.distanceTo(this.ball.position);
    const sag = Math.sqrt(Math.max(0, this.length ** 2 - span ** 2)) * 0.5;
    for (let i = 0; i < LINKS; i += 1) {
      const t = (i + 0.5) / LINKS;
      this.link.lerpVectors(hitch, this.ball.position, t);
      this.link.y -= Math.sin(Math.PI * t) * sag;
      const next = (i + 1.5) / LINKS;
      this.ahead.lerpVectors(hitch, this.ball.position, next);
      this.ahead.y -= Math.sin(Math.PI * next) * sag;
      this.rotation.setFromUnitVectors(this.zAxis, this.ahead.sub(this.link).normalize());
      this.matrix.compose(this.link, this.rotation, this.scale);
      this.links.setMatrixAt(i, this.matrix);
    }
    this.links.instanceMatrix.needsUpdate = true;
  }

  status(): WeaponStatus {
    const extension = (this.length - SHORT_CHAIN) / (LONG_CHAIN - SHORT_CHAIN);
    return {
      label: 'FLAIL',
      meter: extension,
      value: extension > 0.98 ? 'LONG' : extension > 0.02 ? 'OUT' : 'SHORT',
      ready: true,
      active: extension > 0.5,
      intensity: Math.min(1, this.velocity.length() / LOUD_SPEED),
    };
  }

  addAmmo(): boolean {
    return false;
  }

  dispose(): void {
    this.context.physics.world.removeRigidBody(this.body);
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
