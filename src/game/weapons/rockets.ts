import * as THREE from 'three/webgpu';
import { GRAVITY, Layer, RAPIER, collisionGroups } from '../../engine/physics';
import { wrapAngle } from '../math';
import type { Vehicle } from '../vehicles/vehicle';
import { EFFECT_COLORS } from '../world/effects';
import type { Weapon, WeaponContext, WeaponStatus } from './weapon';

/** Rockets in the launcher at the start, and the most that it holds. */
export const START_AMMO = 6;
export const MAX_AMMO = 12;
/** Speed of a rocket in m/s. */
const ROCKET_SPEED = 90;
/**
 * A rocket burns its fuel after this distance, in metres. Then it falls to the ground and
 * explodes where it lands.
 */
const ROCKET_RANGE = 240;
/** A rocket explodes after this many seconds at the latest, wherever it is. */
const ROCKET_LIFE = 15;
/** Radius and damage at the centre of a rocket's explosion. */
export const ROCKET_RADIUS = 9;
export const ROCKET_DAMAGE = 280;
/** Seconds between two rockets. */
const REFIRE_SECONDS = 0.3;
/** The aim assist picks a building within this angle of the heading and this distance. */
const ASSIST_ANGLE = (18 * Math.PI) / 180;
const ASSIST_RANGE = 170;
/** A rocket turns towards its target at most this fast, in radians per second. */
const TURN_RATE = 1.5;
/** The aim assist aims this high above the ground, in metres. */
const AIM_HEIGHT = 3;

interface Rocket {
  mesh: THREE.Group;
  previous: THREE.Vector3;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  target: THREE.Vector3 | undefined;
  travelled: number;
  trail: number;
  age: number;
  /** Velocity once the fuel is gone and the rocket falls. Undefined while it burns. */
  falling: THREE.Vector3 | undefined;
}

/**
 * The buggy's rocket launcher. A press of the action button fires one rocket straight ahead. The
 * aim assist bends the rocket towards the nearest building close to the line of fire. The
 * launcher holds a limited number of rockets, and ammunition crates refill it.
 */
export class Rockets implements Weapon {
  readonly object = new THREE.Group();
  private ammo: number;
  private refire = 0;
  private readonly rockets: Rocket[] = [];
  private readonly geometries: THREE.BufferGeometry[];
  private readonly materials: THREE.Material[];
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private readonly desired = new THREE.Vector3();
  private readonly puffVelocity = new THREE.Vector3();
  private readonly filter = collisionGroups(
    Layer.vehicle,
    Layer.terrain | Layer.building | Layer.bridge | Layer.prop | Layer.crate,
  );

