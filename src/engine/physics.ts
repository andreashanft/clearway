import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

let loaded: Promise<Rapier> | null = null;

/** Loads Rapier's WASM module once. The compat build inlines the WASM, so no extra fetch. */
export function loadRapier(): Promise<Rapier> {
  loaded ??= RAPIER.init().then(() => RAPIER);
  return loaded;
}

export interface PhysicsOptions {
  readonly gravity?: number;
}

/** Owns the Rapier world and its collision event queue. */
export class Physics {
  readonly rapier: Rapier;
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  /** Milliseconds the last `step()` took, for the debug overlay. */
  lastStepMs = 0;

  constructor(rapier: Rapier, options: PhysicsOptions = {}) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: options.gravity ?? -9.81, z: 0 });
    this.events = new rapier.EventQueue(true);
  }

  step(dt: number): void {
    const start = performance.now();
    this.world.timestep = dt;
    this.world.step(this.events);
    this.lastStepMs = performance.now() - start;
  }

  get bodyCount(): number {
    return this.world.bodies.len();
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}
