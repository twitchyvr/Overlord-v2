/**
 * MiniMax Image Generation Service
 *
 * Calls the MiniMax Image Generation API (image-01 model) for text-to-image
 * and image-to-image generation. Used primarily for agent profile photos.
 *
 * API: https://api.minimax.io/v1/image_generation
 * Auth: Bearer token via MINIMAX_API_KEY
 *
 * Layer: AI (depends on Core only)
 */

import { logger, broadcastLog } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import { config } from '../core/config.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'ai:minimax-image' });

const MINIMAX_IMAGE_API_URL = 'https://api.minimax.io/v1/image_generation';
const MINIMAX_IMAGE_MODEL = 'image-01';

// ─── Types ───

export interface ImageGenerationResult {
  base64: string;
  mimeType: 'image/jpeg';
}

export interface GenerateAgentPhotoOptions {
  /** URL of a reference image for subject-consistent generation */
  subjectReference?: string;
  /** Aspect ratio for the generated image (default: "1:1") */
  aspectRatio?: string;
}

interface MiniMaxImageResponse {
  data: {
    image_base64: string[];
  };
}

interface MiniMaxImageErrorResponse {
  error?: {
    message?: string;
    code?: string;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

// ─── Internal helpers ───

/**
 * Retrieve the MiniMax API key from the config service.
 * Returns null if not configured.
 */
function getApiKey(): string | null {
  try {
    const key = config.get('MINIMAX_API_KEY');
    return key || null;
  } catch {
    // Config might not be validated yet; fall back to env
    return process.env.MINIMAX_API_KEY || null;
  }
}

/**
 * Build the request body for the MiniMax image generation API.
 */
function buildRequestBody(
  prompt: string,
  opts: GenerateAgentPhotoOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: MINIMAX_IMAGE_MODEL,
    prompt,
    aspect_ratio: opts.aspectRatio || '1:1',
    response_format: 'base64',
    prompt_optimizer: true, // Auto-enhance prompts for better results (#1225)
  };

  if (opts.subjectReference) {
    body.subject_reference = [
      {
        type: 'character',
        image_file: opts.subjectReference,
      },
    ];
  }

  return body;
}

/**
 * Parse and validate the MiniMax API response.
 */
function parseResponse(
  responseBody: unknown,
): Result<ImageGenerationResult> {
  const body = responseBody as MiniMaxImageResponse & MiniMaxImageErrorResponse;

  // Check for API-level error in response body
  if (body.error?.message) {
    return err(
      'MINIMAX_API_ERROR',
      `MiniMax image API error: ${body.error.message}`,
      { retryable: true, context: { code: body.error.code } },
    );
  }

  if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
    return err(
      'MINIMAX_API_ERROR',
      `MiniMax image API error: ${body.base_resp.status_msg || 'Unknown error'}`,
      { retryable: true, context: { statusCode: body.base_resp.status_code } },
    );
  }

  // Validate response structure
  if (!body.data?.image_base64 || !Array.isArray(body.data.image_base64)) {
    return err(
      'MINIMAX_INVALID_RESPONSE',
      'MiniMax image API returned an unexpected response structure',
      { retryable: false },
    );
  }

  if (body.data.image_base64.length === 0) {
    return err(
      'MINIMAX_EMPTY_RESPONSE',
      'MiniMax image API returned no images',
      { retryable: true },
    );
  }

  const base64 = body.data.image_base64[0];
  if (!base64 || typeof base64 !== 'string' || base64.length === 0) {
    return err(
      'MINIMAX_EMPTY_RESPONSE',
      'MiniMax image API returned an empty image',
      { retryable: true },
    );
  }

  return ok({ base64, mimeType: 'image/jpeg' as const });
}

// ─── Public API ───

/**
 * Generate an agent profile photo using the MiniMax image generation API.
 *
 * @param prompt - Text description of the desired image
 * @param opts - Optional configuration (subject reference, aspect ratio)
 * @returns Result containing base64-encoded JPEG image data
 */
export async function generateAgentPhoto(
  prompt: string,
  opts: GenerateAgentPhotoOptions = {},
): Promise<Result<ImageGenerationResult>> {
  const startTime = Date.now();

  // Validate API key
  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('MINIMAX_API_KEY is not configured — cannot generate image');
    return err(
      'MINIMAX_NOT_CONFIGURED',
      'MiniMax API key is not configured. Set MINIMAX_API_KEY in environment.',
      { retryable: false },
    );
  }

  // Validate prompt
  if (!prompt || prompt.trim().length === 0) {
    return err(
      'INVALID_PROMPT',
      'Image generation prompt must not be empty',
      { retryable: false },
    );
  }

  const requestBody = buildRequestBody(prompt, opts);

  log.info(
    {
      promptLength: prompt.length,
      hasSubjectRef: !!opts.subjectReference,
      aspectRatio: opts.aspectRatio || '1:1',
    },
    'Sending MiniMax image generation request',
  );

  try {
    const response = await fetch(MINIMAX_IMAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Failed to read error body');
      log.error(
        { status: response.status, statusText: response.statusText, errorText },
        'MiniMax image API returned HTTP error',
      );

      // Determine retryability based on status code
      const retryable = response.status >= 500 || response.status === 429;

      return err(
        'MINIMAX_HTTP_ERROR',
        `MiniMax image API returned HTTP ${response.status}: ${response.statusText}`,
        { retryable, context: { status: response.status, statusText: response.statusText } },
      );
    }

    const responseBody: unknown = await response.json();
    const result = parseResponse(responseBody);

    const duration = Date.now() - startTime;

    if (result.ok) {
      log.info(
        { duration, base64Length: result.data.base64.length },
        'MiniMax image generated successfully',
      );
      broadcastLog('info', `Agent photo generated (${duration}ms)`, 'ai:minimax-image');
    } else {
      log.warn(
        { duration, error: result.error },
        'MiniMax image generation failed (API-level error)',
      );
    }

    return result;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout =
      error instanceof Error &&
      (error.name.toLowerCase().includes('timeout') ||
        error.name === 'AbortError' ||
        error.message.toLowerCase().includes('timed out'));

    if (isTimeout) {
      log.warn({ duration }, 'MiniMax image generation request timed out');
      return err(
        'MINIMAX_TIMEOUT',
        'MiniMax image generation request timed out',
        { retryable: true, context: { duration } },
      );
    }

    log.error(
      { duration, error: message },
      'MiniMax image generation failed (network/fetch error)',
    );
    return err(
      'MINIMAX_NETWORK_ERROR',
      `MiniMax image generation network error: ${message}`,
      { retryable: true, context: { duration } },
    );
  }
}

/**
 * Check whether the MiniMax image generation service is available
 * (i.e., the API key is configured).
 */
export function isImageGenerationAvailable(): boolean {
  return !!getApiKey();
}