  /** @param ammo Rockets in the launcher at the start. */
  constructor(
    private readonly context: WeaponContext,
    ammo = START_AMMO,
  ) {
    this.ammo = ammo;
    this.object.name = 'rockets';
    const body = new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8).rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.16, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, 0.75);
    const flame = new THREE.IcosahedronGeometry(0.28, 0).translate(0, 0, -0.7);
    this.geometries = [body, nose, flame];
    this.materials = [
      new THREE.MeshLambertMaterial({ color: 0xdfe3e8, flatShading: true }),
      new THREE.MeshLambertMaterial({ color: 0xd8462f, flatShading: true }),
      new THREE.MeshBasicMaterial({ color: EFFECT_COLORS.fireHot, toneMapped: false }),
    ];
    // A tiny rocket far below the ground, so that the GPU compiles the rocket's shaders while the
    // level loads and not at the first shot.
    const warmUp = this.createMesh();
    warmUp.name = 'shader-warm-up';
    warmUp.scale.setScalar(0.01);
    warmUp.position.set(0, -500, 0);
    warmUp.traverse((child) => {
      child.frustumCulled = false;
    });
    this.object.add(warmUp);
  }

  private createMesh(): THREE.Group {
    const mesh = new THREE.Group();
    this.geometries.forEach((geometry, index) => {
      mesh.add(new THREE.Mesh(geometry, this.materials[index]));
    });
    return mesh;
  }

  step(dt: number, vehicle: Vehicle, _held: boolean, pressed: boolean): void {
    this.refire = Math.max(0, this.refire - dt);
    if (pressed && this.ammo > 0 && this.refire === 0) {
      this.fire(vehicle);
    }
    for (let i = this.rockets.length - 1; i >= 0; i -= 1) {
      const rocket = this.rockets[i];
      if (this.fly(rocket, vehicle, dt)) {
        this.rockets.splice(i, 1);
        this.object.remove(rocket.mesh);
      }
    }
  }

  private fire(vehicle: Vehicle): void {
    this.ammo -= 1;
    this.refire = REFIRE_SECONDS;
    const { heading } = vehicle;
    const direction = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    const position = vehicle.position
      .clone()
      .addScaledVector(direction, vehicle.spec.length * 0.4)
      .setY(vehicle.position.y + vehicle.spec.height * 0.7);
    const mesh = this.createMesh();
    mesh.position.copy(position);
    mesh.quaternion.setFromUnitVectors(this.forward, direction);
    this.object.add(mesh);
    this.rockets.push({
      mesh,
      previous: position.clone(),
      position,
      direction,
      target: this.aim(vehicle),
      travelled: 0,
      trail: 0,
      age: 0,
      falling: undefined,
    });
    this.context.effects.puff({
      position,
      velocity: this.puffVelocity.set(0, 1, 0),
      color: EFFECT_COLORS.fireHot,
      size: 0.9,
      life: 0.12,
      glowing: true,
      drag: 0,
    });
    this.context.events.emit('weaponFired', { weapon: 'rocket', position: position.clone() });
  }

  /**
   * Finds the point that the aim assist steers to: on the standing column that lies closest to
   * the line of fire, within the assist's angle and range.
   */
  private aim(vehicle: Vehicle): THREE.Vector3 | undefined {
    const { x, z } = vehicle.position;
    const ground = vehicle.position.y - vehicle.spec.rideHeight;
    let best: THREE.Vector3 | undefined;
    let bestScore = Infinity;
    for (const building of this.context.buildings.list) {
      if (building.destroyed) {
        continue;
      }
      for (const piece of building.pieces) {
        if (piece.top === 0) {
          continue;
        }
        const dx = piece.center.x - x;
        const dz = piece.center.z - z;
        const distance = Math.hypot(dx, dz);
        if (distance > ASSIST_RANGE || distance < 4) {
          continue;
        }
        const off = Math.abs(wrapAngle(Math.atan2(dz, dx) - vehicle.heading));
        if (off > ASSIST_ANGLE) {
          continue;
        }
        // Prefer what lies on the line of fire, then what is near.
        const score = off * 4 + distance / ASSIST_RANGE;
        if (score < bestScore) {
          bestScore = score;
          const top = building.baseY + building.sectionBottom(piece.top);
          best = new THREE.Vector3(
            piece.center.x,
            Math.min(top - 1, Math.max(ground + AIM_HEIGHT, building.baseY + building.base + 1)),
            piece.center.z,
          );
        }
      }
    }
    return best;
  }

  /** Moves a rocket by one step. Returns true when it exploded. */
  private fly(rocket: Rocket, vehicle: Vehicle, dt: number): boolean {
    rocket.age += dt;
    if (rocket.falling) {
      // Out of fuel: the rocket falls and points along its path.
      rocket.falling.y -= GRAVITY * dt;
      rocket.falling.multiplyScalar(Math.exp(-0.2 * dt));
      rocket.direction.copy(rocket.falling).normalize();
    } else if (rocket.target) {
      this.desired.subVectors(rocket.target, rocket.position);
      // A rocket that has passed its target flies on straight instead of turning back.
      if (this.desired.dot(rocket.direction) <= 0) {
        rocket.target = undefined;
      }
    }
    if (rocket.target && !rocket.falling) {
      this.desired.normalize();
      const angle = rocket.direction.angleTo(this.desired);
      if (angle > 1e-4) {
        const share = Math.min(1, (TURN_RATE * dt) / angle);
        rocket.direction.lerp(this.desired, share).normalize();
      }
    }
    const distance = (rocket.falling ? rocket.falling.length() : ROCKET_SPEED) * dt;
    const ray = new RAPIER.Ray(rocket.position, rocket.direction);
    const hit = this.context.physics.world.castRay(
      ray,
      distance,
      true,
      undefined,
      this.filter,
      vehicle.collider,
      vehicle.body,
    );
    rocket.previous.copy(rocket.position);
    if (hit) {
      const point = rocket.position.clone().addScaledVector(rocket.direction, hit.timeOfImpact);
      this.context.explode(point, ROCKET_RADIUS, ROCKET_DAMAGE, 'rocket');
      return true;
    }
    rocket.position.addScaledVector(rocket.direction, distance);
    rocket.travelled += distance;
    rocket.trail += dt;
    if (!rocket.falling && rocket.trail >= 0.03) {
      rocket.trail = 0;
      this.context.effects.puff({
        position: rocket.position.clone().addScaledVector(rocket.direction, -0.8),
        velocity: this.puffVelocity.set(0, 0.6, 0),
        color: Math.random() > 0.5 ? EFFECT_COLORS.smoke : EFFECT_COLORS.dustDark,
        size: 0.5 + Math.random() * 0.3,
        life: 0.6 + Math.random() * 0.3,
        drag: 2,
      });
    }
    const ground = this.context.groundAt(rocket.position.x, rocket.position.z, rocket.position.y);
    if (rocket.position.y < ground || rocket.age >= ROCKET_LIFE) {
      rocket.position.y = Math.max(rocket.position.y, ground);
      this.context.explode(rocket.position.clone(), ROCKET_RADIUS, ROCKET_DAMAGE, 'rocket');
      return true;
    }
    if (!rocket.falling && rocket.travelled >= ROCKET_RANGE) {
      // The fuel is gone: the flame goes out, and the rocket keeps its speed as it starts to fall.
      rocket.falling = rocket.direction.clone().multiplyScalar(ROCKET_SPEED);
      rocket.mesh.children[2].visible = false;
      this.context.effects.puff({
        position: rocket.position.clone(),
        velocity: this.puffVelocity.set(0, 0.5, 0),
        color: EFFECT_COLORS.smoke,
        size: 0.9,
        life: 0.8,
        drag: 2,
      });
    }
    return false;
  }

  sync(alpha: number): void {
    for (const rocket of this.rockets) {
      rocket.mesh.position.lerpVectors(rocket.previous, rocket.position, alpha);
      rocket.mesh.quaternion.setFromUnitVectors(this.forward, rocket.direction);
    }
  }

  status(): WeaponStatus {
    return {
      label: 'ROCKETS',
      meter: this.ammo / MAX_AMMO,
      value: `${this.ammo} / ${MAX_AMMO}`,
      ready: this.ammo > 0 && this.refire === 0,
      active: this.rockets.length > 0,
    };
  }

  /** Number of rockets in the launcher. */
  get count(): number {
    return this.ammo;
  }

  addAmmo(count: number): boolean {
    if (this.ammo >= MAX_AMMO) {
      return false;
    }
    this.ammo = Math.min(MAX_AMMO, this.ammo + count);
    return true;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }
}
