import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RepeatWrapping,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';
import { HAULER, type Footprint } from '../hauler/route-sweep';
import type { Route } from '../route';
import type { Heightfield } from './heightfield';

/** Metres of route per repeat of the chevron pattern. */
const PATTERN_LENGTH = 4;
const LIFT = 0.12;
const ALARM = '#FF3D5A';

/** Draws the route pattern: chevrons (colour plus shape) or plain dashes. */
function drawPattern(canvas: HTMLCanvasElement, chevrons: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, 128, 32);
  ctx.fillStyle = ALARM;
  if (chevrons) {
    // One chevron per repeat, pointing towards +u (the direction of travel).
    ctx.beginPath();
    ctx.moveTo(20, 2);
    ctx.lineTo(64, 16);
    ctx.lineTo(20, 30);
    ctx.lineTo(38, 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(74, 13, 36, 6);
  } else {
    ctx.fillRect(8, 11, 70, 10);
  }
}

/** Red chevrons pointing along the route: colour plus shape, readable without colour. */
function chevronTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  drawPattern(canvas, true);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function numberTexture(n: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = ALARM;
    ctx.beginPath();
    ctx.roundRect(4, 4, 56, 56, 10);
    ctx.fill();
    ctx.fillStyle = '#0B1430';
    ctx.font = '900 40px "Big Shoulders Display", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 32, 35);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A strip draped over the terrain along the route, `width` metres wide. */
function strip(route: Route, field: Heightfield, width: number, step: number): BufferGeometry {
  const samples = route.points(step);
  const positions = new Float32Array(samples.length * 6);
  const uvs = new Float32Array(samples.length * 4);
  const index: number[] = [];
  samples.forEach((s, k) => {
    const nx = -s.dz;
    const nz = s.dx;
    const hw = width / 2;
    const lx = s.x + nx * hw;
    const lz = s.z + nz * hw;
    const rx = s.x - nx * hw;
    const rz = s.z - nz * hw;
    positions.set(
      [lx, field.heightAt(lx, lz) + LIFT, lz, rx, field.heightAt(rx, rz) + LIFT, rz],
      k * 6,
    );
    const u = (k * step) / PATTERN_LENGTH;
    uvs.set([u, 0, u, 1], k * 4);
    if (k > 0) {
      const a = (k - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** A rectangle outline on the ground around a footprint, as one geometry. */
function outline(
  f: Footprint,
  field: Heightfield,
  margin: number,
  thickness: number,
): BufferGeometry {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const hx = f.halfX + margin;
  const hz = f.halfZ + margin;
  // Corners in local (x, z), then rotated like Three.js rotation.y.
  const corner = (lx: number, lz: number): [number, number] => [
    f.x + lx * c + lz * s,
    f.z - lx * s + lz * c,
  ];
  const ring = [corner(-hx, -hz), corner(hx, -hz), corner(hx, hz), corner(-hx, hz)];
  const inner = [
    corner(-hx + thickness, -hz + thickness),
    corner(hx - thickness, -hz + thickness),
    corner(hx - thickness, hz - thickness),
    corner(-hx + thickness, hz - thickness),
  ];
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = ring[i] ?? [0, 0];
    const [bx, bz] = inner[i] ?? [0, 0];
    positions.push(
      ax,
      field.heightAt(ax, az) + LIFT * 2,
      az,
      bx,
      field.heightAt(bx, bz) + LIFT * 2,
      bz,
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 2;
    const b = ((i + 1) % 4) * 2;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(index);
  return g;
}

interface Marker {
  readonly id: string;
  readonly outline: Mesh;
  readonly beacon: Group;
  readonly baseY: number;
}

/**
 * The route as the player sees it: a scrolling dashed hazard line with chevrons, a faint
 * band as wide as the Hauler, and a red outline and numbered marker on every obstacle.
 */
export class RouteLine {
  readonly group = new Group();
  private readonly texture = chevronTexture();
  private readonly markers: Marker[] = [];
  private readonly lineMaterial: MeshBasicMaterial;
  private readonly outlineMaterial = new MeshBasicMaterial({
    color: ALARM,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: DoubleSide,
  });
  private time = 0;

  constructor(
    route: Route,
    private readonly field: Heightfield,
  ) {
    this.texture.repeat.set(1, 1);
    this.lineMaterial = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: DoubleSide,
    });
    const band = new Mesh(
      strip(route, field, HAULER.width, 2),
      new MeshBasicMaterial({
        color: ALARM,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    const line = new Mesh(strip(route, field, 1.3, 1), this.lineMaterial);
    band.renderOrder = 1;
    line.renderOrder = 2;
    this.group.add(band, line);
    this.group.name = 'route';
  }

  /** Marks an obstacle: an outline around each member footprint and a numbered beacon. */
  addObstacle(id: string, number: number, footprints: readonly Footprint[], height: number): void {
    footprints.forEach((f, index) => {
      const mesh = new Mesh(outline(f, this.field, 0.8, 0.45), this.outlineMaterial);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      const beacon = new Group();
      const gem = new Mesh(new OctahedronGeometry(0.7, 0), new MeshBasicMaterial({ color: ALARM }));
      const label = new Sprite(
        new SpriteMaterial({ map: numberTexture(number), depthTest: false }),
      );
      label.scale.setScalar(2.4);
      label.position.y = 1.9;
      label.renderOrder = 5;
      beacon.add(gem, label);
      const baseY = this.field.heightAt(f.x, f.z) + height + 2.5;
      beacon.position.set(f.x, baseY, f.z);
      this.group.add(beacon);
      this.markers.push({ id, outline: mesh, beacon, baseY });
      // Only the first member of a group carries the number.
      label.visible = index === 0;
    });
  }

  /** Switches between chevrons and a plain dashed line. */
  setPattern(chevrons: boolean): void {
    drawPattern(this.texture.image, chevrons);
    this.texture.needsUpdate = true;
  }

  /** Hides the outline and marker of a cleared obstacle. */
  clear(id: string): void {
    for (const marker of this.markers) {
      if (marker.id !== id) continue;
      marker.outline.visible = false;
      marker.beacon.visible = false;
    }
  }

  /** Scrolls the chevrons at the Hauler's pace and bobs the markers. */
  update(dt: number, haulerSpeed: number): void {
    this.time += dt;
    this.texture.offset.x -= (haulerSpeed * dt) / PATTERN_LENGTH;
    for (const marker of this.markers) {
      marker.beacon.position.y = marker.baseY + Math.sin(this.time * 2) * 0.35;
      marker.beacon.rotation.y = this.time * 1.2;
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) (obj.geometry as BufferGeometry).dispose();
    });
    this.texture.dispose();
    this.lineMaterial.dispose();
    this.outlineMaterial.dispose();
  }
}
