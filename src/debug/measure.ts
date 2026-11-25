import type { App } from '../app';
import { STEP_SECONDS } from '../engine/loop';
import type { Game } from '../game/game';
import type { VehicleType } from '../game/level';
import { clamp, wrapAngle } from '../game/math';
import { VEHICLE_TYPES } from '../game/vehicles/specs';
import { HAULER_WIDTH } from '../game/route';
import { ramDamage } from '../game/world/damage';
import { REFERENCE_STREET_END_X, REFERENCE_STREET_START_X, REFERENCE_STREET_Z } from '../game/yard';

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

/** What the destruction measurement reports for one vehicle. */
export interface RamRow {
  vehicle: string;
  /** Speed of the ram in km/h: three quarters of the top speed. */
  ramKmh: number;
  /** Hit points of the house and the damage of the ram. */
  houseHp: number;
  damage: number;
  /** True when one ram broke the house. */
  broke: boolean;
  /**
   * The lowest speed in the 0.3 seconds after the break, as a share of the speed before it. A ram
   * that breaks the house should keep nearly all of the speed.
   */
  keptShare: number;
}

/**
 * Rams one house of the downtown street with each vehicle, at three quarters of the top speed,
 * and reports whether one ram breaks it. The measurement destroys three houses. Reset the yard
 * afterwards.
 */
export function measureRams(app: App): RamRow[] {
  const game = app.game;
  if (game?.level.id !== 'yard' || game.phase !== 'playing') {
    console.warn('The ram measurement needs a running test yard. Open ?yard&debug.');
    return [];
  }
  const original = game.activeVehicle.spec.type;
  const rows = VEHICLE_TYPES.map((type): RamRow => {
    app.setVehicle(type);
    const vehicle = game.activeVehicle;
    const { spec } = vehicle;
    // A standing house on the north side of the downtown street. The vehicle comes from the open
    // ground north of it.
    const house = game.buildings.list.find(
      (building) =>
        building.kind === 'house' &&
        building.standing(0) &&
        Math.abs(building.center[1] - 119) < 1 &&
        building.center[0] > -200 &&
        building.center[0] < -130,
    );
    if (!house) {
      return { vehicle: spec.name, ramKmh: 0, houseHp: 0, damage: 0, broke: false, keptShare: 0 };
    }
    const [x, z] = house.center;
    const target = spec.topSpeed * 0.75;
    let damage = 0;
    const off = game.events.on('impact', () => {
      const { x: vx, z: vz } = vehicle.impactVelocity;
      damage = ramDamage(spec.ram, Math.hypot(vx, vz), spec.topSpeed) * spec.blade;
    });
    vehicle.teleport([x, z - 30], Math.PI / 2);
    let speedBefore = 0;
    run(game, 8, () => {
      setInput(app, 0, vehicle.forwardSpeed < target ? 1 : 0);
      const done = !house.standing(0) || vehicle.position.z > z;
      if (!done) {
        speedBefore = vehicle.forwardSpeed;
      }
      return done;
    });
    off();
    // Drive on at the same speed and record the lowest speed after the break.
    let lowest = vehicle.forwardSpeed;
    run(game, 0.3, () => {
      setInput(app, 0, vehicle.forwardSpeed < target ? 1 : 0);
      lowest = Math.min(lowest, vehicle.forwardSpeed);
      return false;
    });
    setInput(app, 0, 0);
    // Let the debris settle, so that it does not slow the next vehicle.
    run(game, 4.5, () => false);
    return {
      vehicle: spec.name,
      ramKmh: round(target * 3.6, 0),
      houseHp: round(house.maxHp[0], 0),
      damage: round(damage, 0),
      broke: !house.standing(0),
      keptShare: round(lowest / Math.max(speedBefore, 1e-6), 2),
    };
  });
  app.setVehicle(original);
  park(game, game.level.spawn.pos[0], game.level.spawn.pos[1]);
  console.table(rows);
  return rows;
}

/** What the reference street measurement reports for one vehicle. */
export interface StreetRow {
  vehicle: string;
  /** Seconds from the start line until the last building section in the street broke. */
  seconds: number;
  /** True when every building section that reaches into the strip broke. */
  cleared: boolean;
  /** Building sections in the strip that still stand at the end. */
  left: number;
  /** Boosts, rockets or seconds with the flail's chain out that the driver model used. */
  weaponUses: number;
  /** Number of times that the driver drove along the street. */
  passes: number;
  /** The sections that the first pass missed, with the X of each section. */
  firstPassMissed: string;
  /** The buildings whose sections still stand in the street, with the X of the section. */
  missed: string;
}

/** The driver model gives up after this many seconds. */
const STREET_LIMIT_SECONDS = 90;
/** A piece blocks the strip when it reaches at least this far into it, in metres. */
const STRIP_OVERLAP = 0.5;
/** A turn at the end of the street counts this many seconds. */
const TURN_SECONDS = 3;
/** Half the width of the strip to clear: the strip of the carrier. */
const CLEAR_HALF_WIDTH = HAULER_WIDTH / 2 + 0.4;

/**
 * Drives each vehicle along the reference street of the test yard and measures how long it
 * takes to clear a strip as wide as the carrier's. A simple driver model steers towards the next
 * building section in the strip and uses the weapon: the bulldozer boosts when a section is near,
 * the flail car lets its chain out near a building, and the buggy fires when a section lies
 * ahead. At the end of the street, the driver turns and drives back for the
 * sections that it missed. A turn counts `TURN_SECONDS`.
 *
 * The measurement reloads the yard before each vehicle and once more at the end.
 */
