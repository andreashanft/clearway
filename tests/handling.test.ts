import { describe, expect, it } from 'vitest';
import {
  NO_COMMAND,
  driveSpeed,
  fullLockTurnRate,
  nextSlide,
  shapeSteering,
  slideTurnRate,
  tyreVelocity,
  type DriveCommand,
} from '../src/game/vehicles/handling';
import { VEHICLE_SPECS, VEHICLE_TYPES } from '../src/game/vehicles/specs';

const DT = 1 / 60;
const { buggy, dozer, flail } = VEHICLE_SPECS;

const pedal = (throttle: number): DriveCommand => ({ ...NO_COMMAND, throttle });

/** Steps the speed until `done`, and returns the seconds and the metres that it took. */
function drive(
  spec: typeof buggy,
  from: number,
  command: DriveCommand,
  done: (speed: number) => boolean,
): { seconds: number; metres: number; speed: number } {
  let speed = from;
  let metres = 0;
  let steps = 0;
  while (!done(speed) && steps < 60 * 60) {
    speed = driveSpeed(spec, speed, command, DT);
    metres += speed * DT;
    steps += 1;
  }
  return { seconds: steps * DT, metres, speed };
}

describe('driveSpeed', () => {
  it.each(VEHICLE_TYPES)('brings the %s to its top speed in under two seconds', (type) => {
    const spec = VEHICLE_SPECS[type];
    const run = drive(spec, 0, pedal(1), (speed) => speed >= spec.topSpeed);
    expect(run.seconds).toBeLessThan(2);
    expect(run.speed).toBeCloseTo(spec.topSpeed);
  });

  it('never exceeds the top speed', () => {
    const run = drive(buggy, 0, pedal(1), () => false);
    expect(run.speed).toBeCloseTo(buggy.topSpeed);
  });

  it.each(VEHICLE_TYPES)('stops the %s from top speed within 20 m', (type) => {
    const spec = VEHICLE_SPECS[type];
    const run = drive(spec, spec.topSpeed, pedal(-1), (speed) => speed <= 0);
    expect(run.metres).toBeLessThan(20);
  });

  it('brakes with the brake pedal first and reverses only from a standstill', () => {
    const afterOneStep = driveSpeed(flail, 20, pedal(-1), DT);
    expect(afterOneStep).toBeCloseTo(20 - flail.braking * DT);
    const reversing = drive(flail, 0, pedal(-1), () => false);
    expect(reversing.speed).toBeCloseTo(-flail.reverseSpeed);
  });

  it('holds the vehicle with the handbrake and never reverses it', () => {
    const run = drive(flail, 20, { throttle: 1, steer: 0, brake: true }, () => false);
    expect(run.speed).toBe(0);
  });

  it('brakes more gently with the handbrake than with the brake pedal', () => {
    const handbrake = { ...NO_COMMAND, brake: true };
    for (const type of VEHICLE_TYPES) {
      const spec = VEHICLE_SPECS[type];
      expect(driveSpeed(spec, 20, handbrake, DT)).toBeGreaterThan(
        driveSpeed(spec, 20, pedal(-1), DT),
      );
    }
  });

  it('never brakes a sliding vehicle that has the throttle held', () => {
    const sideways = buggy.topSpeed * 1.1;
    expect(driveSpeed(buggy, 10, pedal(1), DT, sideways)).toBeGreaterThan(
      10 - buggy.coasting * DT * 1.01,
    );
  });

  it('keeps the total speed of a sliding vehicle at its top speed', () => {
    const sideways = buggy.topSpeed * 0.6;
    let forward = 0;
    for (let step = 0; step < 600; step += 1) {
      forward = driveSpeed(buggy, forward, pedal(1), DT, sideways);
    }
    expect(Math.hypot(forward, sideways)).toBeCloseTo(buggy.topSpeed);
  });

  it('rolls out without a pedal', () => {
    const run = drive(buggy, 30, NO_COMMAND, (speed) => speed <= 0);
    expect(run.seconds).toBeCloseTo(30 / buggy.coasting, 1);
  });

  it('makes the buggy the fastest and the bulldozer the slowest', () => {
    expect(buggy.topSpeed).toBeGreaterThan(flail.topSpeed);
    expect(flail.topSpeed).toBeGreaterThan(dozer.topSpeed);
  });
});

