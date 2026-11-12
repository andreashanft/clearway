import * as THREE from 'three/webgpu';
import type { EventBus } from '../../engine/events';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { GameEvents } from '../events';
import type { BuildingData, LevelData } from '../level';
import { DEG, clamp, headingVector, toBoxLocal, type OrientedBox, type Vec2 } from '../math';
import { buildSegmentGeometry, segmentLayout, type SegmentLayout } from './building-models';
import { STRENGTH_HP, applySegmentDamage, blastDamage } from './damage';
import type { Debris } from './debris';
import type { Effects } from './effects';
import { shade } from './mesh-builder';

/** Rubble pieces that stay where a segment fell. They are decoration and have no collider. */
const RUBBLE_PER_SEGMENT = 7;
/** A segment sheds this many chunks when it falls, at most. */
const MAX_CHUNKS_PER_SEGMENT = 12;

interface Segment {
  mesh: THREE.Mesh;
  collider: RAPIER.Collider | undefined;
  /** Footprint of the segment on the ground plane. */
  box: OrientedBox;
  center: THREE.Vector3;
  cracked: boolean;
}

/** Points at one segment of one building. */
export interface SegmentRef {
  building: Building;
  index: number;
}

/** A destructible building, cut into segments along its longer side. */
export class Building {
  readonly layout: SegmentLayout;
  readonly object = new THREE.Group();
  readonly segments: Segment[] = [];
  /** Hit points of every segment. */
  readonly hp: number[];
  readonly maxHp: number;
  /** Heading of the longer side in radians. */
  readonly heading: number;
  /** Footprint of the whole building. */
  readonly footprint: OrientedBox;

  constructor(
    readonly data: BuildingData,
    readonly baseY: number,
  ) {
    this.layout = segmentLayout(data);
    this.maxHp = STRENGTH_HP[data.strength];
    this.hp = new Array<number>(this.layout.count).fill(this.maxHp);
    this.heading = (data.yaw + (this.layout.alongX ? 0 : 90)) * DEG;
    this.footprint = {
      center: data.pos,
      half: [(this.layout.length * this.layout.count) / 2, this.layout.depth / 2],
      heading: this.heading,
    };
    this.object.name = `building-${data.id}`;
    this.object.position.set(data.pos[0], baseY, data.pos[1]);
    this.object.rotation.y = -this.heading;
  }

  /** True when every segment has fallen. */
  get destroyed(): boolean {
    return this.hp.every((value) => value <= 0);
  }

  /** The id that route obstacles are counted by: the group, or the building itself. */
  get obstacleId(): string {
    return this.data.group ?? this.data.id;
  }
}

/** Creates, damages and destroys the buildings of a level. */
export class Buildings {
  readonly object = new THREE.Group();
  readonly list: Building[] = [];

