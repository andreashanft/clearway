import { approach, clamp, lerp } from '../math';
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
  /**
   * The handbrake. It locks the rear wheels: the vehicle slows down more gently than with the
   * brake pedal, and above 15 km/h it slides. It never reverses the vehicle.
   */
  brake: boolean;
}

export const NO_COMMAND: Readonly<DriveCommand> = { throttle: 0, steer: 0, brake: false };

/** Below this speed, the brake pedal reverses and a tracked vehicle changes its turn direction. */
const STANDSTILL_SPEED = 0.5;
/** A vehicle that is faster than its engine allows loses the extra speed by this, in m/s². */
const OVERSPEED_DRAG = 1.5;
/**
 * Below this speed, in m/s, no vehicle slides. Up to twice this speed, a slide fades out, so
 * that a vehicle that brakes to a stop in a slide does not spin on the spot.
 */
const SLIDE_MIN_SPEED = 4;
/** A fast turn starts a slide from this steering wheel position, with the throttle held. */
const SLIDE_LOCK = 0.8;
/** A fast turn starts a slide from this pedal position. */
const SLIDE_THROTTLE = 0.5;
/** A slide that has set in lasts with the throttle down to this share of `slideSpeed`. */
const SLIDE_HOLD_SHARE = 0.6;
/** How fast the handbrake starts a slide, in full slides per second. */
const HANDBRAKE_SLIDE_RATE = 6;
/** How fast a fast turn starts a slide. It is slower, so that a short correction keeps its grip. */
const POWER_SLIDE_RATE = 2.5;
/** How fast the grip returns once nothing holds the slide, per second. */
const SLIDE_RECOVERY_RATE = 3;
/** How quickly a slide turns the heading towards the angle that the steering asks for, per second. */
const SLIDE_ANGLE_RESPONSE = 6;
/** The fastest turn of a vehicle in a slide, in radians per second. */
const MAX_SLIDE_TURN_RATE = 5;
/**
 * The share of the speed that a real slide would cost, which a slide costs here. The rest
 * carries on in the new direction of travel, so that a slide keeps the vehicle fast.
 */
const SLIDE_SPEED_LOSS = 0.35;

/** The parts of a vehicle's tuning that decide its speed. */
export type EngineSpec = Pick<
  VehicleSpec,
  'topSpeed' | 'reverseSpeed' | 'acceleration' | 'braking' | 'handbrakeBraking' | 'coasting'
>;

/** The parts of a vehicle's tuning that decide how it turns. */
export type SteeringSpec = Pick<VehicleSpec, 'turnRadius' | 'pivotRate' | 'cornering'>;

/** The parts of a vehicle's tuning that decide how it slides. */
export type SlideSpec = Pick<VehicleSpec, 'grip' | 'slideSpeed' | 'slideAngle' | 'slideFriction'>;

/**
 * Returns the speed along the heading after one step of engine and brakes.
 *
 * @param forward Current speed along the heading in m/s. Negative when reversing.
 * @param sideways Current sideways speed in m/s. The engine only drives the vehicle until its
 *   total speed, along and across the heading, reaches the top speed.
 */
