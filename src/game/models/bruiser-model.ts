import { BoxGeometry, CylinderGeometry, Group, type MeshStandardMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createReadyGlow, MATERIALS } from './materials';
import { ModelBuilder } from './model-builder';
import { TrackCleats } from './track';

export interface BruiserModel {
  /** Whole model; its origin sits at the physics body's centre. */
  readonly root: Group;
  /** The blade assembly, raised for push mode. */
  readonly blade: Group;
  readonly bladeGlow: MeshStandardMaterial;
  readonly leftTrack: TrackCleats;
  readonly rightTrack: TrackCleats;
}

/** Height of the body centre above the ground when the Bruiser is at rest. */
export const BRUISER_RIDE_HEIGHT = 1.2;

const TRACK_X = 1.3;
const TRACK_WIDTH = 0.72;
const WHEEL_R = 0.45;
const TRACK_LENGTH = 3.3;

const rbox = (w: number, h: number, d: number, r = 0.08): RoundedBoxGeometry =>
  new RoundedBoxGeometry(w, h, d, 2, r);
const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
const cyl = (rTop: number, rBottom: number, h: number, seg = 14): CylinderGeometry =>
  new CylinderGeometry(rTop, rBottom, h, seg);

/** Builds the Bruiser bulldozer: squat body, wide blade, chunky tracks, black band. */
export function buildBruiserModel(): BruiserModel {
  const m = MATERIALS;
  const b = new ModelBuilder();
  const sideways: [number, number, number] = [0, 0, Math.PI / 2];

  // Running gear: belt body, side frames, sprockets, idlers and road wheels.
  for (const side of [-1, 1]) {
    const x = side * TRACK_X;
    b.add(rbox(TRACK_WIDTH, WHEEL_R * 2, TRACK_LENGTH + WHEEL_R * 2, WHEEL_R * 0.95), m.rubber, {
      at: [x, WHEEL_R, 0],
    });
    b.add(box(0.1, 0.5, TRACK_LENGTH * 0.92), m.darkSteel, {
      at: [x - side * (TRACK_WIDTH / 2 + 0.05), WHEEL_R + 0.05, 0],
    });
    for (const z of [-TRACK_LENGTH / 2, TRACK_LENGTH / 2]) {
      b.add(cyl(WHEEL_R * 0.92, WHEEL_R * 0.92, TRACK_WIDTH + 0.14, 16), m.steel, {
        at: [x, WHEEL_R, z],
        rotate: sideways,
      });
      b.add(cyl(0.16, 0.16, TRACK_WIDTH + 0.2, 10), m.darkSteel, {
        at: [x, WHEEL_R, z],
        rotate: sideways,
      });
    }
    for (let k = 1; k <= 4; k++) {
      const z = -TRACK_LENGTH / 2 + (TRACK_LENGTH * k) / 5;
      b.add(cyl(0.2, 0.2, TRACK_WIDTH + 0.16, 10), m.darkSteel, {
        at: [x, 0.24, z],
        rotate: sideways,
      });
    }
    // Fender over each track.
    b.add(rbox(TRACK_WIDTH + 0.14, 0.12, TRACK_LENGTH + 1.0, 0.04), m.hazardPaint, {
      at: [x, WHEEL_R * 2 + 0.12, -0.05],
    });
  }

  // Hull with the black signature band.
  b.add(rbox(2.1, 0.9, 3.7, 0.14), m.hazardPaint, { at: [0, 1.32, -0.1] });
  b.add(box(2.14, 0.92, 0.32), m.blackBand, { at: [0, 1.33, 0.62] });
  // Front nose plate and headlights.
  b.add(rbox(1.8, 0.5, 0.3, 0.06), m.hazardDeep, { at: [0, 1.1, 1.78] });
  b.addMirrored(rbox(0.32, 0.18, 0.1, 0.04), m.headlight, { at: [0.62, 1.62, 1.72] });
  b.addMirrored(rbox(0.44, 0.26, 0.08, 0.04), m.blackBand, { at: [0.62, 1.62, 1.68] });

  // Engine hood with grille slats, exhaust stack and tail lights.
  b.add(rbox(1.7, 0.5, 1.45, 0.12), m.hazardPaint, { at: [0, 1.98, -1.1] });
  for (let k = 0; k < 5; k++) {
    b.add(box(1.3, 0.06, 0.1), m.darkSteel, { at: [0, 2.25, -1.55 + k * 0.22] });
  }
  b.add(cyl(0.1, 0.12, 1.1, 10), m.darkSteel, { at: [0.62, 2.55, -0.7] });
  b.add(cyl(0.14, 0.1, 0.12, 10), m.blackBand, { at: [0.62, 3.13, -0.7] });
  b.addMirrored(box(0.26, 0.14, 0.06), m.tailLight, { at: [0.75, 1.55, -1.97] });

  // Cab: glass box, frame posts and a roof with an amber beacon.
  b.add(rbox(1.38, 1.05, 1.22, 0.06), m.glass, { at: [0, 2.28, 0.15] });
  for (const [px, pz] of [
    [0.7, 0.77],
    [-0.7, 0.77],
    [0.7, -0.47],
    [-0.7, -0.47],
  ] as const) {
    b.add(box(0.11, 1.12, 0.11), m.blackBand, { at: [px, 2.28, pz] });
  }
  b.add(rbox(1.62, 0.16, 1.5, 0.05), m.hazardPaint, { at: [0, 2.9, 0.15] });
  b.add(cyl(0.16, 0.16, 0.22, 12), m.beaconAmber, { at: [-0.45, 3.08, -0.25] });
  b.add(box(1.2, 0.08, 0.08), m.darkSteel, { at: [0, 3.02, 0.92] });

  // Hydraulic cylinders that drive the blade (fixed to the hull).
  b.addMirrored(cyl(0.11, 0.11, 0.9, 10), m.darkSteel, {
    at: [0.6, 1.42, 1.98],
    rotate: [Math.PI / 2 - 0.35, 0, 0],
  });

  const root = b.build('bruiser');

  // Blade assembly: curved plate, cutting edge, side plates, push arms and the glow strip.
  const bladeGlow = createReadyGlow();
  const bladeBuilder = new ModelBuilder();
  // A moldboard in three segments, each leaning further forward, so the face is concave.
  bladeBuilder.add(box(3.7, 0.55, 0.14), m.hazardDeep, { at: [0, 0.4, 2.9] });
  bladeBuilder.add(box(3.7, 0.5, 0.14), m.hazardDeep, {
    at: [0, 0.909, 2.974],
    rotate: [0.3, 0, 0],
  });
  bladeBuilder.add(box(3.7, 0.3, 0.14), m.hazardDeep, {
    at: [0, 1.25, 3.156],
    rotate: [0.8, 0, 0],
  });
  bladeBuilder.add(box(3.74, 0.12, 0.26), m.steel, { at: [0, 0.1, 2.95] });
  bladeBuilder.addMirrored(box(0.1, 1.2, 0.5), m.hazardDeep, { at: [1.86, 0.72, 2.88] });
  for (const x of [-1.1, 0, 1.1]) {
    bladeBuilder.add(box(0.12, 0.9, 0.3), m.hazardDeep, { at: [x, 0.62, 2.76] });
  }
  bladeBuilder.addMirrored(box(0.2, 0.24, 1.5), m.darkSteel, { at: [TRACK_X, 0.62, 2.0] });
  bladeBuilder.addMirrored(cyl(0.06, 0.06, 0.75, 8), m.chrome, {
    at: [0.6, 1.25, 2.55],
    rotate: [Math.PI / 2 - 0.35, 0, 0],
  });
  bladeBuilder.add(box(3.6, 0.07, 0.07), bladeGlow, { at: [0, 1.36, 3.27] });
  const blade = bladeBuilder.build('bruiser-blade');
  root.add(blade);

  const leftTrack = new TrackCleats({
    x: TRACK_X,
    y: WHEEL_R,
    length: TRACK_LENGTH,
    radius: WHEEL_R,
    width: TRACK_WIDTH,
  });
  const rightTrack = new TrackCleats({
    x: -TRACK_X,
    y: WHEEL_R,
    length: TRACK_LENGTH,
    radius: WHEEL_R,
    width: TRACK_WIDTH,
  });
  root.add(leftTrack.mesh, rightTrack.mesh);

  // The model was built with the ground at y = 0; shift it so the origin is the body centre.
  const wrapper = new Group();
  wrapper.name = 'bruiser-model';
  root.position.y = -BRUISER_RIDE_HEIGHT;
  wrapper.add(root);

  return { root: wrapper, blade, bladeGlow, leftTrack, rightTrack };
}
