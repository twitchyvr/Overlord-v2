/**
 * MiniMax File Management Service
 *
 * Upload, retrieve, list, and delete files on the MiniMax API platform.
 * Used by Speech (T2A) and Voice Cloning services for audio file management.
 *
 * API: https://api.minimax.io/v1/files/
 * Auth: Bearer token via MINIMAX_API_KEY
 *
 * Endpoints:
 *   POST /v1/files/upload   — multipart/form-data upload
 *   GET  /v1/files/retrieve  — get file metadata by ID
 *   GET  /v1/files/list      — list files by purpose
 *   POST /v1/files/delete    — delete a file by ID + purpose
 *
 * Layer: AI (depends on Core only)
 */

import { logger, broadcastLog } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import { config } from '../core/config.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'ai:minimax-files' });

const MINIMAX_FILES_BASE = 'https://api.minimax.io/v1/files';
const FETCH_TIMEOUT_MS = 120_000; // 2 min timeout for uploads
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB max upload

// ─── Types ───

export type FilePurpose = 'voice_clone' | 'prompt_audio' | 't2a_async_input';

export interface MiniMaxFile {
  /** Unique file ID (numeric, but stored as string for safety) */
  fileId: string;
  /** File size in bytes */
  bytes: number;
  /** Unix timestamp (seconds) when the file was created */
  createdAt: number;
  /** Original filename */
  filename: string;
  /** Purpose category */
  purpose: string;
  /** Download URL (only present in retrieve responses) */
  downloadUrl?: string;
}

interface ApiFileObject {
  file_id?: number | string;
  bytes?: number;
  created_at?: number;
  filename?: string;
  purpose?: string;
  download_url?: string;
}

interface ApiBaseResp {
  status_code?: number;
  status_msg?: string;
}

interface UploadResponse {
  file?: ApiFileObject;
  base_resp?: ApiBaseResp;
}

interface RetrieveResponse {
  file?: ApiFileObject;
  base_resp?: ApiBaseResp;
}

interface ListResponse {
  files?: ApiFileObject[];
  base_resp?: ApiBaseResp;
}

interface DeleteResponse {
  file_id?: number | string;
  base_resp?: ApiBaseResp;
}

// ─── Internal helpers ───

function getApiKey(): string | null {
  try {
    const key = config.get('MINIMAX_API_KEY');
    return key || null;
  } catch {
    return process.env.MINIMAX_API_KEY || null;
  }
}

function parseFileObject(raw: ApiFileObject): MiniMaxFile {
  return {
    fileId: String(raw.file_id ?? ''),
    bytes: raw.bytes ?? 0,
    createdAt: raw.created_at ?? 0,
    filename: raw.filename ?? '',
    purpose: raw.purpose ?? '',
    downloadUrl: raw.download_url,
  };
}

function checkApiError(baseResp: ApiBaseResp | undefined): Result<void> | null {
  if (!baseResp) return null;
  if (baseResp.status_code !== undefined && baseResp.status_code !== 0) {
    const retryable = baseResp.status_code === 1001 || baseResp.status_code === 1002 || baseResp.status_code === 1039;
    return err(
      'MINIMAX_API_ERROR',
      `MiniMax Files API error: ${baseResp.status_msg || `status code ${baseResp.status_code}`}`,
      { retryable, context: { statusCode: baseResp.status_code } },
    );
  }
  return null;
}

async function handleHttpError(response: Response): Promise<Result<never>> {
  const errorText = await response.text().catch(() => 'Failed to read error body');
  log.error(
    { status: response.status, statusText: response.statusText, errorText },
    'MiniMax Files API returned HTTP error',
  );
  const retryable = response.status >= 500 || response.status === 429;
  return err(
    'MINIMAX_HTTP_ERROR',
    `MiniMax Files API returned HTTP ${response.status}: ${response.statusText}`,
    { retryable, context: { status: response.status } },
  );
}

function handleFetchError(error: unknown, operation: string, startTime: number): Result<never> {
  const duration = Date.now() - startTime;
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout =
    error instanceof Error &&
    (error.name.toLowerCase().includes('timeout') ||
      error.name === 'AbortError' ||
      error.message.toLowerCase().includes('timed out'));

  if (isTimeout) {
    log.warn({ duration, operation }, 'MiniMax Files API request timed out');
    return err('MINIMAX_TIMEOUT', `MiniMax Files ${operation} timed out`, { retryable: true, context: { duration } });
  }

  log.error({ duration, error: message, operation }, 'MiniMax Files API failed (network error)');
  return err('MINIMAX_NETWORK_ERROR', `MiniMax Files ${operation} network error: ${message}`, { retryable: true, context: { duration } });
}

// ─── Public API ───

/**
 * Upload a file to MiniMax for a specific purpose.
 *
 * @param fileBuffer - Raw file data
 * @param filename - Original filename (used by API for metadata)
 * @param purpose - File purpose category
 * @returns Result containing the uploaded file metadata
 */
