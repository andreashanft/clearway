import { Scene, Vector3 } from 'three';
import { type ControlFrame, IDLE_FRAME } from '../engine/input/controls';
import type { InputManager } from '../engine/input/input-manager';
import type { Physics } from '../engine/physics';
import type { Viewport } from '../engine/renderer';
import { FollowCamera } from './camera';
import { DestructionSystem } from './destruction-system';
import { bearingToHeading } from './drive';
import type { GameBus, GameEvents } from './events';
import { Effects } from './fx/effects';
import { Hauler } from './hauler/hauler';
import { sweepRoute } from './hauler/route-sweep';
import type { LevelDefinition } from './level-data';
import { type LoadedWorld, loadWorld } from './level-loader';
import { Pilot } from './pilot';
import { Route } from './route';
import { type Difficulty, labelFor, LevelSession, urgencyFor } from './session';
import { createVehicle } from './vehicles/factory';
import { Fishtail } from './vehicles/fishtail';
import { DECK_HEIGHT, Railbed } from './vehicles/railbed';
import type { Machine as Vehicle } from './vehicles/vehicle';
import { footprintOf } from './world/footprint';
import { Pickups } from './world/pickups';
import { mapBounds } from './map-bounds';
import {
  BEACON_POINTS,
  buildingPoints,
  DISH_POINTS,
  PATH_CLEAR_POINTS,
  propPoints,
} from './points';
import { Rails } from './world/rails';
import { RouteLine } from './world/route-line';

/** The pilot can climb into a vehicle this far beyond its body. */
const ENTER_DISTANCE = 3;
/** How far below the ground a vehicle may sink before it is put back on top. */
const FALL_RESCUE_DEPTH = 4;
/** Steering assist only acts within this distance of the route. */
const ASSIST_RADIUS = 14;
/** The Hauler's blast when it is destroyed: big, but not nuclear. */
const HAULER_BLAST_RADIUS = 16;
const HAULER_BLAST_DAMAGE = 1200;
/** Slow motion after the Hauler is destroyed: speed and real seconds. */
const FAIL_SLOWMO_SCALE = 0.25;
const FAIL_SLOWMO_SECONDS = 2.2;
/** Hit-stop: hits at least this strong (0–1) freeze the action for a moment. */
const HIT_STOP_THRESHOLD = 0.3;
const HIT_STOP_BASE = 0.03;
const HIT_STOP_EXTRA = 0.07;
/** Simulation speed during hit-stop: nearly frozen, so it reads as a beat, not a stall. */
const HIT_STOP_SCALE = 0.05;
/** Shake multiplier with the reduced-shake setting. */
const REDUCED_SHAKE = 0.35;
/** How often the HUD hears about the Hauler, per second. */
const STATUS_RATE = 10;

export interface GameOptions {
  readonly difficulty: Difficulty;
  readonly steeringAssist: boolean;
  readonly autoSkid: boolean;
}

const DEFAULT_OPTIONS: GameOptions = {
  difficulty: 'normal',
  steeringAssist: true,
  autoSkid: true,
};

/** What the game is doing: a title-screen backdrop, a briefing fly-over, or play. */
export type GameMode = 'attract' | 'briefing' | 'play';

/** Seconds the briefing camera takes to fly the whole route. */
const FLYOVER_SECONDS = 9;
/** Title backdrop: the Hauler loops this far before the first obstacle, a bit faster. */
const ATTRACT_MARGIN = 18;
const ATTRACT_SPEEDUP = 1.6;
const ATTRACT_ORBIT = 0.05;

/** Strips one-frame events so they only reach the first fixed step of a frame. */
function withoutEdges(frame: ControlFrame): ControlFrame {
  return {
    ...frame,
    actionPressed: false,
    enterExitPressed: false,
    cameraTurn: 0,
    zoomStep: 0,
    pausePressed: false,
  };
}

/**
 * Runs one attempt at a level: the world, the vehicles, the Hauler, the rules and the
 * camera. It reads input once per frame and advances everything in fixed steps.
 */
