import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/engine/clock';

const STEP = 1 / 60;

describe('FixedStepClock', () => {
  it('runs one step per 60 Hz frame', () => {
    const clock = new FixedStepClock();
    const result = clock.advance(STEP);
    expect(result.steps).toBe(1);
    expect(result.alpha).toBeCloseTo(0, 6);
    expect(result.dropped).toBe(false);
  });

  it('accumulates short frames until a whole step is due', () => {
    const clock = new FixedStepClock();
    // A 120 Hz display: every other frame runs one step.
    expect(clock.advance(STEP / 2).steps).toBe(0);
    expect(clock.advance(STEP / 2).steps).toBe(1);
  });

  it('reports the leftover fraction as the interpolation alpha', () => {
    const clock = new FixedStepClock();
    const result = clock.advance(STEP * 2.25);
    expect(result.steps).toBe(2);
    expect(result.alpha).toBeCloseTo(0.25, 6);
  });

  it('caps steps per frame and drops the excess backlog', () => {
    const clock = new FixedStepClock({ maxStepsPerFrame: 4 });
    const slow = clock.advance(STEP * 20);
    expect(slow.steps).toBe(4);
    expect(slow.dropped).toBe(true);
    // At most one step of backlog survives into the next frame.
    expect(clock.advance(0).steps).toBeLessThanOrEqual(1);
  });

  it('keeps simulated time equal to real time over many uneven frames', () => {
    const clock = new FixedStepClock();
    const frames = [0.016, 0.017, 0.015, 0.02, 0.012, 0.0167];
    let real = 0;
    let steps = 0;
    for (let i = 0; i < 600; i++) {
      const frame = frames[i % frames.length] ?? 0;
      real += frame;
      steps += clock.advance(frame).steps;
    }
    expect(Math.abs(steps * STEP - real)).toBeLessThan(STEP);
  });

  it('scales time for slow motion and stops at time scale zero', () => {
    const clock = new FixedStepClock();
    clock.timeScale = 0.5;
    expect(clock.advance(STEP).steps).toBe(0);
    expect(clock.advance(STEP).steps).toBe(1);
    clock.timeScale = 0;
    expect(clock.advance(1).steps).toBe(0);
  });

  it('ignores negative frame times and clears the backlog on reset', () => {
    const clock = new FixedStepClock();
    expect(clock.advance(-1).steps).toBe(0);
    clock.advance(STEP * 0.9);
    clock.reset();
    expect(clock.advance(STEP * 0.5).steps).toBe(0);
  });

  it('rejects a non-positive step rate', () => {
    expect(() => new FixedStepClock({ stepHz: 0 })).toThrow(RangeError);
  });
});
