import { describe, expect, it } from 'vitest';
import { PointToDrive } from '../src/game/vehicles/drive-control';

const DEG = Math.PI / 180;

describe('PointToDrive', () => {
  it('does nothing while the stick is released', () => {
    const command = new PointToDrive().update(0, 0.05, 0);
    expect(command).toEqual({ throttle: 0, steer: 0, brake: false });
  });

  it('drives straight ahead when the stick points along the heading', () => {
    const command = new PointToDrive().update(30 * DEG, 1, 30 * DEG);
    expect(command.throttle).toBeCloseTo(1);
    expect(command.steer).toBeCloseTo(0);
  });

  it('steers right towards a heading that lies clockwise', () => {
    const command = new PointToDrive().update(20 * DEG, 1, 0);
    expect(command.steer).toBeGreaterThan(0);
    expect(command.throttle).toBeGreaterThan(0);
  });

  it('takes the short way round across the ±180° seam', () => {
    const command = new PointToDrive().update(-170 * DEG, 1, 170 * DEG);
    expect(command.steer).toBeGreaterThan(0);
  });

  it('eases off the throttle in a sharp turn', () => {
    const sharp = new PointToDrive().update(120 * DEG, 1, 0);
    const gentle = new PointToDrive().update(10 * DEG, 1, 0);
    expect(sharp.throttle).toBeLessThan(gentle.throttle);
    expect(sharp.steer).toBe(1);
  });

  it('reverses when the stick points behind the vehicle', () => {
    const command = new PointToDrive().update(180 * DEG, 1, 0);
    expect(command.throttle).toBeCloseTo(-1);
  });

  it('steers in reverse so that the rear swings towards the stick', () => {
    // The stick points 170° clockwise, so the rear must swing 10° anticlockwise of straight back.
    // The heading has to turn anticlockwise. In reverse that needs the wheel to the right.
    const command = new PointToDrive().update(170 * DEG, 1, 0);
    expect(command.throttle).toBeLessThan(0);
    expect(command.steer).toBeGreaterThan(0);
  });

  it('keeps reversing until the stick clearly points forwards again', () => {
    const control = new PointToDrive();
    control.update(180 * DEG, 1, 0);
    expect(control.update(120 * DEG, 1, 0).throttle).toBeLessThan(0);
    expect(control.update(90 * DEG, 1, 0).throttle).toBeGreaterThan(0);
  });

  it('scales the throttle with the stick deflection', () => {
    const half = new PointToDrive().update(0, 0.56, 0);
    expect(half.throttle).toBeCloseTo(0.5);
  });
});
