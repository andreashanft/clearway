import { approach, clamp } from '../math';
import type { VehicleSpec } from './specs';

/** What the driver asks of a vehicle during one simulation step. */
export interface DriveCommand {
  /**
   * The pedals: 1 is full throttle and -1 is the full brake pedal.
   * The brake pedal brakes a vehicle that rolls forwards. Once the vehicle stands, it reverses.
   */
  throttle: number;
  /**
   * Steering wheel position: -1 is full left, 1 is full right.
   * Like a car, a vehicle that reverses with the wheel to the right swings its rear to the right.
   */
  steer: number;
  /** The handbrake. It stops the vehicle and never reverses it. */
  brake: boolean;
}

export const NO_COMMAND: Readonly<DriveCommand> = { throttle: 0, steer: 0, brake: false };

/** Below this speed, the brake pedal reverses and a tracked vehicle changes its turn direction. */
const STANDSTILL_SPEED = 0.5;
/** A vehicle that is faster than its engine allows loses the extra speed by this, in m/s². */
const OVERSPEED_DRAG = 1.5;

/** The parts of a vehicle's tuning that decide its speed. */
export type EngineSpec = Pick<
  VehicleSpec,
  'topSpeed' | 'reverseSpeed' | 'acceleration' | 'braking' | 'coasting'
>;

/** The parts of a vehicle's tuning that decide how it turns. */
export type SteeringSpec = Pick<VehicleSpec, 'turnRadius' | 'pivotRate' | 'cornering'>;

/**
 * Returns the speed along the heading after one step of engine and brakes.
 *
 * @param forward Current speed along the heading in m/s. Negative when reversing.
 */
export function driveSpeed(
  spec: Readonly<EngineSpec>,
  forward: number,
  command: Readonly<DriveCommand>,
  dt: number,
): number {
  if (command.brake) {
    return approach(forward, 0, spec.braking * dt);
  }
  const throttle = clamp(command.throttle, -1, 1);
  if (throttle === 0) {
    return approach(forward, 0, spec.coasting * dt);
  }
  const target = throttle > 0 ? throttle * spec.topSpeed : throttle * spec.reverseSpeed;
  if (Math.sign(target) !== Math.sign(forward) && Math.abs(forward) > STANDSTILL_SPEED) {
    // A pedal against the direction of travel brakes first.
    return approach(forward, 0, spec.braking * Math.abs(throttle) * dt);
  }
  if (Math.abs(forward) <= Math.abs(target)) {
    return approach(forward, target, spec.acceleration * dt);
  }
  // Faster than the pedal asks for, for example downhill: lose the extra speed slowly.
  return approach(forward, target, Math.max(OVERSPEED_DRAG, spec.coasting) * dt);
}

/**
 * Returns the turn rate at full steering lock to the right, in radians per second.
 *
 * At low speed the turn follows the geometry of the vehicle: a wheeled vehicle drives a circle
 * of `turnRadius`, and a tracked vehicle pivots at `pivotRate`. At high speed the sideways
 * acceleration `cornering` limits the rate, so the turn widens instead of the vehicle spinning.
 * The result is negative while a vehicle reverses, as with a car.
 */
export function fullLockTurnRate(spec: Readonly<SteeringSpec>, forward: number): number {
  const speed = Math.abs(forward);
  const gripLimit = speed > 0.01 ? spec.cornering / speed : Infinity;
  if (spec.turnRadius === 0) {
    const rate = Math.min(spec.pivotRate, gripLimit);
    return forward < -STANDSTILL_SPEED ? -rate : rate;
  }
  return Math.sign(forward) * Math.min(speed / spec.turnRadius, gripLimit);
}

/**
 * Shapes an analogue steering input: small deflections steer finely, and full deflection still
 * gives full lock. Digital input (-1, 0 or 1) passes unchanged.
 */
export function shapeSteering(input: number): number {
  const value = clamp(input, -1, 1);
  return Math.sign(value) * Math.abs(value) ** 1.5;
}
