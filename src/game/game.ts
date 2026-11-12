import * as THREE from 'three/webgpu';
import { EventBus } from '../engine/events';
import type { Input, InputState } from '../engine/input/input';
import { PhysicsWorld } from '../engine/physics';
import { CameraRig } from './camera';
import type { ExplosionSource, FailCause, GameEvents, Phase } from './events';
import { Hauler } from './hauler';
import type { LevelData, RouteGapData } from './level';
import { heightmapUrl } from './levels';
import {
  DEG,
  boxesOverlap,
  clamp,
  lerp,
  toBoxLocal,
  wrapAngle,
  type OrientedBox,
  type Vec2,
} from './math';
import {
  CRITICAL_SECONDS,
  createRoute,
  findObstacles,
  HAULER_LENGTH,
  routePoint,
  toRoute,
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
import { RailbedController } from './vehicles/railbed';
import { VEHICLE_SPECS } from './vehicles/specs';
import { SKID_DAMAGE_FACTOR, SKID_SLIP_ANGLE, Vehicle, type GroundQuery } from './vehicles/vehicle';
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
import { createDecks, deckHeightAt, type Deck } from './world/decks';
import { EFFECT_COLORS, Effects } from './world/effects';
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
const ROLL_RECOIL_SPEED = 0.6;
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

/** The pilot can climb into a vehicle within this distance of its hull, in metres. */
const ENTER_RANGE = 6.5;
/** The pilot does not step out closer than this to the edge of the Hauler's lane, in metres. */
const EXIT_LANE_MARGIN = 3;
/** With auto-skid, the Fishtail looks for a wall within this distance, in metres. */
const AUTO_SKID_RANGE = 26;
/** A skidding tail hits the same building segment at most once in this many seconds. */
const SKID_HIT_SECONDS = 0.4;
/** A landing counts as a stomp when the contact normal is this upright. */
const STOMP_NORMAL = 0.7;

/** The replay shows this many seconds before the crash. */
const REPLAY_SECONDS = 1.3;
/** Camera distance of the fly-over along the Hauler's line. */
const FLYOVER_DISTANCE = 84;

/** One recorded step, for the slow-motion replay of a crash. */
interface ReplayFrame {
  hauler: THREE.Vector3;
  pitch: number;
  vehicles: { position: THREE.Vector3; heading: number }[];
}

/** A route obstacle together with the buildings that it is made of. */
export interface ObstacleState {
  def: RouteObstacle;
  cleared: boolean;
  /** The segments of the obstacle that stand in the Hauler's strip. */
  segments: { building: Building; index: number; enter: number }[];
  /** Set when the obstacle is a gap in the route and not a building. */
  gap?: RouteGapData;
}

const ZERO = new THREE.Vector3();

/** Returns a ground query that reads the terrain on the centre line of a straight track. */
function trackHeight(rail: [Vec2, Vec2], heightAt: (x: number, z: number) => number): GroundQuery {
  const [start, end] = rail;
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  return (x, z) => {
    const t = ((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared;
    return heightAt(start[0] + dx * t, start[1] + dz * t);
  };
}

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
  /** The Fishtail starts its skid by itself next to a wall. */
  autoSkid: boolean;
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
  /** The vehicle that the player drives, or the pilot while on foot. */
  activeVehicle: Vehicle;
  /** The pilot on foot. Disabled while the player sits in a vehicle. */
  readonly pilot: Vehicle;
  readonly railbeds: RailbedController[] = [];
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
  /** False hides the obstacle outlines, for the title backdrop. */
  showMarkers = true;
  /** Debug switch: the Hauler drives through everything. */
  invincibleHauler = false;
  /** The result, once the level has ended. */
  result: LevelResult | undefined;

  private readonly pointToDrive = new PointToDrive();
  private readonly lighting: LevelLighting;
  private readonly terrain: Terrain;
  readonly scenery: Scenery;
  private hitStop = 0;
  private trailTimer = 0;
  private readonly pendingExplosions: PendingExplosion[] = [];
  private readonly markers: ObstacleMarkers;
  private readonly vehicleByCollider = new Map<number, Vehicle>();
  private readonly shownHints = new Set<string>();
  private readonly blocking = new Set<Building>();
  private readonly nextBuildings = new Set<Building>();
  private readonly decks: Deck[];
  /** When each building segment last took a skid hit, by `building:segment`. */
  private readonly skidHits = new Map<string, number>();
  private readonly recording: ReplayFrame[] = [];
  /** Position in the replay in seconds, while a replay plays. */
  private replayTime: number | undefined;
  /** Where the fly-over looks, as a fraction of the route, while the level is not running. */
  private flyover: number | undefined;

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

    const fixedDecks = createDecks(level.decks ?? [], this.physics);
    this.decks = fixedDecks.decks;
    this.scene.add(fixedDecks.object);

    const groundAt: GroundQuery = (x, z, fromY) => this.groundAt(x, z, fromY);
    for (const spawn of level.vehicles) {
      const spec = VEHICLE_SPECS[spawn.type];
      const vehicle = new Vehicle(
        spawn.id,
        spec,
        createVehicleModel(spec),
        this.physics,
        // The Railbed stands on the track bed: it takes its height from the middle of the track,
        // and neither the banks of the cutting nor its own deck may lift it.
        spawn.rail ? trackHeight(spawn.rail, heightAt) : groundAt,
        spawn.pos,
        spawn.yaw * DEG,
      );
      this.vehicles.push(vehicle);
      this.vehicleByCollider.set(vehicle.collider.handle, vehicle);
      this.scene.add(vehicle.object);

      if (spawn.lockedIn) {
        // The vehicle waits inside a building. It is free once the part of the building that
        // stands around it has fallen.
        const cover = this.buildings.get(spawn.lockedIn);
        vehicle.locked = true;
        vehicle.setEnabled(false);
        this.events.on('segmentDestroyed', ({ building }) => {
          if (building !== cover || !vehicle.locked) {
            return;
          }
          const around = building.segments.findIndex(
            (segment) => distanceToBox(spawn.pos, segment.box) === 0,
          );
          if (around < 0 || building.hp[around] <= 0) {
            vehicle.locked = false;
            vehicle.setEnabled(true);
            vehicle.teleport(spawn.pos, spawn.yaw * DEG);
          }
        });
      }
      const gap = level.routeGaps[this.railbeds.length];
      if (spawn.rail && gap) {
        const controller = new RailbedController(
          vehicle,
          spawn.rail,
          gap,
          heightAt(gap.slot[0], gap.slot[1]),
        );
        this.railbeds.push(controller);
        this.scene.add(controller.object);
      }
    }
    const active = this.vehicles.find((vehicle) => vehicle.id === level.player.vehicle);
    if (!active) {
      throw new Error(`Level "${level.id}" has no vehicle "${level.player.vehicle}" to start in.`);
    }
    this.activeVehicle = active;
    this.pilot = new Vehicle(
      'pilot',
      VEHICLE_SPECS.pilot,
      createVehicleModel(VEHICLE_SPECS.pilot),
      this.physics,
      groundAt,
      [active.position.x, active.position.z],
      0,
    );
    this.pilot.setEnabled(false);
    this.vehicles.push(this.pilot);
    this.vehicleByCollider.set(this.pilot.collider.handle, this.pilot);
    this.scene.add(this.pilot.object);
    this.cameraRig.setRouteHeading(level.hauler.heading * DEG);

    this.route = createRoute(level.hauler);
    this.hauler = new Hauler(this.route, (x, z) => this.groundAt(x, z, Infinity), this.physics);
    this.scene.add(this.hauler.object);
    const buildingObstacles: ObstacleState[] = findObstacles(this.route, level.buildings).map(
      (def) => ({
        def,
        cleared: false,
        segments: def.segments.flatMap((segment) => {
          const building = this.buildings.get(segment.buildingId);
          return building ? [{ building, index: segment.segmentIndex, enter: segment.enter }] : [];
        }),
      }),
    );
    const gapObstacles: ObstacleState[] = level.routeGaps.map((gap) => ({
      def: { id: gap.id, name: gap.name, distance: gap.from, segments: [] },
      cleared: false,
      segments: [],
      gap,
    }));
    this.obstacles = [...buildingObstacles, ...gapObstacles].sort(
      (a, b) => a.def.distance - b.def.distance,
    );
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

  /**
   * Height of the drivable ground: the terrain, or a bridge or Railbed deck above it.
   *
   * @param fromY Height of the asking vehicle. Decks well above it do not count.
   */
  groundAt(x: number, z: number, fromY: number): number {
    let height = this.terrain.heightfield.heightAt(x, z);
    for (const deck of this.decks) {
      height = Math.max(height, deckHeightAt(deck, x, z, fromY) ?? -Infinity);
    }
    for (const railbed of this.railbeds) {
      height = Math.max(height, deckHeightAt(railbed.deck, x, z, fromY) ?? -Infinity);
    }
    return height;
  }

  /** The vehicle that the pilot can climb into right now, if any. */
  get enterTarget(): Vehicle | undefined {
    if (this.activeVehicle !== this.pilot) {
      return undefined;
    }
    const { x, z } = this.pilot.position;
    let best: Vehicle | undefined;
    let bestDistance = ENTER_RANGE;
    for (const vehicle of this.vehicles) {
      if (!vehicle.enabled || vehicle.locked || !vehicle.spec.isVehicle) {
        continue;
      }
      const distance = distanceToBox([x, z], vehicle.footprint);
      if (distance < bestDistance) {
        best = vehicle;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** True when the bridge over a route gap is in place, or the Hauler has already crossed it. */
  private isGapClosed(gap: RouteGapData): boolean {
    return (
      this.hauler.distance > gap.to ||
      this.railbeds.some((railbed) => railbed.gap === gap && railbed.bridged)
    );
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
      if (obstacle.gap && (!best || obstacle.gap.from < best.distance)) {
        best = { obstacle, distance: obstacle.gap.from };
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
    this.flyover = undefined;
    this.cameraRig.setCinematic(undefined);
    this.cameraRig.snap();
    this.setPhase('playing');
    this.showHint('start');
  }

  /**
   * Points the camera at a place on the Hauler's line while the level waits to start.
   *
   * @param progress Fraction of the route from 0 to 1, or `undefined` to follow the vehicle.
   */
  setFlyover(progress: number | undefined): void {
    this.flyover = progress;
    this.cameraRig.setCinematic(progress === undefined ? undefined : FLYOVER_DISTANCE);
  }

  /** True while the slow-motion replay of the crash plays. */
  get replaying(): boolean {
    return this.replayTime !== undefined;
  }

  /** Plays the last moments before the crash again, in slow motion. */
  replayCrash(): void {
    if (this.phase !== 'failed' || this.recording.length === 0) {
      return;
    }
    this.replayTime = 0;
    this.events.emit('replayChanged', { playing: true });
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
    if (this.replayTime !== undefined) {
      this.stepReplay(dt);
      return;
    }
    if (this.hitStop > 0) {
      // The world holds still for a few hundredths of a second after a heavy hit.
      this.hitStop -= dt;
      return;
    }
    const input = this.input.poll();
    this.handleCameraButtons(input);
    if (input.pressed.has('pause') && this.isScoring) {
      this.events.emit('pauseRequested', {});
    }

    const playing = this.phase !== 'failed';
    if (playing && input.pressed.has('enterExit')) {
      this.enterOrExit();
    }
    const command = playing ? this.driveCommand(input) : NO_COMMAND;
    for (const vehicle of this.vehicles) {
      const driven = playing && vehicle === this.activeVehicle;
      const wasActive = vehicle.actionActive;
      vehicle.step(dt, driven ? command : NO_COMMAND, {
        held: driven && input.action,
        pressed: driven && input.pressed.has('action'),
        wallSide: driven && vehicle.spec.actionKind === 'skid' ? this.wallSide(vehicle) : 0,
      });
      if (vehicle.actionActive && !wasActive) {
        this.events.emit('actionFired', { kind: vehicle.spec.actionKind });
      }
    }
    this.guideCrates();
    this.hauler.step(dt);

    const footprints = this.vehicles
      .filter((vehicle) => vehicle.enabled && vehicle.spec.isVehicle)
      .map((vehicle) => vehicle.footprint);
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

    for (const railbed of this.railbeds) {
      const driven = railbed.vehicle === this.activeVehicle && Math.abs(command.throttle) > 0.1;
      railbed.constrain(playing && driven);
    }
    for (const vehicle of this.vehicles) {
      if (!vehicle.enabled) {
        continue;
      }
      this.resolveSkid(vehicle);
      this.resolveImpact(vehicle);
      this.keepInBounds(vehicle);
      vehicle.capture();
      if (vehicle.spec.isVehicle) {
        crushHedges(this.scenery, vehicle.footprint, (position) => this.effects.leaves(position));
      }
    }
    this.tnt.capture();
    this.debris.step(dt);
    this.emitTrails(dt);

    if (playing) {
      crushHedges(this.scenery, this.hauler.footprint, (position) => this.effects.leaves(position));
      const active = this.activeVehicle.position;
      this.pickups.step([[active.x, active.z]]);
      this.updateObstacles();
      this.record();
      this.checkHauler();
      this.updateHints();
      this.time += dt;
    }
  }

  /** Draws the state between the previous and the current step. */
  sync(alpha: number, frameSeconds: number): void {
    if (this.replayTime === undefined) {
      for (const vehicle of this.vehicles) {
        vehicle.sync(alpha, frameSeconds);
      }
      this.hauler.sync(alpha, frameSeconds, this.urgency);
    }
    for (const railbed of this.railbeds) {
      railbed.sync(frameSeconds);
    }
    this.tnt.sync(alpha, frameSeconds);
    this.debris.sync(alpha);
    this.pickups.sync(frameSeconds);
    this.markers.object.visible = this.showMarkers;
    this.markers.update(
      frameSeconds,
      this.blocking,
      this.nextBuildings,
      this.options.patternMarkings,
    );
    this.effects.update(this.hitStop > 0 ? 0 : frameSeconds);

    const active = this.activeVehicle;
    const focus = active.object.position.clone();
    if (this.phase === 'ready' && this.flyover !== undefined) {
      const [x, z] = routePoint(this.route, this.flyover * this.route.length);
      focus.set(x, this.heightAt(x, z), z);
    } else if (this.phase === 'failed') {
      // After the crash the camera looks at the wreck, or at the Hauler in the replay.
      focus.copy(this.replayTime === undefined ? this.hauler.center : this.hauler.object.position);
    } else if (this.phase === 'playing' && this.secondsToImpact < CRITICAL_SECONDS) {
      // Just before an impact the camera leans towards the Hauler to keep both in frame.
      const lean = this.hauler.front.sub(focus);
      lean.setLength(Math.min(lean.length() * 0.35, 30));
      focus.add(lean);
    }
    const following = this.phase === 'playing' || this.phase === 'bonus';
    this.cameraRig.update(
      frameSeconds,
      focus,
      following ? active.impactVelocity : ZERO,
      following ? Math.abs(active.forwardSpeed) / active.spec.topSpeed : 0,
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
    this.events.clear();
    this.physics.dispose();
    this.terrain.dispose();
    this.lighting.dispose();
    this.buildings.dispose();
    this.markers.dispose();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        (object.geometry as THREE.BufferGeometry).dispose();
        for (const material of [object.material].flat() as THREE.Material[]) {
          materials.add(material);
        }
      }
      if (object instanceof THREE.InstancedMesh) {
        object.dispose();
      }
    });
    for (const material of materials) {
      // Materials that the vehicle models share live on for the next level.
      if (material.userData.shared === true) {
        continue;
      }
      (material as THREE.Material & { map?: THREE.Texture | null }).map?.dispose();
      material.dispose();
    }
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
    if (this.activeVehicle === this.pilot) {
      // On foot the pilot simply walks where the stick points.
      const magnitude = Math.hypot(input.pointX, input.pointY);
      const pointed = this.cameraRig.screenToHeading(input.pointX, input.pointY);
      const error = wrapAngle(pointed - this.pilot.heading);
      return {
        throttle: magnitude > 0.12 ? magnitude * Math.max(0.2, Math.cos(error)) : 0,
        steer: magnitude > 0.12 ? clamp(error / 0.5, -1, 1) : 0,
        brake: false,
      };
    }
    const magnitude = Math.hypot(input.pointX, input.pointY);
    const railbed = this.railbeds.find((candidate) => candidate.vehicle === this.activeVehicle);
    if (railbed) {
      // The Railbed only knows forwards and backwards along its track.
      this.pointToDrive.reset();
      const pointed = this.cameraRig.screenToHeading(input.pointX, input.pointY);
      return {
        throttle: magnitude > 0.12 ? railbed.throttleFor(pointed, magnitude) : 0,
        steer: 0,
        brake: input.brake,
      };
    }
    let target = this.assistHeading(this.cameraRig.screenToHeading(input.pointX, input.pointY));
    const skidding = this.activeVehicle.skidding;
    if (skidding) {
      // In a skid the truck turns across its direction of travel, so that the tail swings out.
      target += this.activeVehicle.skidDirection * SKID_SLIP_ANGLE;
    }
    const command = this.pointToDrive.update(target, magnitude, this.activeVehicle.heading);
    command.brake = input.brake;
    return command;
  }

  /** Kicks up dust behind fast vehicles and the Hauler, and where a vehicle lands. */
  private emitTrails(dt: number): void {
    this.trailTimer -= dt;
    const puff = this.trailTimer <= 0;
    if (puff) {
      this.trailTimer = 0.07;
    }
    const position = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    for (const vehicle of this.vehicles) {
      if (!vehicle.enabled || !vehicle.spec.isVehicle) {
        continue;
      }
      const ground = vehicle.position.y - vehicle.spec.rideHeight;
      if (vehicle.landingSpeed > 6) {
        // A hard landing throws up a ring of dust.
        this.effects.dust(position.set(vehicle.position.x, ground, vehicle.position.z), 3.5, 8);
        if (vehicle === this.activeVehicle) {
          this.cameraRig.addShake(clamp(vehicle.landingSpeed / 30, 0.2, 0.8));
        }
        this.events.emit('landed', { speed: vehicle.landingSpeed });
        vehicle.landingSpeed = 0;
      }
      const speed = Math.hypot(vehicle.impactVelocity.x, vehicle.impactVelocity.z);
      const busy = vehicle.skidding || vehicle.rolling || speed > vehicle.spec.topSpeed * 0.55;
      if (!puff || !vehicle.grounded || !busy || speed < 5) {
        continue;
      }
      const back = vehicle.spec.length * 0.45;
      position.set(
        vehicle.position.x - Math.cos(vehicle.heading) * back + (Math.random() - 0.5) * 3,
        ground + 0.4,
        vehicle.position.z - Math.sin(vehicle.heading) * back + (Math.random() - 0.5) * 3,
      );
      this.effects.puff({
        position,
        velocity: velocity.set(0, 1.2 + Math.random(), 0),
        color: EFFECT_COLORS.dust,
        size: vehicle.skidding ? 1.5 : 0.9,
        life: vehicle.skidding ? 0.7 : 0.45,
      });
    }
    if (puff && !this.hauler.destroyed && this.isScoring) {
      const [dx, dz] = this.route.direction;
      const center = this.hauler.center;
      position.set(
        center.x - dx * 13 + (Math.random() - 0.5) * 6,
        center.y - 2.6,
        center.z - dz * 13 + (Math.random() - 0.5) * 6,
      );
      this.effects.puff({
        position,
        velocity: velocity.set(-dx * 2, 1.5, -dz * 2),
        color: EFFECT_COLORS.dustDark,
        size: 1.6,
        life: 0.9,
      });
    }
  }

  /** Records the poses of this step. The replay shows the last moments before a crash. */
  private record(): void {
    const { position, pitch } = this.hauler.pose;
    this.recording.push({
      hauler: position.clone(),
      pitch,
      vehicles: this.vehicles.map((vehicle) => ({
        position: vehicle.position.clone(),
        heading: vehicle.heading,
      })),
    });
    const limit = Math.round(REPLAY_SECONDS * 60);
    if (this.recording.length > limit) {
      this.recording.shift();
    }
  }

  /** Shows the recorded poses one after the other, then lets the Hauler blow up again. */
  private stepReplay(dt: number): void {
    if (this.replayTime === undefined) {
      return;
    }
    this.replayTime += dt;
    const index = Math.floor(this.replayTime * 60);
    const frame = this.recording[Math.min(index, this.recording.length - 1)];
    this.hauler.showAt(frame.hauler, frame.pitch);
    this.vehicles.forEach((vehicle, i) => {
      const pose = frame.vehicles[i];
      vehicle.showAt(pose.position, pose.heading);
    });
    if (index >= this.recording.length) {
      this.replayTime = undefined;
      this.hauler.destroy();
      this.effects.explosion(this.hauler.front, 16);
      this.effects.explosion(frame.hauler, 13);
      this.cameraRig.addShake(1.2);
      this.events.emit('replayChanged', { playing: false });
    }
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
      if (obstacle.gap) {
        // A gap is open again when the Railbed leaves its slot before the Hauler has crossed.
        const closed = this.isGapClosed(obstacle.gap);
        if (closed && !obstacle.cleared) {
          this.events.emit('obstacleCleared', {
            id: obstacle.def.id,
            name: obstacle.def.name,
            left: this.obstaclesLeft - 1,
          });
        }
        obstacle.cleared = closed;
        continue;
      }
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
    if (this.phase === 'bonus' && this.obstaclesLeft > 0) {
      // The Railbed left its slot before the Hauler crossed: the path is blocked again.
      this.setPhase('playing');
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
      for (const gap of this.level.routeGaps) {
        const reached = this.hauler.distance >= gap.from && this.hauler.distance <= gap.to;
        if (reached && !this.isGapClosed(gap)) {
          this.failLevel(`the ${gap.name}`, 'gap');
          return;
        }
      }
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

  /** Leaves the current vehicle on foot, or climbs into the vehicle next to the pilot. */
  private enterOrExit(): void {
    const { pilot } = this;
    if (this.activeVehicle === pilot) {
      const target = this.enterTarget;
      if (target) {
        pilot.setEnabled(false);
        this.activeVehicle = target;
        this.pointToDrive.reset();
        this.events.emit('vehicleChanged', { type: target.spec.type });
      }
      return;
    }
    const vehicle = this.activeVehicle;
    const [x, z] = this.exitSpot(vehicle);
    pilot.setEnabled(true);
    pilot.teleport(
      [x, z],
      vehicle.heading,
      this.groundAt(x, z, vehicle.position.y - vehicle.spec.rideHeight) + pilot.spec.rideHeight,
    );
    this.activeVehicle = pilot;
    this.pointToDrive.reset();
    this.events.emit('vehicleChanged', { type: 'pilot' });
  }

  /**
   * Chooses where the pilot stands after leaving a vehicle: beside the driver's door on the
   * left when that is safe, otherwise the nearest spot that is clear of the Hauler's lane and of
   * every building.
   */
  private exitSpot(vehicle: Vehicle): Vec2 {
    const side = vehicle.spec.width / 2 + 1.8;
    const along = vehicle.spec.length / 2 + 1.8;
    const forward: Vec2 = [Math.cos(vehicle.heading), Math.sin(vehicle.heading)];
    const left: Vec2 = [forward[1], -forward[0]];
    // Local offsets as [along the vehicle, to its left], in order of preference.
    const offsets: Vec2[] = [
      [0, side],
      [0, -side],
      [along, side],
      [-along, side],
      [along, -side],
      [-along, -side],
      [-along, 0],
      [along, 0],
    ];
    const lane = this.route.halfWidth + EXIT_LANE_MARGIN;
    let fallback: Vec2 | undefined;
    for (const [ahead, sideways] of offsets) {
      const spot: Vec2 = [
        vehicle.position.x + forward[0] * ahead + left[0] * sideways,
        vehicle.position.z + forward[1] * ahead + left[1] * sideways,
      ];
      fallback ??= spot;
      const [distance, offset] = toRoute(this.route, spot);
      const aheadOfHauler = distance > this.hauler.distance - HAULER_LENGTH;
      const inLane = aheadOfHauler && distance < this.route.length && Math.abs(offset) < lane;
      const inBuilding = this.buildings.list.some((building) =>
        building.segments.some(
          (segment, index) => building.hp[index] > 0 && distanceToBox(spot, segment.box) < 1,
        ),
      );
      // The pilot must also stay on the level of the vehicle, not drop into a cutting.
      const wheels = vehicle.position.y - vehicle.spec.rideHeight;
      const drop = wheels - this.groundAt(spot[0], spot[1], wheels);
      if (!inLane && !inBuilding && drop < 1.5) {
        return spot;
      }
    }
    return fallback ?? [vehicle.position.x, vehicle.position.z];
  }

  /**
   * For auto-skid: tells on which side of a vehicle the nearest building stands.
   * Returns -1 for the left, 1 for the right and 0 when no building is near.
   */
  private wallSide(vehicle: Vehicle): number {
    if (!this.options.autoSkid) {
      return 0;
    }
    const box = vehicle.footprint;
    let side = 0;
    let nearest = AUTO_SKID_RANGE;
    for (const building of this.buildings.list) {
      building.segments.forEach((segment, index) => {
        if (building.hp[index] <= 0) {
          return;
        }
        const distance = distanceToBox(box.center, segment.box);
        if (distance < nearest) {
          nearest = distance;
          side = Math.sign(toBoxLocal(segment.box.center, box)[1]);
        }
      });
    }
    return side;
  }

  /**
   * The skid attack of the Fishtail: while the truck skids, its armoured tail damages every
   * building segment that it sweeps along. The damage follows the speed of the truck, so a fast
   * pass along a terrace drops one house after the other.
   */
  private resolveSkid(vehicle: Vehicle): void {
    if (!vehicle.skidding) {
      return;
    }
    const velocity = vehicle.impactVelocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < MIN_IMPACT_SPEED) {
      return;
    }
    // The tail is the rear third of the truck, with a little reach beyond the hull.
    const { length, width } = vehicle.spec;
    const tail: OrientedBox = {
      center: [
        vehicle.position.x - Math.cos(vehicle.heading) * (length / 3),
        vehicle.position.z - Math.sin(vehicle.heading) * (length / 3),
      ],
      half: [length / 6 + 1.2, width / 2 + 1.5],
      heading: vehicle.heading,
    };
    const damage = impactDamage({
      mass: vehicle.spec.mass,
      speed,
      vehicleFactor: vehicle.spec.damage,
      ramArmed: false,
      actionFactor: SKID_DAMAGE_FACTOR,
    });
    let fallen = 0;
    let touched: SegmentRef | undefined;
    for (const building of this.buildings.list) {
      if (!boxesOverlap(tail, building.footprint)) {
        continue;
      }
      building.segments.forEach((segment, index) => {
        const key = `${building.data.id}:${index}`;
        const ready = (this.skidHits.get(key) ?? -Infinity) < this.time - SKID_HIT_SECONDS;
        if (building.hp[index] <= 0 || !ready || !boxesOverlap(tail, segment.box)) {
          return;
        }
        this.skidHits.set(key, this.time);
        touched = { building, index };
        if (canDamage(vehicle.spec.type, building.data.strength)) {
          fallen += this.buildings.damage({ building, index }, damage, velocity);
        }
      });
    }
    if (!touched) {
      return;
    }
    const strength = clamp(speed / 22, 0.3, 1);
    const blocked = !canDamage(vehicle.spec.type, touched.building.data.strength);
    const position = new THREE.Vector3(tail.center[0], vehicle.position.y, tail.center[1]);
    if (blocked) {
      this.effects.sparks(position, 8);
    }
    if (vehicle === this.activeVehicle) {
      this.cameraRig.addShake(strength * (fallen > 0 ? 0.8 : 0.4));
      if (fallen > 0) {
        this.hitStop = HIT_STOP_BLOCK;
      }
    }
    this.events.emit('impact', {
      position,
      strength,
      material: touched.building.data.strength,
      blocked,
      broke: fallen > 0,
    });
  }

  /**
   * Finds out whether a vehicle crashed into a building during the physics step, and deals the
   * damage. A crash shows as a sudden loss of speed while the vehicle touches a building.
   */
  private resolveImpact(vehicle: Vehicle): void {
    if (vehicle.impactCooldown > 0 || vehicle.spec.damage === 0 || vehicle.skidding) {
      return;
    }
    const before = vehicle.impactVelocity;
    const after = vehicle.body.linvel();
    const lost = Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z);
    if (lost < MIN_IMPACT_SPEED) {
      return;
    }
    const world = this.physics.world;
    const hits: SegmentRef[] = [];
    // The solver can spread a stop over two steps, so the lost speed understates a crash. The
    // speed at which the vehicle approached along the contact normal is the better measure.
    let approach = 0;
    let upright = 0;
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
        const speed = Math.abs(before.x * normal.x + before.y * normal.y + before.z * normal.z);
        if (speed > approach) {
          approach = speed;
          upright = Math.abs(normal.y);
        }
        if (!hits.includes(ref)) {
          hits.push(ref);
        }
      });
    });
    if (hits.length === 0) {
      return;
    }
    // A stomp is a landing from above: only the armoured belly of the Liftoff makes it count.
    const stomp = upright > STOMP_NORMAL && before.y < -3;
    const speed = stomp ? approach : Math.max(Math.min(lost, approach * 1.2), approach);
    if (speed < MIN_IMPACT_SPEED) {
      return;
    }
    vehicle.impactCooldown = 0.18;

    let actionFactor = 1;
    if (stomp) {
      actionFactor = vehicle.spec.stompDamage / vehicle.spec.damage;
    } else if (vehicle.skidding) {
      actionFactor = SKID_DAMAGE_FACTOR;
    } else if (vehicle.rolling) {
      actionFactor = vehicle.registerRollHit();
    }
    const material = hits[0].building.data.strength;
    const damage = impactDamage({
      mass: vehicle.spec.mass,
      speed,
      vehicleFactor: vehicle.spec.damage,
      ramArmed: vehicle.ramArmed,
      actionFactor,
    });
    let fallen = 0;
    let blocked = true;
    for (const ref of hits) {
      // An explosion-proof wall still gives way to a stomp or a roll of the right machine.
      if (canDamage(vehicle.spec.type, ref.building.data.strength)) {
        blocked = false;
        fallen += this.buildings.damage(ref, damage, before);
      }
    }
    vehicle.ramArmed = false;

    if (fallen > 0) {
      vehicle.setVelocity(before.x * SMASH_THROUGH_SPEED, after.y, before.z * SMASH_THROUGH_SPEED);
    } else if (!stomp) {
      // A rolling Tumbler bounces off hard and pounds the wall again within the same roll.
      const recoil = vehicle.rolling ? ROLL_RECOIL_SPEED : RECOIL_SPEED;
      vehicle.setVelocity(-before.x * recoil, after.y, -before.z * recoil);
    }

    const strength = clamp(speed / 20, 0.25, 1);
    const position = vehicle.position.clone();
    if (!stomp) {
      position.x += Math.cos(vehicle.heading) * vehicle.spec.length * 0.5;
      position.z += Math.sin(vehicle.heading) * vehicle.spec.length * 0.5;
    }
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
