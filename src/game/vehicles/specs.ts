import type { VehicleType } from '../level';

/**
 * Tuning of one vehicle type.
 *
 * The vehicles are arcade cars, not simulations. They reach their top speed in about a second,
 * hold the line that the driver steers, and do not slide. Speeds are in metres per second.
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
  /** Deceleration in m/s² while braking. */
  braking: number;
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
  /** How quickly sideways sliding stops, per second. A high value means no drift. */
  grip: number;
  /** Multiplies the damage that this vehicle deals. */
  damage: number;
}

/** 1 km/h in m/s. */
const KMH = 1 / 3.6;

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
    coasting: 12,
    turnRadius: 0,
    pivotRate: 2.2,
    cornering: 26,
    steerSpeed: 8,
    turnResponse: 14,
    grip: 16,
    damage: 1.2,
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
    coasting: 8,
    turnRadius: 8,
    pivotRate: 0,
    cornering: 32,
    steerSpeed: 7,
    turnResponse: 12,
    grip: 14,
    damage: 1,
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
    coasting: 7,
    turnRadius: 6.5,
    pivotRate: 0,
    cornering: 44,
    steerSpeed: 9,
    turnResponse: 14,
    grip: 18,
    damage: 0.8,
  },
};

/** The vehicle types in the order in which the game lists them. */
export const VEHICLE_TYPES = Object.keys(VEHICLE_SPECS) as VehicleType[];
