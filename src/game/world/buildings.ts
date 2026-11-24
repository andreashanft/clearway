import * as THREE from 'three/webgpu';
import type { EventBus } from '../../engine/events';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { GameEvents } from '../events';
import type { BuildingClass, BuildingColors, BuildingData, LevelData } from '../level';
import { clamp, pointInPolygon, type Vec2 } from '../math';
import { distanceToPolygon } from '../polygon';
import { FLOOR_HEIGHT, classifyBuilding } from './building-class';
import {
  buildPieceGeometry,
  createCrackTexture,
  createWindowTexture,
  paletteColors,
  type PieceStyle,
} from './building-models';
import { applyPieceDamage, blastDamage, hitPoints, type PieceGraph } from './damage';
import type { Debris } from './debris';
import { EFFECT_COLORS, type Effects } from './effects';
import { shade } from './mesh-builder';
import { cutFootprint, type BuildingShape } from './pieces';

/** Rubble pieces that stay where a piece fell. They are decoration and have no collider. */
const RUBBLE_PER_PIECE = 6;
/** A piece sheds at least and at most this many chunks when it falls. */
const MIN_CHUNKS = 6;
const MAX_CHUNKS = 14;
/** A tower leans this far away from the side that broke it while it sinks, in radians. */
const MAX_LEAN = (14 * Math.PI) / 180;
/** The neighbours of a falling tower take damage at these shares of the collapse. */
const COLLAPSE_WAVES = [0.35, 0.8];

interface PieceState {
  mesh: THREE.Mesh | undefined;
  /** One convex collider, or several for a concave piece. Empty once the piece has fallen. */
  colliders: RAPIER.Collider[];
  polygon: Vec2[];
  /** Centre of the piece at half its height. */
  center: THREE.Vector3;
  /** Volume in cubic metres. */
  volume: number;
  cracked: boolean;
}

/** Points at one piece of one building. */
export interface PieceRef {
  building: Building;
  index: number;
}

/** The fall of a tower, from the moment its base gave way. */
interface Collapse {
  elapsed: number;
  duration: number;
  /** Direction on the ground plane in which the tower leans. */
  lean: Vec2;
  /** Floors that have sunk into the ground so far. */
  floors: number;
  /** How many of the waves of damage to the neighbours have gone out. */
  waves: number;
  /** How many collapses led to this one. 0 when the player broke the tower directly. */
  chain: number;
  done: boolean;
}

/**
 * A destructible building.
 *
 * A low building is cut into pieces, and each piece has its own hit points and falls on its own.
 * A tower shares one pool of hit points among its pieces. When the pool is empty, the whole tower
 * sinks into the ground floor by floor.
 */
export class Building {
  readonly shape: BuildingShape;
  readonly kind: BuildingClass;
  readonly tower: boolean;
  readonly name: string;
  readonly colors: BuildingColors;
  /** Heights of the bottom and the roof above the ground, in metres. */
  readonly base: number;
  readonly height: number;
  /** Centre of the footprint. */
  readonly center: Vec2;
  readonly object = new THREE.Group();
  readonly pieces: PieceState[] = [];
  /** Full hit points of every piece. A tower's pieces share `towerMaxHp` instead. */
  readonly maxHp: number[];
  /** Current hit points of every piece of a low building. */
  readonly hp: number[];
  readonly towerMaxHp: number;
  towerHp: number;
  collapse: Collapse | undefined;
  /** Direction of the last ram on the ground plane, for the lean of a tower. */
  lastPush: Vec2 = [0, 0];
  /** The buildings that a part above the ground stands on. */
  readonly supports: Building[] = [];

  /** Height of the ground under the building. */
  readonly baseY: number;

  constructor(
    readonly data: BuildingData,
    heightAt: (x: number, z: number) => number,
  ) {
    this.shape = cutFootprint(data.footprint);
    this.baseY = heightAt(this.shape.center[0], this.shape.center[1]);
    this.base = data.base ?? 0;
    this.height = Math.max(this.base + 1, data.height);
    this.kind = classifyBuilding(this.height, this.shape.area);
    this.tower = this.kind === 'tower';
    this.name = data.name ?? (this.kind === 'block' ? 'building' : this.kind);
    this.colors = data.colors ?? paletteColors(data.id, this.kind);
    this.center = this.shape.center;
    const storey = this.height - this.base;
    this.maxHp = this.shape.pieces.map((piece) => hitPoints(piece.area * storey));
    this.hp = [...this.maxHp];
    this.towerMaxHp = hitPoints(this.shape.area * storey);
    this.towerHp = this.towerMaxHp;
    this.object.name = `building-${data.id}`;
    this.object.position.set(this.center[0], this.baseY, this.center[1]);
  }

