import * as THREE from 'three/webgpu';
import { DEG, clamp, damp, lerp, wrapAngle, type Vec2 } from './math';

/** Camera distances for the three zoom presets, in metres. The first is the closest. */
const ZOOM_DISTANCES = [48, 66, 96];
const DEFAULT_ZOOM = 1;
/** Angle between the view direction and the ground. */
const PITCH = 55 * DEG;
/** A narrow field of view keeps the picture close to an orthographic diorama. */
const FOV_LANDSCAPE = 30;
/** Portrait screens are narrow, so the camera sees more and stands further back. */
const FOV_PORTRAIT = 42;
const PORTRAIT_DISTANCE_FACTOR = 1.45;
/** One rotation step of the view. */
const YAW_STEP = 45 * DEG;
/** The camera looks this many seconds ahead of the vehicle. */
const LOOK_AHEAD_SECONDS = 0.5;
const LOOK_AHEAD_MAX = 16;
/** At full speed the camera pulls back by this fraction of its distance. */
const SPEED_PULL_BACK = 0.16;

/**
 * Three-quarter follow camera.
 *
 * It follows a target with look-ahead in the direction of travel, zooms between three presets
 * and rotates in 45° steps. On a landscape screen north is up. On a portrait screen the camera
 * turns so that the Hauler drives up the screen.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FOV_LANDSCAPE, 1, 4, 900);

  private zoomIndex = DEFAULT_ZOOM;
  private yawSteps = 0;
  private portrait = false;
  private routeHeading = 0;
  /** Smoothed heading that the camera looks along, in radians. */
  private viewHeading = -Math.PI / 2;
  private distance = ZOOM_DISTANCES[DEFAULT_ZOOM];
  private readonly focus = new THREE.Vector3();
  private readonly lookAhead = new THREE.Vector3();
  private readonly shake = new THREE.Vector3();
  private shakeEnergy = 0;
  private started = false;
  private cinematicDistance: number | undefined;

  /** Sets the heading of the Hauler's line. Portrait screens align the view with it. */
  setRouteHeading(heading: number): void {
    this.routeHeading = heading;
  }

  /** Adapts the projection to the canvas. */
  resize(aspect: number): void {
    this.portrait = aspect < 1;
    this.camera.aspect = aspect;
    this.camera.fov = this.portrait ? FOV_PORTRAIT : FOV_LANDSCAPE;
    this.camera.updateProjectionMatrix();
  }

  /** Zooms one preset in (`-1`) or out (`1`). */
  zoom(direction: -1 | 1): void {
    this.zoomIndex = clamp(this.zoomIndex + direction, 0, ZOOM_DISTANCES.length - 1);
  }

  /** Rotates the view by one 45° step. `1` turns the camera clockwise as seen from above. */
  rotate(direction: -1 | 1): void {
    this.yawSteps += direction;
  }

  /** Resets the rotation and the zoom. */
  recenter(): void {
    this.yawSteps = 0;
    this.zoomIndex = DEFAULT_ZOOM;
  }

  /**
   * Fixes the camera distance, for the fly-over and the title backdrop. `undefined` returns to
   * the zoom presets.
   */
  setCinematic(distance: number | undefined): void {
    this.cinematicDistance = distance;
  }

  /** Jumps to the target on the next update, without easing. Use it after a cut. */
  snap(): void {
    this.started = false;
  }

  /** Adds camera shake. `strength` is about 1 for a heavy impact. */
  addShake(strength: number): void {
    this.shakeEnergy = Math.min(1.6, this.shakeEnergy + strength);
  }

  /** The heading that the view settles on, in radians. Input is mapped relative to it. */
  get targetHeading(): number {
    const base = this.portrait ? this.routeHeading : -Math.PI / 2;
    return base + this.yawSteps * YAW_STEP;
  }

  /**
   * Converts a direction on the screen into a heading in the world.
   *
   * @param x Rightwards part of the direction.
   * @param y Upwards part of the direction.
   */
  screenToHeading(x: number, y: number): number {
    const view = this.targetHeading;
    const forward: Vec2 = [Math.cos(view), Math.sin(view)];
    const right: Vec2 = [-forward[1], forward[0]];
    return Math.atan2(forward[1] * y + right[1] * x, forward[0] * y + right[0] * x);
  }

  /**
   * Moves the camera. Call it once per frame.
   *
   * @param target The position to follow.
   * @param velocity Velocity of the target, for the look-ahead.
   * @param speedFraction Speed of the target from 0 to 1, for the pull-back.
   */
  update(
    frameSeconds: number,
    target: THREE.Vector3,
    velocity: THREE.Vector3,
    speedFraction: number,
    shakeScale: number,
  ): void {
    const ahead = new THREE.Vector3(velocity.x, 0, velocity.z).multiplyScalar(LOOK_AHEAD_SECONDS);
    if (ahead.length() > LOOK_AHEAD_MAX) {
      ahead.setLength(LOOK_AHEAD_MAX);
    }
    const presetDistance =
      (this.cinematicDistance ?? ZOOM_DISTANCES[this.zoomIndex]) *
      (this.portrait ? PORTRAIT_DISTANCE_FACTOR : 1) *
      (1 + SPEED_PULL_BACK * clamp(speedFraction, 0, 1));

    if (!this.started) {
      this.started = true;
      this.focus.copy(target);
      this.lookAhead.copy(ahead);
      this.viewHeading = this.targetHeading;
      this.distance = presetDistance;
    } else {
      this.focus.lerp(target, damp(9, frameSeconds));
      this.lookAhead.lerp(ahead, damp(2.2, frameSeconds));
      this.viewHeading += wrapAngle(this.targetHeading - this.viewHeading) * damp(7, frameSeconds);
      this.distance = lerp(this.distance, presetDistance, damp(4, frameSeconds));
    }

    this.shakeEnergy *= Math.exp(-5 * frameSeconds);
    const amplitude = this.shakeEnergy * this.shakeEnergy * shakeScale * 1.4;
    this.shake.set(
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
    );

    const lookAt = this.focus.clone().add(this.lookAhead).add(this.shake);
    const horizontal = Math.cos(PITCH) * this.distance;
    this.camera.position.set(
      lookAt.x - Math.cos(this.viewHeading) * horizontal,
      lookAt.y + Math.sin(PITCH) * this.distance,
      lookAt.z - Math.sin(this.viewHeading) * horizontal,
    );
    this.camera.lookAt(lookAt);
  }

  /** The point on the ground that the camera looks at. */
  get focusPoint(): THREE.Vector3 {
    return this.focus;
  }
}
