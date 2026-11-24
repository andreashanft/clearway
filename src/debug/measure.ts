import type { App } from '../app';
import { STEP_SECONDS } from '../engine/loop';
import type { Game } from '../game/game';
import type { VehicleType } from '../game/level';
import { clamp, wrapAngle } from '../game/math';
import { VEHICLE_TYPES } from '../game/vehicles/specs';

/** What the handling measurement reports for one vehicle. */
export interface HandlingRow {
  vehicle: string;
  /** Speed at the end of the acceleration run, in km/h. */
  topSpeedKmh: number;
  /** Seconds from standstill to 95 % of the top speed. */
  toTopSpeedSeconds: number;
  /** Metres and seconds from top speed to standstill with the brake pedal. */
  stoppingMetres: number;
  stoppingSeconds: number;
  /** Radius of the circle at a quarter of the top speed and full lock, in metres. */
  slowTurnRadius: number;
  /** Radius of the circle at top speed and full lock, in metres. */
  fastTurnRadius: number;
  /** Seconds for a turn of 180° from top speed, at full lock and full throttle. */
  uTurnSeconds: number;
  /** Largest slip angle on the circle at top speed, in degrees. */
  powerSlideDegrees: number;
  /** Seconds for a turn of 90°, as at a street corner, from top speed with the handbrake at full lock. */
  handbrakeTurnSeconds: number;
  /** Speed at the end of that turn, in km/h. */
  handbrakeTurnKmh: number;
  /** Seconds through the wide slalom, and the cones that the driver model knocked over. */
  slalomSeconds: number;
  slalomConesHit: number;
  /** Average speed through the wide slalom, in km/h. */
  slalomKmh: number;
}

/** The wide slalom of the test yard: the cones stand on Z = 44, every 24 m. */
const SLALOM = { z: 44, firstX: -168, lastX: 168, spacing: 24 };
/** The driver model passes each cone at this distance beyond half the width of the vehicle. */
const SLALOM_CLEARANCE = 1.5;
/** The driver model uses this share of the sideways acceleration that the vehicle can hold. */
const SLALOM_GRIP_SHARE = 0.7;

/**
 * Measures how each vehicle drives: acceleration, braking, turning and a slalom.
 *
 * The measurement runs the simulation as fast as the browser allows and does not draw. It needs
 * the test yard and puts the vehicle back at the start afterwards.
 */
export function measureHandling(app: App): HandlingRow[] {
  const game = app.game;
  if (game?.level.id !== 'yard' || game.phase !== 'playing') {
    console.warn('The handling measurement needs a running test yard. Open ?yard&debug.');
    return [];
  }
  const original = game.activeVehicle.spec.type;
  const rows = VEHICLE_TYPES.map((type) => measureVehicle(app, game, type));
  app.setVehicle(original);
  park(game, game.level.spawn.pos[0], game.level.spawn.pos[1]);
  setInput(app, 0, 0);
  console.table(rows);
  return rows;
}

function setInput(app: App, steer: number, throttle: number): void {
  app.scripted.steer = steer;
  app.scripted.throttle = throttle;
}

/** Puts the vehicle at a place, looking east, at rest. */
function park(game: Game, x: number, z: number): void {
  game.activeVehicle.teleport([x, z], 0);
}

/** Steps the simulation until `done` returns true, and returns the seconds that passed. */
function run(game: Game, limitSeconds: number, done: () => boolean): number {
  const limit = Math.round(limitSeconds / STEP_SECONDS);
  for (let step = 0; step < limit; step += 1) {
    game.step(STEP_SECONDS);
    if (done()) {
      return (step + 1) * STEP_SECONDS;
    }
  }
  return limitSeconds;
}

const round = (value: number, digits = 1): number => Number(value.toFixed(digits));