export class Game {
  readonly scene = new Scene();
  readonly camera = new FollowCamera();
  private world: LoadedWorld | null = null;
  private effects: Effects | null = null;
  private destruction: DestructionSystem | null = null;
  private hauler: Hauler | null = null;
  private routeLine: RouteLine | null = null;
  private session: LevelSession | null = null;
  private route: Route | null = null;
  private readonly vehicles: Vehicle[] = [];
  private active: Vehicle | null = null;
  private frame: ControlFrame = IDLE_FRAME;
  private firstStepOfFrame = true;
  private readonly velocity = new Vector3();
  private lastActionKey = '';
  private statusClock = 0;
  private slowmoLeft = 0;
  private failAnnounced = false;
  private pilot: Pilot | null = null;
  private lastVehicle: Vehicle | null = null;
  private lastContextKey = '';
  private railbed: Railbed | null = null;
  private rails: Rails | null = null;
  private readonly lockedBy = new Map<Vehicle, string>();
  private pickups: Pickups | null = null;
  private hitStopLeft = 0;
  private readonly scoreAt = new Vector3();
  private readonly subscriptions: (() => void)[] = [];
  private def: LevelDefinition | null = null;
  private modeValue: GameMode = 'play';
  private flyover = 0;
  private lastHintFor = '';
  private failInfo = { hit: '', time: 0, cleared: 0 };
  private readonly flyTarget = new Vector3();
  private readonly zero = new Vector3();
  private readonly projected = new Vector3();
  private viewport: Viewport = { width: 1, height: 1 };

  constructor(
    private readonly physics: Physics,
    private readonly input: InputManager,
    private readonly bus: GameBus,
    private readonly options: GameOptions = DEFAULT_OPTIONS,
  ) {}

  get activeVehicle(): Vehicle | null {
    return this.active;
  }

  /** Destruction state, for the debug overlay and tests. */
  get destructionSystem(): DestructionSystem | null {
    return this.destruction;
  }

  get levelSession(): LevelSession | null {
    return this.session;
  }

  get mode(): GameMode {
    return this.modeValue;
  }

  /** Progress of the briefing fly-over, 0–1. */
  get flyoverProgress(): number {
    return this.flyover;
  }

  get definition(): LevelDefinition | null {
    return this.def;
  }

  /**
   * Switches between the title backdrop, the briefing fly-over and play. Play starts the
   * level's rules (start delay, then the Hauler).
   */
  setMode(mode: GameMode): void {
    this.modeValue = mode;
    const hauler = this.hauler;
    if (!hauler) return;
    if (mode === 'attract') {
      hauler.resetTo(0);
      hauler.setSpeedFactor(ATTRACT_SPEEDUP);
      hauler.start();
      this.camera.snapTo(hauler.worldPosition);
    } else if (mode === 'briefing') {
      this.flyover = 0;
      hauler.resetTo(0);
      hauler.setSpeedFactor(1);
      hauler.state = 'waiting';
      while (this.camera.zoomLevel < 2) this.camera.zoom(1);
      const start = this.route?.sampleAt(0);
      if (start)
        this.camera.snapTo(this.flyTarget.set(start.x, this.groundAt(start.x, start.z), start.z));
    } else {
      hauler.resetTo(0);
      hauler.setSpeedFactor(1);
      hauler.state = 'waiting';
      while (this.camera.zoomLevel > 1) this.camera.zoom(-1);
      if (this.active) this.camera.snapTo(this.active.position);
      this.lastHintFor = '';
      this.hint(this.def?.hints?.start);
    }
  }

  /** Jumps the briefing fly-over to its end. */
  skipFlyover(): void {
    this.flyover = 1;
  }

  /** Turns steering assist on or off for every vehicle. */
  setSteeringAssist(on: boolean): void {
    const route = this.route;
    for (const vehicle of this.vehicles) {
      vehicle.routeAssist = on && route ? (x, z) => route.headingNear(x, z, ASSIST_RADIUS) : null;
    }
  }

  /** Shadow map resolution, or 0 to turn sun shadows off. */
  setShadowQuality(size: number): void {
    this.world?.lighting.setShadowMapSize(size);
  }

