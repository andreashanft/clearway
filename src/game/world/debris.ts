import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';

/** The most chunks that are alive at once. When the pool is full, the oldest chunk goes first. */
const CAPACITY = 200;
/** Seconds for which a chunk is a solid body. Afterwards it cannot block anything. */
const SOLID_SECONDS = 4;
/** Seconds that a chunk takes to shrink away after it stopped being solid. */
const FADE_SECONDS = 0.7;

interface Chunk {
  body: RAPIER.RigidBody | undefined;
  age: number;
  size: THREE.Vector3;
  previousPosition: THREE.Vector3;
  position: THREE.Vector3;
  previousRotation: THREE.Quaternion;
  rotation: THREE.Quaternion;
}

/**
 * Loose pieces of destroyed buildings.
 *
 * A chunk is a solid physics body for a few seconds, so that it tumbles and can be pushed. Then
 * it loses its collider and shrinks away. Rubble therefore never blocks the player or the Hauler.
 */
export class Debris {
  readonly object: THREE.InstancedMesh;

  private readonly chunks: Chunk[] = [];
  private cursor = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly lerped = new THREE.Vector3();
  private readonly slerped = new THREE.Quaternion();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();

  constructor(private readonly physics: PhysicsWorld) {
    this.object = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      CAPACITY,
    );
    this.object.name = 'debris';
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.frustumCulled = false;
    for (let i = 0; i < CAPACITY; i += 1) {
      this.object.setMatrixAt(i, this.hidden);
      this.object.setColorAt(i, this.color.setHex(0xffffff));
      this.chunks.push({
        body: undefined,
        age: Infinity,
        size: new THREE.Vector3(1, 1, 1),
        previousPosition: new THREE.Vector3(),
        position: new THREE.Vector3(),
        previousRotation: new THREE.Quaternion(),
        rotation: new THREE.Quaternion(),
      });
    }
  }

  /** Number of chunks that are still solid bodies. */
  get activeCount(): number {
    return this.chunks.reduce((count, chunk) => count + (chunk.body ? 1 : 0), 0);
  }

  /** Throws one chunk into the world. `size` is its full size in metres. */
  spawn(
    position: THREE.Vector3,
    size: THREE.Vector3,
    color: number,
    velocity: THREE.Vector3,
    spin: THREE.Vector3,
  ): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    const chunk = this.chunks[index];
    this.release(chunk);

    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6),
    );
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: spin.x, y: spin.y, z: spin.z })
        .setLinearDamping(0.25)
        .setAngularDamping(0.6),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setDensity(90)
        .setFriction(0.8)
        .setRestitution(0.15)
        .setCollisionGroups(
          collisionGroups(
            Layer.debris,
            Layer.terrain |
              Layer.building |
              Layer.debris |
              Layer.vehicle |
              Layer.crate |
              Layer.bridge |
              Layer.hauler,
          ),
        ),
      body,
    );
    chunk.body = body;
    chunk.age = 0;
    chunk.size.copy(size);
    chunk.position.copy(position);
    chunk.previousPosition.copy(position);
    chunk.rotation.copy(rotation);
    chunk.previousRotation.copy(rotation);
    this.object.setColorAt(index, this.color.setHex(color));
    if (this.object.instanceColor) {
      this.object.instanceColor.needsUpdate = true;
    }
  }

  /** Pushes every solid chunk away from a point, for explosions. */
  blast(center: THREE.Vector3, radius: number, strength: number): void {
    for (const chunk of this.chunks) {
      if (!chunk.body) {
        continue;
      }
      const dx = chunk.position.x - center.x;
      const dz = chunk.position.z - center.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) {
        continue;
      }
      const push = strength * (1 - distance / radius);
      const mass = chunk.body.mass();
      chunk.body.applyImpulse(
        {
          x: (dx / (distance || 1)) * push * mass,
          y: push * 0.9 * mass,
          z: (dz / (distance || 1)) * push * mass,
        },
        true,
      );
    }
  }

  /** Ages the chunks and records their transforms. Call it after the physics step. */
  step(dt: number): void {
    for (const chunk of this.chunks) {
      if (chunk.age === Infinity) {
        continue;
      }
      chunk.age += dt;
      chunk.previousPosition.copy(chunk.position);
      chunk.previousRotation.copy(chunk.rotation);
      if (chunk.body) {
        chunk.position.copy(chunk.body.translation());
        chunk.rotation.copy(chunk.body.rotation());
        if (chunk.age >= SOLID_SECONDS) {
          this.release(chunk);
        }
      } else if (chunk.age >= SOLID_SECONDS + FADE_SECONDS) {
        chunk.age = Infinity;
      }
    }
  }

  /** Draws the chunks between the previous and the current step. */
  sync(alpha: number): void {
    this.chunks.forEach((chunk, index) => {
      if (chunk.age === Infinity) {
        this.object.setMatrixAt(index, this.hidden);
        return;
      }
      const fade = chunk.body ? 1 : Math.max(0, 1 - (chunk.age - SOLID_SECONDS) / FADE_SECONDS);
      this.lerped.lerpVectors(chunk.previousPosition, chunk.position, alpha);
      // A fading chunk sinks into the ground while it shrinks.
      this.lerped.y -= (1 - fade) * chunk.size.y * 0.5;
      this.slerped.slerpQuaternions(chunk.previousRotation, chunk.rotation, alpha);
      this.matrix.compose(
        this.lerped,
        this.slerped,
        this.scale.copy(chunk.size).multiplyScalar(Math.max(fade, 0.001)),
      );
      this.object.setMatrixAt(index, this.matrix);
    });
    this.object.instanceMatrix.needsUpdate = true;
  }

  private release(chunk: Chunk): void {
    if (chunk.body) {
      this.physics.world.removeRigidBody(chunk.body);
      chunk.body = undefined;
    }
  }
}
