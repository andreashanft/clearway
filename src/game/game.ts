import * as THREE from 'three/webgpu';
import { EventBus } from '../engine/events';
import type { Input, InputState } from '../engine/input/input';
import { PhysicsWorld } from '../engine/physics';
import { CameraRig } from './camera';
import type { ExplosionSource, GameEvents } from './events';
import type { LevelData } from './level';
import { heightmapUrl } from './levels';
import { DEG, clamp, lerp, toBoxLocal } from './math';
import { NO_COMMAND, PointToDrive, type DriveCommand } from './vehicles/drive-control';
import { createVehicleModel } from './vehicles/models';
import { VEHICLE_SPECS } from './vehicles/specs';
import { Vehicle, type GroundQuery } from './vehicles/vehicle';
import { Buildings, type SegmentRef } from './world/buildings';
import {
  MIN_IMPACT_SPEED,
  TANK_BLAST_DAMAGE,
  TANK_BLAST_RADIUS,
  TNT_DAMAGE,
  TNT_RADIUS,
  canDamage,
  impactDamage,
} from './world/damage';
import { Debris } from './world/debris';
import { Effects } from './world/effects';
import { createLighting, type LevelLighting } from './world/lighting';
import { createScenery, crushHedges, type Scenery } from './world/scenery';
import { CRATE_SIZE, TntCrates } from './world/tnt';
import { createTerrain, loadHeightmap, type Terrain } from './world/terrain';

/** Classic input below this deflection counts as released. */
const CLASSIC_DEAD_ZONE = 0.08;
/** A vehicle that breaks through a wall keeps this fraction of its speed. */
const SMASH_THROUGH_SPEED = 0.82;
/** A vehicle that a wall stops bounces back with this fraction of its speed. */
const RECOIL_SPEED = 0.2;
/** Seconds for which the world freezes on a hit, to give the hit weight. */
const HIT_STOP_BREAK = 0.07;
const HIT_STOP_BLOCK = 0.035;
const HIT_STOP_EXPLOSION = 0.09;
/** Seconds between the destruction of a fuel tank and its explosion. */
const TANK_FUSE_SECONDS = 0.25;

interface PendingExplosion {
  position: THREE.Vector3;
  radius: number;
  damage: number;
  source: ExplosionSource;
  delay: number;
}

/** Player settings that the simulation reads. */
export interface GameOptions {
  /** Scales the camera shake. 0 turns it off. */
  cameraShake: number;
}

