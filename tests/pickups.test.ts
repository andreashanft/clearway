import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/game/world/heightfield';
import { BEACON_REACH, beaconPositions, Pickups } from '../src/game/world/pickups';

const flat = new Heightfield(3, 100, new Float32Array(9));

describe('beaconPositions', () => {
  it('spreads beacons evenly along a polyline, ends included', () => {
    const points = beaconPositions({
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      count: 5,
    });
    expect(points).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 5],
      [10, 10],
    ]);
  });

  it('copes with a single beacon or an empty trail', () => {
    expect(beaconPositions({ points: [[3, 4]], count: 1 })).toEqual([[3, 4]]);
    expect(beaconPositions({ points: [], count: 4 })).toEqual([]);
  });
});

describe('Pickups', () => {
  const trail = {
    points: [
      [0, 0],
      [20, 0],
    ] as [number, number][],
    count: 3,
  };

  it('lights beacons within reach, once each', () => {
    const pickups = new Pickups([trail], null, flat);
    expect(pickups.beaconsTotal).toBe(3);
    expect(pickups.collect(new Vector3(10, 1, BEACON_REACH + 0.5)).beacons).toBe(0);
    expect(pickups.collect(new Vector3(10, 1, 1)).beacons).toBe(1);
    expect(pickups.collect(new Vector3(10, 1, 1)).beacons).toBe(0);
    expect(pickups.beaconsFound).toBe(1);
  });

  it('keeps a hidden dish out of reach until its cover falls', () => {
    const pickups = new Pickups([], { pos: [0, 0], hiddenBy: 'bales' }, flat);
    const here = new Vector3(0, 1, 0);
    expect(pickups.collect(here).dish).toBe(false);
    pickups.onBuildingDestroyed('bales');
    expect(pickups.collect(here).dish).toBe(true);
    expect(pickups.dishFound).toBe(true);
  });

  it('drops a dish to the ground when the building under it falls', () => {
    const pickups = new Pickups([], { pos: [0, 0], height: 7, on: 'station' }, flat);
    const ground = new Vector3(0, 1, 0);
    expect(pickups.collect(ground).dish).toBe(false);
    pickups.onBuildingDestroyed('station');
    for (let i = 0; i < 120; i++) pickups.update(1 / 60);
    expect(pickups.collect(ground).dish).toBe(true);
  });
});
