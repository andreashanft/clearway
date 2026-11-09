import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { type Camera, type Scene, Vector3 } from 'three';
import type { Physics } from '../engine/physics';
import { explosionDamage, impactDamage } from './damage';
import type { GameBus } from './events';
import type { Effects } from './fx/effects';
import type { Hauler } from './hauler/hauler';
import type { LevelDefinition } from './level-data';
import { type Building, Buildings } from './world/buildings';
import type { Heightfield } from './world/heightfield';
import type { Props } from './world/props';
import { ColliderRegistry } from './world/registry';
import { TNT_DAMAGE, TNT_RADIUS, TntCrate } from './world/tnt';
import type { Vehicle } from './vehicles/vehicle';

type Owner =
  | { readonly kind: 'building'; readonly building: Building }
  | { readonly kind: 'vehicle'; readonly vehicle: Vehicle }
  | { readonly kind: 'tnt'; readonly crate: TntCrate }
  | { readonly kind: 'hauler' };

/** What hit the Hauler, for the fail message. */
export type HaulerHit = 'building' | 'vehicle' | 'tnt' | 'explosion';

/** Radius and damage of a fuel kiosk going up. */
const KIOSK_RADIUS = 9;
const KIOSK_DAMAGE = 450;
/** Seconds before the same vehicle can damage the same building again. */
const HIT_COOLDOWN = 0.4;
/** Fraction of its speed a vehicle keeps when it smashes straight through a building. */
const PLOUGH_THROUGH = 0.8;
/** Speed change, m/s, given to a body at the centre of a blast. */
const BLAST_KICK = 9;

interface PendingExplosion {
  readonly at: Vector3;
  readonly radius: number;
  readonly damage: number;
}

/**
 * Everything that breaks: buildings, TNT and props. Routes Rapier collision events to
 * damage, and runs explosions and their chain reactions.
 */
export class DestructionSystem {
  readonly registry = new ColliderRegistry<Owner>();
  readonly buildings: Buildings;
  readonly crates: TntCrate[] = [];
  private readonly lastHit = new Map<string, number>();
  private readonly pending: PendingExplosion[] = [];
  private time = 0;
  private hauler: Hauler | null = null;
  private onHaulerHit: ((cause: HaulerHit) => void) | null = null;
  private readonly tmp = new Vector3();
  private readonly hitPoint = new Vector3();
  private readonly hitDir = new Vector3();

  constructor(
    def: LevelDefinition,
    private readonly scene: Scene,
    private readonly physics: Physics,
    private readonly field: Heightfield,
    private readonly props: Props,
    private readonly effects: Effects,
    private readonly bus: GameBus,
  ) {
    this.buildings = new Buildings(def.buildings ?? [], field, physics, effects, {
      onDamaged: (building) => {
        bus.emit('building:damaged', {
          id: building.def.id,
          hp: building.hp,
          maxHp: building.maxHp,
        });
      },
      onDestroyed: (building) => {
        bus.emit('building:destroyed', {
          id: building.def.id,
          group: building.def.group ?? null,
        });
        if (building.def.explodes) {
          this.pending.push({
            at: building.origin.clone().setY(building.origin.y + 1.5),
            radius: KIOSK_RADIUS,
            damage: KIOSK_DAMAGE,
          });
        }
      },
      register: (collider, building) => {
        this.registry.add(collider, { kind: 'building', building });
      },
      unregister: (collider) => {
        this.registry.remove(collider);
      },
    });
    scene.add(this.buildings.mesh);

    for (const spawn of def.tnt ?? []) {
      const [x, z] = spawn.pos;
      const crate = new TntCrate(physics, new Vector3(x, field.heightAt(x, z), z));
      this.registry.add(crate.collider, { kind: 'tnt', crate });
      scene.add(crate.root, crate.indicator);
      this.crates.push(crate);
    }
  }

  /** Watches the Hauler's sensor and blasts near it, and reports hits to `onHit`. */
  watchHauler(hauler: Hauler, onHit: (cause: HaulerHit) => void): void {
    this.hauler = hauler;
    this.onHaulerHit = onHit;
    this.registry.add(hauler.sensor, { kind: 'hauler' });
  }

