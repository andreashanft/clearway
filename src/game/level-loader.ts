import { CanvasTexture, type Scene } from 'three';
import type { Physics } from '../engine/physics';
import { timed } from '../engine/profile';
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

/** The downloaded and decoded files of a level. Nothing in here belongs to one attempt. */
interface WorldAssets {
  /** Heightmap samples, row by row. */
  readonly heights: Uint8Array;
  /** Samples along one side of the square heightmap. */
  readonly size: number;
  readonly colour: HTMLCanvasElement;
  readonly props: PropsFile;
}

/** How many levels keep their decoded files, the title's backdrop among them. */
const CACHED_LEVELS = 3;

const assetCache = new Map<string, Promise<WorldAssets>>();

async function fetchAssets(def: LevelDefinition): Promise<WorldAssets> {
  const [heightImage, colourImage, props] = await Promise.all([
    loadImage(levelAssetUrl(def.terrain.heightmap)),
    loadImage(levelAssetUrl(def.terrain.colourmap)),
    loadJson<PropsFile>(levelAssetUrl(def.terrain.props)),
  ]);
  if (heightImage.width !== heightImage.height) throw new Error('Heightmap must be square');
  const assets = {
    heights: readGrayscale(heightImage),
    size: heightImage.width,
    colour: toCanvas(colourImage),
    props,
  };
  heightImage.close();
  colourImage.close();
  return assets;
}

/**
 * Downloads and decodes a level's files, or returns them from memory. A retry reuses
 * them, and the level select calls this ahead of time so that START has less to wait for.
 */
export function preloadWorld(def: LevelDefinition): Promise<WorldAssets> {
  let assets = assetCache.get(def.id);
  // Move the level to the end of the map: the first entry is the least recently used.
  assetCache.delete(def.id);
  if (!assets) {
    assets = fetchAssets(def);
    // A failed download must not stick: the next attempt tries again.
    assets.catch(() => {
      if (assetCache.get(def.id) === assets) assetCache.delete(def.id);
    });
  }
  assetCache.set(def.id, assets);
  while (assetCache.size > CACHED_LEVELS) {
    const oldest = assetCache.keys().next();
    if (oldest.done) break;
    assetCache.delete(oldest.value);
  }
  return assets;
}

export async function loadWorld(
  def: LevelDefinition,
  scene: Scene,
  physics: Physics,
): Promise<LoadedWorld> {
  const assets = await preloadWorld(def);

  const field = timed('level: heightfield', () =>
    Heightfield.fromGrayscale(
      assets.heights,
      assets.size,
      def.terrain.metersPerPixel,
      def.terrain.maxHeight,
    ),
  );
  const colourTexture = new CanvasTexture(assets.colour);
  const propsFile = assets.props;

  const terrain = timed('level: terrain mesh', () => new Terrain(field, colourTexture));
  timed('level: terrain collider', () => {
    terrain.addColliders(physics);
  });
  const props = timed('level: props', () => new Props(propsFile, field));
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
