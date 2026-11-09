import {
  Color,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HemisphereLight,
  LinearFilter,
  Object3D,
  RGBAFormat,
  type Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';

export type LightingPreset = 'morning' | 'dusk' | 'noon';

interface PresetValues {
  readonly sky: string;
  readonly sun: string;
  readonly sunIntensity: number;
  /** Direction from the scene towards the sun. */
  readonly sunDirection: readonly [number, number, number];
  readonly hemiSky: string;
  readonly hemiGround: string;
  readonly hemiIntensity: number;
}

const PRESETS: Record<LightingPreset, PresetValues> = {
  morning: {
    sky: '#A9CDEA',
    sun: '#FFE6C2',
    sunIntensity: 2.7,
    sunDirection: [0.62, 0.66, 0.42],
    hemiSky: '#DCEBFF',
    hemiGround: '#5B6E45',
    hemiIntensity: 1.25,
  },
  dusk: {
    sky: '#E8A27A',
    sun: '#FFB27A',
    sunIntensity: 2.3,
    sunDirection: [-0.7, 0.42, 0.55],
    hemiSky: '#B9B6E8',
    hemiGround: '#4A3F4C',
    hemiIntensity: 1.1,
  },
  noon: {
    sky: '#B6DAF5',
    sun: '#FFF8EC',
    sunIntensity: 3,
    sunDirection: [0.25, 0.92, 0.3],
    hemiSky: '#E6F1FF',
    hemiGround: '#6E6250',
    hemiIntensity: 1.35,
  },
};

const SHADOW_MAP_SIZE = 1024;

/**
 * Sky colour, ambient fill and one shadow-casting sun. The sun's shadow box follows the
 * camera focus and snaps to whole shadow texels so shadows don't shimmer while moving.
 */
export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  private readonly direction: Vector3;
  private readonly target = new Object3D();
  private shadowHalfSize = 40;
  private readonly environment: DataTexture;

  constructor(scene: Scene, preset: LightingPreset) {
    const values = PRESETS[preset];
    scene.background = new Color(values.sky);
    this.environment = createEnvironment(values.hemiSky, values.sky, values.hemiGround);
    scene.environment = this.environment;
    scene.environmentIntensity = 0.55;
    this.hemi = new HemisphereLight(values.hemiSky, values.hemiGround, values.hemiIntensity);
    this.sun = new DirectionalLight(values.sun, values.sunIntensity);
    this.direction = new Vector3(...values.sunDirection).normalize();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    this.sun.target = this.target;
    this.setShadowSize(this.shadowHalfSize);
    scene.add(this.hemi, this.sun, this.target);
  }

  /** Half the width of the square area that receives shadows, in metres. */
  setShadowSize(halfSize: number): void {
    if (Math.abs(halfSize - this.shadowHalfSize) < 0.5 && this.sun.shadow.camera.right > 0) return;
    this.shadowHalfSize = halfSize;
    const cam = this.sun.shadow.camera;
    cam.left = -halfSize;
    cam.right = halfSize;
    cam.top = halfSize;
    cam.bottom = -halfSize;
    cam.updateProjectionMatrix();
  }

  dispose(): void {
    this.environment.dispose();
  }

  /** Centres the shadow box on a world position. */
  follow(focus: Vector3): void {
    const texel = (this.shadowHalfSize * 2) / SHADOW_MAP_SIZE;
    const x = Math.round(focus.x / texel) * texel;
    const z = Math.round(focus.z / texel) * texel;
    this.target.position.set(x, focus.y, z);
    this.sun.position.copy(this.target.position).addScaledVector(this.direction, 150);
    this.target.updateMatrixWorld();
  }
}

/** A tiny sky-to-ground gradient used as image-based lighting for reflective materials. */
function createEnvironment(zenith: string, horizon: string, ground: string): DataTexture {
  const width = 8;
  const height = 32;
  const data = new Uint8Array(width * height * 4);
  const top = new Color(zenith);
  const mid = new Color(horizon).lerp(new Color('#ffffff'), 0.35);
  const bottom = new Color(ground);
  const c = new Color();
  // Data rows start at the bottom of the equirectangular image (straight down).
  for (let y = 0; y < height; y++) {
    const t = 1 - y / (height - 1);
    if (t < 0.5) c.copy(top).lerp(mid, t / 0.5);
    else c.copy(mid).lerp(bottom, Math.min(1, (t - 0.5) / 0.15));
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = Math.round(c.r * 255);
      data[o + 1] = Math.round(c.g * 255);
      data[o + 2] = Math.round(c.b * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, width, height, RGBAFormat);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
