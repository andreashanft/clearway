import type { Physics } from '../../engine/physics';
import type { VehicleType } from '../level-data';
import { Bruiser } from './bruiser';
import { Fishtail } from './fishtail';
import { Liftoff } from './liftoff';
import { Tumbler } from './tumbler';
import type { Machine } from './vehicle';

/** Creates a vehicle of the given type. */
export function createVehicle(type: VehicleType, physics: Physics): Machine {
  switch (type) {
    case 'bruiser':
      return new Bruiser(physics);
    case 'fishtail':
      return new Fishtail(physics);
    case 'liftoff':
      return new Liftoff(physics);
    case 'tumbler':
      return new Tumbler(physics);
    case 'railbed':
      throw new Error("The Railbed comes from the level's rail line, not a spawn");
  }
}
