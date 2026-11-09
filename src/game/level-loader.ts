import { CanvasTexture, type Scene } from 'three';
import type { Physics } from '../engine/physics';
import { type LevelDefinition, levelAssetUrl } from './level-data';
import { Heightfield } from './world/heightfield';
import { Lighting } from './world/lighting';
import { Props, type PropsFile } from './world/props';
import { Terrain } from './world/terrain';

/** The static world of a level, built and added to the scene and physics world. */
export interface LoadedWorld {
  readonly field: Heightfield;
  readonly terrain: Terrain;
  readonly props: Props;
  readonly lighting: Lighting;
  dispose(): void;
}

async function loadImage(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return (await response.json()) as T;
}

function toCanvas(image: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(image, 0, 0);
  return canvas;
}

/** Reads the red channel of a grayscale heightmap image. */
function readGrayscale(image: ImageBitmap): Uint8Array {
  const canvas = toCanvas(image);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
  const out = new Uint8Array(image.width * image.height);
  for (let k = 0; k < out.length; k++) out[k] = rgba[k * 4] ?? 0;
  return out;
}

export async function loadWorld(
  def: LevelDefinition,
  scene: Scene,
  physics: Physics,
): Promise<LoadedWorld> {
  const [heightImage, colourImage, propsFile] = await Promise.all([
    loadImage(levelAssetUrl(def.terrain.heightmap)),
    loadImage(levelAssetUrl(def.terrain.colourmap)),
    loadJson<PropsFile>(levelAssetUrl(def.terrain.props)),
  ]);
  if (heightImage.width !== heightImage.height) throw new Error('Heightmap must be square');

  const field = Heightfield.fromGrayscale(
    readGrayscale(heightImage),
    heightImage.width,
    def.terrain.metersPerPixel,
    def.terrain.maxHeight,
  );
  heightImage.close();

  const colourTexture = new CanvasTexture(toCanvas(colourImage));
  colourImage.close();

  const terrain = new Terrain(field, colourTexture);
  terrain.addColliders(physics);
  const props = new Props(propsFile, field);
  const lighting = new Lighting(scene, def.lighting);
  scene.add(terrain.group, props.group);

  return {
    field,
    terrain,
    props,
    lighting,
    dispose() {
      scene.remove(terrain.group, props.group);
      terrain.dispose();
      props.dispose();
      lighting.dispose();
    },
  };
}
