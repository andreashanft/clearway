import { Color, MeshStandardMaterial } from 'three';

/**
 * Shared materials for vehicles and props. Sharing instances keeps GPU state changes and
 * draw calls down. Colours follow the vehicle sheet in the design canvas.
 */
export const MATERIALS = {
  hazardPaint: new MeshStandardMaterial({ color: '#FFC21A', roughness: 0.48, metalness: 0.08 }),
  hazardDeep: new MeshStandardMaterial({ color: '#D9A100', roughness: 0.42, metalness: 0.2 }),
  blackBand: new MeshStandardMaterial({ color: '#15181D', roughness: 0.6, metalness: 0.1 }),
  steel: new MeshStandardMaterial({ color: '#8E95A0', roughness: 0.38, metalness: 0.65 }),
  darkSteel: new MeshStandardMaterial({ color: '#3A414B', roughness: 0.55, metalness: 0.5 }),
  rubber: new MeshStandardMaterial({ color: '#23272D', roughness: 0.85, metalness: 0 }),
  cleat: new MeshStandardMaterial({ color: '#59616C', roughness: 0.5, metalness: 0.55 }),
  glass: new MeshStandardMaterial({ color: '#2F4A5E', roughness: 0.06, metalness: 0.35 }),
  chrome: new MeshStandardMaterial({ color: '#C9CED6', roughness: 0.22, metalness: 0.9 }),
  headlight: new MeshStandardMaterial({
    color: '#FFF6DA',
    emissive: new Color('#FFF1C4'),
    emissiveIntensity: 1.4,
    roughness: 0.3,
  }),
  beaconAmber: new MeshStandardMaterial({
    color: '#FF9A2E',
    emissive: new Color('#FF8A1E'),
    emissiveIntensity: 1.2,
    roughness: 0.3,
  }),
  tailLight: new MeshStandardMaterial({
    color: '#FF3D5A',
    emissive: new Color('#FF3D5A'),
    emissiveIntensity: 0.9,
    roughness: 0.4,
  }),
} as const;

/** Glow used for a vehicle's "action ready" part; each vehicle owns one so it can pulse. */
export function createReadyGlow(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: '#2EE6FF',
    emissive: new Color('#2EE6FF'),
    emissiveIntensity: 1.6,
    roughness: 0.35,
    metalness: 0,
  });
}
