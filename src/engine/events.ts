/**
 * A small typed publish/subscribe bus. The game layer emits events up to the UI and the
 * UI sends commands down, so neither imports the other.
 */
export type EventMap = object;

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends EventMap> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Subscribes to an event and returns a function that unsubscribes. */
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  /** Subscribes for a single delivery. */
  once<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Delivers an event to every current subscriber, in subscription order. */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    // Copy first so handlers can unsubscribe while the event is being delivered.
    for (const handler of [...set]) (handler as Handler<Events[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
