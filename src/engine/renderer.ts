import * as THREE from 'three/webgpu';

/** The highest device pixel ratio the canvas renders at. Higher ratios cost fill rate on phones. */
const MAX_PIXEL_RATIO = 2;

export interface RendererOptions {
  /** Forces the WebGL2 backend. The `?webgl` URL parameter sets it for testing. */
  forceWebGL: boolean;
}

/** Owns the Three.js renderer and keeps the canvas at the size of its element. */
export class RenderContext {
  readonly renderer: THREE.WebGPURenderer;

  /** Name of the active graphics backend, for the debug overlay. */
  readonly backend: 'WebGPU' | 'WebGL2';

  /** Scales the render resolution. The dynamic resolution lowers it when frames run long. */
  private renderScale = 1;

  private readonly canvas: HTMLCanvasElement;
  private readonly resizeListeners = new Set<(width: number, height: number) => void>();
  private width = 1;
  private height = 1;

  private constructor(renderer: THREE.WebGPURenderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.canvas = canvas;
    const backend = renderer.backend as { isWebGPUBackend?: boolean };
    this.backend = backend.isWebGPUBackend === true ? 'WebGPU' : 'WebGL2';

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /**
   * Creates the renderer. Three.js selects WebGPU when the browser supports it and falls back to
   * WebGL2 otherwise.
   */
  static async create(canvas: HTMLCanvasElement, options: RendererOptions): Promise<RenderContext> {
    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      forceWebGL: options.forceWebGL,
      powerPreference: 'high-performance',
    });
    await renderer.init();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    return new RenderContext(renderer, canvas);
  }

  /** Canvas size in CSS pixels. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Width divided by height of the canvas. */
  get aspect(): number {
    return this.width / this.height;
  }

  /** The current render scale from 0.5 to 1. */
  get scale(): number {
    return this.renderScale;
  }

  /** Sets the render scale and resizes the drawing buffer. */
  setScale(scale: number): void {
    const clamped = Math.min(1, Math.max(0.5, scale));
    if (clamped !== this.renderScale) {
      this.renderScale = clamped;
      this.applySize();
    }
  }

  /** Registers a listener that runs now and whenever the canvas changes size. */
  onResize(listener: (width: number, height: number) => void): () => void {
    this.resizeListeners.add(listener);
    listener(this.width, this.height);
    return () => this.resizeListeners.delete(listener);
  }

  private resize(): void {
    const width = Math.max(1, Math.floor(this.canvas.clientWidth));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight));
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.applySize();
    for (const listener of this.resizeListeners) {
      listener(width, height);
    }
  }

  private applySize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * this.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
  }
}
