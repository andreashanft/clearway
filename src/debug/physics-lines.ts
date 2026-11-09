import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  type Scene,
} from 'three';
import type { Physics } from '../engine/physics';

/** Draws every Rapier collider as wireframe lines, refreshed each frame (debug only). */
export class PhysicsLines {
  private readonly lines: LineSegments;

  constructor(
    private readonly physics: Physics,
    private readonly scene: Scene,
  ) {
    this.lines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        vertexColors: true,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    scene.add(this.lines);
  }

  update(): void {
    const { vertices, colors } = this.physics.world.debugRender();
    const geometry = this.lines.geometry;
    geometry.setAttribute('position', new BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 4));
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
  }
}