  addVehicle(vehicle: Vehicle): void {
    for (const collider of vehicle.colliders)
      this.registry.add(collider, { kind: 'vehicle', vehicle });
  }

  /** Runs fuses, queued explosions, rubble timers and prop knocking. Before the world steps. */
  step(dt: number, vehicles: readonly Vehicle[]): void {
    this.time += dt;
    for (const crate of this.crates) {
      if (crate.step(dt)) this.detonate(crate);
    }
    while (this.pending.length > 0) {
      const blast = this.pending.shift();
      if (blast) this.explode(blast.at, blast.radius, blast.damage);
    }
    this.buildings.step(dt);
    for (const vehicle of vehicles) {
      const speed = Math.abs(vehicle.forwardSpeed);
      if (speed < 1.5) continue;
      const p = vehicle.position;
      const v = vehicle.preStepVelocity;
      this.props.knock(p.x, p.z, 2.4, v.x, v.z);
    }
  }

  /** Handles this step's collisions. Call after the world has stepped. */
  afterStep(): void {
    this.physics.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.registry.get(h1);
      const b = this.registry.get(h2);
      if (!a || !b) return;
      if (a.kind === 'hauler' || b.kind === 'hauler') {
        this.haulerTouched(a.kind === 'hauler' ? b : a);
        return;
      }
      const c1 = this.physics.world.getCollider(h1);
      const c2 = this.physics.world.getCollider(h2);
      if (a.kind === 'vehicle' && b.kind === 'building') {
        this.vehicleHit(a.vehicle, b.building, c1, c2);
      } else if (b.kind === 'vehicle' && a.kind === 'building') {
        this.vehicleHit(b.vehicle, a.building, c2, c1);
      } else if (a.kind === 'vehicle' && b.kind === 'tnt') {
        this.touchTnt(a.vehicle, b.crate);
      } else if (b.kind === 'vehicle' && a.kind === 'tnt') {
        this.touchTnt(b.vehicle, a.crate);
      }
    });
    this.buildings.afterStep();
    for (const crate of this.crates) if (!crate.exploded) crate.afterStep();
  }

  render(alpha: number, frameSeconds: number, camera: Camera): void {
    this.buildings.render(alpha);
    for (const crate of this.crates) {
      if (crate.exploded) continue;
      const p = crate.position;
      crate.render(alpha, frameSeconds, this.field.heightAt(p.x, p.z));
    }
    this.props.update(frameSeconds);
    this.effects.update(frameSeconds, camera);
  }

  /** Blasts everything within `radius` of `at`: damage, impulses, chain reactions. */
  explode(at: Vector3, radius: number, maxDamage: number): void {
    const { rapier, world } = this.physics;
    this.effects.explosion(at, radius);
    this.bus.emit('explosion', { x: at.x, y: at.y, z: at.z, radius });
    this.bus.emit('impact', { strength: Math.min(1, maxDamage / 600) });

    for (const building of this.buildings.list) {
      if (building.destroyed) continue;
      const d = building.distanceTo(at.x, at.z);
      const damage = explosionDamage(d, radius, maxDamage);
      if (damage <= 0) continue;
      this.hitDir.set(building.origin.x - at.x, 0, building.origin.z - at.z).normalize();
      this.buildings.damage(
        building,
        damage,
        { kind: 'explosion' },
        {
          point: at,
          direction: this.hitDir,
          speed: 10 * (1 - d / radius),
        },
      );
    }

    for (const crate of this.crates) {
      if (crate.exploded) continue;
      const d = crate.position.distanceTo(at);
      // Nearby crates go up a moment later, so chains read as a ripple.
      if (d < radius) crate.light(0.15 + d * 0.04);
    }

    // Collect first: changing bodies inside Rapier's query callback leaves the world
    // borrowed, and it can no longer be freed.
    const bodies = new Map<number, RigidBody>();
    world.intersectionsWithShape(
      at,
      { x: 0, y: 0, z: 0, w: 1 },
      new rapier.Ball(radius),
      (collider) => {
        const body = collider.parent();
        if (body?.isDynamic()) bodies.set(body.handle, body);
        return true;
      },
    );
    for (const body of bodies.values()) {
      const t = body.translation();
      this.tmp.set(t.x - at.x, t.y - at.y, t.z - at.z);
      const falloff = Math.max(0, 1 - this.tmp.length() / radius);
      this.tmp.normalize();
      this.tmp.y = Math.max(this.tmp.y, 0.45);
      this.tmp.normalize().multiplyScalar(body.mass() * BLAST_KICK * falloff);
      body.applyImpulse(this.tmp, true);
    }

    this.props.knock(at.x, at.z, radius * 0.7, 0, 0);

    const hauler = this.hauler;
    if (
      hauler &&
      hauler.state !== 'destroyed' &&
      hauler.worldPosition.distanceTo(at) < radius + 4
    ) {
      this.onHaulerHit?.('explosion');
    }
  }

  dispose(): void {
    for (const crate of this.crates) crate.dispose();
    this.crates.length = 0;
    this.scene.remove(this.buildings.mesh);
    this.buildings.dispose();
    this.registry.clear();
    this.hauler = null;
    this.onHaulerHit = null;
  }

  private haulerTouched(other: Owner): void {
    if (other.kind === 'hauler') return;
    if (other.kind === 'building' && other.building.destroyed) return;
    this.onHaulerHit?.(other.kind);
  }

  private detonate(crate: TntCrate): void {
    if (crate.exploded) return;
    crate.exploded = true;
    const at = crate.position.clone();
    this.registry.remove(crate.collider);
    crate.dispose();
    this.explode(at, TNT_RADIUS, TNT_DAMAGE);
  }

  private touchTnt(vehicle: Vehicle, crate: TntCrate): void {
    if (crate.lit || crate.exploded || vehicle.spec.type !== 'bruiser') return;
    crate.light();
    this.bus.emit('tnt:lit', { seconds: crate.fuse ?? 0 });
  }

  private vehicleHit(vehicle: Vehicle, building: Building, mine: Collider, theirs: Collider): void {
    if (building.destroyed) return;
    const key = `${vehicle.spec.name}:${building.def.id}`;
    if (this.time - (this.lastHit.get(key) ?? -Infinity) < HIT_COOLDOWN) return;

    const velocity = vehicle.preStepVelocity;
    let normalSpeed = velocity.length();
    this.hitPoint.copy(vehicle.position).addScaledVector(velocity.clone().normalize(), 2.5);
    this.physics.world.contactPair(mine, theirs, (manifold, flipped) => {
      const n = manifold.normal();
      const sign = flipped ? -1 : 1;
      normalSpeed = Math.abs(
        velocity.x * n.x * sign + velocity.y * n.y * sign + velocity.z * n.z * sign,
      );
      const p = manifold.numSolverContacts() > 0 ? manifold.solverContactPoint(0) : null;
      if (p) this.hitPoint.set(p.x, p.y, p.z);
    });

    const damage = impactDamage(vehicle.spec.mass, normalSpeed, vehicle.damageMultiplier);
    if (damage <= 0) return;
    this.lastHit.set(key, this.time);
    this.hitDir.set(velocity.x, 0, velocity.z).normalize();
    const destroyed = this.buildings.damage(
      building,
      damage,
      { kind: 'vehicle', vehicle: vehicle.spec.type },
      { point: this.hitPoint, direction: this.hitDir, speed: normalSpeed },
    );
    this.bus.emit('impact', { strength: Math.min(1, damage / 250) });
    if (destroyed) {
      // Smash on through rather than stopping dead against a wall that just fell.
      vehicle.body.setLinvel(
        { x: velocity.x * PLOUGH_THROUGH, y: velocity.y, z: velocity.z * PLOUGH_THROUGH },
        true,
      );
    }
  }
}
