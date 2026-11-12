import * as THREE from 'three/webgpu';
import type { EventBus } from '../../engine/events';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { GameEvents } from '../events';
import type { LevelData } from '../level';
import { boxesOverlap, type OrientedBox, type Vec2 } from '../math';
import { TNT_FUSE_SECONDS } from './damage';
import { MeshBuilder } from './mesh-builder';

/** Edge length of a TNT crate in metres. */
export const CRATE_SIZE = 3.2;
const CRATE_MASS = 500;
/** Seconds until an exploded or lost crate comes back at its starting place. */
const RESPAWN_SECONDS = 6;
/** A crate that another explosion catches goes off after this short delay. */
const CHAIN_FUSE_SECONDS = 0.35;
const RING_SEGMENTS = 20;
const RING_RADIUS = 3.6;

const COLOR_IDLE = 0x2ee6ff;
const COLOR_FUSE = 0xff9a2e;
const COLOR_URGENT = 0xff3d5a;

type CrateState = 'idle' | 'lit' | 'gone';

/** One TNT crate. */
export interface Crate {
  readonly spawn: Vec2;
  body: RAPIER.RigidBody;
  state: CrateState;
  /** Seconds until the explosion while the fuse burns. */
  fuse: number;
  /** Seconds until the crate comes back after it exploded. */
  respawn: number;
  readonly object: THREE.Group;
  readonly material: THREE.MeshLambertMaterial;
  readonly ring: THREE.InstancedMesh;
  readonly position: THREE.Vector3;
  readonly previousPosition: THREE.Vector3;
  heading: number;
  previousHeading: number;
}

/**
 * The TNT crates of a level.
 *
 * A vehicle that touches a crate lights its fuse. A ring on the ground burns down for ten
 * seconds, then the crate explodes. The crate comes back at its starting place afterwards, so a
 * level cannot become unwinnable when a crate is wasted.
 */
export class TntCrates {
  readonly object = new THREE.Group();
  readonly crates: Crate[] = [];

  private readonly matrix = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();
  private pulse = 0;

  constructor(
    private readonly level: LevelData,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly physics: PhysicsWorld,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.object.name = 'tnt';
    const geometry = createCrateGeometry();
    const segment = new THREE.BoxGeometry(0.85, 0.12, 0.34);
    for (const spawn of level.tnt) {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff5a2e });
      material.emissiveIntensity = 0;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const ring = new THREE.InstancedMesh(
        segment,
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        RING_SEGMENTS,
      );
      ring.frustumCulled = false;
      const object = new THREE.Group();
      object.add(mesh);
      this.object.add(object, ring);

