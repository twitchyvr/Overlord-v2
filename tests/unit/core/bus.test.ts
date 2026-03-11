import { describe, it, expect, vi } from 'vitest';
import { bus } from '../../../src/core/bus.js';

describe('Bus', () => {
  it('should emit events with structured envelope', () => {
    const handler = vi.fn();
    bus.on('test:event', handler);

    bus.emit('test:event', { foo: 'bar' });

    expect(handler).toHaveBeenCalledOnce();
    const payload = handler.mock.calls[0][0];
    expect(payload.event).toBe('test:event');
    expect(payload.foo).toBe('bar');
    expect(payload.timestamp).toBeDefined();
    expect(typeof payload.timestamp).toBe('number');

    bus.off('test:event', handler);
  });

  it('should support multiple listeners', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('multi:test', handler1);
    bus.on('multi:test', handler2);

    bus.emit('multi:test', { data: 1 });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();

    bus.off('multi:test', handler1);
    bus.off('multi:test', handler2);
  });
});
