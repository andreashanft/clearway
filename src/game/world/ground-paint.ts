import * as THREE from 'three/webgpu';
import type { GroundLayer, GroundRows, TerrainData } from '../level';
import { DEG } from '../math';

/** Edge length of the ground texture in pixels: on phones, and on larger screens. */
const TEXTURE_SIZE_PHONE = 2048;
const TEXTURE_SIZE_LARGE = 4096;
/** Edge length of the repeating detail texture in pixels. */
const DETAIL_SIZE = 256;

/**
 * Paints the ground of a level into a texture: fields with crop rows, roads, yards and water.
 *
 * The level file describes the ground as vector shapes in metres. Painting them at load time
 * keeps the level files small and the edges crisp.
 */
export function paintGround(terrain: TerrainData, layers: readonly GroundLayer[]): THREE.Texture {
  const isPhone = Math.min(window.screen.width, window.screen.height) < 600;
  const textureSize = isPhone ? TEXTURE_SIZE_PHONE : TEXTURE_SIZE_LARGE;
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('The browser cannot create a 2D canvas for the ground texture.');
  }

  context.fillStyle = terrain.baseColor;
  context.fillRect(0, 0, textureSize, textureSize);
  speckle(context, terrain.baseColor, textureSize);

  // From here on, the canvas uses metres in level coordinates.
  const scale = textureSize / terrain.size;
  context.setTransform(
    scale,
    0,
    0,
    scale,
    -(terrain.center[0] - terrain.size / 2) * scale,
    -(terrain.center[1] - terrain.size / 2) * scale,
  );
  context.lineJoin = 'round';
  context.lineCap = 'round';

  for (const layer of layers) {
    drawLayer(context, layer, terrain);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function drawLayer(
  context: CanvasRenderingContext2D,
  layer: GroundLayer,
  terrain: TerrainData,
): void {
  switch (layer.kind) {
    case 'polygon': {
      context.beginPath();
      layer.points.forEach(([x, z], index) => {
        if (index === 0) {
          context.moveTo(x, z);
        } else {
          context.lineTo(x, z);
        }
      });
      context.closePath();
      context.fillStyle = layer.color;
      context.fill();
      if (layer.rows) {
        context.save();
        context.clip();
        drawRows(context, layer.rows, terrain);
        context.restore();
      }
      break;
    }
    case 'path': {
      context.beginPath();
      layer.points.forEach(([x, z], index) => {
        if (index === 0) {
          context.moveTo(x, z);
        } else {
          context.lineTo(x, z);
        }
      });
      context.strokeStyle = layer.color;
      context.lineWidth = layer.width;
      context.setLineDash(layer.dash ?? []);
      context.lineCap = layer.dash ? 'butt' : 'round';
      context.stroke();
      context.setLineDash([]);
      context.lineCap = 'round';
      break;
    }
    case 'ellipse': {
      context.beginPath();
      context.ellipse(
        layer.center[0],
        layer.center[1],
        layer.radius[0],
        layer.radius[1],
        0,
        0,
        Math.PI * 2,
      );
      context.fillStyle = layer.color;
      context.fill();
      break;
    }
  }
}

/** Draws parallel stripes across the whole terrain. The caller clips them to a polygon. */
function drawRows(context: CanvasRenderingContext2D, rows: GroundRows, terrain: TerrainData): void {
  const reach = terrain.size * 1.5;
  context.save();
  context.translate(terrain.center[0], terrain.center[1]);
  context.rotate(rows.angle * DEG);
  context.strokeStyle = rows.color;
  context.lineWidth = rows.width;
  context.lineCap = 'butt';
  context.beginPath();
  for (let offset = -reach; offset <= reach; offset += rows.spacing) {
    context.moveTo(-reach, offset);
    context.lineTo(reach, offset);
  }
  context.stroke();
  context.restore();
}

/** Scatters faint light and dark dots, so that large plain areas do not look flat. */
function speckle(context: CanvasRenderingContext2D, baseColor: string, textureSize: number): void {
  const base = new THREE.Color(baseColor);
  const light = `#${base.clone().offsetHSL(0, 0, 0.022).getHexString()}`;
  const dark = `#${base.clone().offsetHSL(0, 0, -0.02).getHexString()}`;
  // A fixed pattern, so that the texture is the same on every load.
  let seed = 12345;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 9000; i += 1) {
    context.fillStyle = i % 2 === 0 ? light : dark;
    const size = (2 + random() * 7) * (textureSize / 2048);
    context.beginPath();
    context.ellipse(
      random() * textureSize,
      random() * textureSize,
      size,
      size * 0.6,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

/**
 * Creates a small grey texture of fine strokes and dots. The terrain repeats it every few metres
 * and multiplies it with the painted ground, so that the ground stays crisp close to the camera.
 * Mid-grey leaves the ground colour unchanged.
 */
export function createGroundDetail(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = DETAIL_SIZE;
  canvas.height = DETAIL_SIZE;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('The browser cannot create a 2D canvas for the ground detail.');
  }
  context.fillStyle = 'rgb(128, 128, 128)';
  context.fillRect(0, 0, DETAIL_SIZE, DETAIL_SIZE);

  let seed = 2024;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 900; i += 1) {
    const light = random() > 0.5;
    const shade = light ? 128 + 10 + random() * 16 : 128 - 10 - random() * 18;
    context.strokeStyle = `rgb(${shade}, ${shade}, ${shade})`;
    context.lineWidth = 1 + random() * 1.5;
    const x = random() * DETAIL_SIZE;
    const y = random() * DETAIL_SIZE;
    const angle = random() * Math.PI;
    const length = 2 + random() * 7;
    // Draw each stroke nine times, shifted by the texture size, so that the texture tiles.
    for (const ox of [-DETAIL_SIZE, 0, DETAIL_SIZE]) {
      for (const oy of [-DETAIL_SIZE, 0, DETAIL_SIZE]) {
        context.beginPath();
        context.moveTo(x + ox, y + oy);
        context.lineTo(x + ox + Math.cos(angle) * length, y + oy + Math.sin(angle) * length);
        context.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}
