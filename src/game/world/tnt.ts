import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import {
  type BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLLISION } from '../../engine/collision-groups';
import { InterpolatedPose } from '../../engine/interpolation';
import type { Physics } from '../../engine/physics';
import { box, merge, paint, place } from '../models/geometry';

/** Seconds from first contact to the blast, from the brief. */
export const TNT_FUSE = 10;
export const TNT_RADIUS = 8;
export const TNT_DAMAGE = 800;
const HALF = 0.65;

let labelTexture: CanvasTexture | null = null;

/** The stencilled "TNT" label, drawn once and shared by every crate. */
function label(): CanvasTexture {
  if (labelTexture) return labelTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0B1430';
    ctx.font = '900 54px "Big Shoulders Display", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 64, 36);
  }
  labelTexture = new CanvasTexture(canvas);
  labelTexture.colorSpace = SRGBColorSpace;
  return labelTexture;
}

const crateMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
const labelMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
const ringMaterial = new MeshBasicMaterial({
  color: '#2EE6FF',
  transparent: true,
  opacity: 0.9,
  side: DoubleSide,
  depthWrite: false,
});
const ringTrackMaterial = new MeshBasicMaterial({
  color: '#0B1430',
  transparent: true,
  opacity: 0.45,
  side: DoubleSide,
  depthWrite: false,
});
const SIGNAL = new Color('#2EE6FF');
const ALARM = new Color('#FF3D5A');

/** The "TNT" label on all four sides, as one geometry. */
function labelGeometry(): BufferGeometry {
  const plates = [0, 1, 2, 3].map((k) => {
    const angle = (k * Math.PI) / 2;
    const plate = new PlaneGeometry(0.95, 0.48);
    plate.rotateY(angle);
    plate.translate(Math.sin(angle) * (HALF + 0.01), 0.1, Math.cos(angle) * (HALF + 0.01));
    return plate;
  });
  const merged = mergeGeometries(plates);
  for (const plate of plates) plate.dispose();
  return merged;
}

function crateGeometry(): BufferGeometry {
  const s = HALF * 2;
  const parts = [box([s - 0.06, s - 0.06, s - 0.06], '#FF7A2E')];
  // Dark wooden frame along every edge.
  const e = 0.12;
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    parts.push(box([e, s, e], '#5E3822', [x * (HALF - e / 2), 0, z * (HALF - e / 2)]));
    parts.push(box([s, e, e], '#5E3822', [0, x * (HALF - e / 2), z * (HALF - e / 2)]));
    parts.push(box([e, e, s], '#5E3822', [x * (HALF - e / 2), z * (HALF - e / 2), 0]));
  }
  // Hazard band: alternating yellow and black blocks around the bottom.
  for (let i = 0; i < 6; i++) {
    const colour = i % 2 === 0 ? '#FFD23F' : '#15181D';
    const x = -HALF + 0.12 + (i + 0.5) * ((s - 0.24) / 6);
    for (const side of [1, -1]) {
      parts.push(
        box([(s - 0.24) / 6, 0.16, 0.04], colour, [x, -HALF + 0.24, side * (HALF + 0.005)]),
      );
      parts.push(
        box([0.04, 0.16, (s - 0.24) / 6], colour, [side * (HALF + 0.005), -HALF + 0.24, x]),
      );
    }
  }
  // Fuse on top.
  parts.push(box([0.2, 0.08, 0.2], '#2B3038', [0.2, HALF + 0.04, 0.2]));
  parts.push(
    place(
      paint(new CylinderGeometry(0.04, 0.04, 0.3, 6), '#3A2A1A'),
      [0.2, HALF + 0.2, 0.2],
      [0.3, 0, 0.2],
    ),
  );
  return merge(parts);
}

/**
 * A pushable TNT crate. The Bruiser's first touch lights a 10-second fuse, shown as a
 * shrinking ring on the ground; then it explodes.
 */
export class TntCrate {
  readonly root = new Group();
  readonly body: RigidBody;
  readonly collider: Collider;
  /** Seconds left on the fuse, or null while unlit. */
  fuse: number | null = null;
  exploded = false;
  private readonly pose: InterpolatedPose;
  private readonly ring: Mesh;
  private readonly spark: Mesh;
  private readonly sparkMaterial = new MeshBasicMaterial({ color: '#FFE27A' });
  private ringSegments = -1;
  private time = 0;
  private removed = false;

  constructor(
    private readonly physics: Physics,
    at: Vector3,
  ) {
    const { rapier, world } = physics;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y + HALF + 0.05, at.z)
        .setLinearDamping(0.3)
        .setAngularDamping(0.5),
    );
    this.collider = world.createCollider(
      rapier.ColliderDesc.cuboid(HALF, HALF, HALF)
        .setDensity(380)
        .setFriction(0.9)
        .setCollisionGroups(COLLISION.tnt)
        .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    const crate = new Mesh(crateGeometry(), crateMaterial);
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.root.add(crate);
    labelMaterial.map = label();
    this.root.add(new Mesh(labelGeometry(), labelMaterial));
    this.spark = new Mesh(new SphereGeometry(0.12, 8, 6), this.sparkMaterial);
    this.spark.position.set(0.2, HALF + 0.22, 0.2);
    this.spark.visible = false;
    this.root.add(this.spark);

    this.ring = new Mesh(new RingGeometry(1.6, 1.9, 48), ringMaterial.clone());
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    const track = new Mesh(new RingGeometry(1.6, 1.9, 48), ringTrackMaterial);
    track.rotation.x = -Math.PI / 2;
    this.ring.add(track);
    track.position.z = 0.01;
    this.root.name = 'tnt';
    this.pose = new InterpolatedPose(this.body, this.root);
  }

  /** The ring lives outside the crate so it stays flat on the ground. */
  get indicator(): Mesh {
    return this.ring;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get lit(): boolean {
    return this.fuse !== null;
  }

  light(seconds = TNT_FUSE): void {
    if (this.exploded) return;
    this.fuse = this.fuse === null ? seconds : Math.min(this.fuse, seconds);
    this.ring.visible = true;
    this.spark.visible = true;
  }

  /** Counts the fuse down; returns true on the step the crate should explode. */
  step(dt: number): boolean {
    if (this.exploded || this.fuse === null) return false;
    this.fuse -= dt;
    return this.fuse <= 0;
  }

  afterStep(): void {
    this.pose.capture();
  }

  render(alpha: number, frameSeconds: number, groundY: number): void {
    this.pose.apply(alpha);
    if (this.fuse === null) return;
    this.time += frameSeconds;
    const progress = Math.max(0, this.fuse / TNT_FUSE);
    const segments = Math.max(1, Math.ceil(progress * 48));
    if (segments !== this.ringSegments) {
      this.ringSegments = segments;
      this.ring.geometry.dispose();
      this.ring.geometry = new RingGeometry(
        1.6,
        1.9,
        segments,
        1,
        Math.PI / 2,
        progress * Math.PI * 2,
      );
    }
    this.ring.position.set(this.root.position.x, groundY + 0.15, this.root.position.z);
    const ringMat = this.ring.material as MeshBasicMaterial;
    ringMat.color.copy(SIGNAL).lerp(ALARM, 1 - progress);
    // The spark flickers faster as the fuse burns down.
    const rate = 6 + (1 - progress) * 22;
    this.spark.scale.setScalar(0.7 + 0.5 * Math.abs(Math.sin(this.time * rate)));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.ring.removeFromParent();
    if (!this.removed) {
      this.removed = true;
      this.physics.world.removeRigidBody(this.body);
    }
  }
}
