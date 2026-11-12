import * as THREE from 'three/webgpu';
import type { EventBus } from '../../engine/events';
import type { GameEvents } from '../events';
import type { LevelData } from '../level';
import type { Vec2 } from '../math';
import type { Effects } from './effects';
import { MeshBuilder } from './mesh-builder';

/** A vehicle lights a beacon when it passes within this distance, in metres. */
const BEACON_RADIUS = 7;
/** A vehicle finds the relay dish within this distance, in metres. */
const DISH_RADIUS = 9;
const SIGNAL = 0x2ee6ff;
const UNLIT = 0x1d5866;
const HAY = 0xd9c27a;

interface Beacon {
  x: number;
  y: number;
  z: number;
  lit: boolean;
}

/** Where the relay dish is in its life. Hidden means that its cover still stands. */
export type DishState = 'hidden' | 'visible' | 'found';

/**
 * The secondary targets of a level: beacons that light up when a vehicle drives past, and one
 * hidden relay dish.
 */
export class Pickups {
  readonly object = new THREE.Group();
  readonly beacons: Beacon[] = [];
  litCount = 0;
  dishState: DishState;
  readonly dishPosition: THREE.Vector3;

  private readonly lamps: THREE.InstancedMesh | undefined;
  private readonly halos: THREE.InstancedMesh | undefined;
  private readonly dish: THREE.Group;
  private readonly dishGlow: THREE.MeshBasicMaterial;
  private readonly bales: THREE.Mesh | undefined;
  /** Id of the building that hides the dish, if a building hides it. */
  private readonly coverBuilding: string | undefined;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private clock = 0;

