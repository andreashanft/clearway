import * as THREE from 'three/webgpu';
import { DEG, clamp, damp, lerp, wrapAngle } from './math';

/**
 * How the camera follows the vehicle.
 *
 * - `chase`: behind the vehicle. The view turns with the vehicle, so left is always left.
 * - `fixed`: a high three-quarter view that keeps its direction, like a diorama.
 */
export type CameraMode = 'chase' | 'fixed';

/** What differs between the two camera modes. */
export interface CameraModeSettings {
  /** Camera distances for the three zoom presets, in metres. The first is the closest. */
  distances: [number, number, number];
  /** Angle between the view direction and the ground, in radians. */
  pitch: number;
  fovLandscape: number;
  /** Portrait screens are narrow, so the camera sees more and stands further back. */
  fovPortrait: number;
  portraitDistanceFactor: number;
  /** The camera looks this many metres ahead of the vehicle, along the view. */
  leadMetres: number;
  /** The camera also looks this many seconds ahead, along the velocity. */
  leadSeconds: number;
  leadMax: number;
  /** At full speed the camera pulls back by this fraction of its distance. */
  speedPullBack: number;
  /** At full speed the field of view widens by this many degrees. */
  speedFov: number;
  /** How quickly the view turns towards its target heading, per second. */
  turnRate: number;
}

/** The debug tuning panel changes these values while the game runs. */
export const CAMERA_MODES: Record<CameraMode, CameraModeSettings> = {
  chase: {
    distances: [17, 23, 32],
    pitch: 26 * DEG,
    fovLandscape: 50,
    fovPortrait: 68,
    portraitDistanceFactor: 1.2,
    leadMetres: 4.5,
    leadSeconds: 0.12,
    leadMax: 6,
    speedPullBack: 0.12,
    speedFov: 9,
    turnRate: 4.5,
  },
  fixed: {
    distances: [46, 66, 96],
    pitch: 55 * DEG,
    // A narrow field of view keeps the picture close to an orthographic diorama.
    fovLandscape: 30,
    fovPortrait: 42,
    portraitDistanceFactor: 1.45,
    leadMetres: 0,
    leadSeconds: 0.5,
    leadMax: 16,
    speedPullBack: 0.16,
    speedFov: 0,
    turnRate: 7,
  },
};

const DEFAULT_ZOOM = 1;
/** One rotation step of the fixed view. */
const YAW_STEP = 45 * DEG;