describe('fullLockTurnRate', () => {
  it('drives a wheeled vehicle on its turning circle at low speed', () => {
    const speed = 6;
    expect(speed / fullLockTurnRate(buggy, speed)).toBeCloseTo(buggy.turnRadius);
    expect(speed / fullLockTurnRate(flail, speed)).toBeCloseTo(flail.turnRadius);
  });

  it('does not turn a wheeled vehicle that stands still', () => {
    expect(fullLockTurnRate(buggy, 0)).toBe(0);
  });

  it.each(VEHICLE_TYPES)('never asks the %s for more sideways grip than it has', (type) => {
    const spec = VEHICLE_SPECS[type];
    for (let speed = 0.5; speed <= spec.topSpeed; speed += 0.5) {
      const sideways = speed * fullLockTurnRate(spec, speed);
      expect(sideways).toBeLessThanOrEqual(spec.cornering + 1e-9);
    }
  });

  it('widens the turn at top speed, so that a fast vehicle stays stable', () => {
    const radius = buggy.topSpeed / fullLockTurnRate(buggy, buggy.topSpeed);
    expect(radius).toBeCloseTo((buggy.topSpeed * buggy.topSpeed) / buggy.cornering);
    expect(radius).toBeGreaterThan(buggy.turnRadius * 3);
  });

  it('turns a tracked vehicle on the spot', () => {
    expect(fullLockTurnRate(dozer, 0)).toBe(dozer.pivotRate);
  });

  it('swings the rear towards the steering side in reverse, like a car', () => {
    expect(fullLockTurnRate(buggy, -6)).toBeLessThan(0);
    expect(fullLockTurnRate(dozer, -6)).toBeLessThan(0);
  });
});

describe('nextSlide', () => {
  const handbrake: DriveCommand = { throttle: 0, steer: 1, brake: true };
  const fullLock: DriveCommand = { throttle: 1, steer: 1, brake: false };

  /** Steps the slide for a number of seconds at a fixed speed and steering wheel position. */
  function slideAfter(
    spec: typeof buggy,
    seconds: number,
    forward: number,
    steering: number,
    command: DriveCommand,
    from = 0,
  ): number {
    let slide = from;
    for (let step = 0; step < Math.round(seconds / DT); step += 1) {
      slide = nextSlide(spec, slide, forward, steering, command, DT);
    }
    return slide;
  }

  it('starts a full slide with the handbrake within a quarter of a second', () => {
    expect(slideAfter(buggy, 0.25, 20, 1, handbrake)).toBe(1);
  });

  it('does not slide at walking pace or in reverse', () => {
    expect(slideAfter(buggy, 1, 2, 1, handbrake)).toBe(0);
    expect(slideAfter(buggy, 1, -10, 1, handbrake)).toBe(0);
  });

  it('starts a slide from a fast turn at full lock with the throttle held', () => {
    expect(slideAfter(buggy, 1, buggy.topSpeed, 1, fullLock)).toBe(1);
  });

  it('keeps the grip in a short steering correction at speed', () => {
    expect(slideAfter(buggy, 0.1, buggy.topSpeed, 1, fullLock)).toBeLessThan(0.3);
  });

  it('keeps the grip below the slide speed, without the throttle and away from full lock', () => {
    expect(slideAfter(buggy, 1, buggy.slideSpeed * 0.9, 1, fullLock)).toBe(0);
    expect(slideAfter(buggy, 1, buggy.topSpeed, 1, { ...fullLock, throttle: 0 })).toBe(0);
    expect(slideAfter(buggy, 1, buggy.topSpeed, 0.5, fullLock)).toBe(0);
  });

  it('holds a slide that has set in down to a lower speed', () => {
    expect(slideAfter(buggy, 0.2, buggy.slideSpeed * 0.8, 1, fullLock, 1)).toBe(1);
  });

  it('fades a slide out near standstill', () => {
    expect(slideAfter(buggy, 0.5, 5, 1, handbrake, 1)).toBeLessThan(0.5);
  });

  it('gives the grip back within half a second once nothing holds the slide', () => {
    expect(slideAfter(buggy, 0.5, 20, 0, NO_COMMAND, 1)).toBe(0);
  });
});

