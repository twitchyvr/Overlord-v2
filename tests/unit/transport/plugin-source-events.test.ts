/**
 * Plugin Source / IDE Socket Events — Schema Validation Tests
 *
 * Tests Zod schemas for all plugin source management, creation,
 * validation, export/import, and log subscription socket events.
 */

import { describe, it, expect } from 'vitest';
import {
  PluginSourceGetSchema,
  PluginSourceSaveSchema,
  PluginCreateSchema,
  PluginDeleteSchema,
  PluginValidateSchema,
  PluginExportSchema,
  PluginImportSchema,
  PluginLogSubscribeSchema,
} from '../../../src/transport/schemas.js';

describe('Plugin Source / IDE Schemas', () => {
  // ─── PluginSourceGetSchema ─────────────────────────────────

  describe('PluginSourceGetSchema', () => {
    it('accepts valid plugin ID', () => {
      const result = PluginSourceGetSchema.safeParse({ pluginId: 'daily-standup' });
      expect(result.success).toBe(true);
    });

    it('rejects empty plugin ID', () => {
      const result = PluginSourceGetSchema.safeParse({ pluginId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing plugin ID', () => {
      const result = PluginSourceGetSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects plugin ID exceeding max length', () => {
      const result = PluginSourceGetSchema.safeParse({ pluginId: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  // ─── PluginSourceSaveSchema ────────────────────────────────

  describe('PluginSourceSaveSchema', () => {
    it('accepts valid plugin ID and code', () => {
      const result = PluginSourceSaveSchema.safeParse({
        pluginId: 'my-script',
        code: 'registerHook("onLoad", function() end)',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing pluginId', () => {
      const result = PluginSourceSaveSchema.safeParse({ code: 'some code' });
      expect(result.success).toBe(false);
    });

    it('rejects missing code', () => {
      const result = PluginSourceSaveSchema.safeParse({ pluginId: 'my-script' });
      expect(result.success).toBe(false);
    });

    it('rejects empty code', () => {
      const result = PluginSourceSaveSchema.safeParse({ pluginId: 'my-script', code: '' });
      expect(result.success).toBe(false);
    });

    it('rejects code exceeding max length (500,000 chars)', () => {
      const result = PluginSourceSaveSchema.safeParse({
        pluginId: 'my-script',
        code: 'x'.repeat(500_001),
      });
      expect(result.success).toBe(false);
    });

    it('accepts code at max length boundary', () => {
      const result = PluginSourceSaveSchema.safeParse({
        pluginId: 'my-script',
        code: 'x'.repeat(500_000),
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── PluginCreateSchema ────────────────────────────────────

  describe('PluginCreateSchema', () => {
    it('accepts valid id and name with defaults', () => {
      const result = PluginCreateSchema.safeParse({
        id: 'my-new-script',
        name: 'My New Script',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe('Custom Overlord script');
        expect(result.data.template).toBe('blank');
      }
    });

    it('accepts all fields provided explicitly', () => {
      const result = PluginCreateSchema.safeParse({
        id: 'room-logger',
        name: 'Room Logger',
        description: 'Logs room enter/exit events',
        template: 'room-hook',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing id', () => {
      const result = PluginCreateSchema.safeParse({ name: 'No ID Script' });
      expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
      const result = PluginCreateSchema.safeParse({ id: 'no-name' });
      expect(result.success).toBe(false);
    });

    it('rejects empty id', () => {
      const result = PluginCreateSchema.safeParse({ id: '', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: '' });
      expect(result.success).toBe(false);
    });

    // ── kebab-case regex enforcement ──

    it('accepts simple kebab-case id', () => {
      const result = PluginCreateSchema.safeParse({ id: 'my-plugin', name: 'Test' });
      expect(result.success).toBe(true);
    });

    it('accepts single-word lowercase id', () => {
      const result = PluginCreateSchema.safeParse({ id: 'plugin', name: 'Test' });
      expect(result.success).toBe(true);
    });

    it('accepts multi-segment kebab-case id', () => {
      const result = PluginCreateSchema.safeParse({ id: 'my-cool-new-plugin', name: 'Test' });
      expect(result.success).toBe(true);
    });

    it('accepts id with numbers in segments', () => {
      const result = PluginCreateSchema.safeParse({ id: 'plugin2', name: 'Test' });
      expect(result.success).toBe(true);
    });

    it('accepts id with numbers after dash', () => {
      const result = PluginCreateSchema.safeParse({ id: 'v2-plugin', name: 'Test' });
      expect(result.success).toBe(true);
    });

    it('rejects id with uppercase letters', () => {
      const result = PluginCreateSchema.safeParse({ id: 'MyPlugin', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects id with underscores', () => {
      const result = PluginCreateSchema.safeParse({ id: 'my_plugin', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects id starting with a number', () => {
      const result = PluginCreateSchema.safeParse({ id: '2fast', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects id with trailing dash', () => {
      const result = PluginCreateSchema.safeParse({ id: 'plugin-', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects id with leading dash', () => {
      const result = PluginCreateSchema.safeParse({ id: '-plugin', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects id with double dashes', () => {
      const result = PluginCreateSchema.safeParse({ id: 'my--plugin', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects id with spaces', () => {
      const result = PluginCreateSchema.safeParse({ id: 'my plugin', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('rejects id exceeding max length', () => {
      const result = PluginCreateSchema.safeParse({ id: 'a'.repeat(101), name: 'Test' });
      expect(result.success).toBe(false);
    });

    // ── template enum ──

    it('accepts template: blank', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: 'Test', template: 'blank' });
      expect(result.success).toBe(true);
    });

    it('accepts template: room-hook', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: 'Test', template: 'room-hook' });
      expect(result.success).toBe(true);
    });

    it('accepts template: tool-hook', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: 'Test', template: 'tool-hook' });
      expect(result.success).toBe(true);
    });

    it('accepts template: phase-hook', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: 'Test', template: 'phase-hook' });
      expect(result.success).toBe(true);
    });

    it('accepts template: dashboard-widget', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: 'Test', template: 'dashboard-widget' });
      expect(result.success).toBe(true);
    });

    it('accepts template: validator', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: 'Test', template: 'validator' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid template value', () => {
      const result = PluginCreateSchema.safeParse({ id: 'test', name: 'Test', template: 'invalid-template' });
      expect(result.success).toBe(false);
    });
  });

  // ─── PluginDeleteSchema ────────────────────────────────────

  describe('PluginDeleteSchema', () => {
    it('accepts valid plugin ID', () => {
      const result = PluginDeleteSchema.safeParse({ pluginId: 'my-script' });
      expect(result.success).toBe(true);
    });

    it('rejects empty plugin ID', () => {
      const result = PluginDeleteSchema.safeParse({ pluginId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing plugin ID', () => {
      const result = PluginDeleteSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects plugin ID exceeding max length', () => {
      const result = PluginDeleteSchema.safeParse({ pluginId: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  // ─── PluginValidateSchema ──────────────────────────────────

  describe('PluginValidateSchema', () => {
    it('accepts valid code string', () => {
      const result = PluginValidateSchema.safeParse({ code: 'print("hello")' });
      expect(result.success).toBe(true);
    });

    it('rejects empty code', () => {
      const result = PluginValidateSchema.safeParse({ code: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing code', () => {
      const result = PluginValidateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects code exceeding max length', () => {
      const result = PluginValidateSchema.safeParse({ code: 'x'.repeat(500_001) });
      expect(result.success).toBe(false);
    });

    it('rejects non-string code', () => {
      const result = PluginValidateSchema.safeParse({ code: 12345 });
      expect(result.success).toBe(false);
    });
  });

  // ─── PluginExportSchema ────────────────────────────────────

  describe('PluginExportSchema', () => {
    it('accepts valid plugin ID', () => {
      const result = PluginExportSchema.safeParse({ pluginId: 'daily-standup' });
      expect(result.success).toBe(true);
    });

    it('rejects empty plugin ID', () => {
      const result = PluginExportSchema.safeParse({ pluginId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing plugin ID', () => {
      const result = PluginExportSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects plugin ID exceeding max length', () => {
      const result = PluginExportSchema.safeParse({ pluginId: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  // ─── PluginImportSchema ────────────────────────────────────

  describe('PluginImportSchema', () => {
    it('accepts valid bundle string', () => {
      const result = PluginImportSchema.safeParse({ bundle: 'base64encodeddata==' });
      expect(result.success).toBe(true);
    });

    it('rejects empty bundle', () => {
      const result = PluginImportSchema.safeParse({ bundle: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing bundle', () => {
      const result = PluginImportSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects bundle exceeding max length (10MB)', () => {
      const result = PluginImportSchema.safeParse({ bundle: 'x'.repeat(10_000_001) });
      expect(result.success).toBe(false);
    });

    it('accepts bundle at max length boundary', () => {
      const result = PluginImportSchema.safeParse({ bundle: 'x'.repeat(10_000_000) });
      expect(result.success).toBe(true);
    });

    it('rejects non-string bundle', () => {
      const result = PluginImportSchema.safeParse({ bundle: 12345 });
      expect(result.success).toBe(false);
    });
  });

  // ─── PluginLogSubscribeSchema ──────────────────────────────

  describe('PluginLogSubscribeSchema', () => {
    it('accepts valid plugin ID', () => {
      const result = PluginLogSubscribeSchema.safeParse({ pluginId: 'my-logger' });
      expect(result.success).toBe(true);
    });

    it('rejects empty plugin ID', () => {
      const result = PluginLogSubscribeSchema.safeParse({ pluginId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing plugin ID', () => {
      const result = PluginLogSubscribeSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects plugin ID exceeding max length', () => {
      const result = PluginLogSubscribeSchema.safeParse({ pluginId: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });
});