/**
 * One level in play: the world, the vehicles and the camera.
 *
 * `step` advances the simulation by one fixed step. `sync` draws the state between two steps.
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly cameraRig = new CameraRig();
  readonly physics = new PhysicsWorld();
  readonly events = new EventBus<GameEvents>();
  readonly effects = new Effects();
  readonly debris: Debris;
  readonly buildings: Buildings;
  readonly tnt: TntCrates;
  readonly vehicles: Vehicle[] = [];
  /** The vehicle that the player drives. */
  activeVehicle: Vehicle;
  /** Simulated time since the level started, in seconds. */
  time = 0;

  private readonly pointToDrive = new PointToDrive();
  private readonly lighting: LevelLighting;
  private readonly terrain: Terrain;
  readonly scenery: Scenery;
  private hitStop = 0;
  private readonly pendingExplosions: PendingExplosion[] = [];

  private constructor(
    readonly level: LevelData,
    heightmap: { grey: Uint8Array; samples: number },
    private readonly input: Input,
    readonly options: GameOptions,
  ) {
    this.lighting = createLighting(this.scene, level.lighting);
    this.terrain = createTerrain(level, heightmap, this.physics);
    this.scene.add(this.terrain.object);
    this.scenery = createScenery(level, this.terrain.heightfield, this.physics);
    this.scene.add(this.scenery.object);

    const heightAt = (x: number, z: number): number => this.terrain.heightfield.heightAt(x, z);
    this.debris = new Debris(this.physics);
    this.buildings = new Buildings(
      level,
      heightAt,
      this.physics,
      this.debris,
      this.effects,
      this.events,
    );
    this.tnt = new TntCrates(level, heightAt, this.physics, this.events);
    this.scene.add(this.buildings.object, this.tnt.object, this.debris.object, this.effects.object);
    this.events.on('buildingDestroyed', ({ building }) => {
      if (building.data.explodes) {
        this.pendingExplosions.push({
          position: new THREE.Vector3(
            building.data.pos[0],
            building.baseY + 2,
            building.data.pos[1],
          ),
          radius: TANK_BLAST_RADIUS,
          damage: TANK_BLAST_DAMAGE,
          source: 'tank',
          delay: TANK_FUSE_SECONDS,
        });
      }
    });

    const groundAt: GroundQuery = heightAt;
    for (const spawn of level.vehicles) {
      const spec = VEHICLE_SPECS[spawn.type];
      const vehicle = new Vehicle(
        spawn.id,
        spec,
        createVehicleModel(spec),
        this.physics,
        groundAt,
        spawn.pos,
        spawn.yaw * DEG,
      );
      this.vehicles.push(vehicle);
      this.scene.add(vehicle.object);
    }
    const active = this.vehicles.find((vehicle) => vehicle.id === level.player.vehicle);
    if (!active) {
      throw new Error(`Level "${level.id}" has no vehicle "${level.player.vehicle}" to start in.`);
    }
    this.activeVehicle = active;
    this.cameraRig.setRouteHeading(level.hauler.heading * DEG);
  }

  /** Loads the assets of a level and builds its world. */
  static async create(level: LevelData, input: Input, options: GameOptions): Promise<Game> {
    const heightmap = await loadHeightmap(heightmapUrl(level));
    return new Game(level, heightmap, input, options);
  }

  /** Height of the terrain at a position on the ground plane. */
  heightAt(x: number, z: number): number {
    return this.terrain.heightfield.heightAt(x, z);
  }

  /** Advances the simulation by one fixed step. */
  step(dt: number): void {
    if (this.hitStop > 0) {
      // The world holds still for a few hundredths of a second after a heavy hit.
      this.hitStop -= dt;
      return;
    }
    const input = this.input.poll();
    this.handleCameraButtons(input);

    const command = this.driveCommand(input);
    for (const vehicle of this.vehicles) {
      const driven = vehicle === this.activeVehicle;
      const wasActive = vehicle.actionActive;
      vehicle.step(dt, driven ? command : NO_COMMAND, {
        held: driven && input.action,
        pressed: driven && input.pressed.has('action'),
      });
      if (vehicle.actionActive && !wasActive) {
        this.events.emit('actionFired', { kind: vehicle.spec.actionKind });
      }
    }
    this.guideCrates();

    const footprints = this.vehicles.map((vehicle) => vehicle.footprint);
    for (const crate of this.tnt.step(dt, footprints)) {
      const position = crate.position.clone();
      this.tnt.remove(crate);
      this.explode(position, TNT_RADIUS, TNT_DAMAGE, 'tnt');
    }
    for (let i = this.pendingExplosions.length - 1; i >= 0; i -= 1) {
      const pending = this.pendingExplosions[i];
      pending.delay -= dt;
      if (pending.delay <= 0) {
        this.pendingExplosions.splice(i, 1);
        this.explode(pending.position, pending.radius, pending.damage, pending.source);
      }
    }

    this.physics.step();

    for (const vehicle of this.vehicles) {
      this.resolveImpact(vehicle);
      this.keepInBounds(vehicle);
      vehicle.capture();
      crushHedges(this.scenery, vehicle.footprint, (position) => this.effects.leaves(position));
    }
    this.tnt.capture();
    this.debris.step(dt);
    this.time += dt;
  }

  /** Draws the state between the previous and the current step. */
  sync(alpha: number, frameSeconds: number): void {
    for (const vehicle of this.vehicles) {
      vehicle.sync(alpha, frameSeconds);
    }
    this.tnt.sync(alpha, frameSeconds);
    this.debris.sync(alpha);
    this.effects.update(this.hitStop > 0 ? 0 : frameSeconds);

    const active = this.activeVehicle;
    this.cameraRig.update(
      frameSeconds,
      active.object.position,
      active.impactVelocity,
      Math.abs(active.forwardSpeed) / active.spec.topSpeed,
      this.options.cameraShake,
    );
    this.lighting.follow(this.cameraRig.focusPoint);
  }

  /**
   * Sets off an explosion: it damages buildings, throws vehicles and debris, lights nearby TNT
   * and flattens hedges.
   */
  explode(position: THREE.Vector3, radius: number, damage: number, source: ExplosionSource): void {
    this.buildings.blast(position, radius, damage);
    this.debris.blast(position, radius, 18);
    this.tnt.igniteWithin(position, radius * 0.8);

    const away = new THREE.Vector3();
    for (const vehicle of this.vehicles) {
      const distance = Math.hypot(vehicle.position.x - position.x, vehicle.position.z - position.z);
      if (distance >= radius) {
        continue;
      }
      const force = 1 - distance / radius;
      away
        .set(vehicle.position.x - position.x, 0, vehicle.position.z - position.z)
        .normalize()
        .multiplyScalar(28 * force);
      away.y = 10 * force;
      vehicle.knock(away, 0.35 + 0.9 * force);
    }
    crushHedges(
      this.scenery,
      { center: [position.x, position.z], half: [radius * 0.6, radius * 0.6], heading: 0 },
      (hedge) => this.effects.leaves(hedge),
    );

    this.effects.explosion(position, radius * 0.5);
    const distanceToView = position.distanceTo(this.cameraRig.focusPoint);
    this.cameraRig.addShake(clamp(1.5 - distanceToView / 80, 0.2, 1.3));
    this.hitStop = HIT_STOP_EXPLOSION;
    this.events.emit('explosion', { position, radius, source });
  }

  /** Adapts the camera to the canvas. */
  resize(aspect: number): void {
    this.cameraRig.resize(aspect);
  }

  /** Frees the physics world and the GPU resources of the level. */
  dispose(): void {
    this.physics.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        (object.geometry as THREE.BufferGeometry).dispose();
      }
    });
  }

  private handleCameraButtons(input: InputState): void {
    if (input.pressed.has('rotateLeft')) {
      this.cameraRig.rotate(-1);
    }
    if (input.pressed.has('rotateRight')) {
      this.cameraRig.rotate(1);
    }
    if (input.pressed.has('zoomIn')) {
      this.cameraRig.zoom(-1);
    }
    if (input.pressed.has('zoomOut')) {
      this.cameraRig.zoom(1);
    }
    if (input.pressed.has('recenter')) {
      this.cameraRig.recenter();
    }
  }

  /** Turns the input into throttle and steering for the active vehicle. */
  private driveCommand(input: InputState): DriveCommand {
    const classic =
      Math.abs(input.steer) > CLASSIC_DEAD_ZONE || Math.abs(input.throttle) > CLASSIC_DEAD_ZONE;
    if (classic) {
      this.pointToDrive.reset();
      return { throttle: input.throttle, steer: input.steer, brake: input.brake };
    }
    const magnitude = Math.hypot(input.pointX, input.pointY);
    const target = this.cameraRig.screenToHeading(input.pointX, input.pointY);
    const command = this.pointToDrive.update(target, magnitude, this.activeVehicle.heading);
    command.brake = input.brake;
    return command;
  }

  /**
   * Finds out whether a vehicle crashed into a building during the physics step, and deals the
   * damage. A crash shows as a sudden loss of speed while the vehicle touches a building.
   */
  private resolveImpact(vehicle: Vehicle): void {
    if (vehicle.impactCooldown > 0) {
      return;
    }
    const before = vehicle.impactVelocity;
    const after = vehicle.body.linvel();
    const lost = Math.hypot(before.x - after.x, before.z - after.z);
    if (lost < MIN_IMPACT_SPEED) {
      return;
    }
    const world = this.physics.world;
    const hits: SegmentRef[] = [];
    // The solver can spread a stop over two steps, so the lost speed understates a crash. The
    // speed at which the vehicle approached along the contact normal is the better measure.
    let approach = 0;
    world.contactPairsWith(vehicle.collider, (other) => {
      const ref = this.buildings.lookup(other.handle);
      if (!ref) {
        return;
      }
      world.contactPair(vehicle.collider, other, (manifold) => {
        if (manifold.numContacts() === 0) {
          return;
        }
        const normal = manifold.normal();
        approach = Math.max(approach, Math.abs(before.x * normal.x + before.z * normal.z));
        if (!hits.includes(ref)) {
          hits.push(ref);
        }
      });
    });
    if (hits.length === 0) {
      return;
    }
    vehicle.impactCooldown = 0.18;

    const material = hits[0].building.data.strength;
    const speed = Math.max(lost, approach);
    const damage = impactDamage({
      mass: vehicle.spec.mass,
      speed,
      vehicleFactor: vehicle.spec.damage,
      ramArmed: vehicle.ramArmed,
    });
    let fallen = 0;
    let blocked = true;
    for (const ref of hits) {
      if (canDamage(vehicle.spec.type, ref.building.data.strength)) {
        blocked = false;
        fallen += this.buildings.damage(ref, damage, before);
      }
    }
    vehicle.ramArmed = false;

    if (fallen > 0) {
      vehicle.setVelocity(before.x * SMASH_THROUGH_SPEED, after.y, before.z * SMASH_THROUGH_SPEED);
    } else {
      vehicle.setVelocity(-before.x * RECOIL_SPEED, after.y, -before.z * RECOIL_SPEED);
    }

    const strength = clamp(speed / 20, 0.25, 1);
    const position = vehicle.position.clone();
    position.x += Math.cos(vehicle.heading) * vehicle.spec.length * 0.5;
    position.z += Math.sin(vehicle.heading) * vehicle.spec.length * 0.5;
    if (blocked) {
      this.effects.sparks(position, 10);
    } else if (fallen === 0) {
      this.effects.dust(position, 2.5, 5);
    }
    if (vehicle === this.activeVehicle) {
      this.cameraRig.addShake(strength * (fallen > 0 ? 1 : 0.6));
      this.hitStop = fallen > 0 ? HIT_STOP_BREAK : HIT_STOP_BLOCK;
    }
    this.events.emit('impact', { position, strength, material, blocked, broke: fallen > 0 });
  }

  /**
   * Keeps a TNT crate in front of the Bruiser's blade while the Bruiser pushes it, so that the
   * crate does not slip off to the side.
   */
  private guideCrates(): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.spec.type !== 'bruiser' || vehicle.forwardSpeed < 1) {
        continue;
      }
      const box = vehicle.footprint;
      for (const crate of this.tnt.crates) {
        if (crate.state === 'gone') {
          continue;
        }
        const local = toBoxLocal([crate.position.x, crate.position.z], box);
        const inFront = local[0] > box.half[0] - 0.5 && local[0] < box.half[0] + CRATE_SIZE;
        if (!inFront || Math.abs(local[1]) > box.half[1]) {
          continue;
        }
        const rightX = -Math.sin(vehicle.heading);
        const rightZ = Math.cos(vehicle.heading);
        const velocity = crate.body.linvel();
        const sideways = velocity.x * rightX + velocity.z * rightZ;
        const eased = lerp(sideways, -local[1] * 1.5, 0.25);
        crate.body.setLinvel(
          {
            x: velocity.x + rightX * (eased - sideways),
            y: velocity.y,
            z: velocity.z + rightZ * (eased - sideways),
          },
          true,
        );
      }
    }
  }

  /** Stops a vehicle at the edge of the play area. */
  private keepInBounds(vehicle: Vehicle): void {
    const { min, max } = this.level.bounds;
    const position = vehicle.body.translation();
    const x = clamp(position.x, min[0], max[0]);
    const z = clamp(position.z, min[1], max[1]);
    if (x === position.x && z === position.z) {
      return;
    }
    const velocity = vehicle.body.linvel();
    vehicle.body.setTranslation({ x, y: position.y, z }, true);
    vehicle.body.setLinvel(
      {
        x: x === position.x ? velocity.x : 0,
        y: velocity.y,
        z: z === position.z ? velocity.z : 0,
      },
      true,
    );
  }
}
