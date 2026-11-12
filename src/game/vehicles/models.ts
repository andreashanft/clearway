import * as THREE from 'three/webgpu';
import type { VehicleType } from '../level';
import type { VehicleSpec } from './specs';

/** What a vehicle model needs to animate itself each frame. */
export interface VehicleModelState {
  frameSeconds: number;
  forwardSpeed: number;
  actionCharge: number;
  actionActive: boolean;
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
  ready: 0x3fd3e0,
  stripeRed: 0xf04848,
  nozzle: 0xff7a3d,
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

/** A material whose glow shows that an action is ready. Each vehicle owns its own instance. */
function readyGlow(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 1 });
}

/**
 * The Bruiser: a squat bulldozer with a wide blade.
 * Its blade edge glows while the ram charge is ready.
 */
function createBruiser(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const C = VEHICLE_COLORS;

  // Tracks
  for (const side of [-1, 1]) {
    addBox(object, [7.0, 1.6, 1.4], [-0.5, floor + 0.8, side * 2.7], paint(C.track));
    addBox(object, [7.3, 0.5, 1.5], [-0.5, floor + 0.25, side * 2.7], paint(C.band));
    addBox(object, [5.8, 0.35, 1.2], [-0.5, floor + 1.72, side * 2.7], paint(C.dark));
  }
  // Hull, black band, engine hood and cab
  addBox(object, [5.8, 1.7, 4.2], [-0.5, floor + 1.75, 0], paint(C.body));
  addBox(object, [5.86, 0.36, 4.26], [-0.5, floor + 1.65, 0], paint(C.band));
  addBox(object, [2.3, 1.0, 3.2], [1.1, floor + 3.05, 0], paint(C.body));
  addBox(object, [2.6, 1.9, 3.3], [-1.6, floor + 3.5, 0], paint(C.dark));
  addBox(object, [0.1, 1.1, 2.7], [-0.28, floor + 3.7, 0], paint(C.glass, 0x16323c));
  addBox(object, [2.7, 0.2, 3.5], [-1.6, floor + 4.5, 0], paint(C.body));
  addCylinder(object, 0.22, 1.5, [1.5, floor + 4.2, 1.0], paint(C.track), 8);
  addCylinder(object, 0.3, 0.35, [-1.6, floor + 4.78, 0], paint(0xff9a2e, 0xff9a2e), 8);
  // Blade with its push arms
  for (const side of [-1, 1]) {
    addBox(object, [3.2, 0.45, 0.45], [2.4, floor + 1.3, side * 2.2], paint(C.track));
  }
  const blade = new THREE.Group();
  blade.position.set(3.8, floor + 1.45, 0);
  blade.rotation.z = 0.12;
  addBox(blade, [0.6, 2.7, 7.4], [0, 0, 0], paint(C.bodyDeep));
  addBox(blade, [0.5, 0.5, 7.5], [0.28, 1.2, 0], paint(C.body));
  const glow = readyGlow(C.ready);
  addBox(blade, [0.22, 0.34, 7.5], [0.36, -1.22, 0], glow);
  addBox(blade, [0.22, 2.4, 0.2], [0.36, 0, 3.66], glow);
  addBox(blade, [0.22, 2.4, 0.2], [0.36, 0, -3.66], glow);
  object.add(blade);

  let pulse = 0;
  return {
    object,
    update(state) {
      pulse += state.frameSeconds * 6;
      const ready = state.actionCharge >= 1;
      // Ready: a calm glow. Firing: a bright flash. Recharging: dark.
      const intensity = state.actionActive ? 2.4 : ready ? 0.9 + Math.sin(pulse) * 0.25 : 0.05;
      glow.emissiveIntensity = intensity;
      glow.color.setHex(ready || state.actionActive ? C.ready : C.track);
    },
  };
}

/**
 * The Fishtail: a skid dump truck with a long tipper body and an armoured steel tail.
 * The tail plate glows while the truck is fast enough to skid.
 */
function createFishtail(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const C = VEHICLE_COLORS;

  // Six wheels
  for (const x of [-3.6, -1.4, 3.6]) {
    for (const side of [-1, 1]) {
      const wheel = addCylinder(
        object,
        1.15,
        1.2,
        [x, floor + 1.15, side * 2.2],
        paint(C.band),
        10,
      );
      wheel.rotation.x = Math.PI / 2;
    }
  }
  addBox(object, [10.2, 0.7, 3.4], [0, floor + 1.7, 0], paint(C.track));
  // Tipper body with ribs
  addBox(object, [7.0, 2.4, 5.0], [-1.5, floor + 3.3, 0], paint(C.body));
  for (const x of [-4.2, -2.4, -0.6, 1.2]) {
    addBox(object, [0.3, 2.5, 5.16], [x, floor + 3.3, 0], paint(C.bodyDeep));
  }
  addBox(object, [7.2, 0.3, 5.2], [-1.5, floor + 4.6, 0], paint(C.bodyDeep));
  // Cab
  addBox(object, [2.6, 2.6, 4.4], [3.9, floor + 3.3, 0], paint(C.track));
  addBox(object, [0.12, 1.2, 3.6], [5.22, floor + 3.7, 0], paint(C.glass, 0x16323c));
  addBox(object, [2.8, 0.25, 4.6], [3.9, floor + 4.7, 0], paint(C.body));
  // Armoured tail
  addBox(object, [1.0, 3.6, 5.6], [-5.3, floor + 2.9, 0], paint(C.steel));
  const glow = readyGlow(C.ready);
  addBox(object, [0.2, 3.3, 5.7], [-5.86, floor + 2.9, 0], glow);

  let pulse = 0;
  return {
    object,
    update(state) {
      pulse += state.frameSeconds * 7;
      const fast = Math.abs(state.forwardSpeed) > 7;
      glow.emissiveIntensity = state.actionActive
        ? 2.6
        : fast
          ? 0.9 + Math.sin(pulse) * 0.25
          : 0.08;
      glow.color.setHex(fast || state.actionActive ? C.ready : C.steel);
    },
  };
}

