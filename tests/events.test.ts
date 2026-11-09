import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/engine/events';

interface TestEvents {
  hit: { damage: number };
  clear: undefined;
}

describe('EventBus', () => {
  it('delivers payloads to subscribers in order', () => {
    const bus = new EventBus<TestEvents>();
    const calls: string[] = [];
    bus.on('hit', ({ damage }) => calls.push(`a${damage}`));
    bus.on('hit', ({ damage }) => calls.push(`b${damage}`));
    bus.emit('hit', { damage: 5 });
    expect(calls).toEqual(['a5', 'b5']);
  });

  it('unsubscribes through the returned function', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const off = bus.on('clear', handler);
    off();
    bus.emit('clear', undefined);
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers a once handler a single time', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once('hit', handler);
    bus.emit('hit', { damage: 1 });
    bus.emit('hit', { damage: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ damage: 1 });
  });

  it('lets a handler unsubscribe another during delivery without skipping it', () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();
    let offSecond = (): void => undefined;
    bus.on('clear', () => offSecond());
    offSecond = bus.on('clear', second);
    bus.emit('clear', undefined);
    expect(second).toHaveBeenCalledTimes(1);
    bus.emit('clear', undefined);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
