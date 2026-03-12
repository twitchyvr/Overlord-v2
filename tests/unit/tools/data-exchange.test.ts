/**
 * Data Exchange Tool Provider Tests
 *
 * Tests fetch_url, transform_data, export_data, validate_schema tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transformData,
  validateSchema,
} from '../../../src/tools/providers/data-exchange.js';
import type {
  TransformOperation,
} from '../../../src/tools/providers/data-exchange.js';

describe('Data Exchange Tool Provider', () => {
  describe('transformData', () => {
    it('wraps single item in array', () => {
      const result = transformData({
        data: { name: 'Alice', age: 30 },
        operations: [],
      });
      expect(result.recordCount).toBe(1);
      expect(result.transformLog).toContain('Wrapped single item in array');
    });

    it('applies filter operation', () => {
      const data = [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'pm' },
        { name: 'Carol', role: 'dev' },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'filter', field: 'role', value: 'dev' }],
      });
      expect(result.recordCount).toBe(2);
      expect((result.data as Record<string, unknown>[]).every((r) => r.role === 'dev')).toBe(true);
    });

    it('applies sort operation ascending', () => {
      const data = [
        { name: 'Carol' },
        { name: 'Alice' },
        { name: 'Bob' },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'sort', field: 'name' }],
      });
      const names = (result.data as Record<string, unknown>[]).map((r) => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Carol']);
    });

    it('applies sort operation descending', () => {
      const data = [
        { name: 'Alice' },
        { name: 'Carol' },
        { name: 'Bob' },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'sort', field: 'name', direction: 'desc' }],
      });
      const names = (result.data as Record<string, unknown>[]).map((r) => r.name);
      expect(names).toEqual(['Carol', 'Bob', 'Alice']);
    });

    it('applies pick operation', () => {
      const data = [
        { name: 'Alice', age: 30, role: 'dev', email: 'a@b.com' },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'pick', fields: ['name', 'role'] }],
      });
      const record = (result.data as Record<string, unknown>[])[0];
      expect(record).toEqual({ name: 'Alice', role: 'dev' });
    });

    it('applies rename operation', () => {
      const data = [{ firstName: 'Alice', lastName: 'Smith' }];
      const result = transformData({
        data,
        operations: [{ type: 'rename', mapping: { firstName: 'first', lastName: 'last' } }],
      });
      const record = (result.data as Record<string, unknown>[])[0];
      expect(record).toEqual({ first: 'Alice', last: 'Smith' });
    });

    it('applies deduplicate operation', () => {
      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 1, name: 'Alice (dup)' },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'deduplicate', field: 'id' }],
      });
      expect(result.recordCount).toBe(2);
    });

    it('applies flatten operation', () => {
      const data = [
        { name: 'Alice', tags: ['dev', 'lead'] },
        { name: 'Bob', tags: ['pm'] },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'flatten', field: 'tags' }],
      });
      expect(result.recordCount).toBe(3);
    });

    it('applies group operation', () => {
      const data = [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'pm' },
        { name: 'Carol', role: 'dev' },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'group', field: 'role' }],
      });
      expect(result.recordCount).toBe(2);
      const groups = result.data as Record<string, unknown>[];
      const devGroup = groups.find((g) => g.role === 'dev');
      expect(devGroup).toBeDefined();
      expect((devGroup as Record<string, unknown>).count).toBe(2);
    });

    it('applies map operation (set field value)', () => {
      const data = [
        { name: 'Alice', status: 'pending' },
        { name: 'Bob', status: 'pending' },
      ];
      const result = transformData({
        data,
        operations: [{ type: 'map', field: 'status', value: 'active' }],
      });
      expect((result.data as Record<string, unknown>[]).every((r) => r.status === 'active')).toBe(true);
    });

    it('chains multiple operations', () => {
      const data = [
        { name: 'Alice', role: 'dev', age: 30 },
        { name: 'Bob', role: 'pm', age: 25 },
        { name: 'Carol', role: 'dev', age: 35 },
      ];
      const result = transformData({
        data,
        operations: [
          { type: 'filter', field: 'role', value: 'dev' },
          { type: 'sort', field: 'name' },
          { type: 'pick', fields: ['name'] },
        ],
      });
      expect(result.recordCount).toBe(2);
      expect(result.operationsApplied).toBe(3);
      expect(result.transformLog).toHaveLength(3);
      expect((result.data as Record<string, unknown>[])[0]).toEqual({ name: 'Alice' });
    });

    it('returns transform log for all operations', () => {
      const result = transformData({
        data: [{ a: 1, b: 2 }],
        operations: [
          { type: 'pick', fields: ['a'] },
          { type: 'rename', mapping: { a: 'x' } },
        ],
      });
      expect(result.transformLog).toHaveLength(2);
      expect(result.transformLog[0]).toContain('pick');
      expect(result.transformLog[1]).toContain('rename');
    });
  });

  describe('validateSchema', () => {
    it('validates records against required fields', () => {
      const result = validateSchema({
        data: [{ name: 'Alice', age: 30 }],
        schema: {
          required: ['name', 'age'],
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.passed).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('detects missing required fields', () => {
      const result = validateSchema({
        data: [{ name: 'Alice' }],
        schema: {
          required: ['name', 'age'],
          properties: {},
        },
      });
      expect(result.valid).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.errors.some((e) => e.message.includes('age'))).toBe(true);
    });

    it('detects type mismatches for string', () => {
      const result = validateSchema({
        data: [{ name: 123 }],
        schema: {
          properties: {
            name: { type: 'string' },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].expected).toBe('string');
      expect(result.errors[0].actual).toBe('number');
    });

    it('detects type mismatches for number', () => {
      const result = validateSchema({
        data: [{ age: 'thirty' }],
        schema: {
          properties: {
            age: { type: 'number' },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].expected).toBe('number');
    });

    it('detects type mismatches for boolean', () => {
      const result = validateSchema({
        data: [{ active: 'yes' }],
        schema: {
          properties: {
            active: { type: 'boolean' },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].expected).toBe('boolean');
    });

    it('detects type mismatches for array', () => {
      const result = validateSchema({
        data: [{ tags: 'not-array' }],
        schema: {
          properties: {
            tags: { type: 'array' },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].expected).toBe('array');
    });

    it('detects type mismatches for object', () => {
      const result = validateSchema({
        data: [{ meta: 'not-object' }],
        schema: {
          properties: {
            meta: { type: 'object' },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].expected).toBe('object');
    });

    it('rejects array when object expected', () => {
      const result = validateSchema({
        data: [{ meta: [1, 2] }],
        schema: {
          properties: {
            meta: { type: 'object' },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].actual).toBe('array');
    });

    it('validates multiple records — mixed pass/fail', () => {
      const result = validateSchema({
        data: [
          { name: 'Alice', age: 30 },
          { name: 'Bob' },
          { name: 'Carol', age: 25 },
        ],
        schema: {
          required: ['name', 'age'],
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.recordsChecked).toBe(3);
    });

    it('wraps single record in array', () => {
      const result = validateSchema({
        data: { name: 'Alice' },
        schema: {
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.recordsChecked).toBe(1);
    });

    it('skips type check for missing optional fields', () => {
      const result = validateSchema({
        data: [{ name: 'Alice' }],
        schema: {
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
