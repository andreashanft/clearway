import { NeutralToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import type { Camera, Object3D } from 'three';
import { WebGPURenderer } from 'three/webgpu';

export type RenderBackend = 'webgpu' | 'webgl2';

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** Skips WebGPU and uses the WebGL2 backend. */
  readonly forceWebGL: boolean;
  /** Highest device pixel ratio to render at; the brief caps it at 2. */
  readonly maxPixelRatio?: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

type ResizeListener = (viewport: Viewport) => void;

/**
 * Wraps Three.js's WebGPURenderer, which falls back to WebGL2 by itself when WebGPU is
 * missing. Owns canvas sizing, the pixel-ratio cap and the dynamic resolution scale.
 */
export class Renderer {
  readonly three: WebGPURenderer;
  readonly backend: RenderBackend;
  private readonly maxPixelRatio: number;
  private readonly listeners = new Set<ResizeListener>();
  private readonly observer: ResizeObserver;
  private scale = 1;
  private current: Viewport = { width: 1, height: 1 };

  private constructor(three: WebGPURenderer, options: RendererOptions) {
    this.three = three;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.backend = isWebGPUBackend(three) ? 'webgpu' : 'webgl2';

    const container = options.canvas.parentElement ?? document.body;
    this.observer = new ResizeObserver(() => {
      this.resize(container.clientWidth, container.clientHeight);
    });
    this.observer.observe(container);
    this.resize(container.clientWidth, container.clientHeight);
  }

  static async create(options: RendererOptions): Promise<Renderer> {
    const three = new WebGPURenderer({
      canvas: options.canvas,
      antialias: true,
      forceWebGL: options.forceWebGL,
      powerPreference: 'high-performance',
    });
    three.outputColorSpace = SRGBColorSpace;
    three.toneMapping = NeutralToneMapping;
    three.toneMappingExposure = 1;
    three.shadowMap.enabled = true;
    three.shadowMap.type = PCFShadowMap;
    await three.init();
    return new Renderer(three, options);
  }

  get viewport(): Viewport {
    return this.current;
  }

  /** Fraction of the capped pixel ratio actually rendered (dynamic resolution). */
  get renderScale(): number {
    return this.scale;
  }

  set renderScale(value: number) {
    this.scale = Math.min(1, Math.max(0.4, value));
    this.applyPixelRatio();
  }

  get pixelRatio(): number {
    return this.three.getPixelRatio();
  }

  onResize(listener: ResizeListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  render(scene: Object3D, camera: Camera): void {
    this.three.render(scene, camera);
  }

  /** Draw calls and triangles of the last rendered frame. */
  get frameStats(): { drawCalls: number; triangles: number } {
    const { drawCalls, triangles } = this.three.info.render;
    return { drawCalls, triangles };
  }

  dispose(): void {
    this.observer.disconnect();
    this.listeners.clear();
    void this.three.dispose();
  }

  private resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.current.width && h === this.current.height) return;
    this.current = { width: w, height: h };
    this.applyPixelRatio();
    this.three.setSize(w, h, false);
    for (const listener of this.listeners) listener(this.current);
  }

  private applyPixelRatio(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) * this.scale;
    this.three.setPixelRatio(ratio);
  }
}

function isWebGPUBackend(renderer: WebGPURenderer): boolean {
  const backend = renderer.backend as { isWebGPUBackend?: boolean };
  return backend.isWebGPUBackend === true;
}
