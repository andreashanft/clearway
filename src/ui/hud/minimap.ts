import type { Game } from '../../game/game';
import type { GroundLayer } from '../../game/level';

/** Colours of the mini-map, from the gameplay mocks. They are map colours, not interface tokens. */
const MAP = {
  ground: '#13254A',
  water: '#2A6BB0',
  road: '#2C3E6B',
  rail: '#3A4A70',
  outline: '#0B1430',
  alarm: '#FF3D5A',
  amber: '#FF9A2E',
  hazard: '#FFD23F',
};

/**
 * The mini-map: a schematic of the level with the obstacles, the Hauler and the player as dots.
 * It shows no route line. North is up.
 */
export class Minimap {
  readonly canvas = document.createElement('canvas');

  private readonly context: CanvasRenderingContext2D;
  private background: HTMLCanvasElement | undefined;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private width = 0;
  private height = 0;

  constructor() {
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('The browser cannot create a 2D canvas for the mini-map.');
    }
    this.context = context;
    this.canvas.className = 'hud__minimap-canvas';
  }

  /** Draws the mini-map. Call it once per frame. */
  draw(game: Game): void {
    this.fit(game);
    const { context } = this;
    if (!this.background || this.width === 0) {
      return;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(this.background, 0, 0);

    const dot = (x: number, z: number, radius: number, fill: string, outlined: boolean): void => {
      const px = x * this.scale + this.offsetX;
      const py = z * this.scale + this.offsetY;
      context.beginPath();
      context.arc(px, py, radius, 0, Math.PI * 2);
      if (outlined) {
        context.lineWidth = radius * 0.6;
        context.strokeStyle = MAP.outline;
        context.stroke();
      }
      context.fillStyle = fill;
      context.fill();
    };

    const unit = Math.max(2, this.height / 30);
    const next = game.nextObstacle?.obstacle;
    for (const obstacle of game.obstacles) {
      if (obstacle.cleared) {
        continue;
      }
      if (obstacle.gap) {
        dot(
          obstacle.gap.slot[0],
          obstacle.gap.slot[1],
          unit,
          obstacle === next ? MAP.amber : MAP.alarm,
          false,
        );
        continue;
      }
      const seen = new Set<unknown>();
      for (const segment of obstacle.segments) {
        if (segment.building.hp[segment.index] <= 0 || seen.has(segment.building)) {
          continue;
        }
        seen.add(segment.building);
        const [x, z] = segment.building.data.pos;
        dot(x, z, unit, obstacle === next ? MAP.amber : MAP.alarm, false);
      }
    }
    for (const vehicle of game.vehicles) {
      if (vehicle !== game.activeVehicle && vehicle.enabled && vehicle.spec.isVehicle) {
        dot(vehicle.position.x, vehicle.position.z, unit * 0.7, MAP.hazard, false);
      }
    }
    if (!game.hauler.destroyed) {
      dot(game.hauler.center.x, game.hauler.center.z, unit * 1.35, MAP.alarm, true);
    }
    const player = game.activeVehicle.position;
    dot(player.x, player.z, unit * 1.2, MAP.hazard, true);
  }

  /** Forgets the cached background, for example when a new level loads. */
  reset(): void {
    this.background = undefined;
    this.width = 0;
  }

  /** Matches the canvas to its CSS size and repaints the background when the size changes. */
  private fit(game: Game): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(this.canvas.clientWidth * ratio);
    const height = Math.round(this.canvas.clientHeight * ratio);
    if (width === 0 || height === 0 || (width === this.width && height === this.height)) {
      return;
    }
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    // Scale the play area so that it covers the whole canvas.
    const { min, max } = game.level.bounds;
    this.scale = Math.max(width / (max[0] - min[0]), height / (max[1] - min[1]));
    this.offsetX = width / 2 - ((min[0] + max[0]) / 2) * this.scale;
    this.offsetY = height / 2 - ((min[1] + max[1]) / 2) * this.scale;

    this.background = document.createElement('canvas');
    this.background.width = width;
    this.background.height = height;
    const context = this.background.getContext('2d');
    if (!context) {
      return;
    }
    context.fillStyle = MAP.ground;
    context.fillRect(0, 0, width, height);
    context.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const layer of game.level.ground) {
      if (layer.tag) {
        drawFeature(context, layer, MAP[layer.tag]);
      }
    }
  }
}

function drawFeature(context: CanvasRenderingContext2D, layer: GroundLayer, color: string): void {
  context.beginPath();
  if (layer.kind === 'ellipse') {
    context.ellipse(
      layer.center[0],
      layer.center[1],
      layer.radius[0],
      layer.radius[1],
      0,
      0,
      Math.PI * 2,
    );
    context.fillStyle = color;
    context.fill();
    return;
  }
  layer.points.forEach(([x, z], index) => {
    if (index === 0) {
      context.moveTo(x, z);
    } else {
      context.lineTo(x, z);
    }
  });
  if (layer.kind === 'polygon') {
    context.closePath();
    context.fillStyle = color;
    context.fill();
  } else {
    context.strokeStyle = color;
    // Thin features would vanish at the size of the mini-map.
    context.lineWidth = Math.max(layer.width, 9);
    context.stroke();
  }
}
