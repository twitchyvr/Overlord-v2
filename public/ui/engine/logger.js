/**
 * Overlord v2 — Client-side Logger
 *
 * Lightweight structured logger for browser environment.
 * Respects configurable log level (default: warn).
 * Each log call includes a prefix tag and timestamp.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

let _level = LEVELS.info;

/**
 * Set the minimum log level.
 * @param {'debug'|'info'|'warn'|'error'|'silent'} level
 */
export function setLogLevel(level) {
  if (level in LEVELS) {
    _level = LEVELS[level];
  }
}

/** Get the current log level name. */
export function getLogLevel() {
  return Object.keys(LEVELS).find(k => LEVELS[k] === _level) || 'warn';
}

/**
 * Create a tagged logger instance.
 * @param {string} tag — prefix for all messages (e.g. 'SocketBridge', 'Engine')
 * @returns {{ debug, info, warn, error }}
 */
export function createLogger(tag) {
  const prefix = `[${tag}]`;

  return {
    debug(...args) {
      if (_level <= LEVELS.debug) console.debug(prefix, ...args);
    },
    info(...args) {
      if (_level <= LEVELS.info) console.info(prefix, ...args);
    },
    warn(...args) {
      if (_level <= LEVELS.warn) console.warn(prefix, ...args);
    },
    error(...args) {
      if (_level <= LEVELS.error) console.error(prefix, ...args);
    },
  };
}
