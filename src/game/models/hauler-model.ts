import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { HAULER } from '../hauler/route-sweep';
import type { Finish } from './finish';
import { ModelBuilder } from './model-builder';

/** Height of the Hauler's body origin above the ground. */
export const HAULER_RIDE_HEIGHT = 1.3;

export interface HaulerModel {
  readonly root: Group;
  /** Red warning beacons; their glow strobes as the Hauler closes in. */
  readonly beaconMaterial: MeshStandardMaterial;
  /** The reactor core window. */
  readonly coreMaterial: MeshStandardMaterial;
  readonly coreLight: PointLight;
  /** Wheel groups that spin with distance travelled. */
  readonly wheels: Group[];
}

const F = {
  body: { colour: '#2B3038', roughness: 0.55, metalness: 0.45 },
  bodyLight: { colour: '#3A414B', roughness: 0.5, metalness: 0.5 },
  frame: { colour: '#1C2026', roughness: 0.6, metalness: 0.5 },
  alarm: { colour: '#F04848', roughness: 0.45, metalness: 0.1 },
  white: { colour: '#F4F1EA', roughness: 0.5, metalness: 0.05 },
  hazard: { colour: '#FFD23F', roughness: 0.45, metalness: 0.05 },
  black: { colour: '#15181D', roughness: 0.6, metalness: 0.1 },
  steel: { colour: '#8E95A0', roughness: 0.35, metalness: 0.7 },
  rubber: { colour: '#23272D', roughness: 0.85, metalness: 0 },
  sensor: {
    colour: '#1A0F14',
    roughness: 0.1,
    metalness: 0.4,
    emissive: '#FF3D5A',
    emissiveIntensity: 0.6,
  },
} as const satisfies Record<string, Finish>;

const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);

/**
 * The Hauler: a long autonomous carrier with an armoured tractor unit, a flatbed carrying
 * a caged reactor vessel with a glowing core, red beacons on every corner and hazard
 * chevrons on the rear. Built facing +z with the ground at y = 0, then shifted so the
 * origin is the body centre.
 */
