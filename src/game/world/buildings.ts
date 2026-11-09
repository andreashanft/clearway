import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import {
  BatchedMesh,
  type BufferGeometry,
  Color,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { COLLISION } from '../../engine/collision-groups';
import type { Physics } from '../../engine/physics';
import {
  canDamage,
  CRACK_THRESHOLD,
  damageFactor,
  type DamageSource,
  type Strength,
  STRENGTH_HP,
} from '../damage';
import type { Effects } from '../fx/effects';
import type { GroundPoint } from '../level-data';
import { merge, type Vec3 } from '../models/geometry';
import { type BuildingStyle, buildShape, type Piece } from './building-styles';
import type { Heightfield } from './heightfield';

export interface BuildingDefinition {
  readonly id: string;
  readonly style: BuildingStyle;
  readonly strength: Strength;
  readonly pos: GroundPoint;
  /** Width (x), height (y) and depth (z) in metres. */
  readonly size: Vec3;
  /** Rotation about the vertical axis in degrees, anticlockwise seen from above. */
  readonly yaw?: number;
  /** Buildings with the same group form one route obstacle, such as twin silos. */
  readonly group?: string;
  /** Explodes when destroyed, like a fuel kiosk. */
  readonly explodes?: boolean;
}

export type BuildingState = 'intact' | 'cracked' | 'collapsing' | 'rubble';

/** Seconds a chunk flies before it starts to fade away. */
export const RUBBLE_AFTER = 4;
/** Seconds a chunk takes to shrink into the ground and disappear. */
export const FADE_SECONDS = 0.8;
/** Most physics chunks alive at once; the oldest start fading early beyond this. */
export const MAX_ACTIVE_CHUNKS = 200;

const DENSITY: Readonly<Record<Strength, number>> = {
  shed: 350,
  house: 700,
  brick: 1100,
  concrete: 1600,
};

interface Chunk {
  readonly piece: Piece;
  readonly instanceId: number;
  body: RigidBody | null;
  age: number;
  /** 0 while it flies; then rises to 1 as the chunk shrinks away. */
  fade: number;
  readonly prevPosition: Vector3;
  readonly prevRotation: Quaternion;
  readonly currPosition: Vector3;
  readonly currRotation: Quaternion;
}

export interface HitInfo {
  /** World position of the hit. */
  readonly point: Vector3;
  /** Direction the hit pushes the building, unit length. */
  readonly direction: Vector3;
  /** Speed of the hitting object, used to throw chunks. */
  readonly speed: number;
}

export interface BuildingCallbacks {
  onDamaged(building: Building, amount: number): void;
  onDestroyed(building: Building, hit: HitInfo): void;
  /** A collider now belongs to `building`. */
  register(collider: Collider, building: Building): void;
  /** A collider was removed; Rapier may reuse its handle. */
  unregister(collider: Collider): void;
}

export class Building {
  readonly maxHp: number;
  hp: number;
  state: BuildingState = 'intact';
  /** Base centre on the ground. */
  readonly origin = new Vector3();
  readonly rotation = new Quaternion();
  /** Horizontal radius of the footprint, for quick distance checks. */
  readonly radius: number;
  readonly chunks: Chunk[] = [];
  body: RigidBody | null = null;
  readonly colliders: Collider[] = [];
  /** Batched-mesh geometry slot holding the merged building. */
  intactGeometry: number | null = null;
  /** Batched-mesh instance of the merged intact building, shown while it stands. */
  intactInstance: number | null = null;
  foundation: BufferGeometry | null = null;
  /** Batched-mesh instance of the bare foundation, shown once the building breaks. */
  foundationInstance: number | null = null;
  debrisColour = '#AAAAAA';

  constructor(readonly def: BuildingDefinition) {
    this.maxHp = STRENGTH_HP[def.strength];
    this.hp = this.maxHp;
    this.radius = Math.hypot(def.size[0], def.size[2]) / 2;
  }

  get destroyed(): boolean {
    return this.state === 'collapsing' || this.state === 'rubble';
  }

  /** Horizontal distance from a point to the building's footprint edge (0 inside). */
  distanceTo(x: number, z: number): number {
    const local = new Vector3(x - this.origin.x, 0, z - this.origin.z).applyQuaternion(
      this.rotation.clone().invert(),
    );
    const ex = Math.max(0, Math.abs(local.x) - this.def.size[0] / 2);
    const ez = Math.max(0, Math.abs(local.z) - this.def.size[2] / 2);
    return Math.hypot(ex, ez);
  }
}

/**
 * All the buildings of a level. Intact buildings are one fixed body each, with a collider
 * per pre-fractured piece. Every piece of every building is an instance in one batched
 * mesh, so a whole town costs a single draw.
 */
export class Buildings {
  readonly list: Building[] = [];
  readonly mesh: BatchedMesh;
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.03,
  });
  private activeChunks: Chunk[] = [];
  private readonly matrix = new Matrix4();
  private readonly unit = new Vector3(1, 1, 1);
  private readonly tmpPos = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly crackTint = new Color(0.8, 0.78, 0.76);

  constructor(
    defs: readonly BuildingDefinition[],
    field: Heightfield,
    private readonly physics: Physics,
    private readonly effects: Effects,
    private readonly callbacks: BuildingCallbacks,
  ) {
    const shapes = defs.map((def, i) => buildShape(def.style, def.size, hashId(def.id) + i));
    // Each building gets a merged intact mesh (one draw while it stands) and its pieces,
    // which stay hidden until it cracks or falls; WebGPU draws each piece separately.
    const intact = shapes.map((shape) => intactGeometry(shape.pieces, shape.foundation));
    let vertices = 0;
    let instances = 0;
    shapes.forEach((shape, i) => {
      for (const piece of shape.pieces) vertices += piece.geometry.getAttribute('position').count;
      vertices += intact[i]?.getAttribute('position').count ?? 0;
      instances += shape.pieces.length + 1;
      if (shape.foundation) {
        vertices += shape.foundation.getAttribute('position').count;
        instances++;
      }
    });
    this.mesh = new BatchedMesh(Math.max(1, instances), Math.max(3, vertices), 0, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'buildings';

    defs.forEach((def, i) => {
      const shape = shapes[i];
      if (!shape) return;
      const building = new Building(def);
      building.debrisColour = shape.debrisColour;
      const [x, z] = def.pos;
      // Sit on the lowest corner so no wall floats above a slope.
      const half = [def.size[0] / 2, def.size[2] / 2];
      building.rotation.setFromEuler(new Euler(0, ((def.yaw ?? 0) * Math.PI) / 180, 0));
      let ground = field.heightAt(x, z);
      for (const [cx, cz] of [
        [half[0], half[1]],
        [-(half[0] ?? 0), half[1]],
        [half[0], -(half[1] ?? 0)],
        [-(half[0] ?? 0), -(half[1] ?? 0)],
      ] as const) {
        const corner = new Vector3(cx, 0, cz).applyQuaternion(building.rotation);
        ground = Math.min(ground, field.heightAt(x + corner.x, z + corner.z));
      }
      building.origin.set(x, ground, z);

      const merged = intact[i];
      if (merged) {
        building.intactGeometry = this.mesh.addGeometry(merged);
        building.intactInstance = this.addStatic(building.intactGeometry, building);
        merged.dispose();
      }
      if (shape.foundation) {
        building.foundation = shape.foundation;
        building.foundationInstance = this.addStatic(
          this.mesh.addGeometry(shape.foundation),
          building,
        );
        this.mesh.setVisibleAt(building.foundationInstance, false);
      }
      this.createIntactBody(building, shape.pieces);
      for (const piece of shape.pieces) {
        // The piece geometry stays in memory: rubble is baked from it later.
        const geometryId = this.mesh.addGeometry(piece.geometry);
        const instanceId = this.mesh.addInstance(geometryId);
        this.mesh.setVisibleAt(instanceId, false);
        const chunk: Chunk = {
          piece,
          instanceId,
          body: null,
          age: 0,
          fade: 0,
          prevPosition: new Vector3(),
          prevRotation: new Quaternion(),
          currPosition: new Vector3(),
          currRotation: new Quaternion(),
        };
        this.worldPose(building, piece, chunk.currPosition, chunk.currRotation);
        chunk.prevPosition.copy(chunk.currPosition);
        chunk.prevRotation.copy(chunk.currRotation);
        this.mesh.setMatrixAt(
          instanceId,
          this.matrix.compose(chunk.currPosition, chunk.currRotation, this.unit),
        );
        building.chunks.push(chunk);
      }
      this.list.push(building);
    });
  }

  /** Applies damage; returns true if this hit destroyed the building. */
  damage(building: Building, amount: number, source: DamageSource, hit: HitInfo): boolean {
    if (building.destroyed || amount <= 0) return false;
    if (!canDamage(building.def.strength, source)) {
      this.effects.dustBurst(hit.point, 1, 3, building.debrisColour);
      return false;
    }
    amount *= damageFactor(building.def.strength, source);
    building.hp = Math.max(0, building.hp - amount);
    this.effects.debrisBurst(
      hit.point,
      Math.min(14, 3 + Math.round(amount / 25)),
      building.debrisColour,
      4,
      hit.direction,
    );
    this.callbacks.onDamaged(building, amount);
    if (building.hp <= 0) {
      this.collapse(building, hit);
      return true;
    }
    if (building.state === 'intact' && building.hp <= building.maxHp * CRACK_THRESHOLD) {
      this.crack(building);
    }
    return false;
  }

  /** Advances flying chunks and fades old ones away. Call before the world steps. */
  step(dt: number): void {
    let flying = 0;
    for (const chunk of this.activeChunks) {
      chunk.age += dt;
      if (chunk.body) flying++;
    }
    // Chunks list oldest first, so beyond the cap the oldest start fading early.
    for (const chunk of this.activeChunks) {
      if (!chunk.body) continue;
      if (chunk.age >= RUBBLE_AFTER || flying > MAX_ACTIVE_CHUNKS) {
        this.startFade(chunk);
        flying--;
      }
    }
    let gone = false;
    for (const chunk of this.activeChunks) {
      if (chunk.body) continue;
      chunk.fade = Math.min(1, chunk.fade + dt / FADE_SECONDS);
      if (chunk.fade >= 1) {
        this.mesh.setVisibleAt(chunk.instanceId, false);
        chunk.piece.geometry.dispose();
        gone = true;
      }
    }
    if (!gone) return;
    this.activeChunks = this.activeChunks.filter((c) => c.fade < 1);
    for (const building of this.list) {
      if (building.state === 'collapsing' && building.chunks.every((c) => c.fade >= 1)) {
        building.state = 'rubble';
      }
    }
  }

  /** Records chunk poses after the world stepped. */
  afterStep(): void {
    for (const chunk of this.activeChunks) {
      if (!chunk.body) continue;
      chunk.prevPosition.copy(chunk.currPosition);
      chunk.prevRotation.copy(chunk.currRotation);
      const t = chunk.body.translation();
      const r = chunk.body.rotation();
      chunk.currPosition.set(t.x, t.y, t.z);
      chunk.currRotation.set(r.x, r.y, r.z, r.w);
    }
  }

  render(alpha: number): void {
    for (const chunk of this.activeChunks) {
      this.tmpPos.lerpVectors(chunk.prevPosition, chunk.currPosition, alpha);
      this.tmpQuat.slerpQuaternions(chunk.prevRotation, chunk.currRotation, alpha);
      // A fading chunk shrinks and sinks a little until it is gone.
      const f = chunk.fade * chunk.fade * (3 - 2 * chunk.fade);
      this.tmpPos.y -= f * 0.6;
      this.tmpScale.setScalar(Math.max(0.001, 1 - f));
      this.mesh.setMatrixAt(
        chunk.instanceId,
        this.matrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale),
      );
    }
  }

  dispose(): void {
    for (const chunk of this.activeChunks) {
      if (chunk.body) this.physics.world.removeRigidBody(chunk.body);
    }
    for (const building of this.list) {
      if (building.body) this.physics.world.removeRigidBody(building.body);
    }
    this.mesh.dispose();
    this.material.dispose();
  }

  private addStatic(geometryId: number, building: Building): number {
    const id = this.mesh.addInstance(geometryId);
    this.mesh.setMatrixAt(id, this.matrix.compose(building.origin, building.rotation, this.unit));
    return id;
  }

  /** Swaps the merged intact mesh for the separate pieces and the bare foundation. */
  private showPieces(building: Building): void {
    if (building.intactInstance !== null) this.mesh.setVisibleAt(building.intactInstance, false);
    if (building.foundationInstance !== null) {
      this.mesh.setVisibleAt(building.foundationInstance, true);
    }
    for (const chunk of building.chunks) this.mesh.setVisibleAt(chunk.instanceId, true);
  }

  private createIntactBody(building: Building, pieces: readonly Piece[]): void {
    const { rapier, world } = this.physics;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed()
        .setTranslation(building.origin.x, building.origin.y, building.origin.z)
        .setRotation(building.rotation),
    );
    for (const piece of pieces) {
      const [hx, hy, hz] = piece.half;
      const collider = world.createCollider(
        rapier.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(piece.position.x, piece.position.y, piece.position.z)
          .setRotation(piece.rotation)
          .setCollisionGroups(COLLISION.building)
          .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
          .setFriction(0.7),
        body,
      );
      building.colliders.push(collider);
      this.callbacks.register(collider, building);
    }
    building.body = body;
  }

  /** Nudges every piece slightly and darkens it, so seams open up as visible cracks. */
  private crack(building: Building): void {
    building.state = 'cracked';
    this.showPieces(building);
    const rand = seeded(hashId(building.def.id));
    const offset = new Vector3();
    const twist = new Quaternion();
    const euler = new Euler();
    for (const chunk of building.chunks) {
      offset.set((rand() - 0.5) * 0.16, -rand() * 0.08, (rand() - 0.5) * 0.16);
      twist.setFromEuler(
        euler.set((rand() - 0.5) * 0.06, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.06),
      );
      chunk.currPosition.add(offset);
      chunk.currRotation.multiply(twist);
      chunk.prevPosition.copy(chunk.currPosition);
      chunk.prevRotation.copy(chunk.currRotation);
      this.mesh.setMatrixAt(
        chunk.instanceId,
        this.matrix.compose(chunk.currPosition, chunk.currRotation, this.unit),
      );
      this.mesh.setColorAt(chunk.instanceId, this.crackTint);
    }
    const centre = building.origin.clone().setY(building.origin.y + building.def.size[1] * 0.5);
    this.effects.dustBurst(centre, building.radius * 0.6, 6, building.debrisColour);
  }

  /** Replaces the intact body with a dynamic body per piece, thrown away from the hit. */
  private collapse(building: Building, hit: HitInfo): void {
    building.state = 'collapsing';
    this.showPieces(building);
    const { rapier, world } = this.physics;
    if (building.body) {
      for (const collider of building.colliders) this.callbacks.unregister(collider);
      building.colliders.length = 0;
      world.removeRigidBody(building.body);
      building.body = null;
    }
    const density = DENSITY[building.def.strength];
    const throwSpeed = Math.min(9, 2 + hit.speed * 0.45);
    const away = new Vector3();
    for (const chunk of building.chunks) {
      const p = chunk.currPosition;
      away.subVectors(p, hit.point).setY(0);
      const distance = away.length();
      away.normalize().lerp(hit.direction, 0.6).normalize();
      // Pieces near the hit fly harder.
      const strength = throwSpeed * (1.2 - Math.min(1, distance / (building.radius * 2)));
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation(chunk.currRotation)
          .setLinvel(
            away.x * strength,
            1.5 + Math.random() * 2.5 + strength * 0.3,
            away.z * strength,
          )
          .setAngvel({
            x: (Math.random() - 0.5) * 4,
            y: (Math.random() - 0.5) * 3,
            z: (Math.random() - 0.5) * 4,
          })
          .setLinearDamping(0.15)
          .setAngularDamping(0.6),
      );
      const [hx, hy, hz] = chunk.piece.half;
      world.createCollider(
        rapier.ColliderDesc.cuboid(Math.max(0.05, hx), Math.max(0.05, hy), Math.max(0.05, hz))
          .setDensity(density)
          .setCollisionGroups(COLLISION.chunk)
          .setFriction(0.8)
          .setRestitution(0.05),
        body,
      );
      chunk.body = body;
      chunk.age = 0;
      this.activeChunks.push(chunk);
    }
    const centre = building.origin.clone().setY(building.origin.y + 1);
    this.effects.dustBurst(centre, building.radius, 18, building.debrisColour);
    this.effects.debrisBurst(hit.point, 20, building.debrisColour, 6, hit.direction);
    this.callbacks.onDestroyed(building, hit);
  }

  /** Freezes a chunk where it lies and removes its body, so it can never block anything. */
  /** Freezes a chunk where it lies and starts it fading. */
  private startFade(chunk: Chunk): void {
    if (!chunk.body) return;
    const t = chunk.body.translation();
    const r = chunk.body.rotation();
    chunk.currPosition.set(t.x, t.y, t.z);
    chunk.currRotation.set(r.x, r.y, r.z, r.w);
    chunk.prevPosition.copy(chunk.currPosition);
    chunk.prevRotation.copy(chunk.currRotation);
    this.mesh.setColorAt(chunk.instanceId, this.crackTint);
    this.physics.world.removeRigidBody(chunk.body);
    chunk.body = null;
  }

  private worldPose(
    building: Building,
    piece: Piece,
    position: Vector3,
    rotation: Quaternion,
  ): void {
    position.copy(piece.position).applyQuaternion(building.rotation).add(building.origin);
    rotation.copy(building.rotation).multiply(piece.rotation);
  }
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** All pieces (and the foundation) merged in the building's own frame. */
function intactGeometry(
  pieces: readonly Piece[],
  foundation: BufferGeometry | null,
): BufferGeometry {
  const matrix = new Matrix4();
  const unit = new Vector3(1, 1, 1);
  const parts = pieces.map((piece) =>
    piece.geometry.clone().applyMatrix4(matrix.compose(piece.position, piece.rotation, unit)),
  );
  if (foundation) parts.push(foundation.clone());
  return merge(parts);
}