/**
 * The Liftoff: a low, open-frame rocket buggy with an armoured belly and a red stripe.
 * Its nozzle glows orange while the boost is ready and flares while it burns.
 */
function createLiftoff(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const C = VEHICLE_COLORS;

  for (const x of [-2.2, 2.2]) {
    for (const side of [-1, 1]) {
      const wheel = addCylinder(
        object,
        1.25,
        1.3,
        [x, floor + 1.25, side * 2.1],
        paint(C.track),
        10,
      );
      wheel.rotation.x = Math.PI / 2;
    }
  }
  addBox(object, [5.6, 0.5, 3.2], [0, floor + 1.1, 0], paint(C.steel));
  addBox(object, [5.2, 1.0, 2.8], [0.1, floor + 1.9, 0], paint(C.body));
  addBox(object, [4.0, 0.28, 2.86], [0.1, floor + 2.2, 0], paint(C.stripeRed));
  addBox(object, [1.7, 0.9, 2.0], [-0.2, floor + 2.8, 0], paint(C.dark));
  // Roll cage
  for (const side of [-1, 1]) {
    addBox(object, [2.6, 0.2, 0.2], [-0.2, floor + 3.6, side * 1.1], paint(C.steel));
    addBox(object, [0.2, 1.4, 0.2], [-1.4, floor + 3.0, side * 1.1], paint(C.steel));
    addBox(object, [0.2, 1.4, 0.2], [1.0, floor + 3.0, side * 1.1], paint(C.steel));
  }
  // Rocket nozzle and flame
  const nozzle = addCylinder(object, 0.75, 1.5, [-3.2, floor + 2.0, 0], paint(C.steel), 10);
  nozzle.rotation.z = Math.PI / 2;
  const glow = readyGlow(C.nozzle);
  const mouth = addCylinder(object, 0.62, 0.3, [-4.0, floor + 2.0, 0], glow, 10);
  mouth.rotation.z = Math.PI / 2;
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }),
  );
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-6.4, floor + 2.0, 0);
  flame.visible = false;
  object.add(flame);

  let pulse = 0;
  return {
    object,
    update(state) {
      pulse += state.frameSeconds * 30;
      flame.visible = state.actionActive;
      flame.scale.set(1, 0.8 + 0.3 * Math.sin(pulse), 1);
      glow.emissiveIntensity = state.actionActive ? 3 : state.actionCharge >= 1 ? 1.1 : 0.05;
      glow.color.setHex(state.actionCharge >= 1 || state.actionActive ? C.nozzle : C.dark);
    },
  };
}

/**
 * The Tumbler: a heavy one-armed industrial mech in steel grey.
 * To roll, it tucks in its legs and its arm and spins as a ball. A ring shows the roll charge.
 */
function createTumbler(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const C = VEHICLE_COLORS;

  const ball = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(3.1, 1), paint(C.steelLight));
  shell.castShadow = true;
  const belt = addCylinder(ball, 3.2, 1.1, [0, 0, 0], paint(C.steel), 14);
  belt.rotation.x = Math.PI / 2;
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 0), paint(C.body, 0x6b4a00));
  core.position.set(2.5, 0.3, 0);
  ball.add(shell, core);
  ball.position.y = 0.3;
  object.add(ball);

  const limbs = new THREE.Group();
  for (const side of [-1, 1]) {
    addBox(limbs, [1.7, 3.4, 1.7], [0, floor + 1.7, side * 2.0], paint(C.steel));
    addBox(limbs, [2.6, 0.8, 2.2], [0.3, floor + 0.4, side * 2.0], paint(C.dark));
  }
  // The single arm: a long boom with a heavy fist.
  addBox(limbs, [1.5, 1.5, 4.2], [0.2, 1.2, 4.6], paint(C.steel));
  addBox(limbs, [2.4, 2.4, 2.2], [0.2, 0.6, 7.2], paint(C.dark));
  object.add(limbs);

  const glow = readyGlow(C.ready);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.16, 6, 28), glow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = floor + 0.4;
  object.add(ring);

  let spin = 0;
  let tuck = 0;
  return {
    object,
    update(state) {
      const rolling = state.actionActive;
      tuck += ((rolling ? 1 : 0) - tuck) * Math.min(1, state.frameSeconds * 12);
      limbs.scale.setScalar(Math.max(0.001, 1 - tuck));
      // The ball spins forwards while rolling and sinks to the ground.
      spin = rolling ? spin - (state.forwardSpeed / 3.1) * state.frameSeconds : spin * 0.85;
      ball.rotation.z = spin;
      ball.position.y = 0.3 - tuck * (spec.rideHeight - 3.3);
      glow.emissiveIntensity = rolling ? 2.4 : state.actionCharge >= 1 ? 1 : 0.05;
      glow.color.setHex(state.actionCharge >= 1 || rolling ? C.ready : C.dark);
    },
  };
}

