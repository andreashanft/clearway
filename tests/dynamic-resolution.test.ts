import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../src/engine/dynamic-resolution';

/** Feeds `seconds` of frames lasting `ms` each; returns every scale change. */
function run(dr: DynamicResolution, ms: number, seconds: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const scale = dr.update(ms / 1000);
    if (scale !== null) changes.push(scale);
  }
  return changes;
}

describe('DynamicResolution', () => {
  it('drops by 10% steps while frames take longer than 18 ms', () => {
    const dr = new DynamicResolution();
    expect(run(dr, 16.7, 3)).toEqual([]);
    expect(run(dr, 25, 1.2)).toEqual([0.9, 0.8]);
  });

  it('never drops below half resolution', () => {
    const dr = new DynamicResolution();
    run(dr, 40, 20);
    expect(dr.scale).toBe(0.5);
  });

  it('recovers below 14 ms', () => {
    const dr = new DynamicResolution();
    run(dr, 25, 0.8);
    expect(dr.scale).toBe(0.9);
    expect(run(dr, 10, 2.5)).toEqual([1]);
  });

  it('probes upward on a 60 Hz display, and backs off when the probe fails', () => {
    const dr = new DynamicResolution();
    run(dr, 25, 0.8);
    expect(dr.scale).toBe(0.9);
    // Locked at 16.7 ms: never under 14 ms, so only a probe can raise the scale.
    expect(run(dr, 16.7, 7)).toEqual([1]);
    expect(run(dr, 25, 0.8)).toEqual([0.9]);
    expect(run(dr, 16.7, 7)).toEqual([]);
    expect(run(dr, 16.7, 6)).toEqual([1]);
  });

  it('ignores hitches such as a tab switch', () => {
    const dr = new DynamicResolution();
    expect(dr.update(2)).toBeNull();
    expect(dr.scale).toBe(1);
  });
});
