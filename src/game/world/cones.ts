import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../../engine/physics';
import type { Vec2 } from '../math';

/** Size of a cone in metres. The cones are larger than real ones, so that they read from afar. */
const CONE_HEIGHT = 1.3;
const CONE_RADIUS = 0.45;
const CONE_MASS = 8;
/** A cone counts as knocked over once it has moved this far from its place, in metres. */
const KNOCKED_DISTANCE = 0.5;

interface Cone {
  body: RAPIER.RigidBody;
  home: THREE.Vector3;
  previousPosition: THREE.Vector3;
  position: THREE.Vector3;
  previousRotation: THREE.Quaternion;
  rotation: THREE.Quaternion;
}

/**
 * Traffic cones that mark a course. Each cone is a light physics body, so a vehicle that
 * touches one knocks it over. The cones never stop a vehicle.
 */
export class Cones {
  readonly object = new THREE.Group();

  private readonly cones: Cone[] = [];
  private readonly bodies: THREE.InstancedMesh;
  private readonly bases: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly lerped = new THREE.Vector3();
  private readonly slerped = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(
    positions: readonly Vec2[],
    heightAt: (x: number, z: number) => number,
    physics: PhysicsWorld,
  ) {
    this.object.name = 'cones';
    const count = Math.max(1, positions.length);
    this.bodies = new THREE.InstancedMesh(
      new THREE.ConeGeometry(CONE_RADIUS * 0.8, CONE_HEIGHT, 10),
      new THREE.MeshLambertMaterial({ color: 0xff7a2e, emissive: 0x4a1c00 }),
      count,
    );
    // The base sits at the bottom of the cone, in the frame of the cone's centre.
    this.bases = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CONE_RADIUS * 2, 0.1, CONE_RADIUS * 2).translate(
        0,
        -CONE_HEIGHT / 2 + 0.05,
        0,
      ),
      new THREE.MeshLambertMaterial({ color: 0x2b3038 }),
      count,
    );
    for (const mesh of [this.bodies, this.bases]) {
      mesh.count = positions.length;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.object.add(mesh);
    }

    const groups = collisionGroups(
      Layer.debris,
      Layer.terrain | Layer.vehicle | Layer.building | Layer.debris,
    );
    for (const [x, z] of positions) {
      const home = new THREE.Vector3(x, heightAt(x, z) + CONE_HEIGHT / 2, z);
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(home.x, home.y, home.z)
          .setLinearDamping(0.6)
          .setAngularDamping(1.2),
      );
      physics.world.createCollider(
        RAPIER.ColliderDesc.cone(CONE_HEIGHT / 2, CONE_RADIUS)
          .setMass(CONE_MASS)
          .setFriction(0.9)
          .setRestitution(0.1)
          .setCollisionGroups(groups),
        body,
      );
      this.cones.push({
        body,
        home,
        previousPosition: home.clone(),
        position: home.clone(),
        previousRotation: new THREE.Quaternion(),
        rotation: new THREE.Quaternion(),
      });
    }
    this.sync(1);
  }

  /** Number of cones that a vehicle has knocked away from their places. */
  get knockedCount(): number {
    return this.cones.reduce(
      (count, cone) => count + (cone.position.distanceTo(cone.home) > KNOCKED_DISTANCE ? 1 : 0),
      0,
    );
  }

  /** Stands every cone up again at its place. */
  reset(): void {
    for (const cone of this.cones) {
      cone.body.setTranslation(cone.home, true);
      cone.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      cone.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      cone.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      cone.position.copy(cone.home);
      cone.previousPosition.copy(cone.home);
      cone.rotation.identity();
      cone.previousRotation.identity();
    }
  }

  /** Records the body transforms after the physics step, for interpolation. */
  capture(): void {
    for (const cone of this.cones) {
      cone.previousPosition.copy(cone.position);
      cone.previousRotation.copy(cone.rotation);
      const translation = cone.body.translation();
      const rotation = cone.body.rotation();
      cone.position.set(translation.x, translation.y, translation.z);
      cone.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }

  /** Moves the meshes to the transforms between the previous and the current step. */
  sync(alpha: number): void {
    this.cones.forEach((cone, index) => {
      this.lerped.lerpVectors(cone.previousPosition, cone.position, alpha);
      this.slerped.slerpQuaternions(cone.previousRotation, cone.rotation, alpha);
      this.matrix.compose(this.lerped, this.slerped, this.one);
      this.bodies.setMatrixAt(index, this.matrix);
      this.bases.setMatrixAt(index, this.matrix);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.bases.instanceMatrix.needsUpdate = true;
  }
}
