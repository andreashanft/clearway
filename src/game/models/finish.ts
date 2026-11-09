import { BufferAttribute, type BufferGeometry, Color } from 'three';
import { attribute } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

/**
 * A surface finish stored per vertex: colour, roughness, metalness and emission. Every
 * part of a model can then share one material and merge into one mesh, so a detailed
 * vehicle still costs a single draw.
 */
export interface Finish {
  readonly colour: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
}

const tmp = new Color();
const black = new Color(0, 0, 0);

/** Writes a finish into a geometry's vertex attributes; drops uvs. */
export function applyFinish(geometry: BufferGeometry, finish: Finish): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const count = g.getAttribute('position').count;
  const colour = new Float32Array(count * 3);
  const pbr = new Float32Array(count * 2);
  const emissive = new Float32Array(count * 3);
  tmp.set(finish.colour);
  const glow = finish.emissive
    ? new Color(finish.emissive).multiplyScalar(finish.emissiveIntensity ?? 1)
    : black;
  for (let k = 0; k < count; k++) {
    colour.set([tmp.r, tmp.g, tmp.b], k * 3);
    pbr.set([finish.roughness, finish.metalness], k * 2);
    emissive.set([glow.r, glow.g, glow.b], k * 3);
  }
  g.setAttribute('color', new BufferAttribute(colour, 3));
  g.setAttribute('pbr', new BufferAttribute(pbr, 2));
  g.setAttribute('emissive', new BufferAttribute(emissive, 3));
  if (g.hasAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/** The one material every finish-painted model shares. */
export const FINISH_MATERIAL = (() => {
  const material = new MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute<'vec2'>('pbr', 'vec2');
  material.roughnessNode = pbr.x;
  material.metalnessNode = pbr.y;
  material.emissiveNode = attribute<'vec3'>('emissive', 'vec3');
  return material;
})();

/** Finishes used across the crew vehicles, from the vehicle sheet. */
export const FINISH = {
  hazardPaint: { colour: '#FFC21A', roughness: 0.48, metalness: 0.08 },
  hazardDeep: { colour: '#D9A100', roughness: 0.42, metalness: 0.2 },
  blackBand: { colour: '#15181D', roughness: 0.6, metalness: 0.1 },
  steel: { colour: '#8E95A0', roughness: 0.38, metalness: 0.65 },
  darkSteel: { colour: '#3A414B', roughness: 0.55, metalness: 0.5 },
  rubber: { colour: '#23272D', roughness: 0.85, metalness: 0 },
  glass: { colour: '#2F4A5E', roughness: 0.06, metalness: 0.35 },
  chrome: { colour: '#C9CED6', roughness: 0.22, metalness: 0.9 },
  headlight: {
    colour: '#FFF6DA',
    roughness: 0.3,
    metalness: 0,
    emissive: '#FFF1C4',
    emissiveIntensity: 1.4,
  },
  beaconAmber: {
    colour: '#FF9A2E',
    roughness: 0.3,
    metalness: 0,
    emissive: '#FF8A1E',
    emissiveIntensity: 1.2,
  },
  tailLight: {
    colour: '#FF3D5A',
    roughness: 0.4,
    metalness: 0,
    emissive: '#FF3D5A',
    emissiveIntensity: 0.9,
  },
} as const satisfies Record<string, Finish>;