  /** Multiplier on simulation speed: hit-stop after a big hit, slow motion after a failure. */
  get timeScale(): number {
    if (this.hitStopLeft > 0) return HIT_STOP_SCALE;
    return this.slowmoLeft > 0 ? FAIL_SLOWMO_SCALE : 1;
  }

  /** Full camera shake, or the reduced amount for players who prefer less motion. */
  setFullShake(full: boolean): void {
    this.camera.shakeScale = full ? 1 : REDUCED_SHAKE;
  }

  /** A hard hit or a blast: freeze the action for a beat and shake the camera. */
  private onImpact(strength: number): void {
    if (this.modeValue !== 'play') return;
    this.camera.shake(strength * 0.7);
    if (strength >= HIT_STOP_THRESHOLD) {
      this.hitStopLeft = Math.max(this.hitStopLeft, HIT_STOP_BASE + HIT_STOP_EXTRA * strength);
    }
  }

  async load(def: LevelDefinition): Promise<void> {
    this.def = def;
    this.world = await loadWorld(def, this.scene, this.physics);
    const { field } = this.world;
    this.effects = new Effects(field);
    this.scene.add(this.effects.group);
    const destruction = new DestructionSystem(
      def,
      this.scene,
      this.physics,
      field,
      this.world.props,
      this.effects,
      this.bus,
    );
    this.destruction = destruction;
    const pickups = new Pickups(def.beacons?.trails ?? [], def.relayDish ?? null, field);
    this.pickups = pickups;
    this.scene.add(pickups.group);

    const route = new Route(def.hauler.route);
    this.route = route;
    const obstacles = sweepRoute(
      route,
      (def.buildings ?? []).map((b) => ({
        id: b.id,
        group: b.group ?? b.id,
        footprint: footprintOf(b),
      })),
    );
    // A route gap is an obstacle too: it is cleared by parking the Railbed in its slot.
    const gap = def.routeGap;
    if (gap) {
      obstacles.push({ id: gap.id, memberIds: [], distance: gap.from });
      obstacles.sort((a, b) => a.distance - b.distance);
    }
    this.routeLine = new RouteLine(route, field);
    obstacles.forEach((obstacle, i) => {
      const members = (def.buildings ?? []).filter((b) => obstacle.memberIds.includes(b.id));
      if (members.length === 0 && obstacle.id === gap?.id) {
        const mid = route.sampleAt((gap.from + gap.to) / 2);
        const footprint = {
          x: mid.x,
          z: mid.z,
          halfX: 3,
          halfZ: (gap.to - gap.from) / 2,
          yaw: Math.atan2(mid.dx, mid.dz),
        };
        this.routeLine?.addObstacle(obstacle.id, i + 1, [footprint], 1);
        return;
      }
      const height = Math.max(...members.map((b) => b.size[1]));
      this.routeLine?.addObstacle(obstacle.id, i + 1, members.map(footprintOf), height);
    });
    this.scene.add(this.routeLine.group);

    const hauler = new Hauler(this.physics, route, field, def.hauler.speed);
    this.hauler = hauler;
    this.scene.add(hauler.root);

    if (def.rail) {
      const rail = new Route(def.rail.points);
      const railbed = new Railbed(this.physics, rail, field, def.rail.railbed, def.rail.slot);
      this.railbed = railbed;
      this.rails = new Rails(rail, field, def.rail.slot);
      this.scene.add(this.rails.group, railbed.root);
      this.vehicles.push(railbed);
      destruction.addVehicle(railbed);
      if (gap) {
        const slotPoint = rail.sampleAt(def.rail.slot);
        hauler.gaps.push({
          from: gap.from,
          to: gap.to,
          deckHeight: field.heightAt(slotPoint.x, slotPoint.z) + DECK_HEIGHT,
          bridged: () => railbed.snapped,
        });
      }
    }
    const session = new LevelSession(
      obstacles,
      hauler,
      destruction.buildings,
      this.bus,
      def.hauler.startDelay,
      this.options.difficulty,
    );
    this.session = session;
    session.pickups = pickups;
    this.world.props.onKnocked = (prop) => {
      this.addPoints(propPoints(prop.type), '', 'prop', prop.position);
    };
    destruction.watchHauler(hauler, () => {
      if (this.modeValue !== 'play') return;
      const next = session.next;
      // Snapshot before the blast, which may flatten the obstacle it hit.
      this.failInfo = {
        hit: next?.label ?? 'something',
        time: session.elapsed,
        cleared: session.obstacles.filter((o) => o.cleared).length,
      };
      if (session.haulerContact()) this.destroyHauler();
    });
    this.subscriptions.push(
      this.bus.on('impact', ({ strength }) => {
        this.onImpact(strength);
      }),
      this.bus.on('building:destroyed', ({ id }) => {
        session.buildingDestroyed(id);
        pickups.onBuildingDestroyed(id);
        const building = destruction.buildings.list.find((b) => b.def.id === id);
        if (building) {
          const onPath = session.obstacles.some((o) => o.memberIds.includes(id));
          this.scoreAt.copy(building.origin).setY(building.origin.y + building.def.size[1] * 0.6);
          this.addPoints(
            buildingPoints(building.def.style, building.def.strength),
            onPath ? '' : 'BONUS',
            onPath ? 'path' : 'bonus',
            this.scoreAt,
          );
        }
        for (const vehicle of this.vehicles) {
          if (vehicle.locked && this.lockedBy.get(vehicle) === id) {
            vehicle.locked = false;
            this.hint(`The ${vehicle.spec.name} is free. Climb in.`);
          }
        }
      }),
      this.bus.on('path:cleared', () => {
        this.addPoints(PATH_CLEAR_POINTS, 'PATH CLEAR', 'clear', null);
      }),
      this.bus.on('obstacle:cleared', ({ id }) => {
        this.routeLine?.clear(id);
      }),
    );

    for (const spawn of def.vehicles) {
      const vehicle = createVehicle(spawn.type, this.physics);
      const [x, z] = spawn.pos;
      vehicle.place(x, field.heightAt(x, z), z, bearingToHeading(spawn.yaw));
      if (spawn.lockedBy) {
        vehicle.locked = true;
        this.lockedBy.set(vehicle, spawn.lockedBy);
      }
      if (vehicle instanceof Fishtail) vehicle.autoSkid = this.options.autoSkid;
      if (this.options.steeringAssist) {
        vehicle.routeAssist = (px, pz) => route.headingNear(px, pz, ASSIST_RADIUS);
      }
      this.scene.add(vehicle.root);
      this.vehicles.push(vehicle);
      destruction.addVehicle(vehicle);
    }
    const pilot = new Pilot(this.physics);
    this.pilot = pilot;
    this.scene.add(pilot.root);
    destruction.addPilot(pilot.collider);

    const start = this.vehicles.find((v) => v.spec.type === def.player.vehicle);
    this.setActive(start ?? this.vehicles[0] ?? null);
    if (this.active) this.camera.snapTo(this.active.position);

    this.bus.emit('map:setup', {
      bounds: mapBounds([
        ...route.points(10).map((p): [number, number] => [p.x, p.z]),
        ...(def.buildings ?? []).map((b) => b.pos),
        ...def.vehicles.map((v) => v.pos),
      ]),
      route: route.points(6).map((p) => [p.x, p.z]),
      background: this.world.terrain.colourImage,
      extent: field.extent,
    });
    this.bus.emit('session:obstacles', {
      obstacles: session.obstacles.map((o) => ({ id: o.id, label: o.label, distance: o.distance })),
      routeLength: route.length,
    });
    this.bus.emit('session:phase', { phase: session.phase });
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    this.camera.setViewport(viewport.width, viewport.height);
  }

