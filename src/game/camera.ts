import { PerspectiveCamera, Vector3 } from 'three';
import { wrapAngle } from './drive';

/**
 * Zoom presets: metres of ground visible across the shorter side of the screen. The
 * camera distance follows from the field of view (see `distanceForSpan`).
 */
export const ZOOM_PRESETS = [20, 30, 48] as const;
export const DEFAULT_ZOOM = 1;
/** How far the camera looks down, in radians. */
export const PITCH = (50 * Math.PI) / 180;
/** Field of view across the shorter screen side, in degrees. */
export const SHORT_SIDE_FOV = 40;
export const YAW_STEP = Math.PI / 4;

/** Camera distance that shows `span` metres across the shorter side of the screen. */
export function distanceForSpan(span: number): number {
  return span / (2 * Math.tan((SHORT_SIDE_FOV * Math.PI) / 360));
}

function presetDistance(index: number): number {
  return distanceForSpan(ZOOM_PRESETS[index] ?? ZOOM_PRESETS[DEFAULT_ZOOM]);
}

/** How far the focus moves towards a point of interest. */
const INTEREST_PULL = 0.42;
/** Seconds of travel the camera looks ahead of a moving vehicle. */
const LOOK_AHEAD_SECONDS = 0.65;
/** The camera pulls back by this fraction at `SPEED_ZOOM_FULL`, so speed reads as speed. */
export const SPEED_ZOOM = 0.3;
/** Ground speed, m/s, at which the pull-back is complete. */
const SPEED_ZOOM_FULL = 30;
/** Ground speed, m/s, below which the camera doesn't pull back at all. */
const SPEED_ZOOM_START = 6;

/** Exponential smoothing factor for a rate (1/s) over `dt` seconds. */
export function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Vertical field of view (degrees) that keeps `SHORT_SIDE_FOV` across the shorter side. */
export function verticalFov(aspect: number): number {
  if (aspect >= 1) return SHORT_SIDE_FOV;
  const half = Math.atan(Math.tan((SHORT_SIDE_FOV * Math.PI) / 360) / aspect);
  return Math.min(76, (half * 360) / Math.PI);
}

/**
 * The three-quarter follow camera: close to the action, pitched 50° down, leading the
 * vehicle in its direction of travel and pulling back a little at speed. Zoom moves
 * between three presets and the view rotates in 45° steps.
 */
/** Trauma lost per second, so a full-strength shake settles in under a second. */
const SHAKE_DECAY = 1.5;
/** Shake offset per metre of visible ground, at full trauma. */
const SHAKE_PER_SPAN = 0.022;
/** Largest roll at full trauma, radians. */
const SHAKE_ROLL = 0.025;

export class FollowCamera {
  readonly camera = new PerspectiveCamera(SHORT_SIDE_FOV, 1, 1, 1500);
  /** The point the camera looks at, after smoothing and look-ahead. */
  readonly focus = new Vector3();
  private readonly lead = new Vector3();
  private readonly tmp = new Vector3();
  private yawTarget = 0;
  private yawCurrent = 0;
  private zoomIndex: number = DEFAULT_ZOOM;
  private distanceCurrent = presetDistance(DEFAULT_ZOOM);
  /** Extra distance factor from the target's speed, 0 to `SPEED_ZOOM`. */
  private speedZoom = 0;
  private placed = false;
  private interest: Vector3 | null = null;
  /** Shake energy, 0–1; the offset grows with its square so small knocks stay subtle. */
  private trauma = 0;
  private shakeTime = 0;
  private readonly shakeOffset = new Vector3();
  /** 1 for full camera shake, lower for the reduced-shake setting. */
  shakeScale = 1;

  /** Current (smoothed) yaw of the camera rig; 0 looks north. */
  get yaw(): number {
    return this.yawCurrent;
  }

  get distance(): number {
    return this.distanceCurrent;
  }

  /** Metres of ground visible across the shorter screen side at the current zoom. */
  get viewSpan(): number {
    return this.distanceCurrent * 2 * Math.tan((SHORT_SIDE_FOV * Math.PI) / 360);
  }

  get zoomLevel(): number {
    return this.zoomIndex;
  }

  setViewport(width: number, height: number): void {
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = verticalFov(aspect);
    this.camera.updateProjectionMatrix();
  }

  /** Rotates the view one 45° step; +1 orbits the camera to its right. */
  turn(direction: -1 | 1): void {
    this.yawTarget = wrapAngle(this.yawTarget + direction * YAW_STEP);
  }