  private readonly byCollider = new Map<number, SegmentRef>();
  private readonly intactMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly crackedMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: createCrackTexture(),
  });
  private readonly rubble: THREE.InstancedMesh;
  private readonly dustPatches: THREE.InstancedMesh;
  private rubbleCount = 0;
  private patchCount = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(
    level: LevelData,
    heightAt: (x: number, z: number) => number,
    private readonly physics: PhysicsWorld,
    private readonly debris: Debris,
    private readonly effects: Effects,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.object.name = 'buildings';
    let segmentTotal = 0;
    for (const data of level.buildings) {
      const building = new Building(data, heightAt(data.pos[0], data.pos[1]));
      this.createSegments(building);
      this.list.push(building);
      this.object.add(building.object);
      segmentTotal += building.layout.count;
    }

    this.rubble = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      Math.max(1, segmentTotal * RUBBLE_PER_SEGMENT),
    );
    this.rubble.name = 'rubble';
    this.rubble.count = 0;
    this.rubble.receiveShadow = true;
    this.rubble.frustumCulled = false;
    this.dustPatches = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
      Math.max(1, segmentTotal),
    );
    this.dustPatches.name = 'rubble-dust';
    this.dustPatches.count = 0;
    this.dustPatches.frustumCulled = false;
    // Create the colour attributes before the first frame. A mesh that is first drawn without
    // them keeps ignoring instance colours.
    this.rubble.setColorAt(0, this.color.setHex(0xffffff));
    this.dustPatches.setColorAt(0, this.color.setHex(0xffffff));
    this.object.add(this.dustPatches, this.rubble);
  }

  /** Returns the building segment that a collider belongs to. */
  lookup(colliderHandle: number): SegmentRef | undefined {
    return this.byCollider.get(colliderHandle);
  }

  /** Returns a building by id. */
  get(id: string): Building | undefined {
    return this.list.find((building) => building.data.id === id);
  }

  /**
   * Damages one segment. The collapse can spread to its neighbours.
   *
   * @param push Velocity that the falling chunks inherit, for example from the ramming vehicle.
   * @returns How many segments fell.
   */
  damage(ref: SegmentRef, amount: number, push: THREE.Vector3): number {
    const { building } = ref;
    if (amount <= 0 || building.hp[ref.index] <= 0) {
      return 0;
    }
    const wasDestroyed = building.destroyed;
    const fallen = applySegmentDamage(building.hp, building.maxHp, ref.index, amount);
    for (const index of fallen) {
      this.dropSegment(building, index, push);
    }
    building.segments.forEach((segment, index) => {
      const hp = building.hp[index];
      if (hp > 0 && hp <= building.maxHp / 2 && !segment.cracked) {
        this.crackSegment(building, segment);
      }
    });
    if (!wasDestroyed && building.destroyed) {
      this.events.emit('buildingDestroyed', { building });
    }
    return fallen.length;
  }

  /** Damages every segment within the radius of an explosion. Concrete is not spared. */
  blast(center: THREE.Vector3, radius: number, peak: number): void {
    const push = new THREE.Vector3();
    for (const building of this.list) {
      building.segments.forEach((segment, index) => {
        if (building.hp[index] <= 0) {
          return;
        }
        const distance = distanceToBox([center.x, center.z], segment.box);
        const amount = blastDamage(peak, radius, distance);
        if (amount > 0) {
          push.copy(segment.center).sub(center).setY(0).normalize().multiplyScalar(9);
          this.damage({ building, index }, amount, push);
        }
      });
    }
  }

  /** Number of buildings that are completely destroyed. */
  get destroyedCount(): number {
    return this.list.reduce((count, building) => count + (building.destroyed ? 1 : 0), 0);
  }

  private createSegments(building: Building): void {
    const { data, layout } = building;
    const [forwardX, forwardZ] = headingVector(building.heading);
    const height = data.size[1];
    const round = data.kind === 'silo' || data.kind === 'chimney';

    for (let index = 0; index < layout.count; index += 1) {
      const offset = (index - (layout.count - 1) / 2) * layout.length;
      const mesh = new THREE.Mesh(buildSegmentGeometry(data, layout, index), this.intactMaterial);
      mesh.position.x = offset;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      building.object.add(mesh);

      const center = new THREE.Vector3(
        data.pos[0] + forwardX * offset,
        building.baseY + height / 2,
        data.pos[1] + forwardZ * offset,
      );
      const shape = round
        ? RAPIER.ColliderDesc.cylinder(height / 2, Math.min(data.size[0], data.size[2]) / 2)
        : RAPIER.ColliderDesc.cuboid(layout.length / 2, height / 2, layout.depth / 2);
      const half = -building.heading / 2;
      const collider = this.physics.world.createCollider(
        shape
          .setTranslation(center.x, center.y, center.z)
          .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
          .setFriction(0.3)
          .setCollisionGroups(collisionGroups(Layer.building, 0xffff)),
      );
      this.byCollider.set(collider.handle, { building, index });

      building.segments.push({
        mesh,
        collider,
        box: {
          center: [center.x, center.z],
          half: [layout.length / 2, layout.depth / 2],
          heading: building.heading,
        },
        center,
        cracked: false,
      });
    }
  }

  private crackSegment(building: Building, segment: Segment): void {
    segment.cracked = true;
    segment.mesh.material = this.crackedMaterial;
    // A cracked segment sags a little, so that the damage reads from far away.
    segment.mesh.rotation.z = (Math.random() - 0.5) * 0.07;
    segment.mesh.rotation.x = (Math.random() - 0.5) * 0.07;
    segment.mesh.position.y = -0.25;
    this.effects.dust(segment.center, building.layout.depth * 0.35, 6);
    this.events.emit('buildingCracked', { building, position: segment.center });
  }

  private dropSegment(building: Building, index: number, push: THREE.Vector3): void {
    const segment = building.segments[index];
    if (segment.collider) {
      this.byCollider.delete(segment.collider.handle);
      this.physics.world.removeCollider(segment.collider, true);
      segment.collider = undefined;
    }
    building.object.remove(segment.mesh);
    segment.mesh.geometry.dispose();

    this.spawnChunks(building, segment, push);
    this.addRubble(building, segment);
    this.effects.dust(
      segment.center,
      Math.max(building.layout.length, building.layout.depth) * 0.5,
      14,
    );
    this.events.emit('segmentDestroyed', { building, position: segment.center });
  }

  private spawnChunks(building: Building, segment: Segment, push: THREE.Vector3): void {
    const { layout, data } = building;
    const height = data.size[1];
    const wall = Number.parseInt(data.colors.wall.slice(1), 16);
    const roof = Number.parseInt(data.colors.roof.slice(1), 16);
    const volume = layout.length * height * layout.depth;
    const count = clamp(Math.round(volume / 110), 6, MAX_CHUNKS_PER_SEGMENT);
    const [forwardX, forwardZ] = headingVector(building.heading);

    const position = new THREE.Vector3();
    const size = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const spin = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const along = (Math.random() - 0.5) * layout.length * 0.8;
      const across = (Math.random() - 0.5) * layout.depth * 0.8;
      const up = (0.15 + Math.random() * 0.75) * height;
      position.set(
        segment.center.x + forwardX * along - forwardZ * across,
        building.baseY + up,
        segment.center.z + forwardZ * along + forwardX * across,
      );
      const scale = 0.5 + Math.random() * 0.7;
      size.set(
        clamp(layout.length * 0.3 * scale, 1.2, 5),
        clamp(height * 0.28 * scale, 1, 4),
        clamp(layout.depth * 0.3 * scale, 1.2, 5),
      );
      // Chunks fly outwards from the middle of the segment, upwards, and along the push.
      velocity
        .set(position.x - segment.center.x, 0, position.z - segment.center.z)
        .normalize()
        .multiplyScalar(3 + Math.random() * 5)
        .addScaledVector(push, 0.45 + Math.random() * 0.35);
      velocity.y = 6 + Math.random() * 9;
      spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      const isRoof = up > height * 0.62;
      this.debris.spawn(
        position,
        size,
        isRoof ? roof : shade(wall, (Math.random() - 0.5) * 0.08),
        velocity,
        spin,
      );
    }
  }

  /** Leaves a dusty patch and a few half-buried pieces where a segment stood. */
  private addRubble(building: Building, segment: Segment): void {
    const { layout, data } = building;
    const wall = shade(data.colors.wall, -0.12);
    const roof = shade(data.colors.roof, -0.08);
    const [forwardX, forwardZ] = headingVector(building.heading);
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();

    if (this.patchCount < this.dustPatches.instanceMatrix.count) {
      this.matrix.compose(
        new THREE.Vector3(
          segment.center.x,
          building.baseY + 0.08 + this.patchCount * 0.004,
          segment.center.z,
        ),
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -building.heading),
        new THREE.Vector3(layout.length * 0.72, 1, layout.depth * 0.72),
      );
      this.dustPatches.setMatrixAt(this.patchCount, this.matrix);
      this.dustPatches.setColorAt(this.patchCount, this.color.setHex(0xcfc3a4));
      this.patchCount += 1;
      this.dustPatches.count = this.patchCount;
      this.dustPatches.instanceMatrix.needsUpdate = true;
      if (this.dustPatches.instanceColor) {
        this.dustPatches.instanceColor.needsUpdate = true;
      }
    }

    for (
      let i = 0;
      i < RUBBLE_PER_SEGMENT && this.rubbleCount < this.rubble.instanceMatrix.count;
      i += 1
    ) {
      const along = (Math.random() - 0.5) * layout.length * 0.9;
      const across = (Math.random() - 0.5) * layout.depth * 0.9;
      const size = 0.8 + Math.random() * 1.8;
      euler.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
      this.matrix.compose(
        new THREE.Vector3(
          segment.center.x + forwardX * along - forwardZ * across,
          building.baseY + size * 0.12,
          segment.center.z + forwardZ * along + forwardX * across,
        ),
        rotation.setFromEuler(euler),
        new THREE.Vector3(size * (0.8 + Math.random()), size * 0.5, size),
      );
      this.rubble.setMatrixAt(this.rubbleCount, this.matrix);
      this.rubble.setColorAt(this.rubbleCount, this.color.setHex(i % 3 === 0 ? roof : wall));
      this.rubbleCount += 1;
    }
    this.rubble.count = this.rubbleCount;
    this.rubble.instanceMatrix.needsUpdate = true;
    if (this.rubble.instanceColor) {
      this.rubble.instanceColor.needsUpdate = true;
    }
  }
}

