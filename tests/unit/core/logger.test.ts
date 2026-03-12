import { describe, it, expect, vi, beforeEach } from 'vitest';
import { broadcastLog } from '../../../src/core/logger.js';
import { bus } from '../../../src/core/bus.js';

describe('broadcastLog', () => {
  beforeEach(() => {
    bus.removeAllListeners();
  });

  it('emits system:log on the bus with correct envelope', () => {
    const handler = vi.fn();
    bus.on('system:log', handler);

    broadcastLog('info', 'Test message', 'transport');

    expect(handler).toHaveBeenCalledTimes(1);
    const data = handler.mock.calls[0][0];
    expect(data.level).toBe('info');
    expect(data.message).toBe('Test message');
    expect(data.source).toBe('server');
    expect(data.module).toBe('transport');
    expect(data.timestamp).toBeTypeOf('number');
  });

  it('supports all log levels', () => {
    const handler = vi.fn();
    bus.on('system:log', handler);

    broadcastLog('warn', 'Warning msg');
    broadcastLog('error', 'Error msg');
    broadcastLog('debug', 'Debug msg');

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0][0].level).toBe('warn');
    expect(handler.mock.calls[1][0].level).toBe('error');
    expect(handler.mock.calls[2][0].level).toBe('debug');
  });

  it('defaults module to empty string when not provided', () => {
    const handler = vi.fn();
    bus.on('system:log', handler);

    broadcastLog('info', 'No module');

    expect(handler.mock.calls[0][0].module).toBe('');
  });

  it('rate-limits to MAX_LOGS_PER_WINDOW per second', () => {
    const handler = vi.fn();
    bus.on('system:log', handler);

    // Fire 30 logs in quick succession — only 20 should get through
    for (let i = 0; i < 30; i++) {
      broadcastLog('info', `Log ${i}`, 'test');
    }

    expect(handler.mock.calls.length).toBeLessThanOrEqual(20);
  });
});
