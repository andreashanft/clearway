/**
 * A small typed publish and subscribe bus.
 *
 * `Events` maps each event name to its payload type. The game layer emits events and the user
 * interface, the audio and the effects listen. The game never calls them directly.
 */
export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  /** Subscribes to an event. Returns a function that removes the subscription. */
  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Calls every listener of an event. */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      (listener as (payload: Events[K]) => void)(payload);
    }
  }

  /** Removes every subscription. */
  clear(): void {
    this.listeners.clear();
  }
}