function measureVehicle(app: App, game: Game, type: VehicleType): HandlingRow {
  app.setVehicle(type);
  const vehicle = game.activeVehicle;
  const { spec } = vehicle;

  // Acceleration and braking on the main straight.
  park(game, -240, 0);
  setInput(app, 0, 1);
  const toTopSpeedSeconds = run(game, 20, () => vehicle.forwardSpeed >= spec.topSpeed * 0.95);
  run(game, 2, () => false);
  const topSpeed = vehicle.forwardSpeed;
  const brakeFrom = vehicle.position.x;
  setInput(app, 0, -1);
  const stoppingSeconds = run(game, 20, () => vehicle.forwardSpeed <= 0.05);
  const stoppingMetres = vehicle.position.x - brakeFrom;

  // Turning circles on open ground: the radius is half the width of the driven circle.
  let maxSlip = 0;
  const circle = (throttle: number): number => {
    park(game, -100, 180);
    setInput(app, 0, throttle);
    run(game, 6, () => false);
    setInput(app, 1, throttle);
    run(game, 3, () => false);
    let minX = Infinity;
    let maxX = -Infinity;
    maxSlip = 0;
    const start = vehicle.heading;
    run(game, 30, () => {
      minX = Math.min(minX, vehicle.position.x);
      maxX = Math.max(maxX, vehicle.position.x);
      maxSlip = Math.max(maxSlip, Math.abs(vehicle.slip));
      return Math.abs(vehicle.heading - start) >= Math.PI * 2;
    });
    return (maxX - minX) / 2;
  };
  const slowTurnRadius = circle(0.25);
  const fastTurnRadius = circle(1);
  const powerSlideDegrees = (maxSlip * 180) / Math.PI;

  // U-turn from top speed.
  park(game, -200, 180);
  setInput(app, 0, 1);
  run(game, 6, () => false);
  setInput(app, 1, 1);
  const turnStart = vehicle.heading;
  const uTurnSeconds = run(game, 20, () => Math.abs(vehicle.heading - turnStart) >= Math.PI);

  // Handbrake turn of 90° from top speed, as at a street corner.
  park(game, -200, 180);
  setInput(app, 0, 1);
  run(game, 6, () => false);
  setInput(app, 1, 0);
  app.scripted.brake = true;
  const handbrakeStart = vehicle.heading;
  const handbrakeTurnSeconds = run(
    game,
    20,
    () => Math.abs(vehicle.heading - handbrakeStart) >= Math.PI / 2,
  );
  const handbrakeTurnKmh = Math.hypot(vehicle.impactVelocity.x, vehicle.impactVelocity.z) * 3.6;
  app.scripted.brake = false;

  const slalom = driveSlalom(app, game);
  setInput(app, 0, 0);

  return {
    vehicle: spec.name,
    topSpeedKmh: round(topSpeed * 3.6, 0),
    toTopSpeedSeconds: round(toTopSpeedSeconds, 2),
    stoppingMetres: round(stoppingMetres),
    stoppingSeconds: round(stoppingSeconds, 2),
    slowTurnRadius: round(slowTurnRadius),
    fastTurnRadius: round(fastTurnRadius),
    uTurnSeconds: round(uTurnSeconds, 2),
    powerSlideDegrees: round(powerSlideDegrees, 0),
    handbrakeTurnSeconds: round(handbrakeTurnSeconds, 2),
    handbrakeTurnKmh: round(handbrakeTurnKmh, 0),
    slalomSeconds: round(slalom.seconds, 2),
    slalomConesHit: slalom.conesHit,
    slalomKmh: round(slalom.kmh, 0),
  };
}

/**
 * Drives the wide slalom with a simple driver model: it steers at a point ahead on a sine line
 * around the cones, and holds the speed that the vehicle's grip allows on that line.
 */
function driveSlalom(app: App, game: Game): { seconds: number; conesHit: number; kmh: number } {
  const vehicle = game.activeVehicle;
  const { spec } = vehicle;
  const amplitude = spec.width / 2 + SLALOM_CLEARANCE;
  const wave = Math.PI / SLALOM.spacing;
  /** Sideways offset of the line at a place along the lane. It peaks beside each cone. */
  const offsetAt = (x: number): number => amplitude * Math.cos((x - SLALOM.firstX) * wave);
  const speedLimit = Math.sqrt((spec.cornering * SLALOM_GRIP_SHARE) / (amplitude * wave * wave));

  const startX = SLALOM.firstX - 30;
  const endX = SLALOM.lastX + 10;
  vehicle.teleport([startX, SLALOM.z + offsetAt(startX)], 0);
  game.cones?.reset();

  const seconds = run(game, 90, () => {
    const { x, z } = vehicle.position;
    const reach = clamp(Math.abs(vehicle.forwardSpeed) * 0.3, 5, 14);
    const targetX = x + reach;
    const targetZ = SLALOM.z + offsetAt(targetX);
    const error = wrapAngle(Math.atan2(targetZ - z, targetX - x) - vehicle.heading);
    app.scripted.steer = clamp(error * 3, -1, 1);
    app.scripted.throttle = vehicle.forwardSpeed < speedLimit ? 1 : 0;
    return x >= endX;
  });
  const conesHit = game.cones?.knockedCount ?? 0;
  return { seconds, conesHit, kmh: ((endX - startX) / seconds) * 3.6 };
}