      const crate: Crate = {
        spawn: spawn.pos,
        body: this.createBody(spawn.pos),
        state: 'idle',
        fuse: 0,
        respawn: 0,
        object,
        material,
        ring,
        position: new THREE.Vector3(),
        previousPosition: new THREE.Vector3(),
        heading: 0,
        previousHeading: 0,
      };
      crate.position.copy(crate.body.translation());
      crate.previousPosition.copy(crate.position);
      this.crates.push(crate);
    }
  }

  /**
   * Burns the fuses and returns the crates that explode in this step.
   *
   * @param vehicleBoxes Footprints of the vehicles that can light a crate.
   */
  step(dt: number, vehicleBoxes: readonly OrientedBox[]): Crate[] {
    const exploding: Crate[] = [];
    const { min, max } = this.level.bounds;
    for (const crate of this.crates) {
      if (crate.state === 'gone') {
        crate.respawn -= dt;
        // Wait until nothing stands on the starting place, so that the crate is not lit at once.
        const place: OrientedBox = {
          center: crate.spawn,
          half: [CRATE_SIZE * 1.5, CRATE_SIZE * 1.5],
          heading: 0,
        };
        if (crate.respawn <= 0 && !vehicleBoxes.some((vehicle) => boxesOverlap(vehicle, place))) {
          this.respawn(crate);
        }
        continue;
      }
      const position = crate.body.translation();
      const lost =
        position.x < min[0] - 2 ||
        position.x > max[0] + 2 ||
        position.z < min[1] - 2 ||
        position.z > max[1] + 2 ||
        position.y < -20;
      if (lost) {
        this.remove(crate);
        continue;
      }
      if (crate.state === 'idle') {
        const reach = CRATE_SIZE / 2 + 0.45;
        const box: OrientedBox = {
          center: [position.x, position.z],
          half: [reach, reach],
          heading: crate.heading,
        };
        if (vehicleBoxes.some((vehicle) => boxesOverlap(vehicle, box))) {
          this.light(crate, TNT_FUSE_SECONDS);
        }
      } else {
        crate.fuse -= dt;
        if (crate.fuse <= 0) {
          exploding.push(crate);
        }
      }
    }
    return exploding;
  }

  /** Returns true when a collider belongs to one of the crates. */
  owns(colliderHandle: number): boolean {
    return this.crates.some(
      (crate) => crate.state !== 'gone' && crate.body.collider(0).handle === colliderHandle,
    );
  }

  /** Lights the fuse of a crate. A burning fuse only gets shorter. */
  light(crate: Crate, seconds: number): void {
    if (crate.state === 'gone') {
      return;
    }
    if (crate.state === 'idle') {
      crate.state = 'lit';
      crate.fuse = seconds;
      this.events.emit('tntLit', { position: crate.position });
    } else {
      crate.fuse = Math.min(crate.fuse, seconds);
    }
  }

  /** Lights every crate within the radius of an explosion with a very short fuse. */
  igniteWithin(center: THREE.Vector3, radius: number): void {
    for (const crate of this.crates) {
      if (crate.state !== 'gone' && crate.position.distanceTo(center) < radius) {
        this.light(crate, CHAIN_FUSE_SECONDS);
      }
    }
  }

  /** Takes a crate out of the world. It comes back at its starting place later. */
  remove(crate: Crate): void {
    this.physics.world.removeRigidBody(crate.body);
    crate.state = 'gone';
    crate.respawn = RESPAWN_SECONDS;
    crate.object.visible = false;
    crate.ring.visible = false;
  }

  /** Records the body transforms after the physics step. */
  capture(): void {
    for (const crate of this.crates) {
      if (crate.state === 'gone') {
        continue;
      }
      crate.previousPosition.copy(crate.position);
      crate.previousHeading = crate.heading;
      crate.position.copy(crate.body.translation());
      const rotation = crate.body.rotation();
      crate.heading = -2 * Math.atan2(rotation.y, rotation.w);
    }
  }

  /** Draws the crates and their fuse rings. */
  sync(alpha: number, frameSeconds: number): void {
    this.pulse += frameSeconds;
    for (const crate of this.crates) {
      if (crate.state === 'gone') {
        continue;
      }
      crate.object.position.lerpVectors(crate.previousPosition, crate.position, alpha);
      crate.object.rotation.y = -crate.heading;

      const lit = crate.state === 'lit';
      const urgent = lit && crate.fuse < 3;
      // The crate blinks faster and faster while the fuse burns down.
      const rate = lit ? 3 + (1 - crate.fuse / TNT_FUSE_SECONDS) * 14 : 0;
      crate.material.emissiveIntensity = lit ? 0.5 + 0.5 * Math.sin(this.pulse * rate) : 0;

      const remaining = lit
        ? Math.ceil((crate.fuse / TNT_FUSE_SECONDS) * RING_SEGMENTS)
        : RING_SEGMENTS;
      const ground = this.heightAt(crate.object.position.x, crate.object.position.z) + 0.12;
      for (let i = 0; i < RING_SEGMENTS; i += 1) {
        // Idle: a dashed ring marks the crate as something to push. Lit: the ring burns down.
        const visible = lit ? i < remaining : i % 2 === 0;
        if (!visible) {
          crate.ring.setMatrixAt(i, this.hidden);
          continue;
        }
        const angle = (i / RING_SEGMENTS) * Math.PI * 2 - Math.PI / 2;
        this.matrix
          .makeRotationY(-angle - Math.PI / 2)
          .setPosition(
            crate.object.position.x + Math.cos(angle) * RING_RADIUS,
            ground,
            crate.object.position.z + Math.sin(angle) * RING_RADIUS,
          );
        crate.ring.setMatrixAt(i, this.matrix);
        crate.ring.setColorAt(
          i,
          this.color.setHex(urgent ? COLOR_URGENT : lit ? COLOR_FUSE : COLOR_IDLE),
        );
      }
      crate.ring.instanceMatrix.needsUpdate = true;
      if (crate.ring.instanceColor) {
        crate.ring.instanceColor.needsUpdate = true;
      }
    }
  }

  private respawn(crate: Crate): void {
    crate.body = this.createBody(crate.spawn);
    crate.state = 'idle';
    crate.fuse = 0;
    crate.position.copy(crate.body.translation());
    crate.previousPosition.copy(crate.position);
    crate.heading = 0;
    crate.previousHeading = 0;
    crate.object.visible = true;
    crate.ring.visible = true;
    crate.material.emissiveIntensity = 0;
    this.events.emit('tntRespawned', { position: crate.position });
  }

  private createBody(position: Vec2): RAPIER.RigidBody {
    const y = this.heightAt(position[0], position[1]) + CRATE_SIZE / 2 + 0.05;
    // The crate slides and turns, but it does not tumble. That keeps it in front of a blade.
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], y, position[1])
        .enabledRotations(false, true, false)
        .setLinearDamping(0.9)
        .setAngularDamping(2.5)
        .setCcdEnabled(true),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(CRATE_SIZE / 2, CRATE_SIZE / 2, CRATE_SIZE / 2)
        .setMass(CRATE_MASS)
        .setFriction(0.5)
        .setRestitution(0)
        .setCollisionGroups(collisionGroups(Layer.crate, 0xffff)),
      body,
    );
    return body;
  }
}

function createCrateGeometry(): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const s = CRATE_SIZE;
  builder.box([s, s, s], [0, 0, 0], 0xe8662c);
  // Dark straps around the crate, as on the level maps.
  for (const y of [-s * 0.22, s * 0.22]) {
    builder.box([s + 0.12, s * 0.12, s + 0.12], [0, y, 0], 0x8a2f10);
  }
  builder.box([s * 0.5, 0.1, s * 0.5], [0, s / 2 + 0.03, 0], 0xffd23f);
  return builder.build();
}
