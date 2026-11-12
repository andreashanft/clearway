import { describe, expect, it } from 'vitest';
import { FixedStepper, FrameStats, STEP_SECONDS } from '../src/engine/loop';

describe('FixedStepper', () => {
  it('runs one step for one step of time', () => {
    const stepper = new FixedStepper();
    let steps = 0;
    stepper.advance(STEP_SECONDS, () => (steps += 1));
    expect(steps).toBe(1);
  });

  it('carries leftover time into the next frame', () => {
    const stepper = new FixedStepper();
    let steps = 0;
    const alpha = stepper.advance(STEP_SECONDS * 1.5, () => (steps += 1));
    expect(steps).toBe(1);
    expect(alpha).toBeCloseTo(0.5);
    stepper.advance(STEP_SECONDS * 0.5, () => (steps += 1));
    expect(steps).toBe(2);
  });

  it('passes the fixed step length to the callback', () => {
    const stepper = new FixedStepper();
    const lengths: number[] = [];
    stepper.advance(STEP_SECONDS * 3, (dt) => lengths.push(dt));
    expect(lengths).toEqual([STEP_SECONDS, STEP_SECONDS, STEP_SECONDS]);
  });

  it('limits the steps of a very long frame', () => {
    const stepper = new FixedStepper();
    let steps = 0;
    stepper.advance(10, () => (steps += 1));
    expect(steps).toBe(5);
    // The backlog is dropped, so the next normal frame runs a normal number of steps.
    steps = 0;
    stepper.advance(STEP_SECONDS, () => (steps += 1));
    expect(steps).toBeLessThanOrEqual(2);
  });

  it('applies the time scale', () => {
    const stepper = new FixedStepper();
    stepper.timeScale = 0.25;
    let steps = 0;
    for (let frame = 0; frame < 8; frame += 1) {
      stepper.advance(STEP_SECONDS, () => (steps += 1));
    }
    expect(steps).toBe(2);
  });

  it('does not step while paused', () => {
    const stepper = new FixedStepper();
    stepper.paused = true;
    let steps = 0;
    stepper.advance(1, () => (steps += 1));
    expect(steps).toBe(0);
  });

  it('ignores negative frame times', () => {
    const stepper = new FixedStepper();
    let steps = 0;
    stepper.advance(-1, () => (steps += 1));
    expect(steps).toBe(0);
  });
});

describe('FrameStats', () => {
  it('converges on a steady frame time', () => {
    const stats = new FrameStats();
    for (let frame = 0; frame < 200; frame += 1) {
      stats.sample(1 / 30);
    }
    expect(stats.frameMs).toBeCloseTo(33.3, 0);
    expect(stats.fps).toBeCloseTo(30, 0);
  });
});