export async function uploadFile(
  fileBuffer: Buffer,
  filename: string,
  purpose: FilePurpose,
): Promise<Result<MiniMaxFile>> {
  const startTime = Date.now();

  const apiKey = getApiKey();
  if (!apiKey) {
    return err('MINIMAX_NOT_CONFIGURED', 'MiniMax API key is not configured.', { retryable: false });
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    return err('INVALID_INPUT', 'File buffer must not be empty', { retryable: false });
  }

  if (fileBuffer.length > MAX_UPLOAD_SIZE) {
    return err(
      'INVALID_INPUT',
      `File exceeds maximum upload size of ${MAX_UPLOAD_SIZE} bytes (got ${fileBuffer.length})`,
      { retryable: false },
    );
  }

  if (!filename || filename.trim().length === 0) {
    return err('INVALID_INPUT', 'Filename must not be empty', { retryable: false });
  }

  const formData = new FormData();
  formData.append('purpose', purpose);
  formData.append('file', new Blob([new Uint8Array(fileBuffer)]), filename);

  log.info({ filename, purpose, bytes: fileBuffer.length }, 'Uploading file to MiniMax');

  try {
    const response = await fetch(`${MINIMAX_FILES_BASE}/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return handleHttpError(response);

    const body = (await response.json()) as UploadResponse;
    const apiErr = checkApiError(body.base_resp);
    if (apiErr) return apiErr as Result<never>;

    if (!body.file?.file_id) {
      return err('MINIMAX_INVALID_RESPONSE', 'Upload response missing file object', { retryable: false });
    }

    const file = parseFileObject(body.file);
    const duration = Date.now() - startTime;
    log.info({ duration, fileId: file.fileId, bytes: file.bytes }, 'File uploaded successfully');
    broadcastLog('info', `File uploaded: ${filename} (${file.bytes} bytes)`, 'ai:minimax-files');
    return ok(file);
  } catch (error: unknown) {
    return handleFetchError(error, 'upload', startTime);
  }
}

/**
 * Retrieve file metadata by ID.
 *
 * @param fileId - The file's unique identifier
 * @returns Result containing file metadata (including download URL if available)
 */
export async function retrieveFile(fileId: string): Promise<Result<MiniMaxFile>> {
  const startTime = Date.now();

  const apiKey = getApiKey();
  if (!apiKey) {
    return err('MINIMAX_NOT_CONFIGURED', 'MiniMax API key is not configured.', { retryable: false });
  }

  if (!fileId || fileId.trim().length === 0) {
    return err('INVALID_INPUT', 'File ID must not be empty', { retryable: false });
  }

  log.info({ fileId }, 'Retrieving file metadata from MiniMax');

  try {
    const url = `${MINIMAX_FILES_BASE}/retrieve?file_id=${encodeURIComponent(fileId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return handleHttpError(response);

    const body = (await response.json()) as RetrieveResponse;
    const apiErr = checkApiError(body.base_resp);
    if (apiErr) return apiErr as Result<never>;

    if (!body.file?.file_id) {
      return err('MINIMAX_INVALID_RESPONSE', 'Retrieve response missing file object', { retryable: false });
    }

    const file = parseFileObject(body.file);
    const duration = Date.now() - startTime;
    log.info({ duration, fileId: file.fileId }, 'File metadata retrieved');
    return ok(file);
  } catch (error: unknown) {
    return handleFetchError(error, 'retrieve', startTime);
  }
}

/**
 * List files by purpose category.
 *
 * @param purpose - Filter files by purpose
 * @returns Result containing array of file metadata
 */
export async function listFiles(purpose: FilePurpose): Promise<Result<MiniMaxFile[]>> {
  const startTime = Date.now();

  const apiKey = getApiKey();
  if (!apiKey) {
    return err('MINIMAX_NOT_CONFIGURED', 'MiniMax API key is not configured.', { retryable: false });
  }

  log.info({ purpose }, 'Listing files from MiniMax');

  try {
    const url = `${MINIMAX_FILES_BASE}/list?purpose=${encodeURIComponent(purpose)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return handleHttpError(response);

    const body = (await response.json()) as ListResponse;
    const apiErr = checkApiError(body.base_resp);
    if (apiErr) return apiErr as Result<never>;

    const files = (body.files ?? []).map(parseFileObject);
    const duration = Date.now() - startTime;
    log.info({ duration, count: files.length, purpose }, 'Files listed');
    return ok(files);
  } catch (error: unknown) {
    return handleFetchError(error, 'list', startTime);
  }
}

/**
 * Delete a file by ID and purpose.
 *
 * @param fileId - The file's unique identifier
 * @param purpose - The file's purpose (required by API)
 * @returns Result with the deleted file ID
 */
export async function deleteFile(fileId: string, purpose: FilePurpose): Promise<Result<{ fileId: string }>> {
  const startTime = Date.now();

  const apiKey = getApiKey();
  if (!apiKey) {
    return err('MINIMAX_NOT_CONFIGURED', 'MiniMax API key is not configured.', { retryable: false });
  }

  if (!fileId || fileId.trim().length === 0) {
    return err('INVALID_INPUT', 'File ID must not be empty', { retryable: false });
  }

  const numericId = Number(fileId);
  if (Number.isNaN(numericId)) {
    return err('INVALID_INPUT', 'File ID must be a numeric value', { retryable: false });
  }

  log.info({ fileId, purpose }, 'Deleting file from MiniMax');

  try {
    const response = await fetch(`${MINIMAX_FILES_BASE}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ file_id: numericId, purpose }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return handleHttpError(response);

    const body = (await response.json()) as DeleteResponse;
    const apiErr = checkApiError(body.base_resp);
    if (apiErr) return apiErr as Result<never>;

    const duration = Date.now() - startTime;
    log.info({ duration, fileId }, 'File deleted');
    broadcastLog('info', `File deleted: ${fileId}`, 'ai:minimax-files');
    return ok({ fileId: String(body.file_id ?? fileId) });
  } catch (error: unknown) {
    return handleFetchError(error, 'delete', startTime);
  }
}

/**
 * Check whether the MiniMax file management service is available.
 */
export function isFileManagementAvailable(): boolean {
  return !!getApiKey();
}
