import * as THREE from 'three/webgpu';
import type { Vehicle } from '../vehicles/vehicle';
import { EFFECT_COLORS } from '../world/effects';
import type { Weapon, WeaponContext, WeaponStatus } from './weapon';

/** Seconds that a full tank of boost lasts while the action button is held. */
export const BOOST_SECONDS = 2;
/** Seconds that an empty tank takes to fill up again while the button is up. */
export const BOOST_RECHARGE_SECONDS = 4;
/** The boost starts only with at least this share of the tank, so that it does not flicker. */
const MIN_START_SHARE = 0.08;
/** Speed in m/s that the start of a boost adds at once, so that it launches from standstill. */
const BOOST_KICK = 6;
/** Seconds between two such launches, so that tapping the button does not stack them. */
const KICK_INTERVAL = 1;

/**
 * The bulldozer's boost. While the action button is held, the boost raises the top speed and the
 * acceleration and drives at full throttle, also from standstill. It burns a tank that lasts
 * `BOOST_SECONDS`. While the button is up, the tank fills up again, and a boost can start again
 * before it is full. A faster ram deals more damage, so the boost also hits harder.
 */
export class Boost implements Weapon {
  readonly object = new THREE.Group();
  /** Share of the boost tank that is left, from 0 to 1. */
  private tank = 1;
  /** Seconds since the last launch. */
  private sinceKick = Infinity;
  /** True while the boost burns. */
  private burning = false;
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();

  constructor(private readonly context: WeaponContext) {
    this.object.name = 'boost';
  }

  step(dt: number, vehicle: Vehicle, held: boolean): void {
    this.sinceKick += dt;
    const starting = held && !this.burning && this.tank >= MIN_START_SHARE;
    const boosting = held && this.tank > 0 && (this.burning || starting);
    if (boosting) {
      // A remainder below a microsecond counts as empty, so that sums of steps end on time.
      const left = this.tank - dt / BOOST_SECONDS;
      this.tank = left > 1e-6 ? left : 0;
    } else if (!held) {
      this.tank = Math.min(1, this.tank + dt / BOOST_RECHARGE_SECONDS);
    }
    if (starting) {
      if (this.sinceKick >= KICK_INTERVAL) {
        vehicle.push(BOOST_KICK);
        this.sinceKick = 0;
      }
      this.context.events.emit('weaponFired', {
        weapon: 'boost',
        position: vehicle.position.clone(),
      });
    }
    this.burning = boosting;
    vehicle.boosting = boosting;
    if (boosting) {
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
    return {
      label: 'BOOST',
      meter: this.tank,
      value: this.tank >= 1 ? 'READY' : `${Math.floor(this.tank * 100)} %`,
      ready: this.tank >= MIN_START_SHARE,
      active: this.burning,
    };
  }

  addAmmo(): boolean {
    return false;
  }

  dispose(): void {
    this.object.removeFromParent();
  }
}
