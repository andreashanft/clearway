import { Scene, Vector3 } from 'three';
import { type ControlFrame, IDLE_FRAME } from '../engine/input/controls';
import type { InputManager } from '../engine/input/input-manager';
import type { Physics } from '../engine/physics';
import type { Viewport } from '../engine/renderer';
import { FollowCamera } from './camera';
import { bearingToHeading } from './drive';
import type { GameBus } from './events';
import type { LevelDefinition } from './level-data';
import { type LoadedWorld, loadWorld } from './level-loader';
import { createVehicle } from './vehicles/factory';
import type { Vehicle } from './vehicles/vehicle';

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

  async load(def: LevelDefinition): Promise<void> {
    this.world = await loadWorld(def, this.scene, this.physics);
    const { field } = this.world;
    for (const spawn of def.vehicles) {
      const vehicle = createVehicle(spawn.type, this.physics);
      const [x, z] = spawn.pos;
      vehicle.place(x, field.heightAt(x, z), z, bearingToHeading(spawn.yaw));
      this.scene.add(vehicle.root);
      this.vehicles.push(vehicle);
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
  }

  afterStep(): void {
    for (const vehicle of this.vehicles) vehicle.afterStep();
  }

  render(alpha: number, frameSeconds: number): void {
    for (const vehicle of this.vehicles) vehicle.render(alpha, frameSeconds);
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
    this.world?.dispose();
    this.world = null;
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