  /** Ends free roam and shows the results. */
  finish(): void {
    this.session?.finish();
  }

  /** Called when the player asks to pause (Esc, P or the gamepad's Start). */
  onPauseRequested: (() => void) | null = null;

  /** Puts the camera back behind the player with north up. */
  recentre(): void {
    this.camera.resetYaw();
    if (this.active) this.camera.snapTo(this.active.position);
  }

  /** Chevrons on the route (pattern plus colour) or a plain dashed line. */
  setPatternMarkings(on: boolean): void {
    this.routeLine?.setPattern(on);
  }

  /** Reads input once at the start of each rendered frame. */
  beginFrame(): void {
    this.frame = this.input.poll();
    this.firstStepOfFrame = true;
    if (this.frame.pausePressed && this.modeValue === 'play') this.onPauseRequested?.();
    if (this.frame.cameraTurn !== 0) this.camera.turn(this.frame.cameraTurn);
    if (this.frame.zoomStep !== 0) this.camera.zoom(this.frame.zoomStep);
  }

  step(dt: number): void {
    const frame = this.firstStepOfFrame ? this.frame : withoutEdges(this.frame);
    this.firstStepOfFrame = false;
    const playing = this.modeValue === 'play';
    const playable = playing && this.session?.phase !== 'results';
    if (playable && frame.enterExitPressed) this.toggleVehicle();
    for (const vehicle of this.vehicles) {
      if (vehicle === this.active && playable) vehicle.control(frame, this.camera.yaw, dt);
      else vehicle.idle(dt);
      vehicle.step(dt);
    }
    const pilot = this.pilot;
    if (pilot?.active) {
      if (playable) pilot.control(frame, this.camera.yaw, dt);
      else pilot.idle(dt);
    }
    if (playing) this.session?.step(dt);
    if (playable) this.collectPickups();
    this.hauler?.step(dt);
    this.loopAttract();
    this.checkGaps();
    this.destruction?.step(dt, this.vehicles);
    this.rescueFallenVehicles();
  }

