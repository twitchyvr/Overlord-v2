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

  it('should include event name in envelope', () => {
    const handler = vi.fn();
    bus.on('envelope:check', handler);

    bus.emit('envelope:check');

    expect(handler).toHaveBeenCalledOnce();
    const payload = handler.mock.calls[0][0];
    expect(payload.event).toBe('envelope:check');
    expect(payload.timestamp).toBeGreaterThan(0);

    bus.off('envelope:check', handler);
  });

  it('should allow removing listeners with off()', () => {
    const handler = vi.fn();
    bus.on('remove:test', handler);

    bus.emit('remove:test');
    expect(handler).toHaveBeenCalledOnce();

    bus.off('remove:test', handler);
    bus.emit('remove:test');
    expect(handler).toHaveBeenCalledOnce(); // Still 1, not 2
  });

  describe('onNamespace', () => {
    // NOTE: onNamespace subscribes to the literal '*' event.
    // EventEmitter3 does NOT have built-in wildcard support,
    // so onNamespace only fires when '*' is explicitly emitted.
    // This is a known bug — regular emit('room:create') does NOT
    // trigger onNamespace('room:') handlers.

    it('onNamespace subscribes to the wildcard event', () => {
      const handler = vi.fn();
      bus.onNamespace('ns-test-room:', handler);

      // Emitting the '*' event with matching prefix triggers handler
      bus.emit('*', { event: 'ns-test-room:create', roomId: 'r1' });

      expect(handler).toHaveBeenCalledOnce();

      bus.off('*', handler);
    });

    it('onNamespace filters by prefix on wildcard events', () => {
      const handler = vi.fn();
      bus.onNamespace('ns-test-filter:', handler);

      // Non-matching prefix should NOT trigger
      bus.emit('*', { event: 'agent:update', agentId: 'a1' });

      expect(handler).not.toHaveBeenCalled();

      bus.off('*', handler);
    });

    it('onNamespace does NOT fire on regular named events (known limitation)', () => {
      const handler = vi.fn();
      bus.onNamespace('ns-test-known:', handler);

      // Regular emit does NOT trigger onNamespace — this is the known bug
      bus.emit('ns-test-known:create', { roomId: 'r1' });

      // Handler should NOT have been called because EE3 has no wildcard routing
      expect(handler).not.toHaveBeenCalled();

      bus.off('*', handler);
    });
  });
});
