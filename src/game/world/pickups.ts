import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { GroundPoint } from '../level-data';
import type { Heightfield } from './heightfield';

/** Beacons spread evenly along a polyline, such as a hedgerow or a back lane. */
export interface BeaconTrail {
  readonly points: readonly GroundPoint[];
  readonly count: number;
}

/** The level's one relay dish. */
export interface RelayDishDefinition {
  readonly pos: GroundPoint;
  /** Height above the ground, for a dish on a roof. */
  readonly height?: number;
  /** The building it stands on: it drops to the ground when that building falls. */
  readonly on?: string;
  /** A building that covers it: it can only be reached once that building falls. */
  readonly hiddenBy?: string;
}

/** Horizontal and vertical reach for lighting a beacon. */
export const BEACON_REACH = 2.8;
const BEACON_HEIGHT_REACH = 3.5;
/** Reach for the relay dish, measured in 3D. */
export const DISH_REACH = 3.5;
const BEACON_LIFT = 1.6;

const UNLIT = new Color('#2EE6FF');
const LIT = new Color('#3DF5A0');

/** Positions of `count` beacons spread evenly along a polyline, ends included. */
export function beaconPositions(trail: BeaconTrail): GroundPoint[] {
  const pts = trail.points;
  if (pts.length === 0 || trail.count <= 0) return [];
  const first = pts[0];
  if (pts.length === 1 || trail.count === 1) return first ? [first] : [];
  const lengths: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths[lengths.length - 1] ?? 0;
  const out: GroundPoint[] = [];
  let segment = 1;
  for (let k = 0; k < trail.count; k++) {
    const d = (total * k) / (trail.count - 1);
    while (segment < pts.length - 1 && (lengths[segment] ?? 0) < d) segment++;
    const a = pts[segment - 1];
    const b = pts[segment];
    if (!a || !b) continue;
    const start = lengths[segment - 1] ?? 0;
    const span = (lengths[segment] ?? 0) - start;
    const t = span > 0 ? (d - start) / span : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

interface Beacon {
  readonly position: Vector3;
  lit: boolean;
  /** Seconds since it lit, for the pop animation. */
  litFor: number;
}

/**
 * Beacons and the relay dish: pickups lit by driving or walking past. They have no
 * colliders, so the Hauler never trips over them; the game checks the player's distance.
 */
export class Pickups {
  readonly group = new Group();
  private readonly beacons: Beacon[] = [];
  private readonly gems: InstancedMesh;
  private readonly posts: InstancedMesh;
  private readonly dish: Group | null = null;
  private readonly dishPosition = new Vector3();
  private readonly dishGround: number;
  private readonly dishBeam: Mesh | null = null;
  private dishFallSpeed = 0;
  private dishFalling = false;
  private dishHidden: boolean;
  private dishFoundValue = false;
  private dishFoundFor = 0;
  private time = 0;
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  private readonly dishDef: RelayDishDefinition | null;

  constructor(
    trails: readonly BeaconTrail[],
    dishDef: RelayDishDefinition | null,
    field: Heightfield,
  ) {
    this.dishDef = dishDef;
    for (const trail of trails) {
      for (const [x, z] of beaconPositions(trail)) {
        this.beacons.push({
          position: new Vector3(x, field.heightAt(x, z) + BEACON_LIFT, z),
          lit: false,
          litFor: 0,
        });
      }
    }
    const count = Math.max(1, this.beacons.length);
    this.gems = new InstancedMesh(
      new OctahedronGeometry(0.62, 0),
      new MeshBasicMaterial({ color: '#FFFFFF' }),
      count,
    );
    this.posts = new InstancedMesh(
      new CylinderGeometry(0.07, 0.1, 1.2, 6),
      new MeshStandardMaterial({ color: '#3A414B', roughness: 0.6, metalness: 0.4 }),
      count,
    );
    this.gems.count = this.beacons.length;
    this.posts.count = this.beacons.length;
    this.beacons.forEach((beacon, i) => {
      this.gems.setColorAt(i, UNLIT);
      const ground = beacon.position.y - BEACON_LIFT;
      this.matrix.compose(
        this.position.set(beacon.position.x, ground + 0.6, beacon.position.z),
        this.quat.identity(),
        this.scale.set(1, 1, 1),
      );
      this.posts.setMatrixAt(i, this.matrix);
    });
    this.gems.frustumCulled = false;
    this.posts.frustumCulled = false;
    this.posts.castShadow = true;
    this.group.add(this.gems, this.posts);

    this.dishHidden = dishDef?.hiddenBy !== undefined;
    this.dishGround = dishDef ? field.heightAt(dishDef.pos[0], dishDef.pos[1]) : 0;
    if (dishDef) {
      this.dishPosition.set(
        dishDef.pos[0],
        this.dishGround + (dishDef.height ?? 0),
        dishDef.pos[1],
      );
      this.dish = buildDish();
      this.dish.position.copy(this.dishPosition);
      this.dishBeam = new Mesh(
        new CylinderGeometry(0.5, 0.5, 30, 12, 1, true),
        new MeshBasicMaterial({
          color: '#2EE6FF',
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      this.dishBeam.position.y = 15;
      this.dish.add(this.dishBeam);
      this.group.add(this.dish);
    }
    this.group.name = 'pickups';
    this.update(0);
  }

  get beaconsTotal(): number {
    return this.beacons.length;
  }

  get beaconsFound(): number {
    return this.beacons.filter((b) => b.lit).length;
  }

  get dishExists(): boolean {
    return this.dishDef !== null;
  }

  get dishFound(): boolean {
    return this.dishFoundValue;
  }

  /** Beacons still to find, for the mini-map. */
  unlitBeacons(out: { x: number; z: number }[]): { x: number; z: number }[] {
    out.length = 0;
    for (const b of this.beacons) if (!b.lit) out.push({ x: b.position.x, z: b.position.z });
    return out;
  }

  /** A building fell: a dish on it drops to the ground, and a hidden dish comes into reach. */
  onBuildingDestroyed(id: string): void {
    if (!this.dishDef) return;
    if (this.dishDef.hiddenBy === id) this.dishHidden = false;
    if (this.dishDef.on === id && !this.dishFoundValue) this.dishFalling = true;
  }

  /**
   * Lights beacons and finds the dish near `at`, the player's position. Returns what it
   * found this step.
   */
  collect(at: Vector3): { beacons: number; dish: boolean } {
    let beacons = 0;
    this.beacons.forEach((b, i) => {
      if (b.lit) return;
      const dx = b.position.x - at.x;
      const dz = b.position.z - at.z;
      if (dx * dx + dz * dz > BEACON_REACH * BEACON_REACH) return;
      if (Math.abs(b.position.y - at.y) > BEACON_HEIGHT_REACH) return;
      b.lit = true;
      beacons++;
      this.gems.setColorAt(i, LIT);
      if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
    });
    let dish = false;
    if (
      this.dishDef &&
      !this.dishFoundValue &&
      !this.dishHidden &&
      this.dishPosition.distanceTo(at) < DISH_REACH
    ) {
      this.dishFoundValue = true;
      dish = true;
    }
    return { beacons, dish };
  }

  update(frameSeconds: number): void {
    this.time += frameSeconds;
    this.beacons.forEach((b, i) => {
      if (b.lit) b.litFor += frameSeconds;
      // Unlit beacons bob and spin; lit ones pop, then settle lower and still.
      const pop = b.lit ? Math.max(0, 1 - b.litFor * 3) : 0;
      const bob = b.lit ? -0.25 : Math.sin(this.time * 2.4 + i * 0.7) * 0.15;
      const size = b.lit ? 0.75 + pop * 0.9 : 1;
      this.quat.setFromAxisAngle(this.up, b.lit ? 0 : this.time * 1.6 + i);
      this.matrix.compose(
        this.position.set(b.position.x, b.position.y + bob, b.position.z),
        this.quat,
        this.scale.set(size, size * 1.3, size),
      );
      this.gems.setMatrixAt(i, this.matrix);
    });
    this.gems.instanceMatrix.needsUpdate = true;

    const dish = this.dish;
    if (!dish) return;
    if (this.dishFalling) {
      this.dishFallSpeed += 9.81 * frameSeconds;
      this.dishPosition.y = Math.max(
        this.dishGround,
        this.dishPosition.y - this.dishFallSpeed * frameSeconds,
      );
      if (this.dishPosition.y <= this.dishGround) this.dishFalling = false;
    }
    dish.position.copy(this.dishPosition);
    const head = dish.children[0];
    if (head) head.rotation.y = this.time * 0.8;
    if (this.dishBeam) {
      this.dishBeam.visible = !this.dishHidden || this.dishFoundValue;
      const material = this.dishBeam.material as MeshBasicMaterial;
      material.opacity = this.dishFoundValue ? 0 : 0.14 + 0.06 * Math.sin(this.time * 3);
    }
    if (this.dishFoundValue) {
      this.dishFoundFor += frameSeconds;
      const s = Math.max(0, 1 - this.dishFoundFor * 1.5);
      dish.scale.setScalar(s);
      dish.position.y += this.dishFoundFor * 4;
      dish.visible = s > 0;
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        (obj.geometry as BufferGeometry).dispose();
        const material = obj.material as MeshBasicMaterial | MeshBasicMaterial[];
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material.dispose();
      }
    });
    this.group.removeFromParent();
  }
}

/** A small relay dish on a tripod mast; child 0 turns. */
function buildDish(): Group {
  const steel = new MeshStandardMaterial({ color: '#C9CED6', roughness: 0.35, metalness: 0.7 });
  const signal = new MeshBasicMaterial({ color: '#2EE6FF' });
  const root = new Group();
  const head = new Group();
  const bowl = new Mesh(new TorusGeometry(0.75, 0.12, 8, 24), steel);
  bowl.rotation.x = Math.PI / 2.6;
  const plate = new Mesh(new CylinderGeometry(0.72, 0.3, 0.25, 20, 1, true), steel);
  plate.rotation.x = Math.PI / 2.6 - Math.PI / 2;
  const feed = new Mesh(new OctahedronGeometry(0.16, 0), signal);
  feed.position.set(0, 0.25, 0.35);
  head.add(bowl, plate, feed);
  head.position.y = 1.6;
  const mast = new Mesh(new CylinderGeometry(0.07, 0.12, 1.6, 8), steel);
  mast.position.y = 0.8;
  const ring = new Mesh(
    new RingGeometry(1.2, 1.45, 32),
    new MeshBasicMaterial({
      color: '#2EE6FF',
      transparent: true,
      opacity: 0.6,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  root.add(head, mast, ring);
  for (const child of [bowl, plate, mast]) child.castShadow = true;
  return root;
}
