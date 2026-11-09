import {
  BoxGeometry,
  type BufferGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Route } from '../route';
import type { Heightfield } from './heightfield';

const GAUGE = 1.5;
const SLEEPER_SPACING = 0.9;

/**
 * Rails and sleepers along a rail spline, and the glowing slot where the Railbed parks:
 * a dashed cyan outline that turns solid once it is filled.
 */
export class Rails {
  readonly group = new Group();
  private readonly slotMaterial = new MeshBasicMaterial({
    color: '#2EE6FF',
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
    depthWrite: false,
  });
  private readonly slotParts: Mesh[] = [];
  private time = 0;
  private filled = false;

  constructor(rail: Route, field: Heightfield, slot: number) {
    const sleepers = Math.floor(rail.length / SLEEPER_SPACING);
    const sleeperMesh = new InstancedMesh(
      new BoxGeometry(2.4, 0.14, 0.28),
      new MeshStandardMaterial({ color: '#5E4A38', roughness: 0.9 }),
      sleepers,
    );
    const matrix = new Matrix4();
    const quat = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const unit = new Vector3(1, 1, 1);
    for (let k = 0; k < sleepers; k++) {
      const s = rail.sampleAt(k * SLEEPER_SPACING);
      quat.setFromAxisAngle(up, Math.atan2(s.dx, s.dz));
      pos.set(s.x, field.heightAt(s.x, s.z) + 0.07, s.z);
      sleeperMesh.setMatrixAt(k, matrix.compose(pos, quat, unit));
    }
    sleeperMesh.receiveShadow = true;

    // Each rail is a chain of short boxes, merged into one mesh.
    const pieces = [];
    const step = 2;
    for (let d = 0; d < rail.length; d += step) {
      const a = rail.sampleAt(d);
      const b = rail.sampleAt(Math.min(rail.length, d + step));
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.01) continue;
      const heading = Math.atan2(b.x - a.x, b.z - a.z);
      for (const side of [-1, 1]) {
        const ox = Math.cos(heading) * side * (GAUGE / 2);
        const oz = -Math.sin(heading) * side * (GAUGE / 2);
        const mx = (a.x + b.x) / 2 + ox;
        const mz = (a.z + b.z) / 2 + oz;
        const g = new BoxGeometry(0.12, 0.16, length + 0.02);
        g.rotateY(heading);
        g.translate(mx, field.heightAt(mx, mz) + 0.22, mz);
        pieces.push(g);
      }
    }
    const railMesh = new Mesh(
      mergeGeometries(pieces),
      new MeshStandardMaterial({ color: '#8E95A0', roughness: 0.3, metalness: 0.8 }),
    );
    for (const p of pieces) p.dispose();
    railMesh.castShadow = true;
    this.group.add(sleeperMesh, railMesh);

    // Slot outline: four dashed bars around the Railbed's footprint at the slot.
    const s = rail.sampleAt(slot);
    const heading = Math.atan2(s.dx, s.dz);
    const y = field.heightAt(s.x, s.z) + 0.3;
    const halfW = 1.8;
    const halfL = 4.6;
    const dashes: [number, number, number, number][] = [];
    for (let k = -4; k <= 4; k++) {
      dashes.push([-halfW, k * 1.05, 0.25, 0.6], [halfW, k * 1.05, 0.25, 0.6]);
    }
    for (let k = -1; k <= 1; k++)
      dashes.push([k * 1.1, -halfL, 0.6, 0.25], [k * 1.1, halfL, 0.6, 0.25]);
    for (const [lx, lz, w, d] of dashes) {
      const dash = new Mesh(new PlaneGeometry(w, d), this.slotMaterial);
      dash.rotation.set(-Math.PI / 2, 0, heading, 'YXZ');
      const wx = s.x + lx * Math.cos(heading) + lz * Math.sin(heading);
      const wz = s.z - lx * Math.sin(heading) + lz * Math.cos(heading);
      dash.position.set(wx, y, wz);
      this.slotParts.push(dash);
      this.group.add(dash);
    }
    this.group.name = 'rails';
  }

  /** Pulses while empty; solid once the Railbed is locked in. */
  update(dt: number, filled: boolean): void {
    this.time += dt;
    if (filled && !this.filled) {
      this.filled = true;
      for (const dash of this.slotParts) dash.scale.set(1.8, 1.8, 1);
    }
    this.slotMaterial.opacity = this.filled ? 0.95 : 0.5 + 0.4 * Math.sin(this.time * 4);
    this.slotMaterial.color.set(this.filled ? '#3DF5A0' : '#2EE6FF');
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) (obj.geometry as BufferGeometry).dispose();
    });
    this.slotMaterial.dispose();
  }
}
