import * as THREE from 'three/webgpu';
import { EventBus } from '../engine/events';
import type { Input, InputState } from '../engine/input/input';
import { STEP_SECONDS } from '../engine/loop';
import { Layer, PhysicsWorld, collisionGroups } from '../engine/physics';
import { CameraRig } from './camera';
import type { ExplosionSource, FailCause, GameEvents, Phase } from './events';
import { Hauler } from './hauler';
import type { LevelData, VehicleType } from './level';
import { DEG, clamp, distanceToBox, type Vec2 } from './math';
import {
  CRITICAL_SECONDS,
  createRoute,
  findObstacles,
  routePoint,
  secondsUntil,
  urgencyOf,
  type Route,
  type RouteObstacle,
  type Urgency,
} from './route';
import { ScoreKeeper } from './score';
import {
  BEACON_POINTS,
  DEFAULT_MEDAL_RULES,
  DISH_POINTS,
  scoreLevel,
  type LevelResult,
  type LevelTally,
} from './scoring';
import { NO_COMMAND, shapeSteering, type DriveCommand } from './vehicles/handling';
import { createVehicleModel } from './vehicles/models';
import { VEHICLE_SPECS } from './vehicles/specs';
import { Vehicle } from './vehicles/vehicle';
import { Buildings, type Building, type PieceRef } from './world/buildings';
import { Cones } from './world/cones';
import {
  MIN_IMPACT_SPEED,
  TANK_BLAST_DAMAGE,
  TANK_BLAST_RADIUS,
  TNT_DAMAGE,
  TNT_RADIUS,
  ramDamage,
} from './world/damage';
import { Debris } from './world/debris';
import { createDecks, deckHeightAt, type Deck } from './world/decks';
import { EFFECT_COLORS, Effects } from './world/effects';
import { createLighting, type LevelLighting } from './world/lighting';
import { ObstacleMarkers } from './world/markers';
import { Pickups } from './world/pickups';
import { createScenery, crushHedges, type Scenery } from './world/scenery';
import { TntCrates } from './world/tnt';
import { createTerrain, flatHeightmap, loadHeightmap, type Terrain } from './world/terrain';

/** A vehicle that a wall stops bounces back with this fraction of its speed. */
const RECOIL_SPEED = 0.2;
/**
 * Seconds for which the world freezes when a wall stops a vehicle, to give the hit weight. A ram
 * that breaks the wall does not freeze the world, so that the vehicle keeps its flow.
 */
const HIT_STOP_BLOCK = 0.035;
const HIT_STOP_EXPLOSION = 0.09;
/** The vehicle looks ahead this many simulation steps for walls that its ram breaks. */
const BREAK_AHEAD_STEPS = 1.5;
/** At most this many walls break ahead of the vehicle in one step. */
const MAX_BREAKS_AHEAD = 4;
/** Seconds between the destruction of a fuel tank and its explosion. */
const TANK_FUSE_SECONDS = 0.25;

/** An explosion this close to the Hauler, as a fraction of its radius, destroys the Hauler. */
const HAULER_BLAST_FRACTION = 0.55;
/** Hints that depend on a place show when the player is this close, in metres. */
const HINT_RANGE = 46;

/** The replay shows this many seconds before the crash. */
const REPLAY_SECONDS = 1.3;
/** Camera distance of the fly-over along the Hauler's line. */
const FLYOVER_DISTANCE = 84;
/** Camera distance and turn rate of the backdrop view around a parked vehicle. */
const BACKDROP_DISTANCE = 46;
const BACKDROP_TURN = 0.1;
/** In a full slide, the chase view turns this share of the slip angle towards the direction of travel. */
const SLIDE_CAMERA_SHARE = 0.6;

/** One recorded step, for the slow-motion replay of a crash. */
interface ReplayFrame {
  hauler: THREE.Vector3;
  pitch: number;
  vehicle: { position: THREE.Vector3; heading: number };
}

/** A route obstacle together with the buildings that it is made of. */
export interface ObstacleState {
  def: RouteObstacle;
  cleared: boolean;
  /** The pieces of the obstacle that stand in the Hauler's strip. */
  pieces: { building: Building; index: number; enter: number }[];
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
  /** Draws the outline of the next obstacle dashed, so that it does not rely on colour. */
  patternMarkings: boolean;
  /** The camera stays behind the vehicle. When off, it keeps the high fixed view. */
  chaseCamera: boolean;
}

