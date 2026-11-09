import type { RigidBody } from '@dimforge/rapier3d-compat';
import {
  Color,
  DirectionalLight,
  Euler,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { InterpolatedPose } from '../engine/interpolation';
import type { Physics } from '../engine/physics';
import type { Viewport } from '../engine/renderer';

const CRATE_COUNT = 24;
const RESPAWN_SECONDS = 6;

interface Crate {
  readonly body: RigidBody;
  readonly pose: InterpolatedPose;
}

/**
 * Milestone 1 test scene: a lit ground plane and crates that fall, tumble and respawn.
 * It proves the renderer, physics, fixed-step loop and interpolation work together.
 * Milestone 2 replaces it with real terrain and a vehicle.
 */
export class Sandbox {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.5, 600);
  private readonly crates: Crate[] = [];
  private sinceRespawn = 0;

  constructor(private readonly physics: Physics) {
    this.scene.background = new Color('#9fc4e8');
    this.addLights();
    this.addGround();
    this.addCrates();
    this.placeCamera();
  }

  setViewport({ width, height }: Viewport): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  step(dt: number): void {
    this.sinceRespawn += dt;
    if (this.sinceRespawn >= RESPAWN_SECONDS) {
      this.sinceRespawn = 0;
      this.respawn();
    }
  }

  /** Call after the physics world has stepped. */
  afterStep(): void {
    for (const { pose } of this.crates) pose.capture();
  }

  render(alpha: number): void {
    for (const { pose } of this.crates) pose.apply(alpha);
  }

  private addLights(): void {
    this.scene.add(new HemisphereLight('#dfefff', '#5d7a4a', 1.4));
    const sun = new DirectionalLight('#fff4e0', 2.6);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = 30;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private addGround(): void {
    const { rapier, world } = this.physics;
    const mesh = new Mesh(
      new PlaneGeometry(120, 120),
      new MeshStandardMaterial({ color: '#7fa65a', roughness: 0.95 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    world.createCollider(rapier.ColliderDesc.cuboid(60, 0.5, 60), body);
  }

  private addCrates(): void {
    const { rapier, world } = this.physics;
    const geometry = new RoundedBoxGeometry(1.6, 1.6, 1.6, 3, 0.12);
    const palette = ['#ffd23f', '#3d7bff', '#ff7a2e', '#eef3ff'];

    for (let i = 0; i < CRATE_COUNT; i++) {
      const material = new MeshStandardMaterial({
        color: palette[i % palette.length],
        roughness: 0.55,
        metalness: 0.05,
      });
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic());
      world.createCollider(rapier.ColliderDesc.cuboid(0.8, 0.8, 0.8).setRestitution(0.2), body);
      this.crates.push({ body, pose: new InterpolatedPose(body, mesh) });
    }
    this.respawn();
  }

  private respawn(): void {
    const tilt = new Quaternion();
    const euler = new Euler();
    this.crates.forEach(({ body, pose }, i) => {
      const ring = 3 + (i % 4) * 1.5;
      const angle = (i / CRATE_COUNT) * Math.PI * 6;
      tilt.setFromEuler(euler.set(0.3 * Math.sin(i), angle, 0.3 * Math.cos(i)));
      body.setTranslation(
        { x: Math.cos(angle) * ring, y: 6 + i * 1.8, z: Math.sin(angle) * ring },
        true,
      );
      body.setRotation(tilt, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: Math.sin(i * 1.7) * 2, y: Math.cos(i) * 2, z: 0 }, true);
      pose.snap();
    });
  }

  private placeCamera(): void {
    // Three-quarter view from the brief: narrow FOV, pitched 55° down.
    const pitch = (55 * Math.PI) / 180;
    const distance = 45;
    this.camera.position.set(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance);
    this.camera.lookAt(0, 0, 0);
  }
}
