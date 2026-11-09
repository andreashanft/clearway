import { describe, expect, it } from 'vitest';
import {
  bearingToHeading,
  PointToDrive,
  REVERSE_ANGLE,
  stickToHeading,
  wrapAngle,
} from '../src/game/drive';

const DEG = Math.PI / 180;
const NORTH = Math.PI;
const EAST = Math.PI / 2;

describe('wrapAngle', () => {
  it('wraps into (−π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle((-3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });
});

describe('bearingToHeading', () => {
  it('maps compass bearings onto headings', () => {
    expect(bearingToHeading(0)).toBeCloseTo(NORTH);
    expect(bearingToHeading(90)).toBeCloseTo(EAST);
    expect(bearingToHeading(180)).toBeCloseTo(0);
    expect(bearingToHeading(270)).toBeCloseTo(-EAST);
  });
});

describe('stickToHeading', () => {
  it('points stick-up north and stick-right east with the default camera', () => {
    expect(stickToHeading(0, 1, 0)).toBeCloseTo(NORTH);
    expect(stickToHeading(1, 0, 0)).toBeCloseTo(EAST);
    expect(stickToHeading(0, -1, 0)).toBeCloseTo(0);
  });

  it('follows the camera when it rotates', () => {
    // Camera turned 90° about +y: it now looks west, so stick-up means west.
    expect(wrapAngle(stickToHeading(0, 1, Math.PI / 2))).toBeCloseTo(-EAST);
  });
});

describe('PointToDrive', () => {
  it('drives straight ahead at full throttle when already aligned', () => {
    const drive = new PointToDrive();
    const out = drive.update(NORTH, NORTH, 1);
    expect(out.steer).toBeCloseTo(0);
    expect(out.throttle).toBeCloseTo(1);
  });

  it('steers right towards a target clockwise of the heading', () => {
    const drive = new PointToDrive();
    // Facing north, target east: east is clockwise, so steer right.
    const out = drive.update(NORTH, EAST, 1);
    expect(out.steer).toBeGreaterThan(0.9);
    expect(out.throttle).toBeGreaterThan(0);
    expect(out.throttle).toBeLessThan(1);
  });

  it('steers left towards a target anticlockwise of the heading', () => {
    const drive = new PointToDrive();
    const out = drive.update(NORTH, NORTH + 10 * DEG, 1);
    expect(out.steer).toBeLessThan(0);
    expect(out.steer).toBeGreaterThan(-1);
  });

  it('scales throttle with stick length and stops when released', () => {
    const drive = new PointToDrive();
    expect(drive.update(0, 0, 0.5).throttle).toBeCloseTo(0.5);
    expect(drive.update(0, 0, 0)).toEqual({ steer: 0, throttle: 0 });
  });

  it('reverses past 150° and holds reverse until the angle falls below 120°', () => {
    const drive = new PointToDrive();
    const behind = drive.update(0, REVERSE_ANGLE + 5 * DEG, 1);
    expect(behind.throttle).toBeLessThan(0);
    expect(drive.isReversing).toBe(true);
    // 135° would drive forward from rest, but reverse holds through the hysteresis band.
    expect(drive.update(0, 135 * DEG, 1).throttle).toBeLessThan(0);
    expect(drive.update(0, 110 * DEG, 1).throttle).toBeGreaterThan(0);
    expect(drive.isReversing).toBe(false);
  });

  it('swings the rear towards the target while reversing', () => {
    const drive = new PointToDrive();
    // Facing south (0); target just west of north. The rear faces north, so the rear must
    // turn anticlockwise (towards west), which in reverse needs right-hand steering lock.
    const out = drive.update(0, NORTH + 10 * DEG, 1);
    expect(out.throttle).toBeLessThan(0);
    expect(out.steer).toBeGreaterThan(0);
  });
});