  /** True while a piece still stands. */
  standing(index: number): boolean {
    return this.tower ? this.towerHp > 0 : this.hp[index] > 0;
  }

  /** True when the building has fallen, or a tower has started to fall. */
  get destroyed(): boolean {
    return this.tower ? this.towerHp <= 0 : this.hp.every((value) => value <= 0);
  }

  /** The id that route obstacles are counted by: the group, or the building itself. */
  get obstacleId(): string {
    return this.data.group ?? this.data.id;
  }

  /** Volume of the whole building in cubic metres. */
  get volume(): number {
    return this.shape.area * (this.height - this.base);
  }

  /** The neighbours, hit points and centres of the pieces, for the spread of damage. */
  get graph(): PieceGraph {
    return {
      maxHp: this.maxHp,
      neighbours: this.shape.neighbours,
      centers: this.shape.pieces.map((piece) => piece.center),
    };
  }
}

/** Creates, damages and destroys the buildings of a level. */
export class Buildings {
  readonly object = new THREE.Group();
  readonly list: Building[] = [];

  private readonly byCollider = new Map<number, PieceRef>();
  private readonly intact: THREE.Material[];
  private readonly cracked: THREE.Material[];
  private readonly textures: THREE.Texture[];
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
    const windows = createWindowTexture(false);
    const crackedWindows = createWindowTexture(true);
    const cracks = createCrackTexture();
    this.textures = [windows, crackedWindows, cracks];
    this.intact = [
      new THREE.MeshLambertMaterial({ vertexColors: true, map: windows }),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    ];
    this.cracked = [
      new THREE.MeshLambertMaterial({ vertexColors: true, map: crackedWindows }),
      new THREE.MeshLambertMaterial({ vertexColors: true, map: cracks }),
    ];

    let pieceTotal = 0;
    for (const data of level.buildings) {
      const building = new Building(data, heightAt);
      if (building.shape.pieces.length === 0) {
        // A footprint without area, for example from broken map data.
        continue;
      }
      this.createPieces(building);
      this.list.push(building);
      this.object.add(building.object);
      pieceTotal += building.pieces.length;
    }

