/**
 * Config Service Tests
 *
 * Tests the Zod-validated config system.
 * Manipulates process.env directly — no .env file needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We import the Config class constructor pattern by recreating it,
// because the module-level singleton calls loadDotenv() on import.
// Instead we test via the exported singleton after setting env vars.

describe('Config Service', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Snapshot current env
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('validate()', () => {
    it('succeeds with defaults when no env vars are set', async () => {
      // Clear all Overlord-specific env vars to test defaults
      delete process.env.PORT;
      delete process.env.NODE_ENV;
      delete process.env.LOG_LEVEL;
      delete process.env.DB_PATH;

      // Dynamic import to get a fresh module each time
      const { config } = await import('../../../src/core/config.js');

      // Re-validate with current env
      // Note: Config is a singleton, so we need to test via its public interface
      // The validate() method should not throw with valid defaults
      expect(() => config.validate()).not.toThrow();
    });

    it('applies default values correctly', async () => {
      delete process.env.PORT;
      delete process.env.NODE_ENV;
      delete process.env.DB_PATH;
      delete process.env.ANTHROPIC_MODEL;
      delete process.env.MINIMAX_MODEL;
      delete process.env.OPENAI_MODEL;
      delete process.env.OLLAMA_MODEL;

      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('PORT')).toBe(4000);
      expect(config.get('NODE_ENV')).toBe('development');
      expect(config.get('DB_PATH')).toBe('./data/overlord.db');
      expect(config.get('ANTHROPIC_MODEL')).toBe('claude-sonnet-4-20250514');
      expect(config.get('MINIMAX_MODEL')).toBe('MiniMax-M2.5');
      expect(config.get('MINIMAX_BASE_URL')).toBe('https://api.minimax.io/anthropic');
      expect(config.get('OPENAI_MODEL')).toBe('gpt-4o');
      expect(config.get('OLLAMA_MODEL')).toBe('llama3');
      expect(config.get('OLLAMA_BASE_URL')).toBe('http://localhost:11434');
      expect(config.get('ENABLE_PLUGINS')).toBe(false);
      expect(config.get('ENABLE_LUA_SCRIPTING')).toBe(false);
    });

    it('reads explicit env vars', async () => {
      process.env.PORT = '8080';
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'debug';
      process.env.DB_PATH = '/tmp/test.db';

      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('PORT')).toBe(8080);
      expect(config.get('NODE_ENV')).toBe('production');
      expect(config.get('LOG_LEVEL')).toBe('debug');
      expect(config.get('DB_PATH')).toBe('/tmp/test.db');
    });

    it('handles optional API key fields', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GITHUB_TOKEN;

      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('ANTHROPIC_API_KEY')).toBeUndefined();
      expect(config.get('MINIMAX_API_KEY')).toBeUndefined();
      expect(config.get('OPENAI_API_KEY')).toBeUndefined();
      expect(config.get('GITHUB_TOKEN')).toBeUndefined();
    });

    it('accepts valid API keys when provided', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test123';
      process.env.MINIMAX_API_KEY = 'mm-test456';
      process.env.ANTHROPIC_BASE_URL = 'https://custom.api.example.com';

      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('ANTHROPIC_API_KEY')).toBe('sk-ant-test123');
      expect(config.get('MINIMAX_API_KEY')).toBe('mm-test456');
      expect(config.get('ANTHROPIC_BASE_URL')).toBe('https://custom.api.example.com');
    });

    it('coerces PORT from string to number', async () => {
      process.env.PORT = '3000';

      const { config } = await import('../../../src/core/config.js');
      config.validate();

      const port = config.get('PORT');
      expect(typeof port).toBe('number');
      expect(port).toBe(3000);
    });

    it('coerces boolean feature flags', async () => {
      process.env.ENABLE_PLUGINS = 'true';
      process.env.ENABLE_LUA_SCRIPTING = '1';

      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('ENABLE_PLUGINS')).toBe(true);
      expect(config.get('ENABLE_LUA_SCRIPTING')).toBe(true);
    });

    it('validates provider assignments per room type', async () => {
      process.env.PROVIDER_DISCOVERY = 'minimax';
      process.env.PROVIDER_CODE_LAB = 'ollama';

      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('PROVIDER_DISCOVERY')).toBe('minimax');
      expect(config.get('PROVIDER_CODE_LAB')).toBe('ollama');
      // Defaults for others
      expect(config.get('PROVIDER_ARCHITECTURE')).toBe('minimax');
      expect(config.get('PROVIDER_REVIEW')).toBe('minimax');
    });

    it('rejects invalid NODE_ENV values', async () => {
      process.env.NODE_ENV = 'staging';

      const { config } = await import('../../../src/core/config.js');
      expect(() => config.validate()).toThrow('Config validation failed');
    });

    it('rejects invalid LOG_LEVEL values', async () => {
      process.env.LOG_LEVEL = 'verbose';

      const { config } = await import('../../../src/core/config.js');
      expect(() => config.validate()).toThrow('Config validation failed');
    });
  });

  describe('get() before validate()', () => {
    it('throws when get() called before validate()', async () => {
      // Reset module cache to get a fresh Config singleton that hasn't been validated
      vi.resetModules();
      const { config: freshConfig } = await import('../../../src/core/config.js');
      expect(() => freshConfig.get('PORT')).toThrow('Config not validated');
    });

    it('throws when getAll() called before validate()', async () => {
      vi.resetModules();
      const { config: freshConfig } = await import('../../../src/core/config.js');
      expect(() => freshConfig.getAll()).toThrow('Config not validated');
    });
  });

  describe('getAll()', () => {
    it('returns a copy of all config values', async () => {
      const { config } = await import('../../../src/core/config.js');
      config.validate();

      const all = config.getAll();
      expect(all.PORT).toBeDefined();
      expect(all.NODE_ENV).toBeDefined();
      expect(all.DB_PATH).toBeDefined();
    });

    it('returns a copy, not a reference', async () => {
      const { config } = await import('../../../src/core/config.js');
      config.validate();

      const all1 = config.getAll();
      const all2 = config.getAll();
      expect(all1).toEqual(all2);
      expect(all1).not.toBe(all2); // Different object references
    });
  });

  describe('security and MCP config', () => {
    it('has security defaults', async () => {
      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('SESSION_SECRET')).toBe('dev-secret-change-in-production');
      expect(config.get('CORS_ORIGIN')).toBe('http://localhost:4000');
    });

    it('has MCP config defaults', async () => {
      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('MCP_SERVERS_CONFIG')).toBe('./mcp-servers.json');
    });

    it('has plugin config defaults', async () => {
      const { config } = await import('../../../src/core/config.js');
      config.validate();

      expect(config.get('PLUGIN_DIR')).toBe('./plugins');
    });
  });
});
