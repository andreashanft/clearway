import type { Collider } from '@dimforge/rapier3d-compat';

/**
 * Maps Rapier collider handles to the game objects they belong to, so collision events
 * can be routed. `T` is the union of things the game registers.
 */
export class ColliderRegistry<T> {
  private readonly owners = new Map<number, T>();

  add(collider: Collider, owner: T): void {
    this.owners.set(collider.handle, owner);
  }

  remove(collider: Collider): void {
    this.owners.delete(collider.handle);
  }

  get(handle: number): T | undefined {
    return this.owners.get(handle);
  }

  clear(): void {
    this.owners.clear();
  }
}