export async function measureStreet(app: App): Promise<StreetRow[]> {
  if (app.game?.level.id !== 'yard') {
    console.warn('The street measurement needs the test yard. Open ?yard&debug.');
    return [];
  }
  const original = app.game.activeVehicle.spec.type;
  const rows: StreetRow[] = [];
  for (const type of VEHICLE_TYPES) {
    const game = await app.loadLevel();
    game.start();
    app.setVehicle(type);
    rows.push(driveStreet(app, game));
  }
  setInput(app, 0, 0);
  app.scripted.action = false;
  const game = await app.loadLevel();
  game.start();
  app.setVehicle(original);
  console.table(rows);
  return rows;
}

function driveStreet(app: App, game: Game): StreetRow {
  const vehicle = game.activeVehicle;
  const z = REFERENCE_STREET_Z;
  const half = CLEAR_HALF_WIDTH;
  // Every column of a building that reaches into the strip to clear.
  const targets = game.buildings.list.flatMap((building) =>
    building.pieces.flatMap((piece, index) => {
      const xs = piece.polygon.map((p) => p[0]);
      const zs = piece.polygon.map((p) => p[1]);
      // A piece that only grazes the edge of the strip does not block it.
      const inStrip =
        Math.min(...zs) < z + half - STRIP_OVERLAP &&
        Math.max(...zs) > z - half + STRIP_OVERLAP &&
        Math.max(...xs) > REFERENCE_STREET_START_X &&
        Math.min(...xs) < REFERENCE_STREET_END_X;
      const target = {
        building,
        index,
        x: piece.center.x,
        z: piece.center.z,
        near: Math.min(...zs),
        far: Math.max(...zs),
      };
      return inStrip ? [target] : [];
    }),
  );
  const left = (): typeof targets => targets.filter((t) => t.building.standing(t.index));
  vehicle.teleport([REFERENCE_STREET_START_X - 20, z], 0);

  let direction = 1;
  let passes = 1;
  let firstPassMissed = '';
  let uses = 0;
  let time = 0;
  let lastBreak = 0;
  let lastLeft = targets.length;
  let wasHeld = false;
  run(game, STREET_LIMIT_SECONDS, () => {
    time += STEP_SECONDS;
    const standing = left();
    if (standing.length !== lastLeft) {
      lastBreak = time;
      lastLeft = standing.length;
    }
    if (standing.length === 0) {
      return true;
    }
    const { x } = vehicle.position;
    const along = (t: { x: number }): number => (t.x - x) * direction;
    const ahead = standing.filter((t) => along(t) > -3).sort((a, b) => along(a) - along(b));
    const beyond =
      direction > 0 ? x > REFERENCE_STREET_END_X + 10 : x < REFERENCE_STREET_START_X - 10;
    if (ahead.length === 0 || beyond) {
      // Turn round for the sections that were missed.
      if (passes === 1) {
        firstPassMissed = standing
          .map((t) => `${t.building.name} ${Math.round(t.x)}/${Math.round(t.z)}`)
          .join(', ');
      }
      direction = -direction;
      passes += 1;
      vehicle.teleport([x, z], direction > 0 ? 0 : Math.PI);
      time += TURN_SECONDS;
      return false;
    }
    // Steer towards the next section, kept within the street.
    const next = ahead[0];
    const distance = along(next);
    // Swerve only as far as the vehicle's reach needs: the blade or the body.
    const reach = Math.max(vehicle.spec.width, vehicle.spec.bladeWidth) / 2;
    // The gap between the centre of the street and the nearest edge of the section.
    const offset = next.near > z ? next.near - z : next.far < z ? next.far - z : 0;
    const swerve = Math.sign(offset) * Math.max(0, Math.abs(offset) - reach + 1);
    const lane = distance < 45 ? clamp(z + swerve, z - half + 1, z + half - 1) : z;
    const forward = direction > 0 ? 0 : Math.PI;
    const wanted = forward + Math.atan2((lane - vehicle.position.z) * direction, 18);
    const steer = clamp(wrapAngle(wanted - vehicle.heading) * 2.5, -1, 1);

    const type = vehicle.spec.type;
    const status = game.weaponStatus;
    const throttle = 1;
    let held: boolean;
    if (type === 'flail') {
      // The driver lets the chain out near buildings. The ball mostly follows behind on a
      // straight line, so the car does most of the work with its rams.
      held = distance < 35;
      if (held) {
        uses += STEP_SECONDS;
      }
    } else if (type === 'dozer') {
      held = distance < 30 && status.ready;
    } else {
      held = distance > 12 && distance < 70 && status.ready && !wasHeld;
    }
    if (held && !wasHeld && type !== 'flail') {
      app.scripted.press('action');
      uses += 1;
    }
    app.scripted.action = held;
    wasHeld = held;
    setInput(app, steer, throttle);
    return false;
  });
  app.scripted.action = false;
  const remaining = left();
  return {
    vehicle: vehicle.spec.name,
    seconds: round(remaining.length === 0 ? lastBreak : time, 1),
    cleared: remaining.length === 0,
    left: remaining.length,
    weaponUses: round(uses, 1),
    passes,
    firstPassMissed,
    missed: remaining.map((t) => `${t.building.name} ${Math.round(t.x)}`).join(', '),
  };
}
