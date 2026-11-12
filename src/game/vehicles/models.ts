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

/** A plain block in the size of the vehicle, until its own model exists. */
function createPlaceholder(spec: VehicleSpec): VehicleModel {
  const object = new THREE.Group();
  addBox(object, [spec.length, spec.height, spec.width], [0, 0, 0], paint(VEHICLE_COLORS.body));
  return { object, update: () => undefined };
}

const builders: Partial<Record<VehicleType, (spec: VehicleSpec) => VehicleModel>> = {
  bruiser: createBruiser,
};

/** Builds the visual model for a vehicle type. */
export function createVehicleModel(spec: VehicleSpec): VehicleModel {
  return (builders[spec.type] ?? createPlaceholder)(spec);
}
