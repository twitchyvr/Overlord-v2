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
    it('fires handler when event matches prefix', () => {
      const handler = vi.fn();
      bus.onNamespace('ns-room:', handler);

      bus.emit('ns-room:create', { roomId: 'r1' });

      expect(handler).toHaveBeenCalledOnce();
      const payload = handler.mock.calls[0][0];
      expect(payload.event).toBe('ns-room:create');
      expect(payload.roomId).toBe('r1');

      bus.offNamespace('ns-room:', handler);
    });

    it('does not fire for non-matching prefix', () => {
      const handler = vi.fn();
      bus.onNamespace('ns-agent:', handler);

      bus.emit('ns-room:create', { roomId: 'r1' });

      expect(handler).not.toHaveBeenCalled();

      bus.offNamespace('ns-agent:', handler);
    });

    it('fires for multiple events in same namespace', () => {
      const handler = vi.fn();
      bus.onNamespace('ns-multi:', handler);

      bus.emit('ns-multi:create', { id: '1' });
      bus.emit('ns-multi:update', { id: '2' });
      bus.emit('ns-multi:delete', { id: '3' });

      expect(handler).toHaveBeenCalledTimes(3);

      bus.offNamespace('ns-multi:', handler);
    });

    it('offNamespace removes the handler', () => {
      const handler = vi.fn();
      bus.onNamespace('ns-off:', handler);

      bus.emit('ns-off:test');
      expect(handler).toHaveBeenCalledOnce();

      bus.offNamespace('ns-off:', handler);

      bus.emit('ns-off:test');
      expect(handler).toHaveBeenCalledOnce(); // Still 1, not 2
    });

    it('supports multiple namespace handlers', () => {
      const roomHandler = vi.fn();
      const agentHandler = vi.fn();
      bus.onNamespace('ns-h-room:', roomHandler);
      bus.onNamespace('ns-h-agent:', agentHandler);

      bus.emit('ns-h-room:enter', {});
      expect(roomHandler).toHaveBeenCalledOnce();
      expect(agentHandler).not.toHaveBeenCalled();

      bus.emit('ns-h-agent:registered', {});
      expect(roomHandler).toHaveBeenCalledOnce();
      expect(agentHandler).toHaveBeenCalledOnce();

      bus.offNamespace('ns-h-room:', roomHandler);
      bus.offNamespace('ns-h-agent:', agentHandler);
    });
  });
});
