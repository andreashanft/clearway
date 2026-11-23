import * as THREE from 'three/webgpu';
import type { VehicleType } from '../level';
import type { VehicleSpec } from './specs';

/** What a vehicle model needs to animate itself each frame. */
export interface VehicleModelState {
  frameSeconds: number;
  forwardSpeed: number;
  /** Position of the steering wheel from -1 (full left) to 1 (full right). */
  steering: number;
  grounded: boolean;
}

/**
 * The visual model of a vehicle. The model looks along +X and its origin is the chassis centre.
 * The ground lies `spec.rideHeight` below the origin.
 */
export interface VehicleModel {
  object: THREE.Object3D;
  update(state: Readonly<VehicleModelState>): void;
}

/** Colours shared by the crew vehicles, from the vehicle sheet of the design. */
export const VEHICLE_COLORS = {
  body: 0xffc21a,
  bodyDeep: 0xd9a100,
  dark: 0x2b3038,
  track: 0x3a414b,
  steel: 0x8e95a0,
  steelLight: 0xc9ced6,
  glass: 0x7ec1dd,
  band: 0x0e1013,
  stripeRed: 0xf04848,
  lamp: 0xff9a2e,
} as const;

const materials = new Map<string, THREE.MeshLambertMaterial>();

/** Returns a shared flat-colour material. Sharing keeps the draw-call count low. */
export function paint(color: number, emissive = 0): THREE.MeshLambertMaterial {
  const key = `${color}:${emissive}`;
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshLambertMaterial({ color, emissive });
    // Shared materials outlive a level. `Game.dispose` leaves them alone.
    material.userData.shared = true;
    materials.set(key, material);
  }
  return material;
}

/** Adds a box to a parent. Position and size are in metres. */
export function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Adds an upright cylinder to a parent. */
export function addCylinder(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  position: [number, number, number],
  material: THREE.Material,
  segments = 10,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, segments),
    material,
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** The largest angle of a steered front wheel, in radians. */
const WHEEL_LOCK = 0.5;

/** A wheel that spins with the speed of the vehicle and, at the front, turns with the steering. */
interface Wheel {
  /** Turns around the vertical axis with the steering. */
  pivot: THREE.Group;
  /** Turns around the axle. */
  spinner: THREE.Group;
  radius: number;
  steered: boolean;
}

/** Adds a wheel with a hub bar, so that its spin shows. */
function addWheel(
  parent: THREE.Object3D,
  radius: number,
  width: number,
  position: [number, number, number],
  steered: boolean,
): Wheel {
  const pivot = new THREE.Group();
  pivot.position.set(...position);
  const spinner = new THREE.Group();
  const tyre = addCylinder(spinner, radius, width, [0, 0, 0], paint(VEHICLE_COLORS.band), 12);
  tyre.rotation.x = Math.PI / 2;
  addBox(
    spinner,
    [radius * 1.3, radius * 0.34, width + 0.06],
    [0, 0, 0],
    paint(VEHICLE_COLORS.steel),
  );
  pivot.add(spinner);
  parent.add(pivot);
  return { pivot, spinner, radius, steered };
}

/** Spins the wheels with the speed and turns the front wheels with the steering. */
function animateWheels(wheels: readonly Wheel[], state: Readonly<VehicleModelState>): void {
  for (const wheel of wheels) {
    wheel.spinner.rotation.z -= (state.forwardSpeed / wheel.radius) * state.frameSeconds;
    if (wheel.steered) {
      wheel.pivot.rotation.y = -state.steering * WHEEL_LOCK;
    }
  }
}

/**
 * The bulldozer: a squat tracked machine with a wide blade. The blade carries a row of spikes.
 */
function createDozer(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const C = VEHICLE_COLORS;

  // Tracks
  for (const side of [-1, 1]) {
    addBox(object, [5.4, 1.1, 0.95], [-0.5, floor + 0.6, side * 1.5], paint(C.track));
    addBox(object, [5.6, 0.35, 1.0], [-0.5, floor + 0.18, side * 1.5], paint(C.band));
    addBox(object, [4.5, 0.25, 0.85], [-0.5, floor + 1.25, side * 1.5], paint(C.dark));
  }
  // Hull, black band, engine hood and cab
  addBox(object, [4.5, 1.2, 2.2], [-0.5, floor + 1.35, 0], paint(C.body));
  addBox(object, [4.56, 0.26, 2.26], [-0.5, floor + 1.2, 0], paint(C.band));
  addBox(object, [1.9, 0.75, 1.9], [0.75, floor + 2.3, 0], paint(C.body));
  addBox(object, [1.9, 1.35, 2.0], [-1.4, floor + 2.6, 0], paint(C.dark));
  addBox(object, [0.08, 0.8, 1.6], [-0.42, floor + 2.75, 0], paint(C.glass, 0x16323c));
  addBox(object, [2.0, 0.16, 2.15], [-1.4, floor + 3.35, 0], paint(C.body));
  addCylinder(object, 0.14, 1.0, [1.2, floor + 3.1, 0.6], paint(C.track), 8);
  addCylinder(object, 0.2, 0.24, [-1.4, floor + 3.55, 0], paint(C.lamp, C.lamp), 8);
  // Blade with its push arms and its spikes
  for (const side of [-1, 1]) {
    addBox(object, [2.2, 0.3, 0.3], [1.9, floor + 0.95, side * 1.75], paint(C.track));
  }
  const blade = new THREE.Group();
  blade.position.set(2.95, floor + 1.05, 0);
  blade.rotation.z = 0.1;
  addBox(blade, [0.4, 1.9, spec.width + 0.2], [0, 0, 0], paint(C.bodyDeep));
  addBox(blade, [0.34, 0.34, spec.width + 0.26], [0.2, 0.86, 0], paint(C.body));
  addBox(blade, [0.16, 0.24, spec.width + 0.26], [0.26, -0.86, 0], paint(C.steelLight));
  const spikes = 6;
  for (let i = 0; i < spikes; i += 1) {
    const z = (i / (spikes - 1) - 0.5) * (spec.width - 0.5);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.75, 6), paint(C.steelLight));
    // The cone points along +Y by default. Turn it so that it points forwards.
    spike.rotation.z = -Math.PI / 2;
    spike.position.set(0.55, 0.05, z);
    spike.castShadow = true;
    blade.add(spike);
  }
  object.add(blade);

  return { object, update: () => undefined };
}