  afterStep(): void {
    this.destruction?.afterStep();
    this.hauler?.afterStep();
    for (const vehicle of this.vehicles) vehicle.afterStep();
    this.pilot?.afterStep();
  }

  render(alpha: number, frameSeconds: number): void {
    // Hit-stop counts down in real time, whatever the simulation speed.
    this.hitStopLeft = Math.max(0, this.hitStopLeft - frameSeconds);
    for (const vehicle of this.vehicles) vehicle.render(alpha, frameSeconds);
    this.pilot?.render(alpha, frameSeconds);
    this.hauler?.render(alpha, frameSeconds);
    this.destruction?.render(alpha, frameSeconds, this.camera.camera);
    this.routeLine?.update(frameSeconds, this.hauler?.state === 'rolling' ? this.hauler.speed : 0);
    this.rails?.update(frameSeconds, this.railbed?.snapped ?? false);
    this.pickups?.update(frameSeconds);
    const effects = this.effects;
    if (effects) {
      for (const vehicle of this.vehicles) {
        vehicle.emitTrails?.(frameSeconds, (at) => {
          effects.skidPuff(at);
        });
      }
    }
    this.updateFailure(frameSeconds);

    if (this.modeValue === 'attract' && this.hauler) {
      this.camera.turnBy(ATTRACT_ORBIT * frameSeconds);
      this.camera.update(frameSeconds, this.hauler.worldPosition, this.zero);
    } else if (this.modeValue === 'briefing' && this.route) {
      this.flyover = Math.min(1, this.flyover + frameSeconds / FLYOVER_SECONDS);
      const eased = this.flyover * this.flyover * (3 - 2 * this.flyover);
      const p = this.route.sampleAt(eased * this.route.length);
      this.flyTarget.set(p.x, this.groundAt(p.x, p.z), p.z);
      this.camera.update(frameSeconds, this.flyTarget, this.zero);
    } else {
      const countdown = this.session?.countdown ?? null;
      const watchHauler = this.hauler && this.hauler.state !== 'destroyed' && countdown !== null;
      this.camera.setInterest(
        watchHauler && urgencyFor(countdown) === 'red'
          ? (this.hauler?.worldPosition ?? null)
          : null,
      );
      const followed = this.player;
      if (followed) {
        this.camera.update(frameSeconds, followed.position, this.playerVelocity(this.velocity));
      }
      if (this.active) this.publishActionState(this.active);
      if (this.modeValue === 'play') this.publishContext();
    }
    if (this.world) {
      // Cover the visible ground, including the wider side on landscape screens.
      const aspect = Math.max(1, this.camera.camera.aspect, 1 / this.camera.camera.aspect);
      this.world.lighting.setShadowSize(Math.max(20, this.camera.viewSpan * aspect * 0.62));
      this.world.lighting.follow(this.camera.focus);
    }
    if (this.modeValue === 'play') this.publishStatus(frameSeconds);
  }

