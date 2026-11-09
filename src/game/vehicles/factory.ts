import type { Physics } from '../../engine/physics';
import type { VehicleType } from '../level-data';
import { Bruiser } from './bruiser';
import type { Vehicle } from './vehicle';

/** Creates a vehicle of the given type. */
export function createVehicle(type: VehicleType, physics: Physics): Vehicle {
  switch (type) {
    case 'bruiser':
      return new Bruiser(physics);
    case 'fishtail':
    case 'liftoff':
    case 'tumbler':
    case 'railbed':
      throw new Error(`The ${type} isn't built yet`);
  }
}
