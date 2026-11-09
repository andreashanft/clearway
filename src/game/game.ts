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
import type { LevelDefinition } from './level-data';
import { type LoadedWorld, loadWorld } from './level-loader';
import { createVehicle } from './vehicles/factory';
import type { Vehicle } from './vehicles/vehicle';

/** How far below the ground a vehicle may sink before it is put back on top. */
const FALL_RESCUE_DEPTH = 4;

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
 * Runs one level: the world, the vehicles and the camera. It reads input once per frame
 * and advances everything in fixed steps.
 */
export class Game {
  readonly scene = new Scene();
  readonly camera = new FollowCamera();
  private world: LoadedWorld | null = null;
  private effects: Effects | null = null;
  private destruction: DestructionSystem | null = null;
  private readonly vehicles: Vehicle[] = [];
  private active: Vehicle | null = null;
  private frame: ControlFrame = IDLE_FRAME;
  private firstStepOfFrame = true;
  private readonly velocity = new Vector3();
  private lastActionKey = '';

  constructor(
    private readonly physics: Physics,
    private readonly input: InputManager,
    private readonly bus: GameBus,
  ) {}

  get activeVehicle(): Vehicle | null {
    return this.active;
  }

  /** Destruction state, for the debug overlay and tests. */
  get destructionSystem(): DestructionSystem | null {
    return this.destruction;
  }

  async load(def: LevelDefinition): Promise<void> {
    this.world = await loadWorld(def, this.scene, this.physics);
    const { field } = this.world;
    this.effects = new Effects(field);
    this.scene.add(this.effects.group);
    this.destruction = new DestructionSystem(
      def,
      this.scene,
      this.physics,
      field,
      this.world.props,
      this.effects,
      this.bus,
    );
    for (const spawn of def.vehicles) {
      const vehicle = createVehicle(spawn.type, this.physics);
      const [x, z] = spawn.pos;
      vehicle.place(x, field.heightAt(x, z), z, bearingToHeading(spawn.yaw));
      this.scene.add(vehicle.root);
      this.vehicles.push(vehicle);
      this.destruction.addVehicle(vehicle);
    }
    const start = this.vehicles.find((v) => v.spec.type === def.player.vehicle);
    this.setActive(start ?? this.vehicles[0] ?? null);
    if (this.active) this.camera.snapTo(this.active.position);
  }

  setViewport({ width, height }: Viewport): void {
    this.camera.setViewport(width, height);
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
    for (const vehicle of this.vehicles) {
      if (vehicle === this.active) vehicle.control(frame, this.camera.yaw, dt);
      else vehicle.idle(dt);
      vehicle.step(dt);
    }
    this.destruction?.step(dt, this.vehicles);
    this.rescueFallenVehicles();
  }

  afterStep(): void {
    this.destruction?.afterStep();
    for (const vehicle of this.vehicles) vehicle.afterStep();
  }

  render(alpha: number, frameSeconds: number): void {
    for (const vehicle of this.vehicles) vehicle.render(alpha, frameSeconds);
    this.destruction?.render(alpha, frameSeconds, this.camera.camera);
    if (this.active) {
      this.camera.update(frameSeconds, this.active.position, this.active.velocity(this.velocity));
      this.publishActionState(this.active);
    }
    if (this.world) {
      // Cover the visible ground, including the wider side on landscape screens.
      const aspect = Math.max(1, this.camera.camera.aspect, 1 / this.camera.camera.aspect);
      this.world.lighting.setShadowSize(Math.max(20, this.camera.viewSpan * aspect * 0.62));
      this.world.lighting.follow(this.camera.focus);
    }
  }

  dispose(): void {
    for (const vehicle of this.vehicles) vehicle.dispose();
    this.vehicles.length = 0;
    this.destruction?.dispose();
    this.destruction = null;
    if (this.effects) this.scene.remove(this.effects.group);
    this.effects = null;
    this.world?.dispose();
    this.world = null;
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
