/**
 * Document Format Tool Provider (#812)
 *
 * Tools for reading PDF, DOCX, XLSX, and structured Markdown files.
 * Enables agents to consume documentation in any common format.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../../core/logger.js';
import { guardPathWithPermissions } from '../path-permissions.js';

const log = logger.child({ module: 'tool:document-formats' });

/** Resolve and validate a file path from tool params. */
function resolvePath(filePath: string, cwd?: string, allowedPaths?: string[]): string {
  const workDir = cwd || process.cwd();
  return guardPathWithPermissions(filePath, workDir, allowedPaths || []);
}

// ── read_pdf ──

export async function readPdfImpl(params: {
  filePath: string;
  pages?: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ text: string; pageCount: number; info: Record<string, unknown> }> {
  const fullPath = resolvePath(params.filePath, params.cwd, params.allowedPaths);
  log.info({ path: fullPath }, 'Reading PDF');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = (await import('pdf-parse') as any).default ?? (await import('pdf-parse') as any);
  const buffer = await readFile(fullPath);
  const result = await pdfParse(buffer) as { text: string; numpages: number; info: Record<string, unknown> };

  let text = result.text;

  // If specific pages requested, try to split by page (best-effort)
  if (params.pages) {
    const pages = text.split(/\f/); // form-feed is common page separator
    const [start, end] = params.pages.split('-').map(Number);
    if (start && end) {
      text = pages.slice(start - 1, end).join('\n\n--- Page Break ---\n\n');
    } else if (start) {
      text = pages[start - 1] || text;
    }
  }

  return {
    text: text.slice(0, 100_000), // Cap at 100K chars for context safety
    pageCount: result.numpages,
    info: result.info || {},
  };
}

// ── read_docx ──

export async function readDocxImpl(params: {
  filePath: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ text: string; html: string; wordCount: number }> {
  const fullPath = resolvePath(params.filePath, params.cwd, params.allowedPaths);
  log.info({ path: fullPath }, 'Reading DOCX');

  const mammoth = await import('mammoth');
  const buffer = await readFile(fullPath);

  const textResult = await mammoth.extractRawText({ buffer });
  const htmlResult = await mammoth.convertToHtml({ buffer });

  const text = textResult.value.slice(0, 100_000);
  const html = htmlResult.value.slice(0, 100_000);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return { text, html, wordCount };
}

// ── read_xlsx ──

export async function readXlsxImpl(params: {
  filePath: string;
  sheet?: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ sheets: string[]; data: Record<string, unknown>[]; headers: string[]; rowCount: number }> {
  const fullPath = resolvePath(params.filePath, params.cwd, params.allowedPaths);
  log.info({ path: fullPath }, 'Reading XLSX');

  const XLSX = await import('xlsx');
  const buffer = await readFile(fullPath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheetName = params.sheet || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    return { sheets: workbook.SheetNames, data: [], headers: [], rowCount: 0 };
  }

  const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];
  const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

  // Cap rows to prevent context overflow
  const capped = jsonData.slice(0, 500);

  return {
    sheets: workbook.SheetNames,
    data: capped,
    headers,
    rowCount: jsonData.length,
  };
}

// ── parse_markdown ──

export async function parseMarkdownImpl(params: {
  filePath: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{
  text: string;
  toc: Array<{ level: number; title: string; line: number }>;
  codeBlocks: Array<{ language: string; content: string; line: number }>;
  links: Array<{ text: string; url: string }>;
  wordCount: number;
}> {
  const fullPath = resolvePath(params.filePath, params.cwd, params.allowedPaths);
  log.info({ path: fullPath }, 'Parsing Markdown');

  const content = await readFile(fullPath, 'utf-8');
  const lines = content.split('\n');

  // Extract TOC from headings
  const toc: Array<{ level: number; title: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      toc.push({ level: match[1].length, title: match[2].trim(), line: i + 1 });
    }
  }

  // Extract code blocks
  const codeBlocks: Array<{ language: string; content: string; line: number }> = [];
  let inBlock = false;
  let blockLang = '';
  let blockContent: string[] = [];
  let blockStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) {
      if (inBlock) {
        codeBlocks.push({ language: blockLang, content: blockContent.join('\n'), line: blockStart + 1 });
        inBlock = false;
        blockContent = [];
      } else {
        inBlock = true;
        blockLang = lines[i].slice(3).trim();
        blockStart = i;
      }
    } else if (inBlock) {
      blockContent.push(lines[i]);
    }
  }

  // Extract links
  const links: Array<{ text: string; url: string }> = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(content)) !== null) {
    links.push({ text: linkMatch[1], url: linkMatch[2] });
  }

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return {
    text: content.slice(0, 100_000),
    toc,
    codeBlocks: codeBlocks.slice(0, 50),
    links: links.slice(0, 100),
    wordCount,
  };
}

// ── detect_file_type ──

export async function detectFileTypeImpl(params: {
  filePath: string;
  cwd?: string;
  allowedPaths?: string[];
}): Promise<{ extension: string; mimeType: string; category: string; readable: boolean }> {
  const fullPath = resolvePath(params.filePath, params.cwd, params.allowedPaths);

  if (!existsSync(fullPath)) {
    return { extension: '', mimeType: 'unknown', category: 'unknown', readable: false };
  }

  const ext = extname(fullPath).toLowerCase();

  const TYPE_MAP: Record<string, { mime: string; category: string; readable: boolean }> = {
    '.pdf':  { mime: 'application/pdf', category: 'document', readable: true },
    '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document', readable: true },
    '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'spreadsheet', readable: true },
    '.md':   { mime: 'text/markdown', category: 'markdown', readable: true },
    '.txt':  { mime: 'text/plain', category: 'text', readable: true },
    '.json': { mime: 'application/json', category: 'data', readable: true },
    '.yaml': { mime: 'text/yaml', category: 'data', readable: true },
    '.yml':  { mime: 'text/yaml', category: 'data', readable: true },
    '.csv':  { mime: 'text/csv', category: 'data', readable: true },
    '.ts':   { mime: 'text/typescript', category: 'code', readable: true },
    '.js':   { mime: 'text/javascript', category: 'code', readable: true },
    '.py':   { mime: 'text/x-python', category: 'code', readable: true },
    '.rs':   { mime: 'text/x-rust', category: 'code', readable: true },
    '.go':   { mime: 'text/x-go', category: 'code', readable: true },
    '.html': { mime: 'text/html', category: 'web', readable: true },
    '.css':  { mime: 'text/css', category: 'web', readable: true },
    '.png':  { mime: 'image/png', category: 'image', readable: false },
    '.jpg':  { mime: 'image/jpeg', category: 'image', readable: false },
    '.gif':  { mime: 'image/gif', category: 'image', readable: false },
    '.svg':  { mime: 'image/svg+xml', category: 'image', readable: true },
    '.zip':  { mime: 'application/zip', category: 'archive', readable: false },
  };

  const info = TYPE_MAP[ext] || { mime: 'application/octet-stream', category: 'binary', readable: false };

  return {
    extension: ext,
    mimeType: info.mime,
    category: info.category,
    readable: info.readable,
  };
}
