import { describe, expect, it } from 'vitest';
import {
  NO_COMMAND,
  driveSpeed,
  fullLockTurnRate,
  shapeSteering,
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
