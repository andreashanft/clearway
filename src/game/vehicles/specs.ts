import type { VehicleType } from '../level';

/**
 * Tuning of one vehicle type.
 *
 * The vehicles are arcade cars, not simulations. They reach their top speed in about a second
 * and hold the line that the driver steers. They slide only when the driver asks for it: with
 * the handbrake, or with a fast turn at nearly full lock and the throttle held. Speeds are in metres per
 * second.
 */
export interface VehicleSpec {
  type: VehicleType;
  name: string;
  /** Mass in kilograms. It scales damage and decides who pushes whom. */
  mass: number;
  /** Size of the collision box: length, height and width in metres. */
  length: number;
  height: number;
  width: number;
  /** Height of the chassis centre above the ground when the vehicle rests. */
  rideHeight: number;
  topSpeed: number;
  reverseSpeed: number;
  /** Acceleration in m/s². */
  acceleration: number;
  /** Deceleration in m/s² with the brake pedal. */
  braking: number;
  /** Deceleration in m/s² with the handbrake. It is lower, because only the rear wheels lock. */
  handbrakeBraking: number;
  /** Deceleration in m/s² when neither throttle nor brake is applied. */
  coasting: number;
  /**
   * Radius of the tightest turn at full steering lock, in metres.
   * 0 marks a tracked vehicle, which turns on the spot at `pivotRate`.
   */
  turnRadius: number;
  /** Turn rate of a tracked vehicle at full steering, in radians per second. */
  pivotRate: number;
  /**
   * The strongest sideways acceleration that the vehicle holds in a turn, in m/s².
   * It limits the turn rate at speed, so that a fast vehicle stays stable.
   */
  cornering: number;
  /** How fast the steering wheel follows the input, in full locks per second. */
  steerSpeed: number;
  /** How quickly the turn rate follows the steering wheel, per second. */
  turnResponse: number;
  /** How quickly sideways motion stops while the tyres grip, per second. */
  grip: number;
  /** From this speed, a turn at nearly full lock with the throttle held starts a slide, in m/s. */
  slideSpeed: number;
  /** The slip angle that full lock holds in a slide, in radians. */
  slideAngle: number;
  /** How strongly the sliding tyres slow sideways motion, in m/s². Lower values drift further. */
  slideFriction: number;
  /**
   * Damage of a ram at the top speed, in hit points. A slower ram deals less, by the square of
   * its share of the top speed. A house has about 100 hit points.
   */
  ram: number;
  /** Factor on the damage of a ram with the front. The bulldozer's spiked blade raises it. */
  blade: number;
  /**
   * Width of the strip in front of the vehicle that its blade breaks, in metres. It can be wider
   * than the vehicle. 0 for a vehicle without a blade.
   */
  bladeWidth: number;
}

/** 1 km/h in m/s. */
const KMH = 1 / 3.6;
/** 1 degree in radians. */
const DEG = Math.PI / 180;

/**
 * The three vehicles. The debug tuning panel changes these values while the game runs, so the
 * objects are not frozen.
 */
export const VEHICLE_SPECS: Record<VehicleType, VehicleSpec> = {
  // The bulldozer: heavy, tracked and slow, but it turns on the spot.
  dozer: {
    type: 'dozer',
    name: 'Bulldozer',
    mass: 12000,
    length: 6.4,
    height: 3,
    width: 4.2,
    rideHeight: 1.7,
    topSpeed: 62 * KMH,
    reverseSpeed: 8,
    acceleration: 16,
    braking: 40,
    handbrakeBraking: 30,
    coasting: 12,
    turnRadius: 0,
    pivotRate: 2.2,
    cornering: 26,
    steerSpeed: 8,
    turnResponse: 14,
    grip: 16,
    // The tracks barely slide.
    slideSpeed: 54 * KMH,
    slideAngle: 12 * DEG,
    slideFriction: 26,
    ram: 400,
    blade: 1.5,
    bladeWidth: 8,
  },
  // The flail car: an all-terrain car between the other two in speed and weight.
  flail: {
    type: 'flail',
    name: 'Flail car',
    mass: 4500,
    length: 5.4,
    height: 2.4,
    width: 2.7,
    rideHeight: 1.5,
    topSpeed: 100 * KMH,
    reverseSpeed: 10,
    acceleration: 20,
    braking: 46,
    handbrakeBraking: 10,
    coasting: 8,
    turnRadius: 8,
    pivotRate: 0,
    cornering: 32,
    steerSpeed: 7,
    turnResponse: 12,
    grip: 14,
    slideSpeed: 62 * KMH,
    slideAngle: 30 * DEG,
    slideFriction: 30,
    ram: 300,
    blade: 1,
    bladeWidth: 0,
  },
  // The buggy: light, fast and agile.
  buggy: {
    type: 'buggy',
    name: 'Buggy',
    mass: 1500,
    length: 4.2,
    height: 1.8,
    width: 2.5,
    rideHeight: 1.2,
    topSpeed: 140 * KMH,
    reverseSpeed: 12,
    acceleration: 28,
    braking: 55,
    handbrakeBraking: 12,
    coasting: 7,
    turnRadius: 6.5,
    pivotRate: 0,
    cornering: 44,
    steerSpeed: 9,
    turnResponse: 14,
    grip: 18,
    // The buggy slides the furthest.
    slideSpeed: 80 * KMH,
    slideAngle: 38 * DEG,
    slideFriction: 38,
    ram: 200,
    blade: 1,
    bladeWidth: 0,
  },
};

/** The vehicle types in the order in which the game lists them. */
export const VEHICLE_TYPES = Object.keys(VEHICLE_SPECS) as VehicleType[];
