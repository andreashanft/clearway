import { BoxGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { CLEAT_MATERIAL } from './materials';

export interface TrackShape {
  /** Lateral position of the track centre. */
  readonly x: number;
  /** Height of the wheel centres above the model origin. */
  readonly y: number;
  /** Distance between the front and rear wheel centres. */
  readonly length: number;
  /** Radius of the end wheels; the belt wraps around them. */
  readonly radius: number;
  readonly width: number;
}

const CLEAT_PITCH = 0.3;

/**
 * Animated crawler-track cleats: instanced blocks laid around a stadium-shaped loop that
 * slide along it as the track turns.
 */
export class TrackCleats {
  readonly mesh: InstancedMesh;
  private readonly perimeter: number;
  private readonly count: number;
  private phase = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly unitScale = new Vector3(1, 1, 1);
  private readonly axis = new Vector3(1, 0, 0);

  constructor(private readonly shape: TrackShape) {
    this.perimeter = 2 * shape.length + 2 * Math.PI * shape.radius;
    this.count = Math.round(this.perimeter / CLEAT_PITCH);
    const cleat = new BoxGeometry(shape.width + 0.04, 0.09, CLEAT_PITCH * 0.55);
    this.mesh = new InstancedMesh(cleat, CLEAT_MATERIAL, this.count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.update(0);
  }

  /** Advances the belt by `distance` metres (positive moves the top run backwards). */
  update(distance: number): void {
    this.phase = (((this.phase + distance) % this.perimeter) + this.perimeter) % this.perimeter;
    const spacing = this.perimeter / this.count;
    for (let k = 0; k < this.count; k++) {
      this.place((k * spacing + this.phase) % this.perimeter);
      this.matrix.compose(this.position, this.rotation, this.unitScale);
      this.mesh.setMatrixAt(k, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Places a cleat at arc length `s`, measured along the bottom run from rear to front,
   * then up and around the front wheel, back along the top and down the rear wheel.
   */
  private place(s: number): void {
    const { x, y, length, radius } = this.shape;
    const half = length / 2;
    const r = radius + 0.045;
    const arc = Math.PI * radius;
    if (s < length) {
      this.position.set(x, y - r, -half + s);
      this.rotation.identity();
      return;
    }
    s -= length;
    if (s < arc) {
      const a = s / radius - Math.PI / 2;
      this.position.set(x, y + Math.sin(a) * r, half + Math.cos(a) * r);
      this.rotation.setFromAxisAngle(this.axis, -(a + Math.PI / 2));
      return;
    }
    s -= arc;
    if (s < length) {
      this.position.set(x, y + r, half - s);
      this.rotation.setFromAxisAngle(this.axis, Math.PI);
      return;
    }
    s -= length;
    const a = s / radius + Math.PI / 2;
    this.position.set(x, y + Math.sin(a) * r, -half + Math.cos(a) * r);
    this.rotation.setFromAxisAngle(this.axis, -(a + Math.PI / 2));
  }
}
