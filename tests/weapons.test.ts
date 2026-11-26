import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { BOOST_RECHARGE_SECONDS, BOOST_SECONDS, Boost } from '../src/game/weapons/boost';
import type { WeaponContext } from '../src/game/weapons/weapon';
import type { Vehicle } from '../src/game/vehicles/vehicle';
import { VEHICLE_SPECS } from '../src/game/vehicles/specs';

const STEP = 1 / 60;

/** A context that records the events and ignores the effects. */
function fakeContext(events: string[]): WeaponContext {
  return {
    effects: { puff: () => undefined },
    events: { emit: (name: string) => events.push(name) },
  } as unknown as WeaponContext;
}

function fakeVehicle(): Vehicle {
  return {
    position: new THREE.Vector3(),
    heading: 0,
    spec: VEHICLE_SPECS.dozer,
    boosting: false,
    push: () => undefined,
  } as unknown as Vehicle;
}

/** Steps a weapon for a span of seconds with the action button up. */
function idle(boost: Boost, vehicle: Vehicle, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    boost.step(STEP, vehicle, false);
  }
}

/** Steps a weapon for a span of seconds with the action button held. */
function hold(boost: Boost, vehicle: Vehicle, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    boost.step(STEP, vehicle, true);
  }
}

describe('Boost', () => {
  it('burns while the button is held and refills while it is up', () => {
    const events: string[] = [];
    const boost = new Boost(fakeContext(events));
    const vehicle = fakeVehicle();
    expect(boost.status().ready).toBe(true);

    hold(boost, vehicle, BOOST_SECONDS / 2);
    expect(vehicle.boosting).toBe(true);
    expect(events).toEqual(['weaponFired']);
    expect(boost.status().meter).toBeCloseTo(0.5, 1);

    // Letting go stops the boost at once, and the tank starts to fill.
    idle(boost, vehicle, BOOST_RECHARGE_SECONDS / 4);
    expect(vehicle.boosting).toBe(false);
    expect(boost.status().meter).toBeCloseTo(0.75, 1);

    // A boost starts again before the tank is full.
    hold(boost, vehicle, STEP);
    expect(vehicle.boosting).toBe(true);
    expect(events).toHaveLength(2);
  });

  it('stops when the tank is empty, also while the button is held', () => {
    const boost = new Boost(fakeContext([]));
    const vehicle = fakeVehicle();
    hold(boost, vehicle, BOOST_SECONDS + 0.2);
    expect(vehicle.boosting).toBe(false);
    expect(boost.status().meter).toBe(0);
  });

  it('takes no ammunition', () => {
    expect(new Boost(fakeContext([])).addAmmo()).toBe(false);
  });
});
