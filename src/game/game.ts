import * as THREE from 'three/webgpu';
import { EventBus } from '../engine/events';
import type { Input, InputState } from '../engine/input/input';
import { PhysicsWorld } from '../engine/physics';
import { CameraRig } from './camera';
import type { ExplosionSource, FailCause, GameEvents, Phase } from './events';
import { Hauler } from './hauler';
import type { LevelData } from './level';
import { heightmapUrl } from './levels';
import { DEG, clamp, lerp, toBoxLocal, wrapAngle, type Vec2 } from './math';
import {
  CRITICAL_SECONDS,
  createRoute,
  findObstacles,
  secondsUntil,
  urgencyOf,
  type Route,
  type RouteObstacle,
  type Urgency,
} from './route';
import {
  BEACON_POINTS,
  DISH_POINTS,
  scoreLevel,
  segmentPoints,
  type LevelResult,
  type LevelTally,
} from './scoring';
import { NO_COMMAND, PointToDrive, type DriveCommand } from './vehicles/drive-control';
import { createVehicleModel } from './vehicles/models';
import { VEHICLE_SPECS } from './vehicles/specs';
import { Vehicle, type GroundQuery } from './vehicles/vehicle';
import { Buildings, distanceToBox, type Building, type SegmentRef } from './world/buildings';
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
import { ObstacleMarkers } from './world/markers';
import { Pickups } from './world/pickups';
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

/** An explosion this close to the Hauler, as a fraction of its radius, destroys the Hauler. */
const HAULER_BLAST_FRACTION = 0.55;
/** The steering assist bends the heading towards the next obstacle within this angle and range. */
const ASSIST_ANGLE = 16 * DEG;
const ASSIST_RANGE = 80;
/** Hints that depend on a place show when the player is this close, in metres. */
const HINT_RANGE = 46;

/** A route obstacle together with the buildings that it is made of. */
export interface ObstacleState {
  def: RouteObstacle;
  cleared: boolean;
  /** The segments of the obstacle that stand in the Hauler's strip. */
  segments: { building: Building; index: number; enter: number }[];
}

