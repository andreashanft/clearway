import * as THREE from 'three/webgpu';
import type { EventBus } from '../../engine/events';
import { GRAVITY, Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { GameEvents } from '../events';
import type { BuildingClass, BuildingColors, BuildingData, LevelData } from '../level';
import { clamp, pointInPolygon, type Vec2 } from '../math';
import { distanceToPolygon } from '../polygon';
import { classifyBuilding, sectionCount } from './building-class';
import {
  buildPieceGeometry,
  createCrackTexture,
  createWindowTexture,
  paletteColors,
  type PieceStyle,
} from './building-models';
import { applyPieceDamage, blastDamage, hitPoints, type PieceGraph } from './damage';
import type { Debris } from './debris';
import type { Effects } from './effects';
import { shade } from './mesh-builder';
import { cutFootprint, type BuildingShape } from './pieces';

/** Rubble pieces that stay where a section fell. They are decoration and have no collider. */
const RUBBLE_PER_SECTION = 6;
/** A section that breaks in place sheds at least and at most this many chunks. */
const MIN_CHUNKS = 6;
const MAX_CHUNKS = 14;
/** A falling section sheds this many chunks when it breaks, because many sections fall at once. */
const BLOCK_CHUNKS = 5;
/** At most this many sections fall at once. A section beyond that breaks where it stands. */
const MAX_FALLING = 160;
/**
 * The collider of a falling section is this much smaller than the section on every side, in
 * metres, so that the section starts free of the sections next to it.
 */
const BLOCK_INSET = 0.3;
/**
 * A falling stack of sections starts to turn at this share of the turn rate that a falling stick
 * of its height reaches, so that it topples away from the ram.
 */
const TOPPLE_SHARE = 0.5;
/** A falling section breaks after this many seconds at the latest. */
const BLOCK_LIFE = 8;
/** A falling section that rests on something for this many seconds breaks. */
const BLOCK_REST_SECONDS = 0.6;
/** A falling section slower than this, in m/s, counts as resting. */
const BLOCK_REST_SPEED = 1.5;
/**
 * A falling section that hits a building at this speed, in m/s, deals its own hit points. The
 * damage grows with the square of the speed, so that a section that slides past does little.
 */
const BLOCK_BREAK_SPEED = 12;
/** A falling section deals at most this multiple of its own hit points. */
const MAX_BLOCK_DAMAGE_SHARE = 1.5;
/** A falling section slower than this, in m/s, deals no damage when it hits a building. */
const MIN_BLOCK_SPEED = 2;
/** Density of a falling section. Only the masses of sections and chunks against each other count. */
const BLOCK_DENSITY = 20;

/** One column of a building: a piece of the footprint and the sections stacked on it. */
interface PieceState {
  /** The sections of the column that still stand, as one mesh. Undefined when none stands. */
  mesh: THREE.Mesh | undefined;
  /**
   * The colliders of every section, from the ground up. A concave piece has several colliders
   * per section. The list of a section is empty once the section has fallen.
   */
  colliders: RAPIER.Collider[][];
  polygon: Vec2[];
  /** Centre of the column at half the building's height. */
  center: THREE.Vector3;
  /** Volume of one section in cubic metres. */
  volume: number;
  /** Number of sections that still stand, counted from the bottom. */
  top: number;
  cracked: boolean;
  /** For a part above the ground: the column of another building that this column stands on. */
  support: PieceRef | undefined;
  /** The columns of other buildings that stand on this column. */
  carries: PieceRef[];
}

/** Points at one section of one building: the column and the level from the bottom. */
export interface PieceRef {
  building: Building;
  index: number;
  /** The section from the bottom of the column. 0 when left out. */
  level?: number;
}

/** A section that has lost what held it up and falls as a physics body. */
interface FallingBlock {
  building: Building;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Volume in cubic metres. */
  volume: number;
  /** Width of the footprint and height of the section, for the chunks that it breaks into. */
  reach: number;
  height: number;
  /** How many collapses led to this fall. 0 when the player's own ram cut the column. */
  chain: number;
  age: number;
  /** Speed at the end of the previous step, so that a hit is judged by the speed before it. */
  speed: number;
  velocity: THREE.Vector3;
  /** Seconds for which the section has rested on something. */
  resting: number;
  /** The building sections that this section has already hit, so that each takes one hit. */
  struck: Set<string>;
  previousPosition: THREE.Vector3;
  position: THREE.Vector3;
  previousRotation: THREE.Quaternion;
  rotation: THREE.Quaternion;
}

/**
 * A destructible building.
 *
 * The footprint is cut into pieces, and each piece is a column of stacked sections. A low
 * building has one section per column. A tower has one section per four floors. Every section has
 * its own hit points. When a section breaks, the sections above it fall as loose blocks.
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
  /** Number of sections in every column. */
  readonly levels: number;
  /** Height of one section in metres. */
  readonly sectionHeight: number;
  /** Full hit points of one section of every column. */
  readonly maxHp: number[];
  /** Current hit points of every section, by level from the bottom and then by column. */
  readonly hp: number[][];
  /** True once the `buildingDestroyed` event went out. */
  reported = false;

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
    this.levels = sectionCount(storey);
    this.sectionHeight = storey / this.levels;
    this.maxHp = this.shape.pieces.map((piece) => hitPoints(piece.area * this.sectionHeight));
    this.hp = Array.from({ length: this.levels }, () => [...this.maxHp]);
    this.object.name = `building-${data.id}`;
    this.object.position.set(this.center[0], this.baseY, this.center[1]);
  }

  /** True while the bottom section of a column still stands. */
  standing(index: number): boolean {
    return this.hp[0][index] > 0;
  }

  /** True when the bottom section of every column has fallen. */
  get destroyed(): boolean {
    return this.hp[0].every((value) => value <= 0);
  }

  /** The id that route obstacles are counted by: the group, or the building itself. */
  get obstacleId(): string {
    return this.data.group ?? this.data.id;
  }

  /** Volume of the whole building in cubic metres. */
  get volume(): number {
    return this.shape.area * (this.height - this.base);
  }

  /** Height of the bottom of a section above the building's ground, in metres. */
  sectionBottom(level: number): number {
    return this.base + level * this.sectionHeight;
  }

  /** The neighbours, hit points and centres of the columns, for the spread of damage. */
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
  private readonly falling: FallingBlock[] = [];
  private readonly blockByCollider = new Map<number, FallingBlock>();
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
    private readonly heightAt: (x: number, z: number) => number,
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

    let sectionTotal = 0;
    for (const data of level.buildings) {
      const building = new Building(data, heightAt);
      if (building.shape.pieces.length === 0) {
        // A footprint without area, for example from broken map data.
        continue;
      }
      this.createPieces(building);
      this.list.push(building);
      this.object.add(building.object);
      sectionTotal += building.pieces.length * building.levels;
    }

    this.rubble = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      Math.max(1, sectionTotal * RUBBLE_PER_SECTION),
    );
    this.rubble.name = 'rubble';
    this.rubble.count = 0;
    this.rubble.receiveShadow = true;
    this.rubble.frustumCulled = false;
    this.dustPatches = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
      Math.max(1, sectionTotal),
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
    physics.setContactFilter((a, b) => this.allowContact(a, b));
  }

  /**
   * A falling section passes through the building that it fell from. Otherwise it would wedge
   * between the columns next to it and fly off when the solver pushes it out.
   */
  private allowContact(a: number, b: number): boolean {
    const block = this.blockByCollider.get(a) ?? this.blockByCollider.get(b);
    if (!block) {
      return true;
    }
    const other = this.blockByCollider.has(a) ? b : a;
    return this.byCollider.get(other)?.building !== block.building;
  }

  /**
   * Finds, for every column of a part that starts above the ground, the column of another
   * building that it stands on. When that column is cut below the part, the part's column falls.
   */
  private linkSupports(): void {
    for (const part of this.list) {
      if (part.base <= 0.5) {
        continue;
      }
      const supports = this.list.filter(
        (support) =>
          support !== part &&
          support.base < part.base &&
          support.height >= part.base - 1 &&
          pointInPolygon(part.center, support.shape.outline),
      );
      part.pieces.forEach((piece, index) => {
        const point: Vec2 = [piece.center.x, piece.center.z];
        let best: PieceRef | undefined;
        let bestDistance = Infinity;
        for (const support of supports) {
          support.pieces.forEach((candidate, candidateIndex) => {
            const distance = distanceToPolygon(point, candidate.polygon);
            const inside = pointInPolygon(point, candidate.polygon);
            const score = inside ? -1 : distance;
            if (score < bestDistance) {
              bestDistance = score;
              best = { building: support, index: candidateIndex };
            }
          });
        }
        if (best) {
          piece.support = best;
          best.building.pieces[best.index].carries.push({ building: part, index });
        }
      });
    }
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

  /** Returns the building section that a collider belongs to. */
  lookup(colliderHandle: number): PieceRef | undefined {
    return this.byCollider.get(colliderHandle);
  }

  /** Returns a building by id. */
  get(id: string): Building | undefined {
    return this.list.find((building) => building.data.id === id);
  }

  /** True when this much damage breaks a section that still stands. */
  wouldBreak(ref: PieceRef, amount: number): boolean {
    const hp = ref.building.hp[ref.level ?? 0][ref.index];
    return hp > 0 && amount >= hp;
  }

  /**
   * Damages one section. The collapse can spread to the sections next to it on the same level,
   * and the sections above a broken one fall.
   *
   * @param push Velocity of the ram. The falling chunks inherit it, and the sections above topple
   *   along it.
   * @param chain How many collapses led to this damage. 0 for the player's own ram.
   * @param ram True for a vehicle's ram. Only a ram carries its spare damage on through pieces.
   * @returns How many sections broke on the level of the hit.
   */
  damage(ref: PieceRef, amount: number, push: THREE.Vector3, chain = 0, ram = false): number {
    const { building } = ref;
    const level = ref.level ?? 0;
    const hp = building.hp[level];
    if (amount <= 0 || hp[ref.index] <= 0) {
      return 0;
    }
    const ramming = ram && chain === 0 && Math.hypot(push.x, push.z) > 0.5;
    const fallen = applyPieceDamage(
      hp,
      building.graph,
      ref.index,
      amount,
      ramming ? [push.x, push.z] : undefined,
    );
    for (const index of fallen) {
      this.cutColumn(building, index, level, push, chain, true);
    }
    building.pieces.forEach((piece, index) => {
      const value = hp[index];
      if (value > 0 && value <= building.maxHp[index] / 2 && !piece.cracked) {
        this.crackPiece(building, index, level);
      }
    });
    return fallen.length;
  }

  /** Damages every section within the radius of an explosion. */
  blast(center: THREE.Vector3, radius: number, peak: number, chain = 0): void {
    const push = new THREE.Vector3();
    const point: Vec2 = [center.x, center.z];
    for (const building of this.list) {
      if (building.destroyed) {
        continue;
      }
      building.pieces.forEach((piece, index) => {
        const flat = distanceToPolygon(point, piece.polygon);
        if (flat >= radius) {
          return;
        }
        // A broken section lowers the top, so the loop stops at the new top.
        for (let level = 0; level < piece.top; level += 1) {
          const bottom = building.baseY + building.sectionBottom(level);
          const top = bottom + building.sectionHeight;
          const vertical = center.y < bottom ? bottom - center.y : Math.max(0, center.y - top);
          const amount = blastDamage(peak, radius, Math.hypot(flat, vertical));
          if (amount > 0) {
            push.copy(piece.center).sub(center).setY(0).normalize().multiplyScalar(9);
            this.damage({ building, index, level }, amount, push, chain);
          }
        }
      });
    }
  }

  /** Advances the falling sections. Call it once per simulation step, after the physics step. */
  step(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i -= 1) {
      const block = this.falling[i];
      block.age += dt;
      block.previousPosition.copy(block.position);
      block.previousRotation.copy(block.rotation);
      block.position.copy(block.body.translation());
      block.rotation.copy(block.body.rotation());
      const contact = this.blockContacts(block);
      const lost = block.position.y < block.building.baseY - 20;
      block.resting = block.speed < BLOCK_REST_SPEED ? block.resting + dt : 0;
      if (
        contact.ground ||
        lost ||
        block.age >= BLOCK_LIFE ||
        block.resting >= BLOCK_REST_SECONDS
      ) {
        this.falling.splice(i, 1);
        this.shatterBlock(block);
      }
      // Damage after the block is settled, because the damage can cut more columns.
      for (const hit of contact.hits) {
        this.strikeWithBlock(block, hit);
      }
      if (this.falling.includes(block)) {
        const velocity = block.body.linvel();
        block.velocity.set(velocity.x, velocity.y, velocity.z);
        block.speed = block.velocity.length();
      }
    }
  }

  /** Draws the falling sections between the previous and the current step. */
  sync(alpha: number): void {
    for (const block of this.falling) {
      block.mesh.position.lerpVectors(block.previousPosition, block.position, alpha);
      block.mesh.quaternion.slerpQuaternions(block.previousRotation, block.rotation, alpha);
    }
  }

  /** Number of sections that are falling at the moment. */
  get fallingCount(): number {
    return this.falling.length;
  }

  /** Number of buildings that are completely destroyed. */
  get destroyedCount(): number {
    return this.list.reduce((count, building) => count + (building.destroyed ? 1 : 0), 0);
  }

  private createPieces(building: Building): void {
    building.shape.pieces.forEach((piece, index) => {
      const colliders: RAPIER.Collider[][] = [];
      for (let level = 0; level < building.levels; level += 1) {
        const bottom = building.baseY + building.sectionBottom(level);
        const top = bottom + building.sectionHeight;
        const section: RAPIER.Collider[] = [];
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
            this.byCollider.set(collider.handle, { building, index, level });
            section.push(collider);
          }
        }
        colliders.push(section);
      }
      building.pieces.push({
        mesh: undefined,
        colliders,
        polygon: piece.polygon,
        center: new THREE.Vector3(
          piece.center[0],
          building.baseY + (building.base + building.height) / 2,
          piece.center[1],
        ),
        volume: piece.area * building.sectionHeight,
        top: building.levels,
        cracked: false,
        support: undefined,
        carries: [],
      });
      this.buildStump(building, index);
    });
  }

  /** Builds the mesh of the sections of a column that still stand. */
  private buildStump(building: Building, index: number): void {
    const piece = building.pieces[index];
    this.removeMesh(building, piece);
    if (piece.top === 0) {
      return;
    }
    const { shape } = building;
    const whole = piece.top === building.levels;
    const gable =
      whole &&
      building.base === 0 &&
      building.kind === 'house' &&
      shape.pieces.length === 1 &&
      shape.rectangular
        ? shape.rect
        : undefined;
    const style: PieceStyle = {
      colors: building.colors,
      base: building.base,
      height: building.sectionBottom(piece.top),
      gable,
      broken: !whole,
    };
    const mesh = new THREE.Mesh(
      buildPieceGeometry(shape.pieces[index], building.center, style),
      piece.cracked ? this.cracked : this.intact,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (piece.cracked && !building.tower) {
      mesh.position.y = -0.25;
    }
    building.object.add(mesh);
    piece.mesh = mesh;
  }

  /** Shows cracks on a column, with a puff of dust at the damaged section. */
  private crackPiece(building: Building, index: number, level: number): void {
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
    const position = new THREE.Vector3(
      piece.center.x,
      building.baseY + building.sectionBottom(level) + 1,
      piece.center.z,
    );
    this.effects.dust(position, Math.sqrt(piece.volume) * 0.12 + 2, 6);
    this.events.emit('buildingCracked', { building, position });
  }

  private removeColliders(colliders: RAPIER.Collider[]): void {
    for (const collider of colliders) {
      this.byCollider.delete(collider.handle);
      this.physics.world.removeCollider(collider, true);
    }
    colliders.length = 0;
  }

  private removeMesh(building: Building, piece: PieceState): void {
    if (piece.mesh) {
      building.object.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      piece.mesh = undefined;
    }
  }

  /**
   * Removes a column from a level upwards. With `shatter`, the section on that level breaks where
   * it stands. The sections above it fall as loose blocks, and so do the parts that stand on it.
   */
  private cutColumn(
    building: Building,
    index: number,
    level: number,
    push: THREE.Vector3,
    chain: number,
    shatter: boolean,
  ): void {
    const piece = building.pieces[index];
    const top = piece.top;
    if (level >= top) {
      return;
    }
    for (let above = level; above < top; above += 1) {
      building.hp[above][index] = 0;
      this.removeColliders(piece.colliders[above]);
    }
    piece.top = level;
    this.buildStump(building, index);

    const pivotY = building.baseY + building.sectionBottom(level);
    if (shatter) {
      this.breakSection(building, index, level, push, chain);
    }
    const first = shatter ? level + 1 : level;
    if (first < top) {
      const stack = (top - level) * building.sectionHeight;
      let count = 0;
      for (let above = first; above < top; above += 1) {
        if (this.spawnBlock(building, index, above, pivotY, stack, push, chain)) {
          count += 1;
        }
      }
      const middle =
        pivotY + (shatter ? building.sectionHeight : 0) + (count * building.sectionHeight) / 2;
      if (count > 0) {
        this.events.emit('sectionsFalling', {
          building,
          position: new THREE.Vector3(piece.center.x, middle, piece.center.z),
          count,
          volume: count * piece.volume,
          chain,
        });
      }
    }

    for (const carried of piece.carries) {
      const part = carried.building;
      if (part.pieces[carried.index].top > 0 && pivotY < part.baseY + part.base - 0.5) {
        this.cutColumn(part, carried.index, 0, push, chain, false);
      }
    }
    if (!building.reported && building.destroyed) {
      building.reported = true;
      this.events.emit('buildingDestroyed', { building });
    }
  }

  /** Breaks one section where it stands: chunks fly, dust rises and rubble stays. */
  private breakSection(
    building: Building,
    index: number,
    level: number,
    push: THREE.Vector3,
    chain: number,
  ): void {
    const piece = building.pieces[index];
    const height = building.sectionHeight;
    const reach = Math.sqrt(building.shape.pieces[index].area);
    const bottom = building.baseY + building.sectionBottom(level);
    const center = new THREE.Vector3(piece.center.x, bottom + height / 2, piece.center.z);
    const count = clamp(Math.round(piece.volume / 90), MIN_CHUNKS, MAX_CHUNKS);
    this.spawnChunks(building, center, push, height, reach, count);
    this.addRubble(building, piece.center.x, piece.center.z, reach);
    this.effects.dust(
      new THREE.Vector3(piece.center.x, bottom + 0.5, piece.center.z),
      reach * 0.7 + height * 0.25,
      16,
    );
    if (building.kind === 'block' || building.tower) {
      this.effects.sparks(center, 8, 10);
    }
    this.events.emit('pieceDestroyed', {
      building,
      position: center,
      volume: piece.volume,
      chain,
    });
  }

  /**
   * Turns one section into a loose block that falls. Returns false when too many sections fall
   * already: the section then breaks where it stands. The whole stack above a cut starts to turn
   * around the cut's edge on the far side of the ram, so that it topples away from the ram.
   *
   * @param pivotY Height of the cut.
   * @param stack Height of the stack from the cut to its top, in metres.
   */
  private spawnBlock(
    building: Building,
    index: number,
    level: number,
    pivotY: number,
    stack: number,
    push: THREE.Vector3,
    chain: number,
  ): boolean {
    if (this.falling.length >= MAX_FALLING) {
      this.breakSection(building, index, level, push, chain);
      return false;
    }
    const piece = building.pieces[index];
    const shapePiece = building.shape.pieces[index];
    const height = building.sectionHeight;
    const bottom = building.sectionBottom(level);
    const [cx, cz] = shapePiece.center;
    const position = new THREE.Vector3(cx, building.baseY + bottom + height / 2, cz);

    const geometry = buildPieceGeometry(shapePiece, shapePiece.center, {
      colors: building.colors,
      base: bottom,
      height: bottom + height,
      broken: level < building.levels - 1,
      closed: true,
    });
    geometry.translate(0, -(bottom + height / 2), 0);
    const mesh = new THREE.Mesh(geometry, piece.cracked ? this.cracked : this.intact);
    mesh.castShadow = true;
    mesh.position.copy(position);
    this.object.add(mesh);

    // Direction of the fall on the ground plane: along the ram, or anywhere without one.
    const length = Math.hypot(push.x, push.z);
    const angle = Math.random() * Math.PI * 2;
    const dx = length > 0.5 ? push.x / length : Math.cos(angle);
    const dz = length > 0.5 ? push.z / length : Math.sin(angle);
    const reach = Math.sqrt(shapePiece.area);
    const pivot = new THREE.Vector3(cx + dx * reach * 0.5, pivotY, cz + dz * reach * 0.5);
    // A turn around the axis up × direction moves the top of the stack along the direction.
    const rate = TOPPLE_SHARE * Math.sqrt((3 * GRAVITY) / Math.max(stack, height));
    const spin = new THREE.Vector3(dz, 0, -dx).multiplyScalar(rate * (0.9 + Math.random() * 0.2));
    const velocity = new THREE.Vector3()
      .crossVectors(spin, new THREE.Vector3().subVectors(position, pivot))
      .addScaledVector(push, 0.1);

    const points: number[] = [];
    for (const [x, z] of shapePiece.polygon) {
      const ox = cx - x;
      const oz = cz - z;
      const distance = Math.hypot(ox, oz);
      const inset = Math.min(BLOCK_INSET, distance * 0.3) / Math.max(distance, 1e-6);
      const half = height / 2 - BLOCK_INSET;
      points.push(x - cx + ox * inset, -half, z - cz + oz * inset);
      points.push(x - cx + ox * inset, half, z - cz + oz * inset);
    }
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: spin.x, y: spin.y, z: spin.z })
        .setLinearDamping(0.05)
        .setAngularDamping(0.2),
    );
    const desc =
      RAPIER.ColliderDesc.convexHull(new Float32Array(points)) ??
      RAPIER.ColliderDesc.cuboid(reach * 0.4, height / 2 - BLOCK_INSET, reach * 0.4);
    const collider = this.physics.world.createCollider(
      desc
        .setDensity(BLOCK_DENSITY)
        .setFriction(0.6)
        .setRestitution(0.05)
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS)
        .setCollisionGroups(
          collisionGroups(Layer.block, Layer.terrain | Layer.building | Layer.block | Layer.bridge),
        ),
      body,
    );
    const rotation = new THREE.Quaternion();
    const block: FallingBlock = {
      building,
      mesh,
      body,
      collider,
      volume: piece.volume,
      reach,
      height,
      chain,
      age: 0,
      speed: velocity.length(),
      velocity,
      resting: 0,
      struck: new Set(),
      previousPosition: position.clone(),
      position: position.clone(),
      previousRotation: rotation.clone(),
      rotation,
    };
    this.falling.push(block);
    this.blockByCollider.set(collider.handle, block);
    return true;
  }

  /**
   * Returns what a falling section touches: whether it is on the ground, and the building
   * sections that it touches for the first time. Other falling sections and chunks do not count.
   */
  private blockContacts(block: FallingBlock): {
    ground: boolean;
    hits: { ref: PieceRef; speed: number }[];
  } {
    const world = this.physics.world;
    const result = {
      ground: false,
      hits: [] as { ref: PieceRef; speed: number }[],
    };
    const { velocity } = block;
    world.contactPairsWith(block.collider, (other: RAPIER.Collider | null) => {
      // Rapier lists the pairs of a collider removed in this step until the next step, and passes
      // null for the removed collider.
      if (!other) {
        return;
      }
      const ref = this.byCollider.get(other.handle);
      const ground = ((other.collisionGroups() >>> 16) & (Layer.terrain | Layer.bridge)) !== 0;
      if (!ref && !ground) {
        return;
      }
      // A concave section has several colliders. It takes one hit per falling section.
      if (ref && block.struck.has(sectionKey(ref))) {
        return;
      }
      let touching = false;
      // The speed along the contact normal: a section that slides down past a wall barely hits it.
      let speed = 0;
      world.contactPair(block.collider, other, (manifold) => {
        if (manifold.numContacts() > 0) {
          touching = true;
          const normal = manifold.normal();
          speed = Math.max(
            speed,
            Math.abs(velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z),
          );
        }
      });
      if (!touching) {
        return;
      }
      if (ref) {
        const key = sectionKey(ref);
        const earlier = result.hits.find((hit) => sectionKey(hit.ref) === key);
        if (earlier) {
          earlier.speed = Math.max(earlier.speed, speed);
        } else {
          result.hits.push({ ref, speed });
        }
      } else {
        result.ground = true;
      }
    });
    return result;
  }

  /**
   * Damages a building section that a falling section hit, by the speed of the hit along the
   * contact normal. A falling section only touches other buildings, so the chain grows by one.
   */
  private strikeWithBlock(block: FallingBlock, hit: { ref: PieceRef; speed: number }): void {
    const { ref, speed } = hit;
    block.struck.add(sectionKey(ref));
    if (speed < MIN_BLOCK_SPEED) {
      return;
    }
    const share = Math.min(MAX_BLOCK_DAMAGE_SHARE, (speed / BLOCK_BREAK_SPEED) ** 2);
    this.damage(ref, hitPoints(block.volume) * share, block.velocity, block.chain + 1);
  }

  /** Breaks a falling section into chunks where it landed. */
  private shatterBlock(block: FallingBlock): void {
    this.blockByCollider.delete(block.collider.handle);
    this.physics.world.removeRigidBody(block.body);
    this.object.remove(block.mesh);
    block.mesh.geometry.dispose();

    const { building } = block;
    this.spawnChunks(
      building,
      block.position,
      block.velocity.clone().multiplyScalar(0.3),
      block.height,
      block.reach,
      BLOCK_CHUNKS,
    );
    const ground = this.heightAt(block.position.x, block.position.z);
    const position = new THREE.Vector3(
      block.position.x,
      Math.max(ground, block.position.y - block.height / 2),
      block.position.z,
    );
    this.effects.dust(position, block.reach * 0.6 + 3, 10);
    this.addRubble(building, block.position.x, block.position.z, block.reach, ground);
    this.events.emit('sectionLanded', { building, position, volume: block.volume });
  }

  private spawnChunks(
    building: Building,
    center: THREE.Vector3,
    push: THREE.Vector3,
    height: number,
    reach: number,
    count: number,
  ): void {
    const wall = Number.parseInt(building.colors.wall.slice(1), 16);
    const roof = Number.parseInt(building.colors.roof.slice(1), 16);
    const position = new THREE.Vector3();
    const size = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const spin = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const up = (Math.random() - 0.5) * height * 0.85;
      position.set(
        center.x + (Math.random() - 0.5) * reach * 0.8,
        center.y + up,
        center.z + (Math.random() - 0.5) * reach * 0.8,
      );
      const scale = 0.5 + Math.random() * 0.8;
      size.set(
        clamp(reach * 0.3 * scale, 1.2, 5.5),
        clamp(height * 0.3 * scale, 1, 4.5),
        clamp(reach * 0.3 * scale, 1.2, 5.5),
      );
      // Chunks fly outwards from the middle of the section, upwards, and along the push.
      velocity
        .set(position.x - center.x, 0, position.z - center.z)
        .normalize()
        .multiplyScalar(4 + Math.random() * 7)
        .addScaledVector(push, 0.5 + Math.random() * 0.4);
      velocity.y = 7 + Math.random() * 11;
      spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      const isRoof = !building.tower && up > height * 0.25;
      this.debris.spawn(
        position,
        size,
        isRoof ? roof : shade(wall, (Math.random() - 0.5) * 0.08),
        velocity,
        spin,
      );
    }
  }

  /** Leaves a dusty patch and a few half-buried pieces on the ground. */
  private addRubble(
    building: Building,
    x: number,
    z: number,
    reach: number,
    ground = building.baseY,
  ): void {
    const wall = shade(building.colors.wall, -0.12);
    const roof = shade(building.colors.roof, -0.08);
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();

    if (this.patchCount < this.dustPatches.instanceMatrix.count) {
      this.matrix.compose(
        new THREE.Vector3(x, ground + 0.08 + this.patchCount * 0.002, z),
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
      i < RUBBLE_PER_SECTION && this.rubbleCount < this.rubble.instanceMatrix.count;
      i += 1
    ) {
      const size = 0.8 + Math.random() * 1.8;
      euler.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
      this.matrix.compose(
        new THREE.Vector3(
          x + (Math.random() - 0.5) * reach * 0.8,
          ground + size * 0.12,
          z + (Math.random() - 0.5) * reach * 0.8,
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

/** A key that is the same for every collider of one section. */
function sectionKey(ref: PieceRef): string {
  return `${ref.building.data.id}/${ref.index}/${ref.level ?? 0}`;
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
