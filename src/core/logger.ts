/**
 * Structured Logger
 *
 * Pino-based logger with child loggers per module.
 * JSON in production, pretty in development.
 *
 * Also exports broadcastLog() for emitting log entries to the
 * event bus so connected clients receive real-time server logs.
 */

import pino from 'pino';
import { bus } from './bus.js';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  base: { service: 'overlord-v2' },
});

// ── Rate limiter for log broadcasting ──
const LOG_WINDOW_MS = 1000;
const MAX_LOGS_PER_WINDOW = 20;
let _windowStart = Date.now();
let _windowCount = 0;

/**
 * Broadcast a log entry to connected clients via the event bus.
 * Rate-limited to MAX_LOGS_PER_WINDOW per second to prevent flooding.
 */
export function broadcastLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  module?: string,
): void {
  const now = Date.now();
  if (now - _windowStart > LOG_WINDOW_MS) {
    _windowStart = now;
    _windowCount = 0;
  }
  if (_windowCount >= MAX_LOGS_PER_WINDOW) return;
  _windowCount++;

  bus.emit('system:log', {
    level,
    message,
    source: 'server',
    module: module || '',
    timestamp: now,
  });
}
