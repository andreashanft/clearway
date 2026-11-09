import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';

export interface PoseSource {
  translation(): { x: number; y: number; z: number };
  rotation(): { x: number; y: number; z: number; w: number };
}

/**
 * Remembers a body's pose at the last two simulation steps and blends between them, so
 * motion stays smooth when the display rate differs from the 60 Hz simulation.
 */
export class InterpolatedPose {
  private readonly prevPosition = new Vector3();
  private readonly prevRotation = new Quaternion();
  private readonly currPosition = new Vector3();
  private readonly currRotation = new Quaternion();

  constructor(
    readonly source: PoseSource,
    readonly target: Object3D,
  ) {
    this.snap();
  }

  /** Call after every simulation step. */
  capture(): void {
    this.prevPosition.copy(this.currPosition);
    this.prevRotation.copy(this.currRotation);
    this.read();
  }

  /** Jumps to the current pose with no blending, for example after a teleport. */
  snap(): void {
    this.read();
    this.prevPosition.copy(this.currPosition);
    this.prevRotation.copy(this.currRotation);
    this.apply(1);
  }

  /** Writes the blended pose to the target object. */
  apply(alpha: number): void {
    this.target.position.lerpVectors(this.prevPosition, this.currPosition, alpha);
    this.target.quaternion.slerpQuaternions(this.prevRotation, this.currRotation, alpha);
  }

  private read(): void {
    const t = this.source.translation();
    const r = this.source.rotation();
    this.currPosition.set(t.x, t.y, t.z);
    this.currRotation.set(r.x, r.y, r.z, r.w);
  }
}
