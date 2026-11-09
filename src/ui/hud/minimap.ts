import type { GameEvents } from '../../game/events';

type Setup = GameEvents['map:setup'];
type Frame = GameEvents['hud:frame'];

const ALARM = '#FF3D5A';
const HAZARD = '#FFD23F';
const TNT = '#FF7A2E';

/**
 * The mini-map: a north-up 2D drawing of the play area with the route, obstacles,
 * crates, vehicles, the player and the Hauler. Redrawn whenever a HUD frame arrives
 * (about ten times a second).
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private setup: Setup | null = null;
  private blink = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cw-minimap__canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
  }

  configure(setup: Setup): void {
    this.setup = setup;
  }

  draw(frame: Frame): void {
    const { ctx, setup } = this;
    if (!ctx || !setup) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const hgt = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w;
      this.canvas.height = hgt;
    }
    const { minX, maxX, minZ, maxZ } = setup.bounds;
    // Fit the bounds into the canvas, keeping the aspect ratio.
    const scale = Math.min(w / (maxX - minX), hgt / (maxZ - minZ));
    const ox = (w - (maxX - minX) * scale) / 2;
    const oz = (hgt - (maxZ - minZ) * scale) / 2;
    const px = (x: number): number => ox + (x - minX) * scale;
    const pz = (z: number): number => oz + (z - minZ) * scale;

    ctx.fillStyle = '#13254A';
    ctx.fillRect(0, 0, w, hgt);
    if (setup.background) {
      const half = setup.extent / 2;
      const image = setup.background as HTMLCanvasElement;
      const iw = image.width;
      const ih = image.height;
      const sx = ((minX + half) / setup.extent) * iw;
      const sz = ((minZ + half) / setup.extent) * ih;
      const sw = ((maxX - minX) / setup.extent) * iw;
      const sh = ((maxZ - minZ) / setup.extent) * ih;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(image, sx, sz, sw, sh, ox, oz, (maxX - minX) * scale, (maxZ - minZ) * scale);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(11, 20, 48, 0.35)';
      ctx.fillRect(0, 0, w, hgt);
    }

    ctx.strokeStyle = ALARM;
    ctx.lineWidth = 2 * ratio;
    ctx.setLineDash([4 * ratio, 3 * ratio]);
    ctx.beginPath();
    setup.route.forEach(([x, z], i) => {
      if (i === 0) ctx.moveTo(px(x), pz(z));
      else ctx.lineTo(px(x), pz(z));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    for (const o of frame.obstacles) {
      if (o.cleared) continue;
      dot(ctx, px(o.x), pz(o.z), 3 * ratio, ALARM);
    }
    this.blink = !this.blink;
    for (const c of frame.crates) {
      if (c.lit && this.blink) continue;
      ctx.fillStyle = TNT;
      const s = 3 * ratio;
      ctx.fillRect(px(c.x) - s, pz(c.z) - s, s * 2, s * 2);
    }
    for (const v of frame.vehicles) dot(ctx, px(v.x), pz(v.z), 3 * ratio, HAZARD, '#0B1430');
    if (frame.hauler)
      dot(ctx, px(frame.hauler.x), pz(frame.hauler.z), 4.5 * ratio, ALARM, '#0B1430');
    if (frame.player) {
      const { x, z, heading } = frame.player;
      ctx.save();
      ctx.translate(px(x), pz(z));
      // Heading 0 faces +z (down the map); rotate the arrow to match.
      ctx.rotate(-heading);
      ctx.fillStyle = HAZARD;
      ctx.strokeStyle = '#0B1430';
      ctx.lineWidth = 1.5 * ratio;
      ctx.beginPath();
      ctx.moveTo(0, 6 * ratio);
      ctx.lineTo(4.5 * ratio, -4 * ratio);
      ctx.lineTo(-4.5 * ratio, -4 * ratio);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = r * 0.4;
    ctx.stroke();
  }
}
