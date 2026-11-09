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
import { Route } from './route';
import { type Difficulty, LevelSession, urgencyFor } from './session';
import { createVehicle } from './vehicles/factory';
import type { Vehicle } from './vehicles/vehicle';
import { footprintOf } from './world/footprint';
import { RouteLine } from './world/route-line';

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
/** How often the HUD hears about the Hauler, per second. */
const STATUS_RATE = 10;

export interface GameOptions {
  readonly difficulty: Difficulty;
  readonly steeringAssist: boolean;
}

const DEFAULT_OPTIONS: GameOptions = { difficulty: 'normal', steeringAssist: true };

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

  /** Multiplier on simulation speed, used for the slow motion after a failure. */
  get timeScale(): number {
    return this.slowmoLeft > 0 ? FAIL_SLOWMO_SCALE : 1;
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
    this.routeLine = new RouteLine(route, field);
    obstacles.forEach((obstacle, i) => {
      const members = (def.buildings ?? []).filter((b) => obstacle.memberIds.includes(b.id));
      const height = Math.max(...members.map((b) => b.size[1]));
      this.routeLine?.addObstacle(obstacle.id, i + 1, members.map(footprintOf), height);
    });
    this.scene.add(this.routeLine.group);

    const hauler = new Hauler(this.physics, route, field, def.hauler.speed);
    this.hauler = hauler;
    this.scene.add(hauler.root);
    const session = new LevelSession(
      obstacles,
      hauler,
      destruction.buildings,
      this.bus,
      def.hauler.startDelay,
      this.options.difficulty,
    );
    this.session = session;
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
      this.bus.on('building:destroyed', ({ id }) => {
        session.buildingDestroyed(id);
      }),
      this.bus.on('obstacle:cleared', ({ id }) => {
        this.routeLine?.clear(id);
      }),
    );

    for (const spawn of def.vehicles) {
      const vehicle = createVehicle(spawn.type, this.physics);
      const [x, z] = spawn.pos;
      vehicle.place(x, field.heightAt(x, z), z, bearingToHeading(spawn.yaw));
      if (this.options.steeringAssist) {
        vehicle.routeAssist = (px, pz) => route.headingNear(px, pz, ASSIST_RADIUS);
      }
      this.scene.add(vehicle.root);
      this.vehicles.push(vehicle);
      destruction.addVehicle(vehicle);
    }
    const start = this.vehicles.find((v) => v.spec.type === def.player.vehicle);
    this.setActive(start ?? this.vehicles[0] ?? null);
    if (this.active) this.camera.snapTo(this.active.position);

    const xs = route.points(10).map((p) => p.x);
    const zs = route.points(10).map((p) => p.z);
    const margin = 70;
    this.bus.emit('map:setup', {
      bounds: {
        minX: Math.min(...xs) - margin,
        maxX: Math.max(...xs) + margin,
        minZ: Math.min(...zs) - margin,
        maxZ: Math.max(...zs) + margin,
      },
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
    for (const vehicle of this.vehicles) {
      if (vehicle === this.active && playable) vehicle.control(frame, this.camera.yaw, dt);
      else vehicle.idle(dt);
      vehicle.step(dt);
    }
    if (playing) this.session?.step(dt);
    this.hauler?.step(dt);
    this.loopAttract();
    this.destruction?.step(dt, this.vehicles);
    this.rescueFallenVehicles();
  }

  afterStep(): void {
    this.destruction?.afterStep();
    this.hauler?.afterStep();
    for (const vehicle of this.vehicles) vehicle.afterStep();
  }

  render(alpha: number, frameSeconds: number): void {
    for (const vehicle of this.vehicles) vehicle.render(alpha, frameSeconds);
    this.hauler?.render(alpha, frameSeconds);
    this.destruction?.render(alpha, frameSeconds, this.camera.camera);
    this.routeLine?.update(frameSeconds, this.hauler?.state === 'rolling' ? this.hauler.speed : 0);
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
    } else if (this.active) {
      const countdown = this.session?.countdown ?? null;
      const watchHauler = this.hauler && this.hauler.state !== 'destroyed' && countdown !== null;
      this.camera.setInterest(
        watchHauler && urgencyFor(countdown) === 'red'
          ? (this.hauler?.worldPosition ?? null)
          : null,
      );
      this.camera.update(frameSeconds, this.active.position, this.active.velocity(this.velocity));
      this.publishActionState(this.active);
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
        distance: active ? active.position.distanceTo(p) : 0,
      };
    }
    this.bus.emit('hud:frame', {
      hauler: haulerInfo,
      player: active
        ? {
            x: active.position.x,
            z: active.position.z,
            heading: active.heading,
            speed: active.forwardSpeed,
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
      cameraYaw: this.camera.yaw,
    });
  }

  /** Puts back on the ground any vehicle that slipped below the terrain or off the map. */
  private rescueFallenVehicles(): void {
    if (!this.world) return;
    const { field } = this.world;
    for (const vehicle of this.vehicles) {
      const t = vehicle.body.translation();
      const ground = field.heightAt(t.x, t.z);
      if (t.y < ground - FALL_RESCUE_DEPTH) {
        vehicle.place(t.x, ground, t.z, vehicle.heading);
      }
    }
  }

  private setActive(vehicle: Vehicle | null): void {
    this.active = vehicle;
    if (!vehicle) return;
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
