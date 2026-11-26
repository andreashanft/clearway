import * as THREE from 'three/webgpu';
import { STEP_SECONDS } from '../../engine/loop';
import { Layer, RAPIER, collisionGroups } from '../../engine/physics';
import type { Vehicle } from '../vehicles/vehicle';
import type { PieceRef } from '../world/buildings';
import { EFFECT_COLORS } from '../world/effects';
import type { Weapon, WeaponContext, WeaponStatus } from './weapon';

/** Radius and mass of the spiked ball. */
const BALL_RADIUS = 0.9;
/** Distance from the hitch to the middle of the ball while the ball sits on the car, in metres. */
export const DOCKED_CHAIN = BALL_RADIUS + 0.15;
/** Length of the chain while the action button is held, in metres. */
export const LONG_CHAIN = 7;
/**
 * The tuning of the flail. The debug panel changes these values while the game runs, so the
 * object is not frozen.
 */
export const FLAIL_TUNING = {
  /** Mass of the ball in kilograms. */
  ballMass: 1200,
  /** How fast the chain pays out and winds in, in metres per second. */
  extendRate: 24,
  retractRate: 18,
  /**
   * Share of the chain's pull that reaches the car. Below 1, the car keeps more of its own line,
   * so that the swinging ball tugs the car without throwing it around.
   */
  tugShare: 0.45,
};
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
 * The flail car's morning star: a spiked ball on a chain from a winch at the back of the car.
 *
 * The ball sits on the car while the action button is up. While the button is held, the chain
 * pays out and the ball becomes a physics body that swings out in turns and whips round in a
 * slide. The chain pulls the car too, so the ball's mass and momentum tug at the car. When the
 * button is released, the chain winds in and the ball docks again. The ball breaks the buildings
 * that it hits hard enough.
 */
export class Flail implements Weapon {
  readonly object = new THREE.Group();
  private length = DOCKED_CHAIN;
  /** True while the ball sits on the car. */
  private docked = true;
  /** The ball's mass that the collider has, in kilograms. */
  private mass = FLAIL_TUNING.ballMass;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly cooldowns = new Map<string, number>();
  private readonly ball: THREE.Group;
  private readonly links: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly previous = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  /** Velocity of the ball before the physics step, to judge the speed of a hit. */
  private readonly velocity = new THREE.Vector3();
  private readonly hitch = new THREE.Vector3();
  private readonly link = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

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

    // The ball starts on the car. It does not turn, so it slides instead of rolling like a wheel,
    // and the chain stays fixed to the same point of the ball.
    const start = this.dockPoint(vehicle, vehicle.position, vehicle.heading, new THREE.Vector3());
    this.body = context.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setLinearDamping(0.15)
        .lockRotations()
        .setCcdEnabled(true),
    );
    // A prop, so that it hits buildings, cones, crates and its own car, which it bounces off.
    this.collider = context.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setMass(FLAIL_TUNING.ballMass)
        .setFriction(0.35)
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
    if (held) {
      this.docked = false;
    }
    // The debug panel can change the mass while the ball is in play.
    if (this.mass !== FLAIL_TUNING.ballMass) {
      this.mass = FLAIL_TUNING.ballMass;
      this.collider.setMass(this.mass);
    }
    const target = held ? LONG_CHAIN : DOCKED_CHAIN;
    const rate = held ? FLAIL_TUNING.extendRate : FLAIL_TUNING.retractRate;
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
    if (!this.docked) {
      this.breakAhead();
    }
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
    if (this.docked) {
      // The ball rides on the car.
      const dock = this.dockPoint(vehicle, vehicle.position, vehicle.heading, this.hitch);
      this.body.setTranslation(dock, true);
      this.body.setLinvel(vehicle.impactVelocity, true);
      this.velocity.copy(vehicle.impactVelocity);
      this.record();
      return;
    }
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
      // The tight chain stops the ball moving away from the hitch, relative to the car, and pulls
      // the car towards the ball by the same impulse: the ball's momentum tugs at the car.
      const car = vehicle.body.linvel();
      const outward = (linvel.x - car.x) * nx + (linvel.y - car.y) * ny + (linvel.z - car.z) * nz;
      if (outward > 0) {
        const mass = FLAIL_TUNING.ballMass;
        const impulse = (outward * (1 + ROPE_BOUNCE)) / (1 / mass + 1 / vehicle.spec.mass);
        const cut = impulse / mass;
        this.body.setLinvel(
          { x: linvel.x - nx * cut, y: linvel.y - ny * cut, z: linvel.z - nz * cut },
          true,
        );
        const pull = impulse * FLAIL_TUNING.tugShare;
        vehicle.applyImpulse(new THREE.Vector3(nx * pull, 0, nz * pull), this.hitch);
      }
    }
    // Wound in: the ball docks on the car again.
    if (this.length <= DOCKED_CHAIN + 0.01 && distance <= DOCKED_CHAIN + 0.6) {
      this.docked = true;
    }
    this.record();
  }

  /** Records the ball's transform after the step, for interpolation. */
  private record(): void {
    this.previous.copy(this.current);
    this.current.copy(this.body.translation());
  }

  /** Writes the point where the docked ball sits, just behind the winch. */
  private dockPoint(
    vehicle: Vehicle,
    center: THREE.Vector3,
    heading: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    this.placeHitch(vehicle, center, heading, target);
    target.x -= Math.cos(heading) * DOCKED_CHAIN;
    target.z -= Math.sin(heading) * DOCKED_CHAIN;
    return target;
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
    const center = vehicle.object.position;
    const heading = -vehicle.object.rotation.y;
    if (this.docked) {
      // Follow the drawn car exactly, so that the docked ball does not lag behind it.
      this.dockPoint(vehicle, center, heading, this.ball.position);
    } else {
      this.ball.position.lerpVectors(this.previous, this.current, alpha);
    }
    const hitch = this.placeHitch(vehicle, center, heading, this.hitch);
    // The chain holds the same point of the ball, so the ball faces the hitch.
    this.ahead.subVectors(hitch, this.ball.position);
    if (this.ahead.lengthSq() > 1e-6) {
      this.ball.quaternion.setFromUnitVectors(this.yAxis, this.ahead.normalize());
    }
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
    const extension = (this.length - DOCKED_CHAIN) / (LONG_CHAIN - DOCKED_CHAIN);
    return {
      label: 'FLAIL',
      meter: extension,
      value: this.docked ? 'READY' : extension > 0.98 ? 'LONG' : 'OUT',
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