  /** Turns the view back to north up. */
  resetYaw(): void {
    this.yawTarget = 0;
  }

  /** Rotates the view smoothly by `radians` (title-screen orbit). */
  turnBy(radians: number): void {
    this.yawTarget = wrapAngle(this.yawTarget + radians);
  }

  /** Moves one zoom preset in (−1) or out (+1). */
  zoom(step: -1 | 1): void {
    this.zoomIndex = Math.max(0, Math.min(ZOOM_PRESETS.length - 1, this.zoomIndex + step));
  }

  /** Keeps a second point in frame alongside the target, or stops when given null. */
  setInterest(point: Vector3 | null): void {
    this.interest = point;
  }

  /** Jumps straight to a target with no smoothing, for level starts and respawns. */
  snapTo(target: Vector3): void {
    this.focus.copy(target);
    this.lead.set(0, 0, 0);
    this.yawCurrent = this.yawTarget;
    this.speedZoom = 0;
    this.distanceCurrent = presetDistance(this.zoomIndex);
    this.placed = true;
    this.applyTransform();
  }

  /** Adds shake for a hit or blast of `strength` (0–1). */
  shake(strength: number): void {
    this.trauma = Math.min(1, this.trauma + strength * this.shakeScale);
  }

  update(dt: number, target: Vector3, velocity: Vector3): void {
    this.trauma = Math.max(0, this.trauma - dt * SHAKE_DECAY);
    this.shakeTime += dt;
    if (!this.placed) {
      this.snapTo(target);
      return;
    }
    // Pull back a little at speed: quick to open up, slower to close in again.
    const groundSpeed = Math.hypot(velocity.x, velocity.z);
    const pull =
      SPEED_ZOOM *
      Math.max(
        0,
        Math.min(1, (groundSpeed - SPEED_ZOOM_START) / (SPEED_ZOOM_FULL - SPEED_ZOOM_START)),
      );
    this.speedZoom += (pull - this.speedZoom) * smoothing(pull > this.speedZoom ? 2.2 : 1.1, dt);
    const preset = presetDistance(this.zoomIndex) * (1 + this.speedZoom);
    this.distanceCurrent += (preset - this.distanceCurrent) * smoothing(6, dt);
    this.yawCurrent = wrapAngle(
      this.yawCurrent + wrapAngle(this.yawTarget - this.yawCurrent) * smoothing(7, dt),
    );

    // Lead the vehicle by where it will be shortly, within a fraction of the view.
    const maxLead = this.viewSpan * 0.28;
    this.tmp.set(velocity.x, 0, velocity.z).multiplyScalar(LOOK_AHEAD_SECONDS);
    if (this.tmp.length() > maxLead) this.tmp.setLength(maxLead);
    this.lead.lerp(this.tmp, smoothing(2.6, dt));

    this.tmp.copy(target).add(this.lead);
    // Nudge towards a point of interest (the Hauler near impact) if it is close enough.
    if (this.interest) {
      const gap = Math.hypot(this.interest.x - target.x, this.interest.z - target.z);
      if (gap < this.viewSpan * 1.2) this.tmp.lerp(this.interest, INTEREST_PULL);
    }
    this.focus.lerp(this.tmp, smoothing(this.interest ? 3.5 : 12, dt));
    this.applyTransform();
  }

  private applyTransform(): void {
    const d = this.distanceCurrent;
    const horizontal = Math.cos(PITCH) * d;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yawCurrent) * horizontal,
      this.focus.y + Math.sin(PITCH) * d,
      this.focus.z + Math.cos(this.yawCurrent) * horizontal,
    );
    this.camera.lookAt(this.focus);
    if (this.trauma <= 0) return;
    // Layered sines make a cheap, smooth noise; move the camera sideways and up a little
    // and roll it slightly, so the view jolts without losing its target.
    const t = this.shakeTime;
    const amount = this.trauma * this.trauma * (0.25 + this.viewSpan * SHAKE_PER_SPAN);
    this.shakeOffset.set(
      (Math.sin(t * 37.3) * 0.6 + Math.sin(t * 71.9) * 0.4) * amount,
      (Math.sin(t * 43.7 + 1.3) * 0.6 + Math.sin(t * 89.1) * 0.4) * amount,
      0,
    );
    this.shakeOffset.applyQuaternion(this.camera.quaternion);
    this.camera.position.add(this.shakeOffset);
    this.camera.rotateZ(Math.sin(t * 29.3 + 0.7) * this.trauma * this.trauma * SHAKE_ROLL);
  }
}
