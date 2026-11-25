import * as THREE from 'three/webgpu';
import type { Vec2 } from '../math';

/** A vehicle picks up a crate within this distance, in metres. */
const PICKUP_RADIUS = 4;
/** A crate at a fixed place comes back after this many seconds. */
const RESPAWN_SECONDS = 25;
/** A crate that a building dropped disappears after this many seconds. */
const DROP_LIFE_SECONDS = 25;
/** It blinks during its last seconds. */
const BLINK_SECONDS = 5;
/** At most this many dropped crates lie in the level at once. */
const MAX_DROPPED = 4;
const SIZE = 1.3;

interface Crate {
  object: THREE.Group;
  x: number;
  z: number;
  y: number;
  dropped: boolean;
  /** Seconds since the crate appeared, or until a fixed crate comes back while negative. */
  age: number;
  present: boolean;
}

/**
 * Ammunition crates for the buggy's rockets. Some lie at fixed places in the level and come back
 * after a while. Large buildings drop more when they break. A crate shows only while the buggy is
 * the active vehicle, because only the buggy uses ammunition.
 */
export class AmmoCrates {
  readonly object = new THREE.Group();
  private readonly crates: Crate[] = [];
  private readonly geometries: THREE.BufferGeometry[];
  private readonly materials: THREE.Material[];
  private time = 0;

  constructor(
    positions: readonly Vec2[],
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.object.name = 'ammo-crates';
    const box = new THREE.BoxGeometry(SIZE, SIZE * 0.7, SIZE * 0.9);
    const band = new THREE.BoxGeometry(SIZE + 0.04, SIZE * 0.2, SIZE * 0.9 + 0.04);
    const beam = new THREE.CylinderGeometry(0.35, 0.35, 14, 10, 1, true).translate(0, 7, 0);
    this.geometries = [box, band, beam];
    this.materials = [
      new THREE.MeshLambertMaterial({ color: 0x4f6b3a, flatShading: true }),
      new THREE.MeshLambertMaterial({ color: 0xffc21a, flatShading: true }),
      new THREE.MeshBasicMaterial({
        color: 0xffc21a,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    ];
    for (const [x, z] of positions) {
      this.add(x, z, false);
    }
  }

  /** Shows or hides every crate. A hidden crate cannot be picked up. */
  set enabled(value: boolean) {
    this.object.visible = value;
  }

  get enabled(): boolean {
    return this.object.visible;
  }

  /** Drops a crate on the ground, unless too many dropped crates lie around already. */
  drop(x: number, z: number): boolean {
    const dropped = this.crates.filter((crate) => crate.dropped).length;
    if (dropped >= MAX_DROPPED) {
      return false;
    }
    this.add(x, z, true);
    return true;
  }

  /** Number of crates that can be picked up now. */
  get availableCount(): number {
    return this.crates.filter((crate) => crate.present).length;
  }

  /**
   * Spins the crates, brings fixed crates back and removes old dropped ones. A vehicle within
   * reach picks a crate up when `take` accepts it.
   *
   * @returns The positions of the crates picked up in this step.
   */
  step(dt: number, vehicle: THREE.Vector3, take: () => boolean): THREE.Vector3[] {
    this.time += dt;
    const taken: THREE.Vector3[] = [];
    for (let i = this.crates.length - 1; i >= 0; i -= 1) {
      const crate = this.crates[i];
      crate.age += dt;
      if (!crate.present) {
        if (crate.age >= 0) {
          crate.present = true;
          crate.object.visible = true;
        }
        continue;
      }
      if (crate.dropped && crate.age >= DROP_LIFE_SECONDS) {
        this.remove(i);
        continue;
      }
      const near = Math.hypot(vehicle.x - crate.x, vehicle.z - crate.z) < PICKUP_RADIUS;
      if (this.enabled && near && take()) {
        taken.push(new THREE.Vector3(crate.x, crate.y + SIZE, crate.z));
        if (crate.dropped) {
          this.remove(i);
        } else {
          crate.present = false;
          crate.object.visible = false;
          crate.age = -RESPAWN_SECONDS;
        }
      }
    }
    return taken;
  }

  /** Lets the crates bob and turn. */
  sync(): void {
    for (const crate of this.crates) {
      if (!crate.present) {
        continue;
      }
      const phase = this.time * 2 + crate.x * 0.1;
      crate.object.children[0].position.y = SIZE * 0.6 + Math.sin(phase) * 0.15;
      crate.object.children[0].rotation.y = this.time * 1.2;
      const blinking = crate.dropped && crate.age > DROP_LIFE_SECONDS - BLINK_SECONDS;
      crate.object.visible = !blinking || Math.floor(this.time * 6) % 2 === 0;
    }
  }

  private add(x: number, z: number, dropped: boolean): void {
    const object = new THREE.Group();
    const y = this.groundAt(x, z);
    object.position.set(x, y, z);
    const crate = new THREE.Group();
    const box = new THREE.Mesh(this.geometries[0], this.materials[0]);
    box.castShadow = true;
    crate.add(box, new THREE.Mesh(this.geometries[1], this.materials[1]));
    object.add(crate, new THREE.Mesh(this.geometries[2], this.materials[2]));
    this.object.add(object);
    this.crates.push({ object, x, z, y, dropped, age: 0, present: true });
  }

  private remove(index: number): void {
    this.object.remove(this.crates[index].object);
    this.crates.splice(index, 1);
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }
}