  dispose(): void {
    this.pickups?.dispose();
    this.pickups = null;
    this.rails?.dispose();
    this.rails = null;
    this.railbed = null;
    this.pilot?.dispose();
    this.pilot = null;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    for (const vehicle of this.vehicles) vehicle.dispose();
    this.vehicles.length = 0;
    this.hauler?.dispose();
    this.hauler = null;
    this.routeLine?.dispose();
    this.routeLine = null;
    this.destruction?.dispose();
    this.destruction = null;
    if (this.effects) this.scene.remove(this.effects.group);
    this.effects = null;
    this.world?.dispose();
    this.world = null;
    this.session = null;
  }

  private destroyHauler(): void {
    const hauler = this.hauler;
    if (!hauler || hauler.state === 'destroyed') return;
    const at = hauler.worldPosition.clone();
    hauler.destroy();
    this.destruction?.explode(at, HAULER_BLAST_RADIUS, HAULER_BLAST_DAMAGE);
    this.slowmoLeft = FAIL_SLOWMO_SECONDS;
    this.camera.setInterest(at);
  }

  /** Counts down the slow motion in real time, then tells the UI the level failed. */
  private updateFailure(frameSeconds: number): void {
    if (this.slowmoLeft <= 0) return;
    this.slowmoLeft -= frameSeconds;
    if (this.slowmoLeft <= 0 && !this.failAnnounced) {
      this.failAnnounced = true;
      const obstacles = this.session?.obstacles ?? [];
      this.bus.emit('hauler:destroyed', {
        hit: this.failInfo.hit,
        time: this.failInfo.time,
        cleared: this.failInfo.cleared,
        total: obstacles.length,
      });
    }
  }

  private publishStatus(frameSeconds: number): void {
    const { session, hauler, route, destruction } = this;
    if (!session || !hauler || !route || !destruction) return;
    this.statusClock -= frameSeconds;
    if (this.statusClock > 0) return;
    this.statusClock = 1 / STATUS_RATE;
    const countdown = session.countdown;
    const next = session.next;
    if (next && next.id !== this.lastHintFor) {
      this.lastHintFor = next.id;
      this.hint(this.def?.hints?.[next.id]);
    }
    this.publishFrame();
    this.bus.emit('hauler:status', {
      distance: hauler.distance,
      routeLength: route.length,
      countdown,
      next: session.next?.label ?? null,
      urgency: urgencyFor(countdown),
      obstaclesLeft: session.obstacles.filter((o) => !o.cleared).length,
      buildingsLeft: destruction.buildings.list.filter((b) => !b.destroyed).length,
    });
  }

  /** Lights beacons and finds the relay dish near the player. */
  private collectPickups(): void {
    const { pickups } = this;
    const player = this.player;
    if (!pickups || !player) return;
    const found = pickups.collect(player.position);
    if (found.beacons > 0) {
      this.addPoints(BEACON_POINTS * found.beacons, 'BEACON', 'pickup', player.position);
      this.bus.emit('pickup:beacon', {
        found: pickups.beaconsFound,
        total: pickups.beaconsTotal,
      });
    }
    if (found.dish) {
      const p = player.position;
      this.bus.emit('pickup:dish', { x: p.x, y: p.y, z: p.z });
      this.addPoints(DISH_POINTS, 'RELAY DISH', 'pickup', p);
      this.hint('Relay dish found.');
    }
  }

  /**
   * Adds points to the run and tells the HUD where to pop them up: over `at`, or in the
   * middle of the screen when `at` is null.
   */
  private addPoints(
    points: number,
    label: string,
    kind: GameEvents['score']['kind'],
    at: Vector3 | null,
  ): void {
    const session = this.session;
    if (!session?.scoring || this.modeValue !== 'play' || points <= 0) return;
    session.score += points;
    let screenX = this.viewport.width / 2;
    let screenY = this.viewport.height * 0.38;
    let onScreen = true;
    if (at) {
      this.projected.copy(at).project(this.camera.camera);
      screenX = (this.projected.x * 0.5 + 0.5) * this.viewport.width;
      screenY = (-this.projected.y * 0.5 + 0.5) * this.viewport.height;
      onScreen =
        Math.abs(this.projected.x) <= 1 && Math.abs(this.projected.y) <= 1 && this.projected.z < 1;
    }
    this.bus.emit('score', {
      points,
      total: session.score,
      label,
      kind,
      screenX,
      screenY,
      onScreen,
    });
  }

