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
  /** Multiplies the damage of a landing from above. Only the Liftoff has an armoured belly. */
  stompDamage: number;
  /** While the action runs, the top speed and the acceleration rise by these factors. */
  actionSpeed: number;
  actionAcceleration: number;
  /** False for vehicles that the player cannot leave or that are no vehicles: the pilot. */
  isVehicle: boolean;
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
    stompDamage: 1,
    actionSpeed: 1.25,
    actionAcceleration: 3,
    isVehicle: true,
    actionDuration: 0.5,
    actionRecharge: 4,
  },
  // The skid truck: a front ram is weak, the armoured tail in a skid is strong.
  fishtail: {
    type: 'fishtail',
    name: 'Fishtail',
    actionLabel: 'SKID',
    actionKind: 'skid',
    mass: 7000,
    length: 11,
    height: 3.6,
    width: 5.4,
    rideHeight: 2.1,
    topSpeed: 80 * KMH,
    reverseSpeed: 10,
    acceleration: 22,
    braking: 44,
    coasting: 12,
    turnRate: 2.1,
    turnResponse: 9,
    pivots: false,
    fullTurnSpeed: 7,
    grip: 9,
    damage: 0.6,
    stompDamage: 1,
    actionSpeed: 1,
    actionAcceleration: 1,
    isVehicle: true,
    actionDuration: 0,
    actionRecharge: 0,
  },
  // The rocket buggy: light and fast. It destroys by landing on things.
  liftoff: {
    type: 'liftoff',
    name: 'Liftoff',
    actionLabel: 'BOOST',
    actionKind: 'boost',
    mass: 2600,
    length: 6.6,
    height: 2.4,
    width: 4.8,
    rideHeight: 1.7,
    topSpeed: 110 * KMH,
    reverseSpeed: 10,
    acceleration: 28,
    braking: 50,
    coasting: 12,
    turnRate: 2.3,
    turnResponse: 10,
    pivots: false,
    fullTurnSpeed: 9,
    grip: 11,
    damage: 0.5,
    stompDamage: 7,
    actionSpeed: 1.45,
    actionAcceleration: 2.6,
    isVehicle: true,
    actionDuration: 1,
    actionRecharge: 3,
  },
  // The roll mech: slow to turn on foot, and the only vehicle that breaks concrete.
  tumbler: {
    type: 'tumbler',
    name: 'Tumbler',
    actionLabel: 'ROLL',
    actionKind: 'roll',
    mass: 14000,
    length: 6.4,
    height: 8.4,
    width: 6.4,
    rideHeight: 4.4,
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
    damage: 1.3,
    stompDamage: 1,
    actionSpeed: 2.25,
    actionAcceleration: 3.5,
    isVehicle: true,
    actionDuration: 1.5,
    actionRecharge: 0.6,
  },
  // The rail flatbed: it only moves along its track, and its deck bridges a gap in the route.
  railbed: {
    type: 'railbed',
    name: 'Railbed',
    actionLabel: '',
    actionKind: 'none',
    mass: 20000,
    length: 19,
    height: 3,
    width: 15.5,
    rideHeight: 1.5,
    topSpeed: 30 * KMH,
    reverseSpeed: 30 * KMH,
    acceleration: 9,
    braking: 22,
    coasting: 9,
    turnRate: 0,
    turnResponse: 1,
    pivots: false,
    fullTurnSpeed: 1,
    grip: 30,
    damage: 0,
    stompDamage: 0,
    actionSpeed: 1,
    actionAcceleration: 1,
    isVehicle: true,
    actionDuration: 0,
    actionRecharge: 0,
  },
  // The pilot on foot: slow, harmless, and able to climb into any free vehicle.
  pilot: {
    type: 'pilot',
    name: 'Pilot',
    actionLabel: '',
    actionKind: 'none',
    mass: 120,
    length: 1.6,
    height: 3.6,
    width: 1.6,
    rideHeight: 1.8,
    topSpeed: 24 * KMH,
    reverseSpeed: 24 * KMH,
    acceleration: 40,
    braking: 60,
    coasting: 40,
    turnRate: 9,
    turnResponse: 16,
    pivots: true,
    fullTurnSpeed: 1,
    grip: 30,
    damage: 0,
    stompDamage: 0,
    actionSpeed: 1,
    actionAcceleration: 1,
    isVehicle: false,
    actionDuration: 0,
    actionRecharge: 0,
  },
};
