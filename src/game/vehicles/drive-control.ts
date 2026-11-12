import { clamp, wrapAngle } from '../math';

/** What the driver asks of a vehicle during one simulation step. */
export interface DriveCommand {
  /** -1 is full reverse, 1 is full ahead. */
  throttle: number;
  /**
   * Steering wheel position: -1 is full left, 1 is full right.
   * Like a car, a vehicle that reverses with the wheel to the right swings its rear to the right.
   */
  steer: number;
  brake: boolean;
}

export const NO_COMMAND: Readonly<DriveCommand> = { throttle: 0, steer: 0, brake: false };

/** Beyond this angle between the stick and the vehicle heading, the vehicle reverses. */
const REVERSE_ANGLE = (150 * Math.PI) / 180;

/** Once reversing, the vehicle keeps reversing until the stick is this close to the front. */
const REVERSE_RELEASE_ANGLE = (105 * Math.PI) / 180;

/** The heading error at which the steering reaches full lock. */
const FULL_STEER_ANGLE = (32 * Math.PI) / 180;

/** Stick deflection below which the input counts as released. */
const DEAD_ZONE = 0.12;

/**
 * Point-to-drive: turns "the stick points there" into throttle and steering.
 *
 * The driver points the stick where the vehicle should go. The vehicle accelerates and turns
 * towards that heading. When the stick points behind the vehicle, the vehicle reverses.
 */
export class PointToDrive {
  private reversing = false;

  /**
   * @param targetHeading World heading that the stick points at, in radians.
   * @param magnitude Stick deflection from 0 to 1.
   * @param heading Current heading of the vehicle in radians.
   */
  update(targetHeading: number, magnitude: number, heading: number): DriveCommand {
    if (magnitude < DEAD_ZONE) {
      this.reversing = false;
      return { throttle: 0, steer: 0, brake: false };
    }
    const error = wrapAngle(targetHeading - heading);
    const limit = this.reversing ? REVERSE_RELEASE_ANGLE : REVERSE_ANGLE;
    this.reversing = Math.abs(error) > limit;

    const strength = clamp((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE), 0, 1);
    if (this.reversing) {
      // Line the rear up with the stick. In reverse the steering acts the opposite way.
      const rearError = wrapAngle(targetHeading + Math.PI - heading);
      return {
        throttle: -strength,
        steer: clamp(-rearError / FULL_STEER_ANGLE, -1, 1),
        brake: false,
      };
    }
    // Ease off the throttle in a sharp turn, so that the turn stays tight.
    const turnSlowdown = 1 - 0.55 * clamp((Math.abs(error) - 0.5) / 1.6, 0, 1);
    return {
      throttle: strength * turnSlowdown,
      steer: clamp(error / FULL_STEER_ANGLE, -1, 1),
      brake: false,
    };
  }

  reset(): void {
    this.reversing = false;
  }
}