/**
 * The Railbed: a rail-mounted flatbed with a small cab. Its deck is as wide as the rail cutting,
 * so that it becomes a bridge for the Hauler.
 */
function createRailbed(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const top = spec.height / 2;
  const C = VEHICLE_COLORS;

  // Bogies on the rails, and a frame that carries the deck
  for (const x of [-6, 6]) {
    addBox(object, [4.2, 1.1, 5.6], [x, floor + 0.75, 0], paint(C.dark));
    for (const side of [-1, 1]) {
      addBox(
        object,
        [0.6, top - floor - 1.0, 0.6],
        [x, (top + floor) / 2, side * 2.4],
        paint(C.steel),
      );
    }
  }
  addBox(object, [spec.length, 0.5, 6.4], [0, top - 0.95, 0], paint(C.track));
  // Deck with planks and hazard edges
  addBox(object, [spec.length, 0.5, spec.width], [0, top - 0.25, 0], paint(0x5d6470));
  for (let i = 0; i < 6; i += 1) {
    const x = -spec.length / 2 + 1.6 + i * ((spec.length - 3.2) / 5);
    addBox(object, [0.25, 0.08, spec.width - 0.6], [x, top + 0.03, 0], paint(0x4a4f57));
  }
  for (const side of [-1, 1]) {
    addBox(
      object,
      [spec.length, 0.14, 0.7],
      [0, top + 0.05, side * (spec.width / 2 - 0.35)],
      paint(C.body),
    );
  }
  // Cab at the southern end, below deck level so that the Hauler rolls over the deck freely
  addBox(object, [2.6, 2.2, 4.4], [-spec.length / 2 - 1.3, floor + 2.3, 0], paint(C.body));
  addBox(
    object,
    [0.12, 0.9, 3.6],
    [-spec.length / 2 - 2.62, floor + 2.7, 0],
    paint(C.glass, 0x16323c),
  );

  return { object, update: () => undefined };
}

/**
 * The pilot on foot: a small figure in orange crew overalls and a yellow hard hat.
 * A ring on the ground keeps the pilot readable at the widest zoom.
 */
function createPilot(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  const floor = -spec.rideHeight;
  const overalls = paint(0xff9a2e);
  const legs: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    legs.push(addBox(object, [0.5, 1.3, 0.5], [0, floor + 0.65, side * 0.32], paint(0x2b3038)));
  }
  addBox(object, [0.8, 1.3, 1.2], [0, floor + 1.95, 0], overalls);
  addBox(object, [0.7, 0.7, 0.7], [0, floor + 2.95, 0], paint(0xe8c9a0));
  addBox(object, [0.95, 0.3, 0.95], [0.05, floor + 3.4, 0], paint(VEHICLE_COLORS.body));
  for (const side of [-1, 1]) {
    addBox(object, [0.4, 1.1, 0.4], [0, floor + 2.0, side * 0.8], overalls);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.3, 1.7, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: VEHICLE_COLORS.body, toneMapped: false }),
  );
  ring.position.y = floor + 0.15;
  object.add(ring);

  let stride = 0;
  return {
    object,
    update(state) {
      // The legs swing while the pilot walks.
      stride += state.forwardSpeed * state.frameSeconds * 1.8;
      const swing = Math.abs(state.forwardSpeed) > 0.5 ? Math.sin(stride) * 0.5 : 0;
      legs[0].position.x = swing;
      legs[1].position.x = -swing;
    },
  };
}

/** A plain block in the size of the vehicle, until its own model exists. */
function createPlaceholder(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  addBox(object, [spec.length, spec.height, spec.width], [0, 0, 0], paint(VEHICLE_COLORS.body));
  return { object, update: () => undefined };
}

const builders: Partial<Record<VehicleType, (spec: VehicleSpec) => VehicleModel>> = {
  bruiser: createBruiser,
  fishtail: createFishtail,
  liftoff: createLiftoff,
  tumbler: createTumbler,
  railbed: createRailbed,
  pilot: createPilot,
};

/** Builds the visual model for a vehicle type. */
export function createVehicleModel(spec: VehicleSpec): VehicleModel {
  return (builders[spec.type] ?? createPlaceholder)(spec);
}