/**
 * The follow camera.
 *
 * It follows a target with look-ahead, zooms between three presets and has two modes. In the
 * chase mode it stays behind the vehicle. In the fixed mode it rotates in 45° steps: on a
 * landscape screen north is up, and on a portrait screen the Hauler drives up the screen.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(CAMERA_MODES.chase.fovLandscape, 1, 1, 1200);
  mode: CameraMode = 'chase';

  private zoomIndex = DEFAULT_ZOOM;
  private yawSteps = 0;
  private portrait = false;
  private routeHeading = -Math.PI / 2;
  /** Smoothed heading that the camera looks along, in radians. */
  private viewHeading = -Math.PI / 2;
  private distance = CAMERA_MODES.chase.distances[DEFAULT_ZOOM];
  private pitch = CAMERA_MODES.chase.pitch;
  private fov = CAMERA_MODES.chase.fovLandscape;
  private readonly focus = new THREE.Vector3();
  private readonly lead = new THREE.Vector3();
  private readonly shake = new THREE.Vector3();
  private shakeEnergy = 0;
  private started = false;
  private cinematic: { distance: number; heading?: number } | undefined;

  /** Sets the heading of the Hauler's line. Portrait screens align the fixed view with it. */
  setRouteHeading(heading: number): void {
    this.routeHeading = heading;
  }

  /** Adapts the projection to the canvas. */
  resize(aspect: number): void {
    this.portrait = aspect < 1;
    this.camera.aspect = aspect;
    // Take the field of view of the new orientation at once. The next update may not come
    // before the game resumes, for example when a phone turns on the pause screen.
    const settings = CAMERA_MODES[this.cinematic ? 'fixed' : this.mode];
    this.fov = this.portrait ? settings.fovPortrait : settings.fovLandscape;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Zooms one preset in (`-1`) or out (`1`). */
  zoom(direction: -1 | 1): void {
    this.zoomIndex = clamp(this.zoomIndex + direction, 0, 2);
  }

  /** Rotates the fixed view by one 45° step. `1` turns the camera clockwise as seen from above. */
  rotate(direction: -1 | 1): void {
    // The chase view has no rotation, and it must not collect steps for the fixed view.
    if (this.mode === 'fixed') {
      this.yawSteps += direction;
    }
  }

  /** Resets the rotation and the zoom. */
  recenter(): void {
    this.yawSteps = 0;
    this.zoomIndex = DEFAULT_ZOOM;
  }

  /**
   * Takes the camera away from the player, for the fly-over and the title backdrop: it then
   * looks from a set distance in the high view of the fixed mode. `undefined` returns to play.
   *
   * @param heading Heading that the camera looks along. Without it, the fixed view applies.
   */
  setCinematic(distance: number | undefined, heading?: number): void {
    this.cinematic = distance === undefined ? undefined : { distance, heading };
  }

  /** Jumps to the target on the next update, without easing. Use it after a cut. */
  snap(): void {
    this.started = false;
  }

  /** Adds camera shake. `strength` is about 1 for a heavy impact. */
  addShake(strength: number): void {
    this.shakeEnergy = Math.min(1.6, this.shakeEnergy + strength);
  }

  /** The heading that the camera looks along right now, in radians. */
  get heading(): number {
    return this.viewHeading;
  }

  /**
   * Moves the camera. Call it once per frame.
   *
   * @param target The position to follow.
   * @param velocity Velocity of the target, for the look-ahead.
   * @param speedFraction Speed of the target from 0 to 1, for the pull-back.
   * @param targetHeading Heading of the target, which the chase view stays behind.
   */
  update(
    frameSeconds: number,
    target: THREE.Vector3,
    velocity: THREE.Vector3,
    speedFraction: number,
    shakeScale: number,
    targetHeading: number,
  ): void {
    const settings = CAMERA_MODES[this.cinematic ? 'fixed' : this.mode];
    const speed = clamp(speedFraction, 0, 1);

    let wantedHeading: number;
    if (this.cinematic?.heading !== undefined) {
      wantedHeading = this.cinematic.heading;
    } else if (this.cinematic || this.mode === 'fixed') {
      wantedHeading = (this.portrait ? this.routeHeading : -Math.PI / 2) + this.yawSteps * YAW_STEP;
    } else {
      wantedHeading = targetHeading;
    }
    const wantedDistance =
      (this.cinematic?.distance ?? settings.distances[this.zoomIndex]) *
      (this.portrait ? settings.portraitDistanceFactor : 1) *
      (1 + settings.speedPullBack * speed);
    const wantedFov =
      (this.portrait ? settings.fovPortrait : settings.fovLandscape) + settings.speedFov * speed;
    const ahead = new THREE.Vector3(velocity.x, 0, velocity.z).multiplyScalar(settings.leadSeconds);
    // A portrait screen shows a narrow strip of ground, so the look-ahead must stay short there.
    const leadMax = settings.leadMax * (this.portrait ? 0.45 : 1);
    if (ahead.length() > leadMax) {
      ahead.setLength(leadMax);
    }

    if (!this.started) {
      this.started = true;
      this.focus.copy(target);
      this.lead.copy(ahead);
      this.viewHeading = wantedHeading;
      this.distance = wantedDistance;
      this.pitch = settings.pitch;
      this.fov = wantedFov;
    } else {
      this.focus.lerp(target, damp(12, frameSeconds));
      this.lead.lerp(ahead, damp(2.2, frameSeconds));
      this.viewHeading +=
        wrapAngle(wantedHeading - this.viewHeading) * damp(settings.turnRate, frameSeconds);
      this.distance = lerp(this.distance, wantedDistance, damp(4, frameSeconds));
      this.pitch = lerp(this.pitch, settings.pitch, damp(4, frameSeconds));
      this.fov = lerp(this.fov, wantedFov, damp(3, frameSeconds));
    }
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.shakeEnergy *= Math.exp(-5 * frameSeconds);
    // The shake is tuned for the far fixed view. Up close, the same shake would be too strong.
    const amplitude = this.shakeEnergy * this.shakeEnergy * shakeScale * (this.distance / 45);
    this.shake.set(
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
    );

    const forwardX = Math.cos(this.viewHeading);
    const forwardZ = Math.sin(this.viewHeading);
    const lookAt = this.focus.clone().add(this.lead).add(this.shake);
    lookAt.x += forwardX * settings.leadMetres;
    lookAt.z += forwardZ * settings.leadMetres;
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      lookAt.x - forwardX * horizontal,
      lookAt.y + Math.sin(this.pitch) * this.distance,
      lookAt.z - forwardZ * horizontal,
    );
    this.camera.lookAt(lookAt);
  }

  /** The point on the ground that the camera follows. */
  get focusPoint(): THREE.Vector3 {
    return this.focus;
  }
}
