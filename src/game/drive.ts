/**
 * Driving maths shared by every vehicle. Headings are rotations about the world y axis:
 * a heading θ faces the direction (sin θ, cos θ) in (x, z), so 0 faces south (+z),
 * π/2 faces east (+x) and π faces north (−z).
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Past this angle between the vehicle and the stick, the vehicle reverses instead. */
export const REVERSE_ANGLE = 150 * DEG;
/** Once reversing, the vehicle keeps reversing until the angle drops below this. */
export const REVERSE_RELEASE_ANGLE = 120 * DEG;

/** Wraps an angle into (−π, π]. */
export function wrapAngle(angle: number): number {
  let a = angle % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Converts a compass bearing in degrees (0 = north, 90 = east) to a heading. */
export function bearingToHeading(bearingDegrees: number): number {
  return wrapAngle(Math.PI - bearingDegrees * DEG);
}

/**
 * Converts a screen-space stick (x right, y up) to a world heading, given the camera's
 * yaw. At camera yaw 0 the camera looks north, so stick-up means north.
 */
export function stickToHeading(stickX: number, stickY: number, cameraYaw: number): number {
  const cos = Math.cos(cameraYaw);
  const sin = Math.sin(cameraYaw);
  const dx = stickX * cos - stickY * sin;
  const dz = -stickX * sin - stickY * cos;
  return Math.atan2(dx, dz);
}

export interface DriveOutput {
  /** −1 full left to +1 full right. */
  readonly steer: number;
  /** +1 full ahead to −1 full reverse. */
  readonly throttle: number;
}

export interface PointToDriveOptions {
  /** Heading error, in radians, that asks for full steering lock. */
  readonly fullLockAngle: number;
}

/**
 * Turns "point the stick where you want to go" into steering and throttle. The vehicle
 * steers towards the stick direction, slows for sharp turns, and reverses when the stick
 * points behind it.
 */
export class PointToDrive {
  private reversing = false;

  constructor(private readonly options: PointToDriveOptions = { fullLockAngle: 35 * DEG }) {}

  get isReversing(): boolean {
    return this.reversing;
  }

  reset(): void {
    this.reversing = false;
  }

  update(currentHeading: number, targetHeading: number, magnitude: number): DriveOutput {
    if (magnitude <= 0) {
      this.reversing = false;
      return { steer: 0, throttle: 0 };
    }
    const diff = wrapAngle(targetHeading - currentHeading);
    const absDiff = Math.abs(diff);
    if (this.reversing ? absDiff > REVERSE_RELEASE_ANGLE : absDiff > REVERSE_ANGLE) {
      this.reversing = true;
      // Swing the rear towards the target; steering acts the other way round in reverse.
      const rearDiff = wrapAngle(diff - Math.PI);
      return { steer: clampUnit(rearDiff / this.options.fullLockAngle), throttle: -magnitude };
    }
    this.reversing = false;
    // A positive heading change turns left, so steering right is the negative of it.
    const steer = clampUnit(-diff / this.options.fullLockAngle);
    const turnSlowdown = 1 - 0.65 * smoothstep(0.35, 2.4, absDiff);
    return { steer, throttle: magnitude * turnSlowdown };
  }
}

/** Stick directions within this angle of the route are eased onto it. */
export const ASSIST_ANGLE = 25 * DEG;
/** How far the target heading moves towards the route (0 = none, 1 = snap). */
export const ASSIST_STRENGTH = 0.55;

/**
 * Steering assist: when the requested heading is close to the route's direction (either
 * way along it), ease it onto the route so driving along the road needs less precision.
 */
export function assistHeading(target: number, routeHeading: number): number {
  for (const along of [routeHeading, routeHeading + Math.PI]) {
    const diff = wrapAngle(target - along);
    if (Math.abs(diff) < ASSIST_ANGLE) {
      // Full pull near the route direction, fading out towards the edge of the cone.
      const weight = ASSIST_STRENGTH * (1 - Math.abs(diff) / ASSIST_ANGLE);
      return wrapAngle(target - diff * weight);
    }
  }
  return target;
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
