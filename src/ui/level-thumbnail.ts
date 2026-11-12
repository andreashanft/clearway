import type { LevelData } from '../game/level';
import { boxCorners } from '../game/math';
import { drawLayer } from '../game/world/ground-paint';
import { segmentLayout } from '../game/world/segments';

/**
 * Draws a top-down picture of a level for its campaign card: the painted ground, the buildings
 * and the trees. It shows no route line.
 */
export function renderLevelThumbnail(
  level: LevelData,
  width: number,
  height: number,
): HTMLCanvasElement {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }
  context.fillStyle = level.terrain.baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Show the middle of the play area, a little zoomed in, so that the buildings read.
  const { min, max } = level.bounds;
  const scale =
    Math.max(canvas.width / (max[0] - min[0]), canvas.height / (max[1] - min[1])) * 1.35;
  context.setTransform(
    scale,
    0,
    0,
    scale,
    canvas.width / 2 - ((min[0] + max[0]) / 2) * scale,
    canvas.height / 2 - ((min[1] + max[1]) / 2) * scale,
  );
  context.lineJoin = 'round';
  context.lineCap = 'round';
  for (const layer of level.ground) {
    drawLayer(context, layer, level.terrain);
  }

  context.fillStyle = '#4F7F3E';
  for (const [x, z, radius] of level.scenery.trees) {
    context.beginPath();
    context.arc(x, z, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.lineWidth = 1;
  context.strokeStyle = '#2B2F36';
  for (const building of level.buildings) {
    const layout = segmentLayout(building);
    context.fillStyle = building.colors.roof;
    context.beginPath();
    if (layout.round) {
      context.arc(
        building.pos[0],
        building.pos[1],
        Math.min(building.size[0], building.size[2]) / 2,
        0,
        Math.PI * 2,
      );
    } else {
      const corners = boxCorners({
        center: building.pos,
        half: [(layout.length * layout.count) / 2, layout.depth / 2],
        heading: layout.heading,
      });
      corners.forEach(([x, z], index) => {
        if (index === 0) {
          context.moveTo(x, z);
        } else {
          context.lineTo(x, z);
        }
      });
      context.closePath();
    }
    context.fill();
    context.stroke();
  }
  return canvas;
}
