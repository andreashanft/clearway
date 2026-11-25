import type { VehicleType } from '../level';
import { Boost } from './boost';
import { Flail } from './flail';
import { Rockets } from './rockets';
import type { Weapon, WeaponContext } from './weapon';

export type { Weapon, WeaponContext, WeaponStatus } from './weapon';

/**
 * Creates the weapon of a vehicle type: the boost, the flail or the rocket launcher.
 *
 * @param rockets Rockets in the launcher, so that a change of vehicle keeps them.
 */
export function createWeapon(type: VehicleType, context: WeaponContext, rockets?: number): Weapon {
  switch (type) {
    case 'dozer':
      return new Boost(context);
    case 'flail':
      return new Flail(context);
    case 'buggy':
      return new Rockets(context, rockets);
  }
}