/** Distance on the ground plane from a point to the nearest point of a box. 0 inside the box. */
export function distanceToBox(point: Vec2, box: OrientedBox): number {
  const local = toBoxLocal(point, box);
  const dx = Math.max(0, Math.abs(local[0]) - box.half[0]);
  const dz = Math.max(0, Math.abs(local[1]) - box.half[1]);
  return Math.hypot(dx, dz);
}

/** Paints jagged dark lines on white. Cracked segments multiply it with their colours. */
function createCrackTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('The browser cannot create a 2D canvas for the crack texture.');
  }
  context.fillStyle = '#d9d2c8';
  context.fillRect(0, 0, size, size);
  let seed = 99;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (let crack = 0; crack < 9; crack += 1) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    context.strokeStyle = crack % 3 === 0 ? '#3a3632' : '#5b554e';
    context.lineWidth = 2 + random() * 3;
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 9; step += 1) {
      angle += (random() - 0.5) * 1.6;
      x += Math.cos(angle) * (12 + random() * 22);
      y += Math.sin(angle) * (12 + random() * 22);
      context.lineTo(x, y);
    }
    context.stroke();
  }
  for (let blotch = 0; blotch < 14; blotch += 1) {
    context.fillStyle = 'rgba(70, 62, 54, 0.25)';
    context.beginPath();
    context.arc(random() * size, random() * size, 8 + random() * 22, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
