import { Color, MeshStandardMaterial } from 'three';

/** Material for crawler-track cleats, drawn as one instanced mesh per track. */
export const CLEAT_MATERIAL = new MeshStandardMaterial({
  color: '#59616C',
  roughness: 0.5,
  metalness: 0.55,
});

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