  constructor(
    level: LevelData,
    heightAt: (x: number, z: number) => number,
    private readonly effects: Effects,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.object.name = 'pickups';
    for (const trail of level.beacons.trails) {
      for (let i = 0; i < trail.count; i += 1) {
        const t = trail.count === 1 ? 0.5 : i / (trail.count - 1);
        const x = trail.from[0] + (trail.to[0] - trail.from[0]) * t;
        const z = trail.from[1] + (trail.to[1] - trail.from[1]) * t;
        this.beacons.push({ x, y: heightAt(x, z), z, lit: false });
      }
    }

    if (this.beacons.length > 0) {
      const posts = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.16, 0.22, 2.6, 6),
        new THREE.MeshLambertMaterial({ color: 0x2b3038 }),
        this.beacons.length,
      );
      this.lamps = new THREE.InstancedMesh(
        new THREE.OctahedronGeometry(1, 0),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        this.beacons.length,
      );
      this.halos = new THREE.InstancedMesh(
        new THREE.RingGeometry(1.5, 2.3, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: SIGNAL,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          toneMapped: false,
        }),
        this.beacons.length,
      );
      this.beacons.forEach((beacon, index) => {
        this.matrix.makeTranslation(beacon.x, beacon.y + 1.3, beacon.z);
        posts.setMatrixAt(index, this.matrix);
        this.lamps?.setColorAt(index, this.color.setHex(UNLIT));
        this.halos?.setMatrixAt(index, this.hidden);
      });
      posts.castShadow = true;
      for (const mesh of [posts, this.lamps, this.halos]) {
        mesh.frustumCulled = false;
        this.object.add(mesh);
      }
    }

    const [dx, dz] = level.relayDish.pos;
    this.dishPosition = new THREE.Vector3(dx, heightAt(dx, dz), dz);
    this.dishGlow = new THREE.MeshBasicMaterial({ color: SIGNAL, toneMapped: false });
    this.dish = createDish(this.dishGlow);
    this.dish.position.copy(this.dishPosition);
    this.object.add(this.dish);

    const cover = level.relayDish.hiddenBy;
    if (cover === 'hay-bales') {
      this.bales = createBales();
      this.bales.position.copy(this.dishPosition);
      this.object.add(this.bales);
      this.dishState = 'hidden';
    } else if (cover) {
      this.coverBuilding = cover;
      this.dishState = 'hidden';
      events.on('buildingDestroyed', ({ building }) => {
        if (building.data.id === this.coverBuilding && this.dishState === 'hidden') {
          this.dishState = 'visible';
          this.dish.visible = true;
        }
      });
    } else {
      this.dishState = 'visible';
    }
    this.dish.visible = this.dishState !== 'hidden';
  }

  /** Lights beacons and finds the dish near the given positions. Call it once per step. */
  step(positions: readonly Vec2[]): void {
    for (const [x, z] of positions) {
      for (const beacon of this.beacons) {
        if (!beacon.lit && Math.hypot(beacon.x - x, beacon.z - z) < BEACON_RADIUS) {
          beacon.lit = true;
          this.litCount += 1;
          this.effects.ring(new THREE.Vector3(beacon.x, beacon.y, beacon.z), 7, SIGNAL);
          this.events.emit('beaconLit', { lit: this.litCount, total: this.beacons.length });
        }
      }
      const distance = Math.hypot(this.dishPosition.x - x, this.dishPosition.z - z);
      if (this.dishState === 'hidden' && this.bales && distance < DISH_RADIUS - 2) {
        // A vehicle scatters the hay bales and uncovers the dish.
        this.object.remove(this.bales);
        this.bales.geometry.dispose();
        (this.bales.material as THREE.Material).dispose();
        this.effects.dust(this.dishPosition, 5, 12, HAY);
        this.dishState = 'visible';
        this.dish.visible = true;
      }
      if (this.dishState === 'visible' && distance < DISH_RADIUS) {
        this.dishState = 'found';
        this.effects.ring(this.dishPosition, 14, SIGNAL);
        this.events.emit('dishFound', {});
      }
    }
  }

  /** Animates the lamps and the dish. */
  sync(frameSeconds: number): void {
    this.clock += frameSeconds;
    if (this.lamps && this.halos) {
      const bob = Math.sin(this.clock * 3) * 0.12;
      this.beacons.forEach((beacon, index) => {
        const size = beacon.lit ? 0.95 : 0.5;
        this.matrix
          .makeRotationY(this.clock * (beacon.lit ? 2.2 : 0.6) + index)
          .scale(new THREE.Vector3(size, size * 1.3, size))
          .setPosition(beacon.x, beacon.y + 3 + (beacon.lit ? bob : 0), beacon.z);
        this.lamps?.setMatrixAt(index, this.matrix);
        this.lamps?.setColorAt(index, this.color.setHex(beacon.lit ? SIGNAL : UNLIT));
        if (beacon.lit) {
          this.matrix.makeTranslation(beacon.x, beacon.y + 0.15, beacon.z);
          this.halos?.setMatrixAt(index, this.matrix);
        }
      });
      this.lamps.instanceMatrix.needsUpdate = true;
      this.halos.instanceMatrix.needsUpdate = true;
      if (this.lamps.instanceColor) {
        this.lamps.instanceColor.needsUpdate = true;
      }
    }
    if (this.dish.visible) {
      this.dish.rotation.y += frameSeconds * (this.dishState === 'found' ? 2.4 : 0.5);
      const pulse = 0.6 + 0.4 * Math.sin(this.clock * (this.dishState === 'found' ? 9 : 3));
      this.dishGlow.color.setHex(SIGNAL).multiplyScalar(pulse);
    }
  }
}

function createDish(glow: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const builder = new MeshBuilder();
  builder.box([2.4, 0.5, 2.4], [0, 0.25, 0], 0x5d6470);
  builder.cylinder(0.3, 0.3, 3.2, [0, 0.5, 0], 0x8e95a0, 8);
  // The bowl is a wide cone that opens upwards and to one side.
  builder.cylinder(0.4, 2.6, 1.3, [0, 3.5, 0], 0xd9d6cc, 12);
  const mesh = new THREE.Mesh(
    builder.build(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  mesh.castShadow = true;
  group.add(mesh);
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), glow);
  tip.position.y = 5.6;
  group.add(tip);
  return group;
}

function createBales(): THREE.Mesh {
  const builder = new MeshBuilder();
  // Round bales, stacked two high around the dish.
  for (const [x, z] of [
    [-2.4, -1.4],
    [2.4, -1.4],
    [-2.4, 1.6],
    [2.4, 1.6],
    [0, 3.2],
    [0, -3.2],
  ]) {
    builder.cylinder(1.5, 1.5, 2.6, [x - 1.3, 1.5, z], HAY, 10, 'x');
  }
  for (const [x, z] of [
    [-1.2, 0],
    [1.2, 0],
  ]) {
    builder.cylinder(1.5, 1.5, 2.6, [x - 1.3, 4.2, z], 0xcdb66c, 10, 'x');
  }
  builder.cylinder(1.5, 1.5, 2.6, [-1.3, 6.6, 0], HAY, 10, 'x');
  const mesh = new THREE.Mesh(
    builder.build(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
