import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { BOOST_COOLDOWN, BOOST_SECONDS, Boost } from '../src/game/weapons/boost';
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
    boost.step(STEP, vehicle, false, false);
  }
}

describe('Boost', () => {
  it('boosts for its duration after a press and then cools down', () => {
    const events: string[] = [];
    const boost = new Boost(fakeContext(events));
    const vehicle = fakeVehicle();
    expect(boost.status().ready).toBe(true);

    boost.step(STEP, vehicle, true, true);
    expect(vehicle.boosting).toBe(true);
    expect(events).toEqual(['weaponFired']);

    idle(boost, vehicle, BOOST_SECONDS);
    expect(vehicle.boosting).toBe(false);
    expect(boost.status().ready).toBe(false);

    // A press during the cooldown does nothing.
    boost.step(STEP, vehicle, true, true);
    expect(vehicle.boosting).toBe(false);
    expect(events).toHaveLength(1);

    idle(boost, vehicle, BOOST_COOLDOWN);
    expect(boost.status().ready).toBe(true);
  });

  it('takes no ammunition', () => {
    expect(new Boost(fakeContext([])).addAmmo()).toBe(false);
  });
});