export function buildHaulerModel(): HaulerModel {
  const b = new ModelBuilder();
  const L = HAULER.length;
  const W = HAULER.width;
  const halfL = L / 2;

  // Chassis rails and the flatbed deck.
  b.add(box(W - 0.6, 0.5, L - 0.4), F.frame, { at: [0, 0.95, 0] });
  b.add(box(W, 0.32, L * 0.62), F.bodyLight, { at: [0, 1.36, -halfL + L * 0.31 + 0.2] });
  for (const side of [-1, 1]) {
    // Side skirts with a red-and-white stripe along the deck edge.
    b.add(box(0.12, 0.55, L * 0.62), F.body, {
      at: [side * (W / 2 - 0.06), 1.1, -halfL + L * 0.31 + 0.2],
    });
    b.add(box(0.13, 0.12, L * 0.62), F.alarm, {
      at: [side * (W / 2 - 0.05), 1.3, -halfL + L * 0.31 + 0.2],
    });
  }

  // Tractor unit at the front: armoured, windowless, with a sensor band and red eye.
  const cabZ = halfL - 1.4;
  b.add(box(W, 2.3, 2.6), F.body, { at: [0, 2.35, cabZ] });
  b.add(box(W - 0.3, 0.5, 2.3), F.bodyLight, { at: [0, 3.7, cabZ - 0.1] });
  b.add(box(W - 0.4, 0.42, 0.08), F.sensor, { at: [0, 2.9, halfL - 0.06] });
  b.add(box(W + 0.02, 0.18, 2.62), F.alarm, { at: [0, 2.2, cabZ] });
  b.add(box(W + 0.03, 0.08, 2.63), F.white, { at: [0, 2.02, cabZ] });
  b.add(box(W + 0.2, 0.45, 0.4), F.frame, { at: [0, 0.95, halfL + 0.05] });
  // Push bar with hazard blocks.
  for (let i = 0; i < 6; i++) {
    const x = -W / 2 + 0.1 + (i + 0.5) * ((W - 0.2) / 6);
    b.add(box((W - 0.2) / 6, 0.22, 0.06), i % 2 === 0 ? F.hazard : F.black, {
      at: [x, 1.05, halfL + 0.27],
    });
  }

  // Reactor vessel on the deck inside a cage.
  const coreZ = -1.6;
  b.add(new CylinderGeometry(1.45, 1.55, 2.2, 20), F.bodyLight, { at: [0, 2.65, coreZ] });
  b.add(new SphereGeometry(1.45, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), F.body, {
    at: [0, 3.75, coreZ],
  });
  b.add(new CylinderGeometry(0.35, 0.35, 0.5, 10), F.steel, { at: [0, 5.1, coreZ] });
  for (const [x, z] of [
    [1.7, 1.7],
    [-1.7, 1.7],
    [1.7, -1.7],
    [-1.7, -1.7],
  ] as const) {
    b.add(box(0.16, 3.1, 0.16), F.steel, { at: [x, 3.0, coreZ + z] });
  }
  for (const y of [2.2, 4.3]) {
    b.add(new TorusGeometry(2.25, 0.07, 6, 4), F.steel, {
      at: [0, y, coreZ],
      rotate: [Math.PI / 2, 0, Math.PI / 4],
    });
  }

  // Rear plate with diagonal hazard chevrons and tail lights.
  b.add(box(W, 1.0, 0.18), F.black, { at: [0, 1.5, -halfL + 0.1] });
  for (let i = 0; i < 7; i++) {
    const x = -W / 2 + 0.35 + i * ((W - 0.7) / 6);
    b.add(box(0.26, 1.1, 0.04), F.hazard, { at: [x, 1.5, -halfL - 0.01], rotate: [0, 0, 0.6] });
  }

  // Wheels: six per side, each a small group so they can spin.
  const wheels: Group[] = [];
  const wheelZ = [halfL - 1.0, halfL - 2.3, -0.4, -1.7, -3.3, -4.6];
  const wheelParts = new ModelBuilder()
    .add(new CylinderGeometry(0.58, 0.58, 0.55, 16), F.rubber, { rotate: [0, 0, Math.PI / 2] })
    .add(new CylinderGeometry(0.32, 0.32, 0.58, 12), F.steel, { rotate: [0, 0, Math.PI / 2] })
    .build('hauler-wheel');
  for (const z of wheelZ) {
    for (const side of [-1, 1]) {
      const wheel = new Group();
      wheel.position.set(side * (W / 2 - 0.25), 0.58, z);
      wheel.add(wheelParts.clone());
      wheels.push(wheel);
    }
  }

  const hull = b.build('hauler-hull');
  const inner = new Group();
  inner.add(hull, ...wheels);

  // Beacons and the core window glow with their own materials so they can pulse.
  const beaconMaterial = new MeshStandardMaterial({
    color: '#FF6B6B',
    emissive: new Color('#FF3D5A'),
    emissiveIntensity: 1.5,
    roughness: 0.3,
  });
  const beaconGeometry = new CylinderGeometry(0.2, 0.24, 0.32, 12);
  for (const [x, y, z] of [
    [W / 2 - 0.35, 3.98, halfL - 0.4],
    [-W / 2 + 0.35, 3.98, halfL - 0.4],
    [W / 2 - 0.3, 2.15, -halfL + 0.35],
    [-W / 2 + 0.3, 2.15, -halfL + 0.35],
  ] as const) {
    const beacon = new Mesh(beaconGeometry, beaconMaterial);
    beacon.position.set(x, y, z);
    inner.add(beacon);
  }
  const coreMaterial = new MeshStandardMaterial({
    color: '#FF9AA8',
    emissive: new Color('#FF3D5A'),
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });
  const core = new Mesh(new CylinderGeometry(1.48, 1.48, 0.55, 20, 1, true), coreMaterial);
  core.position.set(0, 2.75, coreZ);
  inner.add(core);
  const coreLight = new PointLight('#FF3D5A', 60, 16, 1.8);
  coreLight.position.set(0, 4.2, coreZ);
  inner.add(coreLight);

  inner.position.y = -HAULER_RIDE_HEIGHT;
  const root = new Group();
  root.name = 'hauler';
  root.add(inner);
  return { root, beaconMaterial, coreMaterial, coreLight, wheels };
}