describe('tyreVelocity', () => {
  /** Applies the tyres for a number of seconds and returns the velocity. */
  function after(seconds: number, forward: number, sideways: number, slide: number) {
    let velocity = { forward, sideways };
    for (let step = 0; step < Math.round(seconds / DT); step += 1) {
      velocity = tyreVelocity(buggy, velocity.forward, velocity.sideways, slide, DT);
    }
    return velocity;
  }

  it('stops sideways motion quickly while the tyres grip', () => {
    expect(Math.abs(after(0.25, 20, 10, 0).sideways)).toBeLessThan(0.2);
  });

  it('lets a sliding vehicle drift on', () => {
    expect(after(0.1, 20, 10, 1).sideways).toBeGreaterThan(5);
  });

  it('turns the direction of travel towards the heading in a slide', () => {
    const velocity = after(0.3, 20, 10, 1);
    expect(Math.atan2(velocity.sideways, velocity.forward)).toBeLessThan(Math.atan2(10, 20));
  });

  it('keeps most of the speed in a slide', () => {
    const velocity = after(0.5, 20, 10, 1);
    expect(Math.hypot(velocity.forward, velocity.sideways)).toBeGreaterThan(
      Math.hypot(20, 10) * 0.85,
    );
  });

  it('never turns sideways motion around', () => {
    expect(after(2, 20, 4, 1).sideways).toBeGreaterThanOrEqual(0);
    expect(after(2, 20, -4, 1).sideways).toBeLessThanOrEqual(0);
  });

  it('lets a reversing vehicle grip', () => {
    const velocity = tyreVelocity(buggy, -5, 1, 1, DT);
    expect(velocity.forward).toBe(-5);
    expect(Math.abs(velocity.sideways)).toBeLessThan(1);
  });

  it('lets the buggy slide furthest and the bulldozer least', () => {
    expect(buggy.slideAngle).toBeGreaterThan(flail.slideAngle);
    expect(flail.slideAngle).toBeGreaterThan(dozer.slideAngle);
  });
});

describe('slideTurnRate', () => {
  it('swings the nose towards the steering side', () => {
    expect(slideTurnRate(buggy, 0, 0, 1)).toBeGreaterThan(0);
    expect(slideTurnRate(buggy, 0, 0, -1)).toBeLessThan(0);
  });

  it('holds the slip angle that full lock asks for while the direction of travel turns', () => {
    expect(slideTurnRate(buggy, buggy.slideAngle, 1.2, 1)).toBeCloseTo(1.2);
  });

  it('straightens the vehicle out when the driver steers to the centre', () => {
    expect(slideTurnRate(buggy, 0.4, 0, 0)).toBeLessThan(0);
  });

  it('limits the turn rate', () => {
    expect(Math.abs(slideTurnRate(buggy, -3, 0, 1))).toBeLessThanOrEqual(5);
  });
});

describe('shapeSteering', () => {
  it('keeps the centre, the full lock and the sign', () => {
    expect(shapeSteering(0)).toBe(0);
    expect(shapeSteering(1)).toBe(1);
    expect(shapeSteering(-1)).toBe(-1);
    expect(shapeSteering(-0.5)).toBeLessThan(0);
  });

  it('steers more finely near the centre', () => {
    expect(shapeSteering(0.3)).toBeLessThan(0.3);
    expect(shapeSteering(0.3)).toBeGreaterThan(0);
  });

  it('limits the input to full lock', () => {
    expect(shapeSteering(3)).toBe(1);
  });
});