    this.rubble = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      Math.max(1, pieceTotal * RUBBLE_PER_PIECE),
    );
    this.rubble.name = 'rubble';
    this.rubble.count = 0;
    this.rubble.receiveShadow = true;
    this.rubble.frustumCulled = false;
    this.dustPatches = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
      Math.max(1, pieceTotal),
    );
    this.dustPatches.name = 'rubble-dust';
    this.dustPatches.count = 0;
    this.dustPatches.frustumCulled = false;
    // Create the colour attributes before the first frame. A mesh that is first drawn without
    // them keeps ignoring instance colours.
    this.rubble.setColorAt(0, this.color.setHex(0xffffff));
    this.dustPatches.setColorAt(0, this.color.setHex(0xffffff));
    this.object.add(this.dustPatches, this.rubble);
    this.linkSupports();
  }

  /**
   * Finds, for every part that starts above the ground, the buildings that it stands on. When one
   * of them falls, the part falls with it.
   */
  private linkSupports(): void {
    for (const part of this.list) {
      if (part.base <= 0.5) {
        continue;
      }
      for (const support of this.list) {
        if (
          support !== part &&
          support.base < part.base &&
          support.height >= part.base - 1 &&
          pointInPolygon(part.center, support.shape.outline)
        ) {
          part.supports.push(support);
        }
      }
    }
    this.events.on('buildingDestroyed', ({ building }) => {
      for (const part of this.list) {
        if (!part.destroyed && part.supports.includes(building)) {
          this.dropPart(part);
        }
      }
    });
  }

  /** Brings down a part whose support fell: a tower part sinks, a low part breaks. */
  private dropPart(part: Building): void {
    const push = new THREE.Vector3();
    if (part.tower) {
      this.damage({ building: part, index: 0 }, part.towerHp, push, 1);
      return;
    }
    part.pieces.forEach((_, index) => {
      if (part.standing(index)) {
        this.damage({ building: part, index }, part.hp[index], push, 1);
      }
    });
  }

  /** Frees the materials and textures. They may not be on any mesh at the moment. */
  dispose(): void {
    for (const texture of this.textures) {
      texture.dispose();
    }
    for (const material of [...this.intact, ...this.cracked]) {
      material.dispose();
    }
  }

  /** Returns the building piece that a collider belongs to. */
  lookup(colliderHandle: number): PieceRef | undefined {
    return this.byCollider.get(colliderHandle);
  }

  /** Returns a building by id. */
  get(id: string): Building | undefined {
    return this.list.find((building) => building.data.id === id);
  }

  /**
   * Damages one piece. In a low building, the collapse can spread to other pieces. In a tower,
   * the damage goes to the tower's shared hit points.
   *
   * @param push Velocity of the ram. The falling chunks inherit it, and a tower leans along it.
   * @param chain How many collapses led to this damage. 0 for the player's own ram.
   * @param ram True for a vehicle's ram. Only a ram carries its spare damage on through pieces.
   * @returns How many pieces fell, or 1 when a tower started to fall.
   */
  damage(ref: PieceRef, amount: number, push: THREE.Vector3, chain = 0, ram = false): number {
    const { building } = ref;
    if (amount <= 0 || !building.standing(ref.index)) {
      return 0;
    }
    if (Math.hypot(push.x, push.z) > 0.5) {
      building.lastPush = [push.x, push.z];
    }
    if (building.tower) {
      return this.damageTower(building, amount, chain);
    }
    const ramming = ram && chain === 0 && Math.hypot(push.x, push.z) > 0.5;
    const fallen = applyPieceDamage(
      building.hp,
      building.graph,
      ref.index,
      amount,
      ramming ? [push.x, push.z] : undefined,
    );
    for (const index of fallen) {
      this.dropPiece(building, index, push, chain);
    }
    building.pieces.forEach((piece, index) => {
      const hp = building.hp[index];
      if (hp > 0 && hp <= building.maxHp[index] / 2 && !piece.cracked) {
        this.crackPiece(building, index);
      }
    });
    if (fallen.length > 0 && building.destroyed) {
      this.events.emit('buildingDestroyed', { building });
    }
    return fallen.length;
  }

  /** Damages every piece within the radius of an explosion. */
  blast(center: THREE.Vector3, radius: number, peak: number, chain = 0, spare?: Building): void {
    const push = new THREE.Vector3();
    const point: Vec2 = [center.x, center.z];
    for (const building of this.list) {
      if (building === spare || building.destroyed) {
        continue;
      }
      if (building.tower) {
        const distance = distanceToPolygon(point, building.shape.outline);
        const amount = blastDamage(peak, radius, distance);
        if (amount > 0) {
          push.set(building.center[0] - center.x, 0, building.center[1] - center.z);
          push.normalize().multiplyScalar(9);
          this.damage({ building, index: 0 }, amount, push, chain);
        }
        continue;
      }
      building.pieces.forEach((piece, index) => {
        if (!building.standing(index)) {
          return;
        }
        const amount = blastDamage(peak, radius, distanceToPolygon(point, piece.polygon));
        if (amount > 0) {
          push.copy(piece.center).sub(center).setY(0).normalize().multiplyScalar(9);
          this.damage({ building, index }, amount, push, chain);
        }
      });
    }
  }

  /** Advances the towers that are falling. Call it once per simulation step. */
  step(dt: number): void {
    for (const building of this.list) {
      const collapse = building.collapse;
      if (collapse && !collapse.done) {
        this.stepCollapse(building, collapse, dt);
      }
    }
  }

  /** Number of buildings that are completely destroyed. */
  get destroyedCount(): number {
    return this.list.reduce((count, building) => count + (building.destroyed ? 1 : 0), 0);
  }

  private createPieces(building: Building): void {
    const { shape } = building;
    const gable =
      building.kind === 'house' && shape.pieces.length === 1 && shape.rectangular
        ? shape.rect
        : undefined;
    const style: PieceStyle = {
      colors: building.colors,
      base: building.base,
      height: building.height,
      gable: building.base === 0 ? gable : undefined,
    };
    const bottom = building.baseY + building.base;
    const top = building.baseY + building.height;
    shape.pieces.forEach((piece, index) => {
      const mesh = new THREE.Mesh(buildPieceGeometry(piece, building.center, style), this.intact);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      building.object.add(mesh);

      const colliders: RAPIER.Collider[] = [];
      for (const part of convexParts(piece.polygon, piece.convex)) {
        const points = new Float32Array(part.length * 6);
        part.forEach(([x, z], i) => {
          points.set([x, bottom, z, x, top, z], i * 6);
        });
        // A part of no area has no hull, so it gets no collider.
        const desc = RAPIER.ColliderDesc.convexHull(points);
        if (desc) {
          const collider = this.physics.world.createCollider(
            desc.setFriction(0.3).setCollisionGroups(collisionGroups(Layer.building, 0xffff)),
          );
          this.byCollider.set(collider.handle, { building, index });
          colliders.push(collider);
        }
      }
      building.pieces.push({
        mesh,
        colliders,
        polygon: piece.polygon,
        center: new THREE.Vector3(piece.center[0], (bottom + top) / 2, piece.center[1]),
        volume: piece.area * (building.height - building.base),
        cracked: false,
      });
    });
  }

  private damageTower(building: Building, amount: number, chain: number): number {
    const before = building.towerHp;
    building.towerHp = Math.max(0, before - amount);
    if (building.towerHp > 0) {
      if (building.towerHp <= building.towerMaxHp / 2 && !building.pieces[0]?.cracked) {
        building.pieces.forEach((_, index) => this.crackPiece(building, index, true));
        const position = new THREE.Vector3(
          building.center[0],
          building.baseY + 1,
          building.center[1],
        );
        this.effects.dust(position, Math.sqrt(building.shape.area) * 0.5 + 3, 10);
        this.events.emit('buildingCracked', { building, position });
      }
      return 0;
    }
    this.startCollapse(building, chain);
    return 1;
  }

  /** Shows cracks on a piece. `quiet` leaves out the dust and the event, for a whole tower. */
  private crackPiece(building: Building, index: number, quiet = false): void {
    const piece = building.pieces[index];
    if (piece.cracked || !piece.mesh) {
      return;
    }
    piece.cracked = true;
    piece.mesh.material = this.cracked;
    if (!building.tower) {
      // A cracked piece sags a little, so that the damage reads from far away. The geometry sits
      // around the building's centre, so the piece only moves down and does not tilt.
      piece.mesh.position.y = -0.25;
    }
    if (quiet) {
      return;
    }
    const position = new THREE.Vector3(piece.center.x, building.baseY + 1, piece.center.z);
    this.effects.dust(position, Math.sqrt(piece.volume) * 0.12 + 2, 6);
    this.events.emit('buildingCracked', { building, position });
  }

  private removeCollider(piece: PieceState): void {
    for (const collider of piece.colliders) {
      this.byCollider.delete(collider.handle);
      this.physics.world.removeCollider(collider, true);
    }
    piece.colliders.length = 0;
  }

  private removeMesh(building: Building, piece: PieceState): void {
    if (piece.mesh) {
      building.object.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      piece.mesh = undefined;
    }
  }

  private dropPiece(building: Building, index: number, push: THREE.Vector3, chain: number): void {
    const piece = building.pieces[index];
    this.removeCollider(piece);
    this.removeMesh(building, piece);
    const height = building.height - building.base;
    const reach = Math.sqrt(building.shape.pieces[index].area);
    this.spawnChunks(building, piece, push, height, reach);
    this.addRubble(building, index);
    const ground = new THREE.Vector3(piece.center.x, building.baseY + 0.5, piece.center.z);
    this.effects.dust(ground, reach * 0.7 + height * 0.25, 16);
    if (building.kind === 'block') {
      this.effects.sparks(piece.center, 8, 10);
    }
    this.events.emit('pieceDestroyed', {
      building,
      position: piece.center,
      volume: piece.volume,
      chain,
    });
  }

  private spawnChunks(
    building: Building,
    piece: PieceState,
    push: THREE.Vector3,
    height: number,
    reach: number,
  ): void {
    const wall = Number.parseInt(building.colors.wall.slice(1), 16);
    const roof = Number.parseInt(building.colors.roof.slice(1), 16);
    const count = clamp(Math.round(piece.volume / 90), MIN_CHUNKS, MAX_CHUNKS);
    const position = new THREE.Vector3();
    const size = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const spin = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const up = (0.15 + Math.random() * 0.8) * height;
      position.set(
        piece.center.x + (Math.random() - 0.5) * reach * 0.8,
        building.baseY + building.base + up,
        piece.center.z + (Math.random() - 0.5) * reach * 0.8,
      );
      const scale = 0.5 + Math.random() * 0.8;
      size.set(
        clamp(reach * 0.3 * scale, 1.2, 5.5),
        clamp(height * 0.3 * scale, 1, 4.5),
        clamp(reach * 0.3 * scale, 1.2, 5.5),
      );
      // Chunks fly outwards from the middle of the piece, upwards, and along the push.
      velocity
        .set(position.x - piece.center.x, 0, position.z - piece.center.z)
        .normalize()
        .multiplyScalar(4 + Math.random() * 7)
        .addScaledVector(push, 0.5 + Math.random() * 0.4);
      velocity.y = 7 + Math.random() * 11;
      spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      const isRoof = up > height * 0.7;
      this.debris.spawn(
        position,
        size,
        isRoof ? roof : shade(wall, (Math.random() - 0.5) * 0.08),
        velocity,
        spin,
      );
    }
  }

  /** Leaves a dusty patch and a few half-buried pieces where a piece stood. */
  private addRubble(building: Building, index: number): void {
    const piece = building.shape.pieces[index];
    const wall = shade(building.colors.wall, -0.12);
    const roof = shade(building.colors.roof, -0.08);
    const reach = Math.sqrt(piece.area);
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    // A part that stood on another building falls to the ground too.
    const ground = building.baseY;

    if (this.patchCount < this.dustPatches.instanceMatrix.count) {
      this.matrix.compose(
        new THREE.Vector3(
          piece.center[0],
          ground + 0.08 + this.patchCount * 0.002,
          piece.center[1],
        ),
        rotation.identity(),
        new THREE.Vector3(reach * 0.62, 1, reach * 0.62),
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
      i < RUBBLE_PER_PIECE && this.rubbleCount < this.rubble.instanceMatrix.count;
      i += 1
    ) {
      const size = 0.8 + Math.random() * 1.8;
      euler.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
      this.matrix.compose(
        new THREE.Vector3(
          piece.center[0] + (Math.random() - 0.5) * reach * 0.8,
          ground + size * 0.12,
          piece.center[1] + (Math.random() - 0.5) * reach * 0.8,
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

  private startCollapse(building: Building, chain: number): void {
    const [px, pz] = building.lastPush;
    const length = Math.hypot(px, pz);
    const angle = Math.random() * Math.PI * 2;
    const lean: Vec2 =
      length > 0.5 ? [px / length, pz / length] : [Math.cos(angle), Math.sin(angle)];
    building.collapse = {
      elapsed: 0,
      // A tall tower takes longer, so that the floors visibly go one after another.
      duration: 1.2 + (building.height - building.base) / 45,
      lean,
      floors: 0,
      waves: 0,
      chain,
      done: false,
    };
    for (const piece of building.pieces) {
      this.removeCollider(piece);
    }
    const position = new THREE.Vector3(building.center[0], building.baseY + 1, building.center[1]);
    const radius = Math.sqrt(building.shape.area) * 0.6 + 6;
    this.effects.ring(position, radius * 1.6, EFFECT_COLORS.dust);
    this.effects.dust(position, radius, 30);
    this.events.emit('towerCollapsing', { building, position, chain });
    this.events.emit('buildingDestroyed', { building });
  }

  private stepCollapse(building: Building, collapse: Collapse, dt: number): void {
    collapse.elapsed += dt;
    const share = Math.min(1, collapse.elapsed / collapse.duration);
    // The fall speeds up like a real one. A part on top of another building sinks all the way.
    const depth = building.height * share ** 1.7;
    building.object.position.y = building.baseY - depth;
    const [lx, lz] = collapse.lean;
    building.object.quaternion.setFromAxisAngle(
      new THREE.Vector3(lz, 0, -lx),
      MAX_LEAN * share ** 1.2,
    );

    const floors = Math.floor(depth / FLOOR_HEIGHT);
    while (collapse.floors < floors) {
      collapse.floors += 1;
      this.burstFloor(building, collapse);
    }
    while (collapse.waves < COLLAPSE_WAVES.length && share >= COLLAPSE_WAVES[collapse.waves]) {
      collapse.waves += 1;
      this.hitNeighbours(building, collapse);
    }
    if (share >= 1) {
      collapse.done = true;
      building.pieces.forEach((piece, index) => {
        this.removeMesh(building, piece);
        this.addRubble(building, index);
      });
      const position = new THREE.Vector3(
        building.center[0],
        building.baseY + 1,
        building.center[1],
      );
      this.effects.dust(position, Math.sqrt(building.shape.area) * 0.7 + 6, 24);
      this.events.emit('towerFell', { building, position });
    }
  }

  /** One floor reaches the ground: dust and chunks burst out around the base. */
  private burstFloor(building: Building, collapse: Collapse): void {
    const outline = building.shape.outline;
    const [lx, lz] = collapse.lean;
    const ground = building.baseY + 0.6;
    const wall = Number.parseInt(building.colors.wall.slice(1), 16);
    const position = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const size = new THREE.Vector3();
    const spin = new THREE.Vector3();
    // A cloud of dust rolls out around the base and hides where the floors sink into the ground.
    const scale = clamp(Math.sqrt(building.shape.area) / 20, 0.6, 1.6);
    const bursts = 5;
    for (let i = 0; i < bursts; i += 1) {
      const a = outline[Math.floor(Math.random() * outline.length)];
      const b = outline[(outline.indexOf(a) + 1) % outline.length];
      const t = Math.random();
      position.set(a[0] + (b[0] - a[0]) * t, ground, a[1] + (b[1] - a[1]) * t);
      const out = new THREE.Vector3(
        position.x - building.center[0],
        0,
        position.z - building.center[1],
      ).normalize();
      velocity.copy(out).multiplyScalar(6 + Math.random() * 8);
      velocity.x += lx * 5;
      velocity.z += lz * 5;
      velocity.y = 2 + Math.random() * 6;
      this.effects.puff({
        position,
        velocity,
        color: Math.random() > 0.5 ? EFFECT_COLORS.dust : EFFECT_COLORS.dustDark,
        size: (4 + Math.random() * 4) * scale,
        life: 1.8 + Math.random() * 1.2,
        drag: 1.1,
      });
      if (i < 2 && collapse.floors % 2 === 0) {
        size.set(1.2 + Math.random() * 1.8, 0.8 + Math.random() * 1.2, 1.2 + Math.random() * 1.8);
        spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
        velocity.y = 6 + Math.random() * 6;
        this.debris.spawn(position, size, shade(wall, (Math.random() - 0.5) * 0.1), velocity, spin);
      }
    }
    this.events.emit('towerFloor', {
      building,
      position: new THREE.Vector3(building.center[0], ground, building.center[1]),
      floor: collapse.floors,
    });
  }

  /** The falling tower damages the buildings around it, most on the side that it leans to. */
  private hitNeighbours(building: Building, collapse: Collapse): void {
    const storey = building.height - building.base;
    const reach = storey * 0.25 * collapse.waves;
    const center = new THREE.Vector3(
      building.center[0] + collapse.lean[0] * reach,
      building.baseY,
      building.center[1] + collapse.lean[1] * reach,
    );
    const radius = 10 + storey * 0.35 + Math.sqrt(building.shape.area) * 0.3;
    const peak = Math.min(700, 200 + storey * 4);
    this.blast(center, radius, peak, collapse.chain + 1, building);
  }
}

/** Splits a piece into convex parts for its colliders: itself when convex, else its triangles. */
function convexParts(polygon: readonly Vec2[], convex: boolean): Vec2[][] {
  if (convex) {
    return [[...polygon]];
  }
  const contour = polygon.map((p) => new THREE.Vector2(p[0], p[1]));
  return THREE.ShapeUtils.triangulateShape(contour, []).map((triangle) =>
    triangle.map((index) => polygon[index]),
  );
}
