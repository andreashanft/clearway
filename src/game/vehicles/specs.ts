import type { VehicleType } from '../level';

/** What the Action button does. */
export type ActionKind = 'ram' | 'skid' | 'boost' | 'roll' | 'none';

/**
 * Tuning of one vehicle type.
 *
 * The vehicles are toys, not simulations: they reach top speed in under a second, turn sharply
 * and do not slide unless their action says so. Speeds are in metres per second.
 */
export interface VehicleSpec {
  type: VehicleType;
  name: string;
  /** Word on the Action button. */
  actionLabel: string;
  actionKind: ActionKind;
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
  /** Turn rate at full steering in radians per second. */
  turnRate: number;
  /** How quickly the turn rate follows the steering input, per second. */
  turnResponse: number;
  /** A tracked vehicle can turn on the spot. A wheeled vehicle needs speed to turn. */
  pivots: boolean;
  /** Speed at which a wheeled vehicle reaches its full turn rate. */
  fullTurnSpeed: number;
  /** How quickly sideways sliding stops, per second. A high value means no drift. */
  grip: number;
  /** Multiplies the damage that this vehicle deals. */
  damage: number;
  /** How long the action lasts, in seconds. */
  actionDuration: number;
  /** How long the action takes to recharge, in seconds. */
  actionRecharge: number;
}

/** 1 km/h in m/s. */
const KMH = 1 / 3.6;

export const VEHICLE_SPECS: Record<VehicleType, VehicleSpec> = {
  bruiser: {
    type: 'bruiser',
    name: 'Bruiser',
    actionLabel: 'RAM',
    actionKind: 'ram',
    mass: 9000,
    length: 8.4,
    height: 3.4,
    width: 6.8,
    rideHeight: 2.1,
    topSpeed: 50 * KMH,
    reverseSpeed: 9,
    acceleration: 26,
    braking: 46,
    coasting: 16,
    turnRate: 2.7,
    turnResponse: 12,
    pivots: true,
    fullTurnSpeed: 1,
    grip: 14,
    damage: 1,
    actionDuration: 0.5,
    actionRecharge: 4,
  },
  fishtail: {
    type: 'fishtail',
    name: 'Fishtail',
    actionLabel: 'SKID',
    actionKind: 'skid',
    mass: 7000,
    length: 10.5,
    height: 3.6,
    width: 5.2,
    rideHeight: 2.1,
    topSpeed: 80 * KMH,
    reverseSpeed: 10,
    acceleration: 24,
    braking: 44,
    coasting: 12,
    turnRate: 2.2,
    turnResponse: 9,
    pivots: false,
    fullTurnSpeed: 7,
    grip: 9,
    damage: 1.1,
    actionDuration: 0,
    actionRecharge: 0,
  },
  liftoff: {
    type: 'liftoff',
    name: 'Liftoff',
    actionLabel: 'BOOST',
    actionKind: 'boost',
    mass: 2600,
    length: 6.6,
    height: 2.4,
    width: 4.6,
    rideHeight: 1.6,
    topSpeed: 110 * KMH,
    reverseSpeed: 10,
    acceleration: 30,
    braking: 50,
    coasting: 12,
    turnRate: 2.4,
    turnResponse: 10,
    pivots: false,
    fullTurnSpeed: 9,
    grip: 11,
    damage: 1.6,
    actionDuration: 1,
    actionRecharge: 3,
  },
  tumbler: {
    type: 'tumbler',
    name: 'Tumbler',
    actionLabel: 'ROLL',
    actionKind: 'roll',
    mass: 14000,
    length: 6.4,
    height: 9,
    width: 6.4,
    rideHeight: 4.6,
    topSpeed: 40 * KMH,
    reverseSpeed: 6,
    acceleration: 18,
    braking: 40,
    coasting: 18,
    turnRate: 1.9,
    turnResponse: 7,
    pivots: true,
    fullTurnSpeed: 1,
    grip: 14,
    damage: 2.2,
    actionDuration: 1.5,
    actionRecharge: 0.6,
  },
  railbed: {
    type: 'railbed',
    name: 'Railbed',
    actionLabel: '',
    actionKind: 'none',
    mass: 12000,
    length: 16,
    height: 2.6,
    width: 6.4,
    rideHeight: 1.7,
    topSpeed: 30 * KMH,
    reverseSpeed: 30 * KMH,
    acceleration: 9,
    braking: 22,
    coasting: 9,
    turnRate: 0,
    turnResponse: 0,
    pivots: false,
    fullTurnSpeed: 1,
    grip: 30,
    damage: 0,
    actionDuration: 0,
    actionRecharge: 0,
  },
};