  /** Beacons lit, out of how many, and whether the dish is found, for the pause screen. */
  get pickupProgress(): { found: number; total: number; dish: boolean; dishExists: boolean } {
    const p = this.pickups;
    return {
      found: p?.beaconsFound ?? 0,
      total: p?.beaconsTotal ?? 0,
      dish: p?.dishFound ?? false,
      dishExists: p?.dishExists ?? false,
    };
  }

  /** Clears a bridged gap, or fails the level when the Hauler reaches an open one. */
  private checkGaps(): void {
    const { hauler, session, def } = this;
    const gap = def?.routeGap;
    if (!hauler || !session || !gap || this.modeValue !== 'play') return;
    if (this.railbed?.snapped) {
      session.clearObstacle(gap.id);
      return;
    }
    if (hauler.state === 'rolling' && hauler.distance >= gap.from - 0.3) {
      this.failInfo = {
        hit: labelFor(gap.id),
        time: session.elapsed,
        cleared: session.obstacles.filter((o) => o.cleared).length,
      };
      if (session.haulerContact()) this.destroyHauler();
    }
  }

  private hint(text: string | undefined): void {
    if (text) this.bus.emit('hint', { text });
  }

  private groundAt(x: number, z: number): number {
    return this.world?.field.heightAt(x, z) ?? 0;
  }

  /** Title backdrop: send the Hauler back to the start before it reaches a building. */
  private loopAttract(): void {
    const hauler = this.hauler;
    const first = this.session?.obstacles[0];
    if (this.modeValue !== 'attract' || !hauler || !first) return;
    if (hauler.distance > first.distance - ATTRACT_MARGIN) {
      hauler.resetTo(0);
      this.camera.snapTo(hauler.worldPosition);
    }
  }

  private publishFrame(): void {
    const { hauler, active, session, destruction } = this;
    const player = this.player;
    let haulerInfo: GameEvents['hud:frame']['hauler'] = null;
    if (hauler && hauler.state !== 'destroyed') {
      const p = hauler.worldPosition;
      this.projected.copy(p).project(this.camera.camera);
      const onScreen =
        Math.abs(this.projected.x) <= 0.92 &&
        Math.abs(this.projected.y) <= 0.88 &&
        this.projected.z < 1;
      haulerInfo = {
        x: p.x,
        z: p.z,
        heading: Math.atan2(
          hauler.model.root.matrixWorld.elements[8],
          hauler.model.root.matrixWorld.elements[10],
        ),
        screenX: (this.projected.x * 0.5 + 0.5) * this.viewport.width,
        screenY: (-this.projected.y * 0.5 + 0.5) * this.viewport.height,
        onScreen,
        distance: player ? player.position.distanceTo(p) : 0,
      };
    }
    this.bus.emit('hud:frame', {
      hauler: haulerInfo,
      player: player
        ? {
            x: player.position.x,
            z: player.position.z,
            heading: player.heading,
            speed: active ? active.forwardSpeed : Math.hypot(this.velocity.x, this.velocity.z),
          }
        : null,
      vehicles: this.vehicles
        .filter((v) => v !== active)
        .map((v) => ({ x: v.position.x, z: v.position.z })),
      obstacles: (session?.obstacles ?? []).flatMap((o) =>
        (destruction?.buildings.list ?? [])
          .filter((b) => o.memberIds.includes(b.def.id))
          .map((b) => ({ x: b.origin.x, z: b.origin.z, cleared: o.cleared })),
      ),
      crates: (destruction?.crates ?? [])
        .filter((c) => !c.exploded)
        .map((c) => ({ x: c.position.x, z: c.position.z, lit: c.lit })),
      beacons: this.pickups?.unlitBeacons([]) ?? [],
      cameraYaw: this.camera.yaw,
    });
  }