export function driveSpeed(
  spec: Readonly<EngineSpec>,
  forward: number,
  command: Readonly<DriveCommand>,
  dt: number,
  sideways = 0,
): number {
  if (command.brake) {
    return approach(forward, 0, spec.handbrakeBraking * dt);
  }
  const throttle = clamp(command.throttle, -1, 1);
  if (throttle === 0) {
    return approach(forward, 0, spec.coasting * dt);
  }
  const topSpeed = Math.sqrt(Math.max(0, spec.topSpeed ** 2 - sideways ** 2));
  const target = throttle > 0 ? throttle * topSpeed : throttle * spec.reverseSpeed;
  if (Math.sign(throttle) !== Math.sign(forward) && Math.abs(forward) > STANDSTILL_SPEED) {
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
 * Returns how much the vehicle slides after one step: 0 is full grip and 1 is a full slide.
 *
 * The handbrake starts a slide above 15 km/h. A turn at nearly full lock with the throttle held
 * starts one from `slideSpeed`, but more slowly, so that a short correction keeps its grip. Once
 * that slide has set in, it lasts down to a lower speed. Without either, the grip returns. Near
 * standstill, every slide fades out.
 *
 * @param slide How much the vehicle slides now.
 * @param forward Speed along the heading in m/s.
 * @param steering Position of the steering wheel from -1 to 1.
 */
export function nextSlide(
  spec: Readonly<SlideSpec>,
  slide: number,
  forward: number,
  steering: number,
  command: Readonly<DriveCommand>,
  dt: number,
): number {
  let target = 0;
  let rate = SLIDE_RECOVERY_RATE;
  const powerSlideSpeed = slide > 0.5 ? spec.slideSpeed * SLIDE_HOLD_SHARE : spec.slideSpeed;
  const fade = clamp((forward - SLIDE_MIN_SPEED) / SLIDE_MIN_SPEED, 0, 1);
  if (fade > 0) {
    if (command.brake) {
      target = fade;
      rate = HANDBRAKE_SLIDE_RATE;
    } else if (
      forward >= powerSlideSpeed &&
      command.throttle >= SLIDE_THROTTLE &&
      Math.abs(steering) >= SLIDE_LOCK
    ) {
      target = fade;
      rate = POWER_SLIDE_RATE;
    }
  }
  return approach(slide, target, rate * dt);
}

/** A velocity as speeds along and across the heading, in m/s. */
export interface TyreVelocity {
  /** Speed along the heading. Negative when reversing. */
  forward: number;
  /** Speed across the heading. Positive to the right. */
  sideways: number;
}

/**
 * Returns the velocity after the tyres act on it for one step.
 *
 * With grip, the tyres stop sideways motion almost at once, at the rate `grip`. In a slide, the
 * tyres slide over the ground: they turn the direction of travel towards the heading with at
 * most `slideFriction` in m/s², and they cost only a share of the speed that a real slide would
 * cost. The vehicle therefore drifts on and stays fast. A partial slide blends the two. A
 * vehicle that reverses always grips.
 */
export function tyreVelocity(
  spec: Readonly<SlideSpec>,
  forward: number,
  sideways: number,
  slide: number,
  dt: number,
): TyreVelocity {
  const gripped = sideways * Math.exp(-spec.grip * dt);
  const speed = Math.hypot(forward, sideways);
  if (slide <= 0 || forward <= 0 || speed < 0.5) {
    return { forward, sideways: gripped };
  }
  const travel = Math.atan2(sideways, forward);
  const turned = approach(travel, 0, (spec.slideFriction / speed) * dt);
  const loss = spec.slideFriction * SLIDE_SPEED_LOSS * Math.abs(Math.sin(travel));
  const slowed = approach(speed, 0, loss * dt);
  return {
    forward: lerp(forward, slowed * Math.cos(turned), slide),
    sideways: lerp(gripped, slowed * Math.sin(turned), slide),
  };
}

/**
 * Returns the turn rate of a vehicle in a full slide, in radians per second.
 *
 * In a slide, the steering sets the slip angle: the angle between the heading and the direction
 * of travel. Full lock asks for `slideAngle` towards the steering side. The centre asks for none,
 * so steering against the slide straightens the vehicle out. The heading also turns with the
 * direction of travel, so that the angle holds through a curve.
 *
 * @param slip Current slip angle in radians. It is positive when the nose points to the right of
 *   the direction of travel.
 * @param travelTurn How fast the direction of travel turns, in radians per second.
 * @param steering Position of the steering wheel from -1 to 1.
 */
export function slideTurnRate(
  spec: Readonly<SlideSpec>,
  slip: number,
  travelTurn: number,
  steering: number,
): number {
  const rate = travelTurn + (steering * spec.slideAngle - slip) * SLIDE_ANGLE_RESPONSE;
  return clamp(rate, -MAX_SLIDE_TURN_RATE, MAX_SLIDE_TURN_RATE);
}

/**
 * Shapes an analogue steering input: small deflections steer finely, and full deflection still
 * gives full lock. Digital input (-1, 0 or 1) passes unchanged.
 */
export function shapeSteering(input: number): number {
  const value = clamp(input, -1, 1);
  return Math.sign(value) * Math.abs(value) ** 1.5;
}
