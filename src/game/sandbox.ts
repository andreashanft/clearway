import * as THREE from 'three/webgpu';
import { Layer, RAPIER, collisionGroups, type PhysicsWorld } from '../engine/physics';

/** How many crates the sandbox drops. */
const CRATE_COUNT = 24;

/** Seconds between two crate drops. */
const DROP_INTERVAL = 0.35;

interface Crate {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  previous: THREE.Vector3;
  current: THREE.Vector3;
  previousRotation: THREE.Quaternion;
  currentRotation: THREE.Quaternion;
}

export interface Sandbox {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Runs game logic for one fixed step, before the physics step. */
  step(dt: number): void;
  /** Copies physics transforms to the meshes, blended by the interpolation factor. */
  sync(alpha: number): void;
  resize(aspect: number): void;
}

/**
 * Milestone 1 test scene: crates drop onto a ground plate.
 *
 * It proves that the renderer, the physics world and the fixed-step loop work together. The level
 * loader replaces it in milestone 2.
 */
export function createSandbox(physics: PhysicsWorld): Sandbox {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4dc);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  camera.position.set(0, 46, 32);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xdcecff, 0x55683e, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.position.set(-30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 150;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(60, 1, 60),
    new THREE.MeshLambertMaterial({ color: 0x7da35a }),
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(30, 0.5, 30)
      .setTranslation(0, -0.5, 0)
      .setCollisionGroups(collisionGroups(Layer.terrain, 0xffff)),
  );

  const crateGeometry = new THREE.BoxGeometry(2, 2, 2);
  const crateMaterial = new THREE.MeshLambertMaterial({ color: 0xff7a2e });
  const crates: Crate[] = [];
  let untilDrop = 0;

  function dropCrate(): void {
    const index = crates.length;
    const angle = index * 2.4;
    const start = new THREE.Vector3(Math.cos(angle) * 5, 14 + index * 0.2, Math.sin(angle) * 5);
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, angle * 0.5, 0))),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1, 1)
        .setRestitution(0.2)
        .setCollisionGroups(collisionGroups(Layer.crate, 0xffff)),
      body,
    );
    const mesh = new THREE.Mesh(crateGeometry, crateMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const rotation = new THREE.Quaternion().copy(body.rotation());
    crates.push({
      mesh,
      body,
      previous: start.clone(),
      current: start.clone(),
      previousRotation: rotation.clone(),
      currentRotation: rotation.clone(),
    });
  }

  return {
    scene,
    camera,
    step(dt) {
      untilDrop -= dt;
      if (untilDrop <= 0 && crates.length < CRATE_COUNT) {
        dropCrate();
        untilDrop = DROP_INTERVAL;
      }
      for (const crate of crates) {
        crate.previous.copy(crate.current);
        crate.previousRotation.copy(crate.currentRotation);
        crate.current.copy(crate.body.translation());
        crate.currentRotation.copy(crate.body.rotation());
      }
    },
    sync(alpha) {
      for (const crate of crates) {
        crate.mesh.position.lerpVectors(crate.previous, crate.current, alpha);
        crate.mesh.quaternion.slerpQuaternions(
          crate.previousRotation,
          crate.currentRotation,
          alpha,
        );
      }
    },
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
  };
}
