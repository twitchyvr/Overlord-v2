// @vitest-environment jsdom
/**
 * Tests for public/ui/engine/logger.js
 *
 * Covers: createLogger, setLogLevel, getLogLevel, log level filtering,
 *         tagged prefix output, and all log methods (debug/info/warn/error).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerPath = '../../../public/ui/engine/logger.js';

let createLogger: any;
let setLogLevel: any;
let getLogLevel: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import(loggerPath);
  createLogger = mod.createLogger;
  setLogLevel = mod.setLogLevel;
  getLogLevel = mod.getLogLevel;
});

// ─── createLogger ──────────────────────────────────────────────

describe('createLogger', () => {
  it('returns an object with debug, info, warn, error methods', () => {
    const log = createLogger('Test');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('prepends tag prefix to messages', () => {
    setLogLevel('debug');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('MyModule');

    log.debug('test message');

    expect(spy).toHaveBeenCalledWith('[MyModule]', 'test message');
    spy.mockRestore();
  });

  it('passes multiple arguments after prefix', () => {
    setLogLevel('debug');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('Tag');

    log.debug('msg', 42, { key: 'val' });

    expect(spy).toHaveBeenCalledWith('[Tag]', 'msg', 42, { key: 'val' });
    spy.mockRestore();
  });
});

// ─── Log level filtering ─────────────────────────────────────────

describe('log level filtering', () => {
  it('default level is info', () => {
    expect(getLogLevel()).toBe('info');
  });

  it('debug messages are suppressed at info level', () => {
    setLogLevel('info');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('Test');

    log.debug('hidden');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('info messages are shown at info level', () => {
    setLogLevel('info');
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('Test');

    log.info('visible');

    expect(spy).toHaveBeenCalledWith('[Test]', 'visible');
    spy.mockRestore();
  });

  it('warn messages are shown at info level', () => {
    setLogLevel('info');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = createLogger('Test');

    log.warn('warning');

    expect(spy).toHaveBeenCalledWith('[Test]', 'warning');
    spy.mockRestore();
  });

  it('error messages are shown at info level', () => {
    setLogLevel('info');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('Test');

    log.error('error');

    expect(spy).toHaveBeenCalledWith('[Test]', 'error');
    spy.mockRestore();
  });

  it('all messages are shown at debug level', () => {
    setLogLevel('debug');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = createLogger('All');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(debugSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('only error messages are shown at error level', () => {
    setLogLevel('error');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = createLogger('Strict');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('silent level suppresses all messages', () => {
    setLogLevel('silent');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = createLogger('Silent');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('warn level suppresses debug and info', () => {
    setLogLevel('warn');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const log = createLogger('Warn');
    log.debug('d');
    log.info('i');
    log.warn('w');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ─── setLogLevel / getLogLevel ────────────────────────────────────

describe('setLogLevel / getLogLevel', () => {
  it('setLogLevel changes the active level', () => {
    setLogLevel('debug');
    expect(getLogLevel()).toBe('debug');

    setLogLevel('error');
    expect(getLogLevel()).toBe('error');
  });

  it('ignores invalid level names', () => {
    setLogLevel('info');
    setLogLevel('invalid_level');
    expect(getLogLevel()).toBe('info');
  });

  it('supports all valid levels', () => {
    for (const level of ['debug', 'info', 'warn', 'error', 'silent']) {
      setLogLevel(level);
      expect(getLogLevel()).toBe(level);
    }
  });
});

// ─── Multiple loggers ─────────────────────────────────────────────

describe('multiple loggers', () => {
  it('each logger has its own prefix', () => {
    setLogLevel('debug');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const logA = createLogger('ModuleA');
    const logB = createLogger('ModuleB');

    logA.debug('from A');
    logB.debug('from B');

    expect(spy.mock.calls[0]).toEqual(['[ModuleA]', 'from A']);
    expect(spy.mock.calls[1]).toEqual(['[ModuleB]', 'from B']);

    spy.mockRestore();
  });

  it('all loggers share the same log level', () => {
    setLogLevel('error');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const logA = createLogger('A');
    const logB = createLogger('B');

    logA.info('hidden');
    logB.info('hidden');

    expect(infoSpy).not.toHaveBeenCalled();

    setLogLevel('info');
    logA.info('visible');
    expect(infoSpy).toHaveBeenCalledTimes(1);

    infoSpy.mockRestore();
  });
});
