import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from './heightfield';

export interface PropPlacement {
  readonly type: string;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly yaw: number;
}

export interface WaterStrip {
  readonly width: number;
  /** Centre line as [x, y, z] points. */
  readonly points: readonly (readonly [number, number, number])[];
}

export interface PropsFile {
  readonly props: readonly PropPlacement[];
  readonly water: readonly WaterStrip[];
}

export interface PropInstance {
  readonly id: number;
  readonly type: string;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
}

/** Paints a geometry one flat colour through a vertex colour attribute. */
function tinted(geometry: BufferGeometry, colour: string): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new Color(colour);
  const count = g.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    colours[k * 3] = c.r;
    colours[k * 3 + 1] = c.g;
    colours[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
  g.deleteAttribute('uv');
  return g;
}

function blob(radius: number, x: number, y: number, z: number, colour: string): BufferGeometry {
  // Detail 0 (20 faces) keeps hundreds of trees inside the phone triangle budget.
  const g = new IcosahedronGeometry(radius, 0);
  g.scale(1, 0.85, 1);
  g.translate(x, y, z);
  return tinted(g, colour);
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Low-poly prop models, each merged into one vertex-coloured geometry. */
function buildModels(): Record<string, BufferGeometry> {
  const trunk = (height: number, radius: number): BufferGeometry => {
    const g = new CylinderGeometry(radius * 0.7, radius, height, 6);
    g.translate(0, height / 2, 0);
    return tinted(g, '#6E5338');
  };
  const tree = merged([
    trunk(2.6, 0.32),
    blob(2.5, 0, 4.4, 0, '#4F7F3E'),
    blob(1.9, 1.4, 3.8, 0.7, '#5D8C45'),
    blob(1.8, -1.2, 4.0, -0.8, '#4A7838'),
    blob(1.7, -0.4, 3.7, 1.3, '#557F40'),
    blob(1.5, 0.3, 5.7, -0.2, '#6A9A52'),
  ]);
  const pineLayer = (radius: number, height: number, y: number, colour: string): BufferGeometry => {
    const g = new ConeGeometry(radius, height, 6);
    g.translate(0, y, 0);
    return tinted(g, colour);
  };
  const pine = merged([
    trunk(1.6, 0.28),
    pineLayer(2.2, 3.2, 2.8, '#3E6B3A'),
    pineLayer(1.7, 2.8, 4.4, '#467542'),
    pineLayer(1.1, 2.2, 5.9, '#52824B'),
  ]);
  const bush = merged([
    blob(1.1, 0, 0.7, 0, '#557F3F'),
    blob(0.85, 0.8, 0.55, 0.2, '#62904A'),
    blob(0.75, -0.6, 0.5, -0.3, '#4C7438'),
  ]);
  const rockPart = (
    radius: number,
    x: number,
    y: number,
    z: number,
    colour: string,
  ): BufferGeometry => {
    const g = new DodecahedronGeometry(radius, 0);
    g.scale(1, 0.62, 0.85);
    g.translate(x, y, z);
    return tinted(g, colour);
  };
  const rock = merged([
    rockPart(0.9, 0, 0.3, 0, '#8E8C82'),
    rockPart(0.55, 0.8, 0.15, 0.3, '#A3A196'),
  ]);
  return { tree, pine, bush, rock };
}

/**
 * Trees, bushes and rocks from the baked props file, drawn as one batched mesh, plus
 * water strips for creeks.
 */
export class Props {
  readonly group = new Group();
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
  });
  private readonly waterMaterial = new MeshStandardMaterial({
    color: '#4E9CC2',
    roughness: 0.18,
    metalness: 0.05,
    transparent: true,
    opacity: 0.88,
    side: DoubleSide,
  });
  private readonly models = buildModels();
  /** Every placed prop, so gameplay can find and knock them over later. */
  readonly instances: PropInstance[] = [];
  private batch: BatchedMesh | null = null;

  constructor(file: PropsFile, field: Heightfield) {
    this.group.name = 'props';
    this.buildInstances(file.props, field);
    for (const strip of file.water) this.group.add(this.buildWater(strip));
  }

  dispose(): void {
    for (const g of Object.values(this.models)) g.dispose();
    this.batch?.dispose();
    this.material.dispose();
    this.waterMaterial.dispose();
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) (obj.geometry as BufferGeometry).dispose();
    });
  }

  private buildInstances(props: readonly PropPlacement[], field: Heightfield): void {
    const placeable = props.filter((prop) => prop.type in this.models);
    const geometryIds = new Map<string, number>();
    let vertexCount = 0;
    for (const [type, geometry] of Object.entries(this.models)) {
      vertexCount += geometry.getAttribute('position').count;
      geometryIds.set(type, -1);
    }
    // One batched draw for every prop; each instance is culled on its own.
    const batch = new BatchedMesh(Math.max(1, placeable.length), vertexCount, 0, this.material);
    for (const [type, geometry] of Object.entries(this.models)) {
      geometryIds.set(type, batch.addGeometry(geometry));
    }

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const tint = new Color();
    placeable.forEach((prop, k) => {
      const geometryId = geometryIds.get(prop.type) ?? -1;
      if (geometryId < 0) return;
      const id = batch.addInstance(geometryId);
      // Sink the base slightly so props sit in the ground on slopes.
      position.set(prop.x, field.heightAt(prop.x, prop.z) - 0.15, prop.z);
      rotation.setFromAxisAngle(up, (prop.yaw * Math.PI) / 180);
      scale.setScalar(prop.scale);
      batch.setMatrixAt(id, matrix.compose(position, rotation, scale));
      const shade = 0.88 + ((k * 37) % 25) / 100;
      batch.setColorAt(id, tint.setRGB(shade, shade, shade));
      this.instances.push({ id, type: prop.type, x: prop.x, z: prop.z, scale: prop.scale });
    });
    batch.castShadow = true;
    batch.receiveShadow = true;
    batch.name = 'props';
    this.batch = batch;
    this.group.add(batch);
  }

  private buildWater(strip: WaterStrip): Mesh {
    const { points, width } = strip;
    const positions = new Float32Array(points.length * 2 * 3);
    const indices: number[] = [];
    for (let k = 0; k < points.length; k++) {
      const [x, y, z] = points[k] ?? [0, 0, 0];
      const prev = points[Math.max(0, k - 1)] ?? points[k] ?? [0, 0, 0];
      const next = points[Math.min(points.length - 1, k + 1)] ?? points[k] ?? [0, 0, 0];
      let dx = next[0] - prev[0];
      let dz = next[2] - prev[2];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const hw = width / 2;
      positions.set([x - dz * hw, y, z + dx * hw, x + dz * hw, y, z - dx * hw], k * 6);
      if (k > 0) {
        const a = (k - 1) * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, this.waterMaterial);
    mesh.receiveShadow = true;
    mesh.name = 'water';
    return mesh;
  }
}