/**
 * The flail car: a wide all-terrain car with a flat roof. Two arms at the front carry the drum
 * that later swings the flail.
 */
function createFlailCar(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const C = VEHICLE_COLORS;

  const wheels: Wheel[] = [];
  for (const x of [-1.65, 1.65]) {
    for (const side of [-1, 1]) {
      wheels.push(addWheel(object, 0.68, 0.55, [x, floor + 0.68, side * 1.12], x > 0));
    }
  }
  addBox(object, [5.0, 0.4, 1.8], [0, floor + 0.95, 0], paint(C.track));
  // Body, band, hood, cabin and roof
  addBox(object, [5.1, 0.85, 2.5], [0, floor + 1.55, 0], paint(C.body));
  addBox(object, [5.16, 0.2, 2.56], [0, floor + 1.3, 0], paint(C.band));
  addBox(object, [1.5, 0.2, 2.1], [1.7, floor + 2.05, 0], paint(C.bodyDeep));
  addBox(object, [2.7, 0.85, 2.3], [-0.5, floor + 2.4, 0], paint(C.dark));
  addBox(object, [0.08, 0.6, 2.0], [0.87, floor + 2.42, 0], paint(C.glass, 0x16323c));
  for (const side of [-1, 1]) {
    addBox(object, [2.2, 0.5, 0.06], [-0.5, floor + 2.45, side * 1.16], paint(C.glass, 0x16323c));
  }
  addBox(object, [2.9, 0.14, 2.45], [-0.5, floor + 2.88, 0], paint(C.body));
  addBox(object, [1.2, 0.5, 2.2], [-2.0, floor + 2.2, 0], paint(C.bodyDeep));
  addCylinder(object, 0.16, 0.2, [-0.5, floor + 3.05, 0], paint(C.lamp, C.lamp), 8);
  // Front arms and the flail drum
  for (const side of [-1, 1]) {
    addBox(object, [1.5, 0.22, 0.22], [3.05, floor + 1.25, side * 1.0], paint(C.steel));
  }
  const drum = addCylinder(object, 0.3, 2.3, [3.7, floor + 1.25, 0], paint(C.steelLight), 10);
  drum.rotation.x = Math.PI / 2;

  return {
    object,
    update(state) {
      animateWheels(wheels, state);
      drum.rotation.y -= (state.forwardSpeed / 0.6) * state.frameSeconds;
    },
  };
}

/** The buggy: a low open frame on four large wheels, with a roll cage and a red stripe. */
function createBuggy(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const C = VEHICLE_COLORS;

  const wheels: Wheel[] = [];
  for (const x of [-1.35, 1.35]) {
    for (const side of [-1, 1]) {
      wheels.push(addWheel(object, 0.62, 0.5, [x, floor + 0.62, side * 1.02], x > 0));
    }
  }
  addBox(object, [3.6, 0.3, 1.5], [0, floor + 0.7, 0], paint(C.steel));
  addBox(object, [3.4, 0.55, 1.45], [0.05, floor + 1.1, 0], paint(C.body));
  addBox(object, [2.6, 0.16, 1.5], [0.05, floor + 1.25, 0], paint(C.stripeRed));
  addBox(object, [1.1, 0.3, 1.2], [1.5, floor + 0.95, 0], paint(C.bodyDeep));
  addBox(object, [0.9, 0.55, 1.0], [-0.2, floor + 1.6, 0], paint(C.dark));
  addBox(object, [0.9, 0.7, 1.3], [-1.45, floor + 1.45, 0], paint(C.track));
  // Roll cage
  for (const side of [-1, 1]) {
    addBox(object, [1.7, 0.12, 0.12], [-0.3, floor + 2.25, side * 0.68], paint(C.steel));
    addBox(object, [0.12, 0.9, 0.12], [-1.1, floor + 1.8, side * 0.68], paint(C.steel));
    addBox(object, [0.12, 0.9, 0.12], [0.5, floor + 1.8, side * 0.68], paint(C.steel));
  }
  addBox(object, [0.12, 0.12, 1.48], [-1.1, floor + 2.25, 0], paint(C.steel));
  addBox(object, [0.12, 0.12, 1.48], [0.5, floor + 2.25, 0], paint(C.steel));
  addCylinder(object, 0.12, 0.16, [-1.1, floor + 2.4, 0], paint(C.lamp, C.lamp), 8);

  return { object, update: (state) => animateWheels(wheels, state) };
}

const builders: Record<VehicleType, (spec: VehicleSpec) => VehicleModel> = {
  dozer: createDozer,
  flail: createFlailCar,
  buggy: createBuggy,
};

/** Builds the visual model for a vehicle type. */
export function createVehicleModel(spec: VehicleSpec): VehicleModel {
  return builders[spec.type](spec);
}
