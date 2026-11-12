import * as THREE from 'three/webgpu';
import type { Input, InputState } from '../engine/input/input';
import { PhysicsWorld } from '../engine/physics';
import { CameraRig } from './camera';
import type { LevelData } from './level';
import { heightmapUrl } from './levels';
import { DEG, clamp } from './math';
import { NO_COMMAND, PointToDrive, type DriveCommand } from './vehicles/drive-control';
import { createVehicleModel } from './vehicles/models';
import { VEHICLE_SPECS } from './vehicles/specs';
import { Vehicle, type GroundQuery } from './vehicles/vehicle';
import { createLighting, type LevelLighting } from './world/lighting';
import { createScenery, type Scenery } from './world/scenery';
import { createTerrain, loadHeightmap, type Terrain } from './world/terrain';

/** Classic input below this deflection counts as released. */
const CLASSIC_DEAD_ZONE = 0.08;

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
  readonly vehicles: Vehicle[] = [];
  /** The vehicle that the player drives. */
  activeVehicle: Vehicle;
  /** Simulated time since the level started, in seconds. */
  time = 0;

  private readonly pointToDrive = new PointToDrive();
  private readonly lighting: LevelLighting;
  private readonly terrain: Terrain;
  readonly scenery: Scenery;

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

    const groundAt: GroundQuery = (x, z) => this.terrain.heightfield.heightAt(x, z);
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
    const input = this.input.poll();
    this.handleCameraButtons(input);

    const command = this.driveCommand(input);
    for (const vehicle of this.vehicles) {
      const driven = vehicle === this.activeVehicle;
      vehicle.step(dt, driven ? command : NO_COMMAND, {
        held: driven && input.action,
        pressed: driven && input.pressed.has('action'),
      });
    }

    this.physics.step();

    for (const vehicle of this.vehicles) {
      this.keepInBounds(vehicle);
      vehicle.capture();
    }
    this.time += dt;
  }

  /** Draws the state between the previous and the current step. */
  sync(alpha: number, frameSeconds: number): void {
    for (const vehicle of this.vehicles) {
      vehicle.sync(alpha, frameSeconds);
    }
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
