import * as THREE from 'three/webgpu';
import type { Vehicle } from '../vehicles/vehicle';
import { EFFECT_COLORS } from '../world/effects';
import type { Weapon, WeaponContext, WeaponStatus } from './weapon';

/** Seconds that a boost lasts. */
export const BOOST_SECONDS = 2;
/** Seconds after the end of a boost before the next one. */
export const BOOST_COOLDOWN = 4;

/**
 * The bulldozer's boost: a press of the action button raises the top speed and the acceleration
 * for a moment. A faster ram deals more damage, so the boost also hits harder.
 */
export class Boost implements Weapon {
  readonly object = new THREE.Group();
  /** Seconds left of the running boost. */
  private left = 0;
  /** Seconds before the next boost. */
  private cooldown = 0;
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();

  constructor(private readonly context: WeaponContext) {
    this.object.name = 'boost';
  }

  step(dt: number, vehicle: Vehicle, _held: boolean, pressed: boolean): void {
    // A remainder below a microsecond counts as zero, so that sums of steps end on time.
    if (this.left > 0) {
      this.left = this.left - dt > 1e-6 ? this.left - dt : 0;
      if (this.left === 0) {
        this.cooldown = BOOST_COOLDOWN;
      }
    } else {
      this.cooldown = this.cooldown - dt > 1e-6 ? this.cooldown - dt : 0;
    }
    if (pressed && this.left === 0 && this.cooldown === 0) {
      this.left = BOOST_SECONDS;
      this.context.events.emit('weaponFired', {
        weapon: 'boost',
        position: vehicle.position.clone(),
      });
    }
    vehicle.boosting = this.left > 0;
    if (vehicle.boosting) {
      this.exhaust(vehicle);
    }
  }

  /** Flames from the exhaust stacks behind the cabin. */
  private exhaust(vehicle: Vehicle): void {
    const { heading, spec } = vehicle;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    for (const side of [-1, 1]) {
      this.position.set(
        vehicle.position.x - fx * spec.length * 0.35 - fz * side * 0.9,
        vehicle.position.y + spec.height * 0.6,
        vehicle.position.z - fz * spec.length * 0.35 + fx * side * 0.9,
      );
      this.velocity.set(-fx * 8, 4 + Math.random() * 2, -fz * 8);
      this.context.effects.puff({
        position: this.position,
        velocity: this.velocity,
        color: Math.random() > 0.4 ? EFFECT_COLORS.fire : EFFECT_COLORS.fireHot,
        size: 0.45 + Math.random() * 0.3,
        life: 0.22 + Math.random() * 0.1,
        glowing: true,
        drag: 3,
      });
    }
  }

  sync(): void {}

  status(): WeaponStatus {
    if (this.left > 0) {
      return {
        label: 'BOOST',
        meter: this.left / BOOST_SECONDS,
        value: 'GO',
        ready: false,
        active: true,
      };
    }
    return {
      label: 'BOOST',
      meter: 1 - this.cooldown / BOOST_COOLDOWN,
      value: this.cooldown > 0 ? `${this.cooldown.toFixed(1)} S` : 'READY',
      ready: this.cooldown === 0,
      active: false,
    };
  }

  addAmmo(): boolean {
    return false;
  }

  dispose(): void {
    this.object.removeFromParent();
  }
}