  /** Puts back on the ground any vehicle (or the pilot) that slipped below the terrain. */
  private rescueFallenVehicles(): void {
    if (!this.world) return;
    const { field } = this.world;
    const pilot = this.pilot;
    if (pilot?.active) {
      const t = pilot.body.translation();
      if (t.y < field.heightAt(t.x, t.z) - FALL_RESCUE_DEPTH) {
        // The brief: falling off the map respawns the player at the last vehicle.
        const back = this.lastVehicle?.position ?? pilot.position;
        pilot.placeAt(back.x + 3, field.heightAt(back.x + 3, back.z), back.z, pilot.heading);
      }
    }
    for (const vehicle of this.vehicles) {
      const t = vehicle.body.translation();
      const ground = field.heightAt(t.x, t.z);
      if (t.y < ground - FALL_RESCUE_DEPTH) {
        vehicle.place(t.x, ground, t.z, vehicle.heading);
      }
    }
  }

  /** Climbs out of the current vehicle, or into the nearest unlocked one on foot. */
  private toggleVehicle(): void {
    const pilot = this.pilot;
    const field = this.world?.field;
    if (!pilot || !field) return;
    const vehicle = this.active;
    if (vehicle) {
      // Step out beside the driver's door (the vehicle's left, local +x).
      const side = vehicle.spec.chassis.halfExtents[0] + 1.3;
      const h = vehicle.heading;
      const x = vehicle.position.x + Math.cos(h) * side;
      const z = vehicle.position.z - Math.sin(h) * side;
      pilot.setActive(true);
      pilot.placeAt(x, field.heightAt(x, z), z, h);
      this.lastVehicle = vehicle;
      this.setActive(null);
      return;
    }
    const target = this.nearestEnterable();
    if (!target) return;
    pilot.setActive(false);
    this.setActive(target);
  }

  /** The closest unlocked vehicle the pilot can reach, if any. */
  private nearestEnterable(): Vehicle | null {
    const pilot = this.pilot;
    if (!pilot?.active) return null;
    let best: Vehicle | null = null;
    let bestDistance = Infinity;
    for (const vehicle of this.vehicles) {
      if (vehicle.locked) continue;
      const [hx, , hz] = vehicle.spec.chassis.halfExtents;
      const reach = Math.max(hx, hz) + ENTER_DISTANCE;
      const d = vehicle.position.distanceTo(pilot.position);
      if (d < reach && d < bestDistance) {
        best = vehicle;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Tells the UI what the Enter/Exit button would do, when it changes. */
  private publishContext(): void {
    let context: GameEvents['context'] = null;
    if (this.active) context = { action: 'exit', label: 'Exit' };
    else {
      const target = this.nearestEnterable();
      if (target) context = { action: 'enter', label: `Enter ${target.spec.name}` };
    }
    const key = context ? `${context.action}:${context.label}` : '';
    if (key === this.lastContextKey) return;
    this.lastContextKey = key;
    this.bus.emit('context', context);
  }

  /** The thing the player controls: a vehicle, or the pilot on foot. */
  private get player(): { position: Vector3; heading: number } | null {
    if (this.active) return this.active;
    return this.pilot?.active ? this.pilot : null;
  }

  private playerVelocity(out: Vector3): Vector3 {
    if (this.active) return this.active.velocity(out);
    return this.pilot?.velocityOut(out) ?? out.set(0, 0, 0);
  }

  private setActive(vehicle: Vehicle | null): void {
    this.active = vehicle;
    this.lastContextKey = '?';
    if (!vehicle) {
      this.bus.emit('vehicle:changed', { type: 'pilot', name: 'Pilot', actionLabel: '' });
      return;
    }
    this.bus.emit('vehicle:changed', {
      type: vehicle.spec.type,
      name: vehicle.spec.name,
      actionLabel: vehicle.actionLabel,
    });
    this.lastActionKey = '';
  }

  private publishActionState(vehicle: Vehicle): void {
    const state = vehicle.actionState;
    const key = `${state.ready}|${state.active}|${state.charge.toFixed(2)}`;
    if (key === this.lastActionKey) return;
    this.lastActionKey = key;
    this.bus.emit('action:state', state);
  }
}
