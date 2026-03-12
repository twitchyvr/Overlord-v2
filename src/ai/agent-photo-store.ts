/**
 * Agent Photo Store
 *
 * Manages writing and reading agent profile photos on disk.
 * Photos are stored as JPEG files at data/agent-photos/{agentId}.jpg
 * and served via Express static middleware or a dedicated route.
 *
 * Layer: AI (depends on Core only)
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'ai:agent-photo-store' });

// ─── Constants ───

/** Base directory for agent photo storage (relative to project root) */
const PHOTOS_DIR = resolve('data', 'agent-photos');

/** URL path prefix for serving agent photos */
const PHOTOS_URL_PREFIX = '/api/agent-photos';

// ─── Directory Initialization ───

/**
 * Ensure the photos directory exists. Creates it if necessary.
 * Called lazily on first write to avoid creating empty directories.
 */
function ensurePhotosDir(): void {
  if (!existsSync(PHOTOS_DIR)) {
    mkdirSync(PHOTOS_DIR, { recursive: true });
    log.info({ dir: PHOTOS_DIR }, 'Created agent photos directory');
  }
}

// ─── Public API ───

/**
 * Write a base64-encoded JPEG image to disk for the given agent.
 *
 * @param agentId - The agent's unique identifier (used as filename)
 * @param base64Data - The base64-encoded JPEG image data (without data URI prefix)
 * @returns Result containing the photo URL for serving
 */
export function writeAgentPhoto(
  agentId: string,
  base64Data: string,
): Result<{ filePath: string; photoUrl: string }> {
  try {
    // Validate inputs
    if (!agentId || agentId.trim().length === 0) {
      return err('INVALID_AGENT_ID', 'Agent ID must not be empty', { retryable: false });
    }

    if (!base64Data || base64Data.length === 0) {
      return err('EMPTY_PHOTO_DATA', 'Photo data must not be empty', { retryable: false });
    }

    // Sanitize agentId for filesystem safety — allow only alphanumeric, underscore, hyphen
    const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (safeId !== agentId) {
      log.warn({ agentId, safeId }, 'Agent ID sanitized for filesystem safety');
    }

    ensurePhotosDir();

    const fileName = `${safeId}.jpg`;
    const filePath = join(PHOTOS_DIR, fileName);
    const photoUrl = `${PHOTOS_URL_PREFIX}/${fileName}`;

    // Decode base64 and write to disk
    const buffer = Buffer.from(base64Data, 'base64');

    // Basic JPEG validation: check for JPEG magic bytes (FFD8FF)
    if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
      log.warn({ agentId, bufferLength: buffer.length }, 'Photo data does not appear to be a valid JPEG');
      // Still write it — MiniMax may use a different format header, and we
      // don't want to block photo storage on strict validation
    }

    writeFileSync(filePath, buffer);

    log.info(
      { agentId, filePath, sizeBytes: buffer.length },
      'Agent photo written to disk',
    );

    return ok({ filePath, photoUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ agentId, error: message }, 'Failed to write agent photo to disk');
    return err('PHOTO_WRITE_ERROR', `Failed to write agent photo: ${message}`, { retryable: false });
  }
}

/**
 * Delete an agent's photo from disk.
 *
 * @param agentId - The agent's unique identifier
 * @returns Result indicating success or failure
 */
export function deleteAgentPhoto(agentId: string): Result<{ deleted: boolean }> {
  try {
    const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = join(PHOTOS_DIR, `${safeId}.jpg`);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
      log.info({ agentId, filePath }, 'Agent photo deleted from disk');
      return ok({ deleted: true });
    }

    return ok({ deleted: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ agentId, error: message }, 'Failed to delete agent photo from disk');
    return err('PHOTO_DELETE_ERROR', `Failed to delete agent photo: ${message}`, { retryable: false });
  }
}

/**
 * Get the filesystem path for an agent's photo.
 * Returns null if the photo does not exist on disk.
 */
export function getAgentPhotoPath(agentId: string): string | null {
  const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = join(PHOTOS_DIR, `${safeId}.jpg`);
  return existsSync(filePath) ? filePath : null;
}

/**
 * Get the URL for serving an agent's photo.
 * Returns the URL regardless of whether the photo exists on disk
 * (caller should check existence first if needed).
 */
export function getAgentPhotoUrl(agentId: string): string {
  const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${PHOTOS_URL_PREFIX}/${safeId}.jpg`;
}

/**
 * Get the base directory path for agent photos.
 * Used by the server to mount express.static middleware.
 */
export function getPhotosDirectory(): string {
  return PHOTOS_DIR;
}

/**
 * Get the URL prefix for the photos route.
 * Used by the server to mount the static middleware at the correct path.
 */
export function getPhotosUrlPrefix(): string {
  return PHOTOS_URL_PREFIX;
}
