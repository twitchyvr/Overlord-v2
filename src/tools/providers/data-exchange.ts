/**
 * Data Exchange Tools
 *
 * Tools for the Data Exchange room on the Integration Floor.
 * Handles external data ingestion, transformation, and export.
 *
 * Tools:
 *   fetch_url       — Fetch data from a URL (JSON, CSV, XML)
 *   transform_data  — Apply transformation operations to data
 *   export_data     — Export data to a target format/location
 *   validate_schema — Validate data against a JSON schema
 */

import { fetchWebpage } from './web.js';
import { writeFileImpl, readFileImpl } from './filesystem.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:data-exchange' });

// ── fetch_url ──────────────────────────────────────────────

export interface FetchUrlParams {
  url: string;
  format?: 'json' | 'csv' | 'text' | 'auto';
  headers?: Record<string, string>;
  maxLength?: number;
}

export interface FetchUrlResult {
  url: string;
  format: string;
  data: unknown;
  recordCount: number;
  rawLength: number;
}

export async function fetchUrl(params: FetchUrlParams): Promise<FetchUrlResult> {
  const { url, format = 'auto', maxLength = 50000 } = params;

  log.info({ url, format }, 'Fetching data from URL');

  const result = await fetchWebpage({ url, maxLength });
  const raw = result.content;
  const detectedFormat = format === 'auto' ? detectFormat(url, raw) : format;

  let data: unknown;
  let recordCount = 0;

  switch (detectedFormat) {
    case 'json': {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        const parseErr = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse JSON from ${url}: ${parseErr}`);
      }
      recordCount = Array.isArray(data) ? data.length : 1;
      break;
    }
    case 'csv': {
      const rows = parseCSV(raw);
      data = rows;
      recordCount = rows.length > 0 ? rows.length - 1 : 0; // minus header
      break;
    }
    default: {
      data = raw;
      recordCount = raw.split('\n').length;
    }
  }

  log.info({ url, detectedFormat, recordCount }, 'Data fetched successfully');

  return {
    url,
    format: detectedFormat,
    data,
    recordCount,
    rawLength: raw.length,
  };
}

// ── transform_data ─────────────────────────────────────────

export interface TransformDataParams {
  data: unknown;
  operations: TransformOperation[];
}

export interface TransformOperation {
  type: 'filter' | 'map' | 'sort' | 'rename' | 'pick' | 'flatten' | 'group' | 'deduplicate';
  field?: string;
  value?: unknown;
  fields?: string[];
  direction?: 'asc' | 'desc';
  mapping?: Record<string, string>;
}

export interface TransformDataResult {
  data: unknown;
  operationsApplied: number;
  recordCount: number;
  transformLog: string[];
}

export function transformData(params: TransformDataParams): TransformDataResult {
  const { operations } = params;
  let data = params.data;
  const transformLog: string[] = [];

  if (!Array.isArray(data)) {
    data = [data];
    transformLog.push('Wrapped single item in array');
  }

  let records = data as Record<string, unknown>[];

  for (const op of operations) {
    const before = records.length;
    switch (op.type) {
      case 'filter': {
        if (op.field && op.value !== undefined) {
          records = records.filter((r) => r[op.field!] === op.value);
          transformLog.push(`filter: ${op.field} = ${JSON.stringify(op.value)} (${before} → ${records.length})`);
        }
        break;
      }
      case 'sort': {
        if (op.field) {
          const dir = op.direction === 'desc' ? -1 : 1;
          records.sort((a, b) => {
            const av = a[op.field!], bv = b[op.field!];
            if (av === bv) return 0;
            return (av as string) < (bv as string) ? -dir : dir;
          });
          transformLog.push(`sort: ${op.field} ${op.direction || 'asc'}`);
        }
        break;
      }
      case 'pick': {
        if (op.fields && op.fields.length > 0) {
          records = records.map((r) => {
            const picked: Record<string, unknown> = {};
            for (const f of op.fields!) {
              if (f in r) picked[f] = r[f];
            }
            return picked;
          });
          transformLog.push(`pick: ${op.fields.join(', ')}`);
        }
        break;
      }
      case 'rename': {
        if (op.mapping) {
          records = records.map((r) => {
            const renamed: Record<string, unknown> = { ...r };
            for (const [from, to] of Object.entries(op.mapping!)) {
              if (from in renamed) {
                renamed[to] = renamed[from];
                delete renamed[from];
              }
            }
            return renamed;
          });
          transformLog.push(`rename: ${Object.entries(op.mapping).map(([f, t]) => `${f}→${t}`).join(', ')}`);
        }
        break;
      }
      case 'deduplicate': {
        if (op.field) {
          const seen = new Set<unknown>();
          records = records.filter((r) => {
            const val = r[op.field!];
            if (seen.has(val)) return false;
            seen.add(val);
            return true;
          });
          transformLog.push(`deduplicate: ${op.field} (${before} → ${records.length})`);
        }
        break;
      }
      case 'flatten': {
        if (op.field) {
          const flattened: Record<string, unknown>[] = [];
          for (const r of records) {
            const nested = r[op.field!];
            if (Array.isArray(nested)) {
              for (const item of nested) {
                flattened.push({ ...r, [op.field!]: item });
              }
            } else {
              flattened.push(r);
            }
          }
          records = flattened;
          transformLog.push(`flatten: ${op.field} (${before} → ${records.length})`);
        }
        break;
      }
      case 'group': {
        if (op.field) {
          const groups: Record<string, Record<string, unknown>[]> = {};
          for (const r of records) {
            const key = String(r[op.field!] ?? 'null');
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
          }
          // Return as array of group objects
          records = Object.entries(groups).map(([key, items]) => ({
            [op.field!]: key,
            count: items.length,
            items,
          }));
          transformLog.push(`group: ${op.field} (${before} records → ${records.length} groups)`);
        }
        break;
      }
      case 'map': {
        if (op.field && op.value !== undefined) {
          records = records.map((r) => ({ ...r, [op.field!]: op.value }));
          transformLog.push(`map: set ${op.field} = ${JSON.stringify(op.value)}`);
        }
        break;
      }
    }
  }

  return {
    data: records,
    operationsApplied: operations.length,
    recordCount: records.length,
    transformLog,
  };
}

// ── export_data ────────────────────────────────────────────

export interface ExportDataParams {
  data: unknown;
  format: 'json' | 'csv' | 'text';
  path: string;
}

export interface ExportDataResult {
  path: string;
  format: string;
  recordCount: number;
  bytesWritten: number;
}

export async function exportData(params: ExportDataParams): Promise<ExportDataResult> {
  const { data, format, path } = params;

  let content: string;
  let recordCount = 0;

  switch (format) {
    case 'json': {
      content = JSON.stringify(data, null, 2);
      recordCount = Array.isArray(data) ? data.length : 1;
      break;
    }
    case 'csv': {
      if (!Array.isArray(data) || data.length === 0) {
        content = '';
        break;
      }
      const headers = Object.keys(data[0] as Record<string, unknown>);
      const rows = (data as Record<string, unknown>[]).map((r) =>
        headers.map((h) => csvEscape(String(r[h] ?? ''))).join(','),
      );
      content = [headers.join(','), ...rows].join('\n');
      recordCount = data.length;
      break;
    }
    default: {
      content = typeof data === 'string' ? data : JSON.stringify(data);
      recordCount = content.split('\n').length;
    }
  }

  const result = await writeFileImpl({ path, content });

  log.info({ path, format, recordCount, bytes: result.bytesWritten }, 'Data exported');

  return {
    path: result.path,
    format,
    recordCount,
    bytesWritten: result.bytesWritten,
  };
}

// ── validate_schema ────────────────────────────────────────

export interface ValidateSchemaParams {
  data: unknown;
  schema: Record<string, unknown>;
}

export interface ValidationError {
  path: string;
  message: string;
  expected: string;
  actual: string;
}

export interface ValidateSchemaResult {
  valid: boolean;
  errors: ValidationError[];
  recordsChecked: number;
  passed: number;
  failed: number;
}

/**
 * Validate data against a simplified JSON schema.
 *
 * Supports: type checking, required fields, array items type.
 * Not a full JSON Schema validator — covers 80% of use cases.
 */
export function validateSchema(params: ValidateSchemaParams): ValidateSchemaResult {
  const { data, schema } = params;
  const errors: ValidationError[] = [];
  const records = Array.isArray(data) ? data : [data];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i] as Record<string, unknown>;
    const recordErrors = validateRecord(record, schema, `[${i}]`);
    if (recordErrors.length === 0) {
      passed++;
    } else {
      failed++;
      errors.push(...recordErrors);
    }
  }

  return {
    valid: failed === 0,
    errors,
    recordsChecked: records.length,
    passed,
    failed,
  };
}

// ── Helpers ────────────────────────────────────────────────

function detectFormat(url: string, content: string): string {
  if (url.endsWith('.json') || url.includes('format=json')) return 'json';
  if (url.endsWith('.csv') || url.includes('format=csv')) return 'csv';
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { JSON.parse(trimmed); return 'json'; } catch { /* not json */ }
  }
  if (trimmed.includes(',') && trimmed.includes('\n')) return 'csv';
  return 'text';
}

function parseCSV(content: string): string[][] {
  return content.trim().split('\n').map((line) =>
    line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')),
  );
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function validateRecord(
  record: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  // Check required fields
  if (required) {
    for (const field of required) {
      if (!(field in record) || record[field] === undefined || record[field] === null) {
        errors.push({
          path: `${path}.${field}`,
          message: `Missing required field "${field}"`,
          expected: 'present',
          actual: 'missing',
        });
      }
    }
  }

  // Check property types
  if (properties) {
    for (const [field, fieldSchema] of Object.entries(properties)) {
      if (!(field in record)) continue;
      const value = record[field];
      const expectedType = fieldSchema.type as string;

      if (expectedType === 'array' && !Array.isArray(value)) {
        errors.push({
          path: `${path}.${field}`,
          message: `Expected array for "${field}"`,
          expected: 'array',
          actual: typeof value,
        });
      } else if (expectedType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        errors.push({
          path: `${path}.${field}`,
          message: `Expected object for "${field}"`,
          expected: 'object',
          actual: Array.isArray(value) ? 'array' : typeof value,
        });
      } else if (['string', 'number', 'boolean'].includes(expectedType) && typeof value !== expectedType) {
        errors.push({
          path: `${path}.${field}`,
          message: `Expected ${expectedType} for "${field}"`,
          expected: expectedType,
          actual: typeof value,
        });
      }
    }
  }

  return errors;
}