const ZERO = new THREE.Vector3();

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
  /** Eases the heading towards the next obstacle when the player already aims at it. */
  steeringAssist: boolean;
  /** Draws the outline of the next obstacle dashed, so that it does not rely on colour. */
  patternMarkings: boolean;
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
  /** Simulated time since the Hauler started rolling, in seconds. */
  time = 0;
  phase: Phase = 'ready';
  readonly route: Route;
  readonly hauler: Hauler;
  readonly obstacles: ObstacleState[];
  readonly pickups: Pickups;
  /** Points from destroyed segments, beacons and the dish. */
  points = 0;
  /** Seconds from the start until the path was clear. */
  clearSeconds = 0;
  /** Seconds of bonus time that the clear earned. */
  bonusSeconds = 0;
  /** Debug switch: the Hauler drives through everything. */
  invincibleHauler = false;
  /** The result, once the level has ended. */
  result: LevelResult | undefined;

  private readonly pointToDrive = new PointToDrive();
  private readonly lighting: LevelLighting;
  private readonly terrain: Terrain;
  readonly scenery: Scenery;
  private hitStop = 0;
  private readonly pendingExplosions: PendingExplosion[] = [];
  private readonly markers: ObstacleMarkers;
  private readonly vehicleByCollider = new Map<number, Vehicle>();
  private readonly shownHints = new Set<string>();
  private readonly blocking = new Set<Building>();
  private readonly nextBuildings = new Set<Building>();

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
      this.vehicleByCollider.set(vehicle.collider.handle, vehicle);
      this.scene.add(vehicle.object);
    }
    const active = this.vehicles.find((vehicle) => vehicle.id === level.player.vehicle);
    if (!active) {
      throw new Error(`Level "${level.id}" has no vehicle "${level.player.vehicle}" to start in.`);
    }
    this.activeVehicle = active;
    this.cameraRig.setRouteHeading(level.hauler.heading * DEG);

    this.route = createRoute(level.hauler);
    this.hauler = new Hauler(this.route, heightAt, this.physics);
    this.scene.add(this.hauler.object);
    this.obstacles = findObstacles(this.route, level.buildings).map((def) => ({
      def,
      cleared: false,
      segments: def.segments.flatMap((segment) => {
        const building = this.buildings.get(segment.buildingId);
        return building ? [{ building, index: segment.segmentIndex, enter: segment.enter }] : [];
      }),
    }));
    this.markers = new ObstacleMarkers(
      this.buildings.list.filter((building) =>
        this.obstacles.some((obstacle) =>
          obstacle.segments.some((segment) => segment.building === building),
        ),
      ),
    );
    this.pickups = new Pickups(level, heightAt, this.effects, this.events);
    this.scene.add(this.markers.object, this.pickups.object);

    this.events.on('segmentDestroyed', ({ building }) => {
      if (this.isScoring) {
        this.points += segmentPoints(building.data.strength);
      }
    });
    this.events.on('beaconLit', () => {
      this.points += BEACON_POINTS;
    });
    this.events.on('dishFound', () => {
      this.points += DISH_POINTS;
    });
    this.updateObstacles();
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

  /** True while destroyed segments, beacons and the dish count for the medal. */
  get isScoring(): boolean {
    return this.phase === 'playing' || this.phase === 'bonus';
  }

  /** The next obstacle that the Hauler would hit, with the route distance of its nearest part. */
  get nextObstacle(): { obstacle: ObstacleState; distance: number } | undefined {
    let best: { obstacle: ObstacleState; distance: number } | undefined;
    for (const obstacle of this.obstacles) {
      if (obstacle.cleared) {
        continue;
      }
      for (const segment of obstacle.segments) {
        const stands = segment.building.hp[segment.index] > 0;
        if (stands && (!best || segment.enter < best.distance)) {
          best = { obstacle, distance: segment.enter };
        }
      }
    }
    return best;
  }

  /** Seconds until the Hauler hits the next obstacle. `Infinity` when the path is clear. */
  get secondsToImpact(): number {
    const next = this.nextObstacle;
    return next ? secondsUntil(this.route, this.hauler.distance, next.distance) : Infinity;
  }

  /** How urgent the next obstacle is, for the pointer and the Hauler's beacons. */
  get urgency(): Urgency {
    return this.phase === 'playing' ? urgencyOf(this.secondsToImpact) : 'calm';
  }

  /** Number of route obstacles that still stand. */
  get obstaclesLeft(): number {
    return this.obstacles.reduce((count, obstacle) => count + (obstacle.cleared ? 0 : 1), 0);
  }

  /** Seconds until the Hauler reaches the end of its line. */
  get secondsUntilHaulerLeaves(): number {
    return secondsUntil(this.route, this.hauler.distance, this.route.length);
  }

  /** What the player has achieved so far. */
  tally(): LevelTally {
    return {
      pathCleared: this.obstaclesLeft === 0,
      obstaclesCleared: this.obstacles.length - this.obstaclesLeft,
      obstaclesTotal: this.obstacles.length,
      buildingsDestroyed: this.buildings.destroyedCount,
      buildingsTotal: this.buildings.list.length,
      beaconsLit: this.pickups.litCount,
      beaconsTotal: this.pickups.beacons.length,
      dishFound: this.pickups.dishState === 'found',
      clearSeconds: this.clearSeconds,
      bonusSeconds: this.bonusSeconds,
      points: this.points,
    };
  }

  /** Starts the level: the Hauler begins to roll. */
  start(): void {
    if (this.phase !== 'ready') {
      return;
    }
    this.setPhase('playing');
    this.showHint('start');
  }

  /** Ends the level early during bonus time. */
  finish(): void {
    if (this.phase === 'bonus') {
      this.endLevel();
    }
  }

  /** Advances the simulation by one fixed step. */
  step(dt: number): void {
    if (this.phase === 'ready' || this.phase === 'ended') {
      return;
    }
    if (this.hitStop > 0) {
      // The world holds still for a few hundredths of a second after a heavy hit.
      this.hitStop -= dt;
      return;
    }
    const input = this.input.poll();
    this.handleCameraButtons(input);

    const playing = this.phase !== 'failed';
    const command = playing ? this.driveCommand(input) : NO_COMMAND;
    for (const vehicle of this.vehicles) {
      const driven = playing && vehicle === this.activeVehicle;
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
    this.hauler.step(dt);

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

    if (playing) {
      crushHedges(this.scenery, this.hauler.footprint, (position) => this.effects.leaves(position));
      const active = this.activeVehicle.position;
      this.pickups.step([[active.x, active.z]]);
      this.updateObstacles();
      this.checkHauler();
      this.updateHints();
      this.time += dt;
    }
  }

  /** Draws the state between the previous and the current step. */
  sync(alpha: number, frameSeconds: number): void {
    for (const vehicle of this.vehicles) {
      vehicle.sync(alpha, frameSeconds);
    }
    this.hauler.sync(alpha, frameSeconds, this.urgency);
    this.tnt.sync(alpha, frameSeconds);
    this.debris.sync(alpha);
    this.pickups.sync(frameSeconds);
    this.markers.update(
      frameSeconds,
      this.blocking,
      this.nextBuildings,
      this.options.patternMarkings,
    );
    this.effects.update(this.hitStop > 0 ? 0 : frameSeconds);

    const active = this.activeVehicle;
    const focus = active.object.position.clone();
    if (this.phase === 'failed') {
      // After the crash the camera looks at the wreck.
      focus.copy(this.hauler.center);
    } else if (this.phase === 'playing' && this.secondsToImpact < CRITICAL_SECONDS) {
      // Just before an impact the camera leans towards the Hauler to keep both in frame.
      const lean = this.hauler.front.sub(focus);
      lean.setLength(Math.min(lean.length() * 0.35, 30));
      focus.add(lean);
    }
    this.cameraRig.update(
      frameSeconds,
      focus,
      this.phase === 'failed' ? ZERO : active.impactVelocity,
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

    const haulerDistance = distanceToBox([position.x, position.z], this.hauler.footprint);
    if (source !== 'hauler' && haulerDistance < radius * HAULER_BLAST_FRACTION) {
      this.failLevel('an explosion', 'explosion');
    }

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
    const target = this.assistHeading(this.cameraRig.screenToHeading(input.pointX, input.pointY));
    const command = this.pointToDrive.update(target, magnitude, this.activeVehicle.heading);
    command.brake = input.brake;
    return command;
  }

  private setPhase(phase: Phase): void {
    const previous = this.phase;
    this.phase = phase;
    this.events.emit('phaseChanged', { phase, previous });
  }

  /** Marks obstacles whose segments have all fallen, and declares the path clear. */
  private updateObstacles(): void {
    this.blocking.clear();
    this.nextBuildings.clear();
    for (const obstacle of this.obstacles) {
      if (obstacle.cleared) {
        continue;
      }
      const standing = obstacle.segments.filter(
        (segment) => segment.building.hp[segment.index] > 0,
      );
      if (standing.length === 0) {
        obstacle.cleared = true;
        this.events.emit('obstacleCleared', {
          id: obstacle.def.id,
          name: obstacle.def.name,
          left: this.obstaclesLeft,
        });
        this.showHint(`cleared:${obstacle.def.id}`);
        continue;
      }
      for (const segment of standing) {
        this.blocking.add(segment.building);
      }
    }
    const next = this.nextObstacle;
    if (next) {
      for (const segment of next.obstacle.segments) {
        if (segment.building.hp[segment.index] > 0) {
          this.nextBuildings.add(segment.building);
        }
      }
    }
    if (this.phase === 'playing' && this.obstaclesLeft === 0) {
      this.clearSeconds = this.time;
      this.bonusSeconds = this.secondsUntilHaulerLeaves;
      this.setPhase('bonus');
      this.events.emit('pathClear', {
        clearSeconds: this.clearSeconds,
        bonusSeconds: this.bonusSeconds,
      });
    }
  }

  /** Blows the Hauler up when it touches something solid, and ends the level when it leaves. */
  private checkHauler(): void {
    if (!this.invincibleHauler) {
      const collider = this.hauler.findCollision();
      if (collider) {
        const { hit, cause } = this.describe(collider);
        this.failLevel(hit, cause);
        return;
      }
    }
    if (this.hauler.distance >= this.route.length) {
      this.endLevel();
    }
  }

  /** Names what a collider belongs to, for the fail screen. */
  private describe(collider: { handle: number }): { hit: string; cause: FailCause } {
    const segment = this.buildings.lookup(collider.handle);
    if (segment) {
      return { hit: `the ${segment.building.data.name}`, cause: segment.building.data.strength };
    }
    const vehicle = this.vehicleByCollider.get(collider.handle);
    if (vehicle) {
      return { hit: `your ${vehicle.spec.name}`, cause: 'vehicle' };
    }
    if (this.tnt.owns(collider.handle)) {
      return { hit: 'a TNT crate', cause: 'tnt' };
    }
    return { hit: 'a tree', cause: 'tree' };
  }

  private failLevel(hit: string, cause: FailCause): void {
    if (!this.isScoring || this.invincibleHauler) {
      return;
    }
    const wreck = this.hauler.center.clone();
    const front = this.hauler.front;
    this.hauler.destroy();
    this.setPhase('failed');

    // A big, non-nuclear explosion: three fireballs along the hull and a shower of dark chunks.
    this.effects.explosion(front, 16);
    this.pendingExplosions.push(
      { position: wreck.clone(), radius: 26, damage: 0, source: 'hauler', delay: 0.12 },
      {
        position: wreck.clone().lerp(front, -0.8),
        radius: 22,
        damage: 0,
        source: 'hauler',
        delay: 0.3,
      },
    );
    const velocity = new THREE.Vector3();
    const size = new THREE.Vector3();
    const spin = new THREE.Vector3();
    for (let i = 0; i < 18; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      velocity.set(Math.cos(angle) * 14, 12 + Math.random() * 14, Math.sin(angle) * 14);
      size.set(1.5 + Math.random() * 3, 1 + Math.random() * 2, 1.5 + Math.random() * 3);
      spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      this.debris.spawn(wreck, size, i % 4 === 0 ? 0xff3d5a : 0x2b3038, velocity, spin);
    }
    this.cameraRig.addShake(1.6);
    this.events.emit('haulerDestroyed', {
      hit,
      cause,
      obstaclesCleared: this.obstacles.length - this.obstaclesLeft,
      obstaclesTotal: this.obstacles.length,
    });
  }

  private endLevel(): void {
    if (this.phase === 'ended' || this.phase === 'failed') {
      return;
    }
    this.result = scoreLevel(this.tally(), this.level.medals);
    this.setPhase('ended');
    this.events.emit('levelEnded', { result: this.result });
  }

  /** Shows a tutorial hint of the level once. */
  private showHint(trigger: string): void {
    if (this.shownHints.has(trigger)) {
      return;
    }
    const hint = this.level.hints.find((candidate) => candidate.trigger === trigger);
    if (hint) {
      this.shownHints.add(trigger);
      this.events.emit('hint', { text: hint.text });
    }
  }

  /** Shows the hints that depend on where the player is. */
  private updateHints(): void {
    const { x, z } = this.activeVehicle.position;
    for (const hint of this.level.hints) {
      if (!hint.trigger.startsWith('near:') || this.shownHints.has(hint.trigger)) {
        continue;
      }
      const target = hint.trigger.slice('near:'.length);
      let position: Vec2 | undefined;
      if (target === 'tnt') {
        const crate = this.tnt.crates.find((candidate) => candidate.state === 'idle');
        position = crate ? [crate.position.x, crate.position.z] : undefined;
      } else {
        position = this.buildings.get(target)?.data.pos;
      }
      if (position && Math.hypot(position[0] - x, position[1] - z) < HINT_RANGE) {
        this.showHint(hint.trigger);
      }
    }
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

  /**
   * Steering assist: when the player already aims roughly at the next obstacle, the heading
   * bends towards it, so that a ram lands square.
   */
  private assistHeading(heading: number): number {
    const next = this.nextObstacle;
    if (!this.options.steeringAssist || this.phase !== 'playing' || !next) {
      return heading;
    }
    const { x, z } = this.activeVehicle.position;
    let best: { offset: number; distance: number } | undefined;
    for (const segment of next.obstacle.segments) {
      if (segment.building.hp[segment.index] <= 0) {
        continue;
      }
      const center = segment.building.segments[segment.index].center;
      const distance = Math.hypot(center.x - x, center.z - z);
      const offset = wrapAngle(Math.atan2(center.z - z, center.x - x) - heading);
      if (distance < ASSIST_RANGE && (!best || Math.abs(offset) < Math.abs(best.offset))) {
        best = { offset, distance };
      }
    }
    if (!best || Math.abs(best.offset) > ASSIST_ANGLE) {
      return heading;
    }
    return heading + best.offset * 0.6;
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