/**
 * One area in play: the world, the player's vehicle and the camera.
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
  readonly cones: Cones | undefined;
  /** The vehicle that the player drives. */
  activeVehicle: Vehicle;
  /** Simulated time since the run started, in seconds. */
  time = 0;
  phase: Phase = 'ready';
  /** The line of the Hauler and the Hauler itself. A free-driving area has neither. */
  readonly route: Route | undefined;
  readonly hauler: Hauler | undefined;
  readonly obstacles: ObstacleState[];
  readonly pickups: Pickups | undefined;
  /** Points from breaks, beacons and the dish, and the combo. */
  readonly score = new ScoreKeeper();
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

  private readonly lighting: LevelLighting;
  private readonly terrain: Terrain;
  readonly scenery: Scenery;
  private hitStop = 0;
  private trailTimer = 0;
  private readonly pendingExplosions: PendingExplosion[] = [];
  private readonly markers: ObstacleMarkers;
  private readonly shownHints = new Set<string>();
  private readonly blocking = new Set<Building>();
  private readonly nextBuildings = new Set<Building>();
  private readonly decks: Deck[];
  private readonly recording: ReplayFrame[] = [];
  /** Position in the replay in seconds, while a replay plays. */
  private replayTime: number | undefined;
  /** Seconds for which the backdrop view has run, while a menu shows the area behind it. */
  private backdrop: number | undefined;

  private constructor(
    readonly level: LevelData,
    heightmap: { grey: Uint8Array; samples: number },
    private readonly input: Input,
    readonly options: GameOptions,
    vehicleType: VehicleType,
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
          position: new THREE.Vector3(building.center[0], building.baseY + 2, building.center[1]),
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

    if (level.cones && level.cones.length > 0) {
      this.cones = new Cones(level.cones, heightAt, this.physics);
      this.scene.add(this.cones.object);
    }

    this.activeVehicle = this.createVehicle(vehicleType, level.spawn.pos, level.spawn.yaw * DEG);

    if (level.hauler) {
      const route = createRoute(level.hauler);
      this.route = route;
      this.cameraRig.setRouteHeading(route.heading);
      this.hauler = new Hauler(route, (x, z) => this.groundAt(x, z, Infinity), this.physics);
      this.scene.add(this.hauler.object);
      this.obstacles = findObstacles(route, level.buildings)
        .map((def) => ({
          def,
          cleared: false,
          pieces: def.pieces.flatMap((piece) => {
            const building = this.buildings.get(piece.buildingId);
            return building ? [{ building, index: piece.pieceIndex, enter: piece.enter }] : [];
          }),
        }))
        .sort((a, b) => a.def.distance - b.def.distance);
    } else {
      this.obstacles = [];
    }
    this.markers = new ObstacleMarkers(
      this.buildings.list.filter((building) =>
        this.obstacles.some((obstacle) =>
          obstacle.pieces.some((piece) => piece.building === building),
        ),
      ),
    );
    this.scene.add(this.markers.object);
    if (level.beacons && level.relayDish) {
      this.pickups = new Pickups(
        level.beacons.trails,
        level.relayDish,
        heightAt,
        this.effects,
        this.events,
      );
      this.scene.add(this.pickups.object);
    }

    this.events.on('pieceDestroyed', ({ building, position, volume, chain }) => {
      this.scoreBreak(position, volume, chain, building.tower);
    });
    this.events.on('sectionsFalling', ({ building, position, count, volume, chain }) => {
      this.scoreBreak(position, volume, chain, building.tower);
      const distance = position.distanceTo(this.cameraRig.focusPoint);
      const size = clamp(count / 6, 0.3, 1);
      this.cameraRig.addShake(size * clamp(1 - distance / 200, 0.1, 0.8));
    });
    this.events.on('beaconLit', () => {
      this.score.add(BEACON_POINTS);
    });
    this.events.on('dishFound', () => {
      this.score.add(DISH_POINTS);
    });
    this.updateObstacles();
  }

  /**
   * Loads the assets of an area and builds its world.
   *
   * @param vehicleType The vehicle that the player starts in.
   */
  static async create(
    level: LevelData,
    input: Input,
    options: GameOptions,
    vehicleType: VehicleType,
  ): Promise<Game> {
    const heightmap = level.terrain.heightmap
      ? await loadHeightmap(level.terrain.heightmap)
      : flatHeightmap();
    return new Game(level, heightmap, input, options, vehicleType);
  }

  /** Puts the player into another vehicle, at the place and heading of the current one. */
  setVehicle(type: VehicleType): void {
    const old = this.activeVehicle;
    if (old.spec.type === type) {
      return;
    }
    const position: Vec2 = [old.position.x, old.position.z];
    const { heading } = old;
    const wheels = old.position.y - old.spec.rideHeight;
    old.dispose();
    const vehicle = this.createVehicle(type, position, heading);
    // Keep the height of the wheels, so that a vehicle on a bridge stays on the bridge.
    vehicle.teleport(position, heading, wheels + vehicle.spec.rideHeight);
    this.activeVehicle = vehicle;
    this.events.emit('vehicleChanged', { type });
  }

  private createVehicle(type: VehicleType, position: Vec2, heading: number): Vehicle {
    const spec = VEHICLE_SPECS[type];
    const vehicle = new Vehicle(
      spec,
      createVehicleModel(spec),
      this.physics,
      (x, z, fromY) => this.groundAt(x, z, fromY),
      position,
      heading,
    );
    this.scene.add(vehicle.object);
    return vehicle;
  }

  /** Height of the terrain at a position on the ground plane. */
  heightAt(x: number, z: number): number {
    return this.terrain.heightfield.heightAt(x, z);
  }

  /**
   * Height of the drivable ground: the terrain, or a bridge deck above it.
   *
   * @param fromY Height of the asking vehicle. Decks well above it do not count.
   */
  groundAt(x: number, z: number, fromY: number): number {
    let height = this.terrain.heightfield.heightAt(x, z);
    for (const deck of this.decks) {
      height = Math.max(height, deckHeightAt(deck, x, z, fromY) ?? -Infinity);
    }
    return height;
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
      for (const piece of obstacle.pieces) {
        const stands = piece.building.standing(piece.index);
        if (stands && (!best || piece.enter < best.distance)) {
          best = { obstacle, distance: piece.enter };
        }
      }
    }
    return best;
  }

  /** Seconds until the Hauler hits the next obstacle. `Infinity` when the path is clear. */
  get secondsToImpact(): number {
    const next = this.nextObstacle;
    return next && this.route && this.hauler
      ? secondsUntil(this.route, this.hauler.distance, next.distance)
      : Infinity;
  }

  /** How urgent the next obstacle is, for the pointer and the Hauler's beacons. */
  get urgency(): Urgency {
    return this.phase === 'playing' ? urgencyOf(this.secondsToImpact) : 'calm';
  }

  /** Number of route obstacles that still stand. */
  get obstaclesLeft(): number {
    return this.obstacles.reduce((count, obstacle) => count + (obstacle.cleared ? 0 : 1), 0);
  }

  /** Seconds until the Hauler reaches the end of its line. `Infinity` without a Hauler. */
  get secondsUntilHaulerLeaves(): number {
    return this.route && this.hauler
      ? secondsUntil(this.route, this.hauler.distance, this.route.length)
      : Infinity;
  }

  /** What the player has achieved so far. */
  tally(): LevelTally {
    return {
      pathCleared: this.hauler !== undefined && this.obstaclesLeft === 0,
      obstaclesCleared: this.obstacles.length - this.obstaclesLeft,
      obstaclesTotal: this.obstacles.length,
      buildingsDestroyed: this.buildings.destroyedCount,
      buildingsTotal: this.buildings.list.length,
      beaconsLit: this.pickups?.litCount ?? 0,
      beaconsTotal: this.pickups?.beacons.length ?? 0,
      dishFound: this.pickups?.dishState === 'found',
      clearSeconds: this.clearSeconds,
      bonusSeconds: this.bonusSeconds,
      points: this.score.total,
    };
  }

  /** Starts the run: the player gets control, and the Hauler begins to roll. */
  start(): void {
    if (this.phase !== 'ready') {
      return;
    }
    this.backdrop = undefined;
    this.cameraRig.setCinematic(undefined);
    this.cameraRig.snap();
    this.setPhase('playing');
    this.showHint('start');
  }

  /**
   * Shows the area as a backdrop for a menu, while the run waits to start. With a Hauler, the
   * camera drifts along the middle of its line. Without one, it circles the parked vehicle.
   *
   * @param seconds How long the backdrop has been showing, or `undefined` to end it.
   */
  setBackdrop(seconds: number | undefined): void {
    if (this.backdrop === undefined && seconds !== undefined) {
      // The backdrop starts with a cut, not with a move away from the vehicle.
      this.cameraRig.snap();
    }
    this.backdrop = seconds;
    if (seconds === undefined) {
      this.cameraRig.setCinematic(undefined);
    } else if (this.route) {
      this.cameraRig.setCinematic(FLYOVER_DISTANCE);
    } else {
      this.cameraRig.setCinematic(BACKDROP_DISTANCE, seconds * BACKDROP_TURN);
    }
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
    const vehicle = this.activeVehicle;
    vehicle.step(dt, playing ? this.driveCommand(input) : NO_COMMAND);
    this.hauler?.step(dt);

    for (const crate of this.tnt.step(dt, [vehicle.footprint])) {
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

    if (playing) {
      this.breakAhead(vehicle);
    }
    this.physics.step();

    this.resolveImpact(vehicle);
    this.buildings.step(dt);
    this.score.update(dt);
    this.keepInBounds(vehicle);
    vehicle.capture();
    crushHedges(this.scenery, vehicle.footprint, (position) => this.effects.leaves(position));
    this.tnt.capture();
    this.cones?.capture();
    this.debris.step(dt);
    this.emitTrails(dt);

    if (playing) {
      if (this.hauler) {
        crushHedges(this.scenery, this.hauler.footprint, (position) =>
          this.effects.leaves(position),
        );
      }
      this.pickups?.step([[vehicle.position.x, vehicle.position.z]]);
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
      this.activeVehicle.sync(alpha, frameSeconds);
      this.hauler?.sync(alpha, frameSeconds, this.urgency);
    }
    this.tnt.sync(alpha, frameSeconds);
    this.cones?.sync(alpha);
    this.debris.sync(alpha);
    this.buildings.sync(alpha);
    this.pickups?.sync(frameSeconds);
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
    const { hauler, route } = this;
    if (this.phase === 'ready' && this.backdrop !== undefined && route) {
      // The backdrop drifts slowly along the middle of the Hauler's line.
      const progress = 0.46 + 0.1 * Math.sin(this.backdrop * 0.12);
      const [x, z] = routePoint(route, progress * route.length);
      focus.set(x, this.heightAt(x, z), z);
    } else if (this.phase === 'failed' && hauler) {
      // After the crash the camera looks at the wreck, or at the Hauler in the replay.
      focus.copy(this.replayTime === undefined ? hauler.center : hauler.object.position);
    } else if (this.phase === 'playing' && hauler && this.secondsToImpact < CRITICAL_SECONDS) {
      // Just before an impact the camera leans towards the Hauler to keep both in frame.
      const lean = hauler.front.sub(focus);
      lean.setLength(Math.min(lean.length() * 0.35, 30));
      focus.add(lean);
    }
    const following = this.phase === 'playing' || this.phase === 'bonus';
    this.cameraRig.mode = this.options.chaseCamera ? 'chase' : 'fixed';
    this.cameraRig.update(
      frameSeconds,
      focus,
      following ? active.impactVelocity : ZERO,
      following ? Math.abs(active.forwardSpeed) / active.spec.topSpeed : 0,
      this.options.cameraShake,
      // The model already holds the heading between the two latest steps. In a slide, the
      // view turns part of the way towards the direction of travel.
      -active.object.rotation.y - active.slip * active.slide * SLIDE_CAMERA_SHARE,
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

    const vehicle = this.activeVehicle;
    const distance = Math.hypot(vehicle.position.x - position.x, vehicle.position.z - position.z);
    if (distance < radius) {
      const force = 1 - distance / radius;
      const away = new THREE.Vector3(
        vehicle.position.x - position.x,
        0,
        vehicle.position.z - position.z,
      )
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

    if (this.hauler && source !== 'hauler') {
      const haulerDistance = distanceToBox([position.x, position.z], this.hauler.footprint);
      if (haulerDistance < radius * HAULER_BLAST_FRACTION) {
        this.failLevel('an explosion', 'explosion');
      }
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
    if (input.pressed.has('camera')) {
      this.events.emit('cameraToggled', {});
    }
  }

  /** Turns the input into the pedals and the steering wheel of the vehicle. */
  private driveCommand(input: InputState): DriveCommand {
    return {
      throttle: input.throttle,
      steer: shapeSteering(input.steer),
      brake: input.brake,
    };
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
    const vehicle = this.activeVehicle;
    const ground = vehicle.position.y - vehicle.spec.rideHeight;
    if (vehicle.landingSpeed > 6) {
      // A hard landing throws up a ring of dust.
      this.effects.dust(position.set(vehicle.position.x, ground, vehicle.position.z), 3.5, 8);
      this.cameraRig.addShake(clamp(vehicle.landingSpeed / 30, 0.2, 0.8));
      this.events.emit('landed', { speed: vehicle.landingSpeed });
      vehicle.landingSpeed = 0;
    }
    const speed = Math.hypot(vehicle.impactVelocity.x, vehicle.impactVelocity.z);
    if (puff && vehicle.grounded && speed > Math.max(5, vehicle.spec.topSpeed * 0.55)) {
      const back = vehicle.spec.length * 0.45;
      position.set(
        vehicle.position.x - Math.cos(vehicle.heading) * back + (Math.random() - 0.5) * 2,
        ground + 0.3,
        vehicle.position.z - Math.sin(vehicle.heading) * back + (Math.random() - 0.5) * 2,
      );
      this.effects.puff({
        position,
        velocity: velocity.set(0, 1.2 + Math.random(), 0),
        color: EFFECT_COLORS.dust,
        size: 0.4,
        life: 0.4,
      });
    }
    if (puff && vehicle.grounded && vehicle.slide > 0.3 && speed > 4) {
      // A slide throws up dust behind both rear wheels.
      const back = vehicle.spec.length * 0.4;
      const side = vehicle.spec.width * 0.45;
      const fx = Math.cos(vehicle.heading);
      const fz = Math.sin(vehicle.heading);
      for (const sign of [-1, 1]) {
        position.set(
          vehicle.position.x - fx * back - fz * side * sign,
          ground + 0.3,
          vehicle.position.z - fz * back + fx * side * sign,
        );
        this.effects.puff({
          position,
          velocity: velocity.set(
            -vehicle.impactVelocity.x * 0.15 + (Math.random() - 0.5) * 2,
            1 + Math.random() * 1.5,
            -vehicle.impactVelocity.z * 0.15 + (Math.random() - 0.5) * 2,
          ),
          color: Math.random() > 0.5 ? EFFECT_COLORS.dust : EFFECT_COLORS.dustDark,
          size: 0.3 + vehicle.slide * 0.2,
          life: 0.5 + Math.random() * 0.3,
        });
      }
    }
    if (puff && this.hauler && this.route && !this.hauler.destroyed && this.isScoring) {
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
    if (!this.hauler) {
      return;
    }
    const { position, pitch } = this.hauler.pose;
    this.recording.push({
      hauler: position.clone(),
      pitch,
      vehicle: {
        position: this.activeVehicle.position.clone(),
        heading: this.activeVehicle.heading,
      },
    });
    const limit = Math.round(REPLAY_SECONDS * 60);
    if (this.recording.length > limit) {
      this.recording.shift();
    }
  }

  /** Shows the recorded poses one after the other, then lets the Hauler blow up again. */
  private stepReplay(dt: number): void {
    if (this.replayTime === undefined || !this.hauler) {
      return;
    }
    this.replayTime += dt;
    const index = Math.floor(this.replayTime * 60);
    const frame = this.recording[Math.min(index, this.recording.length - 1)];
    this.hauler.showAt(frame.hauler, frame.pitch);
    this.activeVehicle.showAt(frame.vehicle.position, frame.vehicle.heading);
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

  /** Marks obstacles whose pieces have all fallen, and declares the path clear. */
  private updateObstacles(): void {
    this.blocking.clear();
    this.nextBuildings.clear();
    for (const obstacle of this.obstacles) {
      if (obstacle.cleared) {
        continue;
      }
      const standing = obstacle.pieces.filter((piece) => piece.building.standing(piece.index));
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
      for (const piece of standing) {
        this.blocking.add(piece.building);
      }
    }
    const next = this.nextObstacle;
    if (next) {
      for (const piece of next.obstacle.pieces) {
        if (piece.building.standing(piece.index)) {
          this.nextBuildings.add(piece.building);
        }
      }
    }
    // Only a run with a Hauler has a path to clear.
    if (this.hauler && this.phase === 'playing' && this.obstaclesLeft === 0) {
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
    const { hauler, route } = this;
    if (!hauler || !route) {
      return;
    }
    if (!this.invincibleHauler) {
      const collider = hauler.findCollision();
      if (collider) {
        const { hit, cause } = this.describe(collider);
        this.failLevel(hit, cause);
        return;
      }
    }
    if (hauler.distance >= route.length) {
      this.endLevel();
    }
  }

  /** Names what a collider belongs to, for the fail screen. */
  private describe(collider: { handle: number }): { hit: string; cause: FailCause } {
    const piece = this.buildings.lookup(collider.handle);
    if (piece) {
      return { hit: `the ${piece.building.name}`, cause: piece.building.kind };
    }
    if (collider.handle === this.activeVehicle.collider.handle) {
      return { hit: `your ${this.activeVehicle.spec.name.toLowerCase()}`, cause: 'vehicle' };
    }
    if (this.tnt.owns(collider.handle)) {
      return { hit: 'a TNT crate', cause: 'tnt' };
    }
    return { hit: 'a tree', cause: 'tree' };
  }

  private failLevel(hit: string, cause: FailCause): void {
    const { hauler } = this;
    if (!hauler || !this.isScoring || this.invincibleHauler) {
      return;
    }
    const wreck = hauler.center.clone();
    const front = hauler.front;
    hauler.destroy();
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
    this.result = scoreLevel(this.tally(), this.level.medals ?? DEFAULT_MEDAL_RULES);
    this.setPhase('ended');
    this.events.emit('levelEnded', { result: this.result });
  }

  /** Shows a tutorial hint of the level once. */
  private showHint(trigger: string): void {
    if (this.shownHints.has(trigger)) {
      return;
    }
    const hint = this.level.hints?.find((candidate) => candidate.trigger === trigger);
    if (hint) {
      this.shownHints.add(trigger);
      this.events.emit('hint', { text: hint.text });
    }
  }

  /** Shows the hints that depend on where the player is. */
  private updateHints(): void {
    const { x, z } = this.activeVehicle.position;
    for (const hint of this.level.hints ?? []) {
      if (!hint.trigger.startsWith('near:') || this.shownHints.has(hint.trigger)) {
        continue;
      }
      const target = hint.trigger.slice('near:'.length);
      let position: Vec2 | undefined;
      if (target === 'tnt') {
        const crate = this.tnt.crates.find((candidate) => candidate.state === 'idle');
        position = crate ? [crate.position.x, crate.position.z] : undefined;
      } else {
        position = this.buildings.get(target)?.center;
      }
      if (position && Math.hypot(position[0] - x, position[1] - z) < HINT_RANGE) {
        this.showHint(hint.trigger);
      }
    }
  }

  /**
   * Breaks the walls that the vehicle reaches during the next physics step and that its ram
   * breaks. They are gone before the physics step, so they never slow the vehicle down.
   */
  private breakAhead(vehicle: Vehicle): void {
    const velocity = vehicle.impactVelocity;
    if (Math.hypot(velocity.x, velocity.z) < MIN_IMPACT_SPEED) {
      return;
    }
    const world = this.physics.world;
    const filter = collisionGroups(Layer.vehicle, Layer.building);
    let fallen = 0;
    let strongest = 0;
    let material: Building['kind'] = 'house';
    // Walls that the vehicle only grazes, so that the look-ahead finds the wall in front.
    const grazed = new Set<number>();
    for (let i = 0; i < MAX_BREAKS_AHEAD; i += 1) {
      const hit = world.castShape(
        vehicle.body.translation(),
        vehicle.body.rotation(),
        velocity,
        vehicle.collider.shape,
        0.05,
        STEP_SECONDS * BREAK_AHEAD_STEPS,
        true,
        undefined,
        filter,
        vehicle.collider,
        vehicle.body,
        (collider) =>
          !grazed.has(collider.handle) && this.buildings.lookup(collider.handle) !== undefined,
      );
      const ref = hit ? this.buildings.lookup(hit.collider.handle) : undefined;
      if (!hit || !ref) {
        break;
      }
      const normal = hit.normal1;
      const approach = -(velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z);
      if (approach < MIN_IMPACT_SPEED) {
        grazed.add(hit.collider.handle);
        continue;
      }
      const damage = ramDamage(vehicle.spec.ram, approach, vehicle.spec.topSpeed);
      if (!this.buildings.wouldBreak(ref, damage)) {
        break;
      }
      material = ref.building.kind;
      strongest = Math.max(strongest, approach);
      fallen += this.buildings.damage(ref, damage, velocity, 0, true);
    }
    if (fallen > 0) {
      this.announceRam(vehicle, strongest, material, true);
    }
  }

  /**
   * Finds out whether a wall stopped a vehicle during the physics step, and deals the damage. A
   * crash shows as a sudden loss of speed while the vehicle touches a building. Walls that the ram
   * breaks are mostly gone before the step, so this handles the walls that hold.
   */
  private resolveImpact(vehicle: Vehicle): void {
    if (vehicle.impactCooldown > 0) {
      return;
    }
    const before = vehicle.impactVelocity;
    const after = vehicle.body.linvel();
    const lost = Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z);
    if (lost < MIN_IMPACT_SPEED) {
      return;
    }
    const world = this.physics.world;
    const hits: PieceRef[] = [];
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
        const speed = Math.abs(before.x * normal.x + before.y * normal.y + before.z * normal.z);
        approach = Math.max(approach, speed);
        // A concave section has several colliders, so a ram where two of them meet counts once.
        const counted = hits.some(
          (hit) =>
            hit.building === ref.building && hit.index === ref.index && hit.level === ref.level,
        );
        if (!counted) {
          hits.push(ref);
        }
      });
    });
    if (hits.length === 0) {
      return;
    }
    const speed = Math.max(Math.min(lost, approach * 1.2), approach);
    if (speed < MIN_IMPACT_SPEED) {
      return;
    }
    vehicle.impactCooldown = 0.18;

    const damage = ramDamage(vehicle.spec.ram, speed, vehicle.spec.topSpeed);
    let fallen = 0;
    for (const ref of hits) {
      fallen += this.buildings.damage(ref, damage, before, 0, true);
    }

    if (fallen > 0) {
      // The wall broke after all: the vehicle drives on as if it had never touched it.
      vehicle.setVelocity(before.x, after.y, before.z);
    } else {
      vehicle.setVelocity(-before.x * RECOIL_SPEED, after.y, -before.z * RECOIL_SPEED);
      this.hitStop = HIT_STOP_BLOCK;
    }
    this.announceRam(vehicle, speed, hits[0].building.kind, fallen > 0);
  }

  /** Shakes the camera, throws dust and announces the impact of a ram. */
  private announceRam(
    vehicle: Vehicle,
    speed: number,
    material: Building['kind'],
    broke: boolean,
  ): void {
    const strength = clamp(speed / 20, 0.25, 1);
    const position = vehicle.position.clone();
    position.x += Math.cos(vehicle.heading) * vehicle.spec.length * 0.5;
    position.z += Math.sin(vehicle.heading) * vehicle.spec.length * 0.5;
    if (!broke) {
      this.effects.dust(position, 2.5, 5);
      if (material === 'tower' || material === 'block') {
        this.effects.sparks(position, 10);
      }
    }
    this.cameraRig.addShake(strength * (broke ? 1 : 0.6));
    this.events.emit('impact', { position, strength, material, broke });
  }

  /** Scores a break while the run counts, and announces the points where the break happened. */
  private scoreBreak(position: THREE.Vector3, volume: number, chain: number, tower: boolean): void {
    if (!this.isScoring) {
      return;
    }
    const award = this.score.award(volume, chain);
    this.events.emit('scored', {
      position: position.clone(),
      points: award.points,
      multiplier: award.multiplier,
      chain,
      tower,
    });
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
