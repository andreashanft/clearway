import { Scene, Vector3 } from 'three';
import { type ControlFrame, IDLE_FRAME } from '../engine/input/controls';
import type { InputManager } from '../engine/input/input-manager';
import type { Physics } from '../engine/physics';
import type { Viewport } from '../engine/renderer';
import { FollowCamera } from './camera';
import { DestructionSystem } from './destruction-system';
import { bearingToHeading } from './drive';
import type { GameBus } from './events';
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

  /** Multiplier on simulation speed, used for the slow motion after a failure. */
  get timeScale(): number {
    return this.slowmoLeft > 0 ? FAIL_SLOWMO_SCALE : 1;
  }

  async load(def: LevelDefinition): Promise<void> {
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

    this.bus.emit('session:obstacles', {
      obstacles: session.obstacles.map((o) => ({ id: o.id, label: o.label, distance: o.distance })),
      routeLength: route.length,
    });
    this.bus.emit('session:phase', { phase: session.phase });
  }

  setViewport({ width, height }: Viewport): void {
    this.camera.setViewport(width, height);
  }

  /** Ends free roam and shows the results. */
  finish(): void {
    this.session?.finish();
  }

  /** Reads input once at the start of each rendered frame. */
  beginFrame(): void {
    this.frame = this.input.poll();
    this.firstStepOfFrame = true;
    if (this.frame.cameraTurn !== 0) this.camera.turn(this.frame.cameraTurn);
    if (this.frame.zoomStep !== 0) this.camera.zoom(this.frame.zoomStep);
  }

  step(dt: number): void {
    const frame = this.firstStepOfFrame ? this.frame : withoutEdges(this.frame);
    this.firstStepOfFrame = false;
    const playable = this.session?.phase !== 'results';
    for (const vehicle of this.vehicles) {
      if (vehicle === this.active && playable) vehicle.control(frame, this.camera.yaw, dt);
      else vehicle.idle(dt);
      vehicle.step(dt);
    }
    this.session?.step(dt);
    this.hauler?.step(dt);
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

    if (this.active) {
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
    this.publishStatus(frameSeconds);
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
      this.bus.emit('hauler:destroyed', {});
    }
  }

  private publishStatus(frameSeconds: number): void {
    const { session, hauler, route, destruction } = this;
    if (!session || !hauler || !route || !destruction) return;
    this.statusClock -= frameSeconds;
    if (this.statusClock > 0) return;
    this.statusClock = 1 / STATUS_RATE;
    const countdown = session.countdown;
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
