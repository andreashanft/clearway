import * as THREE from 'three/webgpu';
import type { Lighting } from '../level';

interface LightingPreset {
  /** Colour behind the world. */
  sky: number;
  hemisphereSky: number;
  hemisphereGround: number;
  hemisphereIntensity: number;
  sun: number;
  sunIntensity: number;
  /** Direction from the scene towards the sun. */
  sunDirection: [number, number, number];
}

const PRESETS: Record<Lighting, LightingPreset> = {
  morning: {
    sky: 0xb9d6e6,
    hemisphereSky: 0xd6ebff,
    hemisphereGround: 0x6f8a4e,
    hemisphereIntensity: 1.25,
    sun: 0xffe9c4,
    sunIntensity: 2.6,
    sunDirection: [-0.55, 0.62, 0.42],
  },
  dusk: {
    sky: 0xd9b9a6,
    hemisphereSky: 0xc9c4ee,
    hemisphereGround: 0x5b5560,
    hemisphereIntensity: 1.1,
    sun: 0xffb37a,
    sunIntensity: 2.5,
    sunDirection: [0.7, 0.38, 0.3],
  },
  noon: {
    sky: 0xc4dcec,
    hemisphereSky: 0xe6f2ff,
    hemisphereGround: 0x8a7a5c,
    hemisphereIntensity: 1.2,
    sun: 0xfff6e4,
    sunIntensity: 2.9,
    sunDirection: [-0.25, 0.9, 0.3],
  },
};

/** Half the edge length of the square that the sun's shadow covers, in metres. */
const SHADOW_HALF_SIZE = 95;
const SHADOW_DISTANCE = 220;

/** The lights of a level. The shadow follows the camera focus. */
export interface LevelLighting {
  /** Moves the shadow area so that it stays centred on a point. */
  follow(focus: THREE.Vector3): void;
  /** Sets the resolution of the shadow map, for the quality presets. */
  setShadowMapSize(size: number): void;
}

/** Adds sky colour, ambient light and a shadow-casting sun to a scene. */
export function createLighting(scene: THREE.Scene, lighting: Lighting): LevelLighting {
  const preset = PRESETS[lighting];
  scene.background = new THREE.Color(preset.sky);
  scene.add(
    new THREE.HemisphereLight(
      preset.hemisphereSky,
      preset.hemisphereGround,
      preset.hemisphereIntensity,
    ),
  );

  const sun = new THREE.DirectionalLight(preset.sun, preset.sunIntensity);
  const direction = new THREE.Vector3(...preset.sunDirection).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_HALF_SIZE;
  sun.shadow.camera.right = SHADOW_HALF_SIZE;
  sun.shadow.camera.top = SHADOW_HALF_SIZE;
  sun.shadow.camera.bottom = -SHADOW_HALF_SIZE;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = SHADOW_DISTANCE * 2;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  return {
    follow(focus) {
      // Move in whole steps, so that the shadow edges do not shimmer while the camera moves.
      const step = 4;
      const x = Math.round(focus.x / step) * step;
      const z = Math.round(focus.z / step) * step;
      sun.target.position.set(x, focus.y, z);
      sun.position.copy(sun.target.position).addScaledVector(direction, SHADOW_DISTANCE);
    },
    setShadowMapSize(size) {
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    },
  };
}
