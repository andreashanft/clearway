import { PerspectiveCamera, Vector3 } from 'three';
import { wrapAngle } from './drive';

/**
 * Zoom presets: metres of ground visible across the shorter side of the screen. The
 * camera distance follows from the field of view (see `distanceForSpan`).
 */
export const ZOOM_PRESETS = [25, 45, 70] as const;
export const DEFAULT_ZOOM = 1;
/** How far the camera looks down, in radians. */
export const PITCH = (55 * Math.PI) / 180;
/** Field of view across the shorter screen side, in degrees. */
export const SHORT_SIDE_FOV = 30;
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
const LOOK_AHEAD_SECONDS = 0.9;

/** Exponential smoothing factor for a rate (1/s) over `dt` seconds. */
export function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Vertical field of view (degrees) that keeps `SHORT_SIDE_FOV` across the shorter side. */
export function verticalFov(aspect: number): number {
  if (aspect >= 1) return SHORT_SIDE_FOV;
  const half = Math.atan(Math.tan((SHORT_SIDE_FOV * Math.PI) / 360) / aspect);
  return Math.min(60, (half * 360) / Math.PI);
}

/**
 * The three-quarter follow camera: narrow field of view, pitched 55° down, leading the
 * vehicle in its direction of travel. Zoom moves between three presets and the view
 * rotates in 45° steps.
 */
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
  private placed = false;
  private interest: Vector3 | null = null;

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
    this.distanceCurrent = presetDistance(this.zoomIndex);
    this.placed = true;
    this.applyTransform();
  }

  update(dt: number, target: Vector3, velocity: Vector3): void {
    if (!this.placed) {
      this.snapTo(target);
      return;
    }
    const preset = presetDistance(this.zoomIndex);
    this.distanceCurrent += (preset - this.distanceCurrent) * smoothing(5, dt);
    this.yawCurrent = wrapAngle(
      this.yawCurrent + wrapAngle(this.yawTarget - this.yawCurrent) * smoothing(7, dt),
    );

    // Lead the vehicle by where it will be shortly, within a fraction of the view.
    const maxLead = this.viewSpan * 0.3;
    this.tmp.set(velocity.x, 0, velocity.z).multiplyScalar(LOOK_AHEAD_SECONDS);
    if (this.tmp.length() > maxLead) this.tmp.setLength(maxLead);
    this.lead.lerp(this.tmp, smoothing(1.8, dt));

    this.tmp.copy(target).add(this.lead);
    // Nudge towards a point of interest (the Hauler near impact) if it is close enough.
    if (this.interest) {
      const gap = Math.hypot(this.interest.x - target.x, this.interest.z - target.z);
      if (gap < this.viewSpan * 1.2) this.tmp.lerp(this.interest, INTEREST_PULL);
    }
    this.focus.lerp(this.tmp, smoothing(this.interest ? 3 : 9, dt));
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
  }
}
