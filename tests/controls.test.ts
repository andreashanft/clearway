import { describe, expect, it } from 'vitest';
import { shapeStick } from '../src/engine/input/controls';
import { TouchState } from '../src/engine/input/touch-state';

describe('shapeStick', () => {
  it('ignores input inside the dead zone', () => {
    expect(shapeStick(0.1, 0.05, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('rescales so the edge of the dead zone reads as zero and the rim as one', () => {
    const just = shapeStick(0.21, 0, 0.2);
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.05);
    expect(shapeStick(1, 0, 0.2).x).toBeCloseTo(1);
  });

  it('keeps the direction and clamps diagonals to the unit circle', () => {
    const out = shapeStick(1, 1, 0.2);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1);
    expect(out.x).toBeCloseTo(out.y);
  });
});

describe('TouchState', () => {
  it('reports button presses once', () => {
    const touch = new TouchState();
    touch.pressAction();
    touch.pressEnterExit();
    touch.turnCamera(1);
    const first = touch.takeEdges();
    expect(first).toMatchObject({ actionPressed: true, enterExitPressed: true, cameraTurn: 1 });
    expect(touch.takeEdges()).toMatchObject({
      actionPressed: false,
      enterExitPressed: false,
      cameraTurn: 0,
    });
    expect(touch.action).toBe(true);
    touch.releaseAction();
    expect(touch.action).toBe(false);
  });

  it('clears everything on reset', () => {
    const touch = new TouchState();
    touch.stickX = 0.5;
    touch.brake = true;
    touch.zoom(-1);
    touch.reset();
    expect(touch.stickX).toBe(0);
    expect(touch.brake).toBe(false);
    expect(touch.takeEdges().zoomStep).toBe(0);
  });
});
