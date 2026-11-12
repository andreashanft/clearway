/**
 * Draws the app icons into `public/`.
 *
 * The icon is a hazard-yellow plate with the lower-right corner cut at 45°, like the buttons of
 * the game, and a navy chevron that points along the Hauler's route.
 *
 * Run it with `npm run build:icons`.
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

type Rgb = [number, number, number];

const GROUND: Rgb = [0x0b, 0x14, 0x30];
const HAZARD: Rgb = [0xff, 0xd2, 0x3f];

/** Samples per pixel edge for anti-aliasing. */
const SUPERSAMPLE = 4;

/**
 * Returns the colour of the icon at a point.
 *
 * @param u Horizontal position from 0 to 1.
 * @param v Vertical position from 0 to 1.
 * @param inset Margin around the plate as a fraction of the icon. Maskable icons need a larger one.
 */
function colourAt(u: number, v: number, inset: number): Rgb {
  const x = (u - inset) / (1 - 2 * inset);
  const y = (v - inset) / (1 - 2 * inset);
  const insidePlate = x >= 0 && x <= 1 && y >= 0 && y <= 1 && x + y <= 1.72;
  if (!insidePlate) {
    return GROUND;
  }
  // Chevron: two bars that meet at a point on the right.
  const cx = x - 0.5;
  const cy = Math.abs(y - 0.46);
  const edge = cx + cy * 0.95;
  const insideChevron = edge <= 0.22 && edge >= -0.02 && cy <= 0.3;
  return insideChevron ? GROUND : HAZARD;
}

function drawIcon(size: number, inset: number): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const v = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          const colour = colourAt(u, v, inset);
          sum[0] += colour[0];
          sum[1] += colour[1];
          sum[2] += colour[2];
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (py * size + px) * 4;
      png.data[offset] = Math.round(sum[0] / samples);
      png.data[offset + 1] = Math.round(sum[1] / samples);
      png.data[offset + 2] = Math.round(sum[2] / samples);
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const icons = [
  { file: 'pwa-192x192.png', size: 192, inset: 0.14 },
  { file: 'pwa-512x512.png', size: 512, inset: 0.14 },
  { file: 'pwa-maskable-512x512.png', size: 512, inset: 0.22 },
  { file: 'apple-touch-icon-180x180.png', size: 180, inset: 0.14 },
];

for (const icon of icons) {
  writeFileSync(
    new URL(`../public/${icon.file}`, import.meta.url),
    drawIcon(icon.size, icon.inset),
  );
  console.log(`Wrote public/${icon.file}`);
}
