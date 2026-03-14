/**
 * Plugin Socket Events — Schema Validation Tests
 *
 * Tests Zod schemas for all plugin management socket events.
 */

import { describe, it, expect } from 'vitest';
import {
  PluginListSchema,
  PluginGetSchema,
  PluginToggleSchema,
  PluginConfigGetSchema,
  PluginConfigSetSchema,
  PluginActivitySchema,
} from '../../../src/transport/schemas.js';

describe('Plugin Management Schemas', () => {
  describe('PluginListSchema', () => {
    it('accepts empty object', () => {
      const result = PluginListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts filter: all', () => {
      const result = PluginListSchema.safeParse({ filter: 'all' });
      expect(result.success).toBe(true);
    });

    it('accepts filter: active', () => {
      const result = PluginListSchema.safeParse({ filter: 'active' });
      expect(result.success).toBe(true);
    });

    it('accepts filter: error', () => {
      const result = PluginListSchema.safeParse({ filter: 'error' });
      expect(result.success).toBe(true);
    });

    it('accepts filter: unloaded', () => {
      const result = PluginListSchema.safeParse({ filter: 'unloaded' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid filter', () => {
      const result = PluginListSchema.safeParse({ filter: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('PluginGetSchema', () => {
    it('accepts valid plugin ID', () => {
      const result = PluginGetSchema.safeParse({ pluginId: 'daily-standup' });
      expect(result.success).toBe(true);
    });

    it('rejects empty plugin ID', () => {
      const result = PluginGetSchema.safeParse({ pluginId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing plugin ID', () => {
      const result = PluginGetSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects plugin ID exceeding max length', () => {
      const result = PluginGetSchema.safeParse({ pluginId: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe('PluginToggleSchema', () => {
    it('accepts valid toggle on', () => {
      const result = PluginToggleSchema.safeParse({ pluginId: 'theme-switcher', enabled: true });
      expect(result.success).toBe(true);
    });

    it('accepts valid toggle off', () => {
      const result = PluginToggleSchema.safeParse({ pluginId: 'theme-switcher', enabled: false });
      expect(result.success).toBe(true);
    });

    it('rejects missing enabled field', () => {
      const result = PluginToggleSchema.safeParse({ pluginId: 'theme-switcher' });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean enabled', () => {
      const result = PluginToggleSchema.safeParse({ pluginId: 'theme-switcher', enabled: 'yes' });
      expect(result.success).toBe(false);
    });

    it('rejects missing pluginId', () => {
      const result = PluginToggleSchema.safeParse({ enabled: true });
      expect(result.success).toBe(false);
    });
  });

  describe('PluginConfigGetSchema', () => {
    it('accepts valid plugin ID', () => {
      const result = PluginConfigGetSchema.safeParse({ pluginId: 'daily-standup' });
      expect(result.success).toBe(true);
    });

    it('rejects empty plugin ID', () => {
      const result = PluginConfigGetSchema.safeParse({ pluginId: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('PluginConfigSetSchema', () => {
    it('accepts valid config with string value', () => {
      const result = PluginConfigSetSchema.safeParse({
        pluginId: 'daily-standup',
        key: 'schedule',
        value: '09:00',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid config with number value', () => {
      const result = PluginConfigSetSchema.safeParse({
        pluginId: 'deadline-tracker',
        key: 'warningDays',
        value: 3,
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid config with boolean value', () => {
      const result = PluginConfigSetSchema.safeParse({
        pluginId: 'theme-switcher',
        key: 'autoSwitch',
        value: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid config with object value', () => {
      const result = PluginConfigSetSchema.safeParse({
        pluginId: 'webhook-forwarder',
        key: 'endpoints',
        value: { url: 'https://example.com', method: 'POST' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing key', () => {
      const result = PluginConfigSetSchema.safeParse({
        pluginId: 'daily-standup',
        value: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty key', () => {
      const result = PluginConfigSetSchema.safeParse({
        pluginId: 'daily-standup',
        key: '',
        value: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects key exceeding max length', () => {
      const result = PluginConfigSetSchema.safeParse({
        pluginId: 'daily-standup',
        key: 'a'.repeat(501),
        value: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PluginActivitySchema', () => {
    it('accepts empty object', () => {
      const result = PluginActivitySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts pluginId filter', () => {
      const result = PluginActivitySchema.safeParse({ pluginId: 'daily-standup' });
      expect(result.success).toBe(true);
    });

    it('accepts limit', () => {
      const result = PluginActivitySchema.safeParse({ limit: 50 });
      expect(result.success).toBe(true);
    });

    it('accepts pluginId and limit together', () => {
      const result = PluginActivitySchema.safeParse({ pluginId: 'daily-standup', limit: 25 });
      expect(result.success).toBe(true);
    });

    it('rejects limit below 1', () => {
      const result = PluginActivitySchema.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects limit above 100', () => {
      const result = PluginActivitySchema.safeParse({ limit: 101 });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer limit', () => {
      const result = PluginActivitySchema.safeParse({ limit: 50.5 });
      expect(result.success).toBe(false);
    });
  });
});
