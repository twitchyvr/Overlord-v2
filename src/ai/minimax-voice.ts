/**
 * MiniMax Voice Cloning & Voice Design Service
 *
 * Clone voices from audio samples or design new voices from text descriptions.
 * Cloned/designed voice IDs can be used with the Speech/T2A service for synthesis.
 *
 * API: https://api.minimax.io/v1/voice_clone
 * Auth: Bearer token via MINIMAX_API_KEY
 *
 * Voice ID constraints:
 *   - 8-256 characters
 *   - Must start with a letter
 *   - Alphanumeric, hyphens, underscores only
 *   - Cannot end with hyphen or underscore
 *
 * Cloned voice audio requirements:
 *   - Format: MP3, M4A, or WAV
 *   - Duration: 10 seconds to 5 minutes
 *   - File size: ≤ 20 MB
 *   - Recommended: 16 kHz or 48 kHz sample rate
 *
 * Note: Cloned voices expire after 7 days if not used in synthesis.
 *
 * Layer: AI (depends on Core only)
 */

import { logger, broadcastLog } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import { config } from '../core/config.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'ai:minimax-voice' });

const MINIMAX_VOICE_CLONE_URL = 'https://api.minimax.io/v1/voice_clone';
const FETCH_TIMEOUT_MS = 120_000; // 2 min — voice cloning can be slow
const MAX_PREVIEW_TEXT_LENGTH = 500;
const MAX_PREVIEW_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB max decoded preview audio

// Voice ID: 8-256 chars, starts with letter, alphanumeric + hyphens/underscores, no trailing - or _
const VOICE_ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{6,254}[a-zA-Z0-9]$/;

// ─── Types ───

export interface VoiceCloneOptions {
  /** Apply noise reduction to source audio (default: false) */
  noiseReduction?: boolean;
  /** Normalize volume levels (default: false) */
  volumeNormalization?: boolean;
  /** Speech model for preview synthesis (default: 'speech-2.8-hd') */
  model?: 'speech-2.8-hd' | 'speech-2.8-turbo';
}

export interface VoiceCloneResult {
  /** The custom voice ID (usable with T2A synthesis) */
  voiceId: string;
  /** Preview audio as a Buffer (synthesized from preview text) */
  previewAudio: Buffer;
  /** Clone status: 1=synthesizing, 2=complete */
  status: number;
}

export interface VoiceDesignResult {
  /** The generated custom voice ID */
  voiceId: string;
  /** Preview audio as a Buffer */
  previewAudio: Buffer;
  /** Voice profile characteristics extracted by the API */
  voiceProfile?: {
    gender?: string;
    tone?: string;
    characteristics?: string[];
  };
}

interface VoiceCloneResponse {
  data?: {
    audio?: string; // hex-encoded audio
    voice_id?: string;
    status?: number; // 1=synthesizing, 2=complete
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
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

function getGroupId(): string | null {
  try {
    const gid = config.get('MINIMAX_GROUP_ID');
    return gid || null;
  } catch {
    return process.env.MINIMAX_GROUP_ID || null;
  }
}

function validateVoiceId(voiceId: string): Result<void> | null {
  if (!voiceId || voiceId.trim().length === 0) {
    return err('INVALID_INPUT', 'Voice ID must not be empty', { retryable: false });
  }
  if (voiceId.length < 8 || voiceId.length > 256) {
    return err('INVALID_INPUT', 'Voice ID must be 8-256 characters', { retryable: false });
  }
  if (!VOICE_ID_REGEX.test(voiceId)) {
    return err(
      'INVALID_INPUT',
      'Voice ID must start with a letter, contain only alphanumeric/hyphens/underscores, and not end with hyphen or underscore',
      { retryable: false },
    );
  }
  return null;
}

function checkApiError(baseResp: VoiceCloneResponse['base_resp']): Result<void> | null {
  if (!baseResp) return null;
  if (baseResp.status_code !== undefined && baseResp.status_code !== 0) {
    const retryable = baseResp.status_code === 1001 || baseResp.status_code === 1002 || baseResp.status_code === 1039;
    return err(
      'MINIMAX_API_ERROR',
      `MiniMax Voice API error: ${baseResp.status_msg || `status code ${baseResp.status_code}`}`,
      { retryable, context: { statusCode: baseResp.status_code } },
    );
  }
  return null;
}

function decodeHexAudio(hexStr: string): Result<Buffer> {
  if (!hexStr || hexStr.length === 0) {
    return err('MINIMAX_EMPTY_RESPONSE', 'Voice API returned no audio data', { retryable: true });
  }

  if (hexStr.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hexStr)) {
    return err('MINIMAX_INVALID_RESPONSE', 'Voice API returned invalid hex-encoded audio', { retryable: false });
  }

  const decodedSize = hexStr.length / 2;
  if (decodedSize > MAX_PREVIEW_AUDIO_SIZE) {
    return err(
      'MINIMAX_RESPONSE_TOO_LARGE',
      `Voice preview audio too large: ${decodedSize} bytes (max ${MAX_PREVIEW_AUDIO_SIZE})`,
      { retryable: false },
    );
  }

  return ok(Buffer.from(hexStr, 'hex'));
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
    log.warn({ duration, operation }, 'MiniMax Voice API request timed out');
    return err('MINIMAX_TIMEOUT', `MiniMax Voice ${operation} timed out`, { retryable: true, context: { duration } });
  }

  log.error({ duration, error: message, operation }, 'MiniMax Voice API failed (network error)');
  return err('MINIMAX_NETWORK_ERROR', `MiniMax Voice ${operation} network error: ${message}`, { retryable: true, context: { duration } });
}

// ─── Public API ───

/**
 * Clone a voice from an uploaded audio file.
 *
 * The audio file must already be uploaded via the File Management API
 * with purpose 'voice_clone'. Use the returned file_id here.
 *
 * @param fileId - MiniMax file ID of the uploaded audio sample
 * @param voiceId - Custom voice identifier (8-256 chars, starts with letter)
 * @param previewText - Text to synthesize as a preview of the cloned voice
 * @param opts - Optional settings (noise reduction, volume normalization)
 * @returns Result containing the voice ID and preview audio
 */
export async function cloneVoice(
  fileId: string,
  voiceId: string,
  previewText: string,
  opts: VoiceCloneOptions = {},
): Promise<Result<VoiceCloneResult>> {
  const startTime = Date.now();

  const apiKey = getApiKey();
  if (!apiKey) {
    return err('MINIMAX_NOT_CONFIGURED', 'MiniMax API key is not configured.', { retryable: false });
  }

  // Validate inputs
  if (!fileId || fileId.trim().length === 0) {
    return err('INVALID_INPUT', 'File ID must not be empty', { retryable: false });
  }

  const voiceIdErr = validateVoiceId(voiceId);
  if (voiceIdErr) return voiceIdErr as Result<never>;

  if (!previewText || previewText.trim().length === 0) {
    return err('INVALID_INPUT', 'Preview text must not be empty', { retryable: false });
  }

  if (previewText.length > MAX_PREVIEW_TEXT_LENGTH) {
    return err(
      'INVALID_INPUT',
      `Preview text exceeds maximum length of ${MAX_PREVIEW_TEXT_LENGTH} characters (got ${previewText.length})`,
      { retryable: false },
    );
  }

  // Build URL with optional group_id
  let url = MINIMAX_VOICE_CLONE_URL;
  const groupId = getGroupId();
  if (groupId) {
    url = `${MINIMAX_VOICE_CLONE_URL}?GroupId=${encodeURIComponent(groupId)}`;
  }

  const requestBody = {
    file_id: fileId,
    voice_id: voiceId,
    text: previewText,
    model: opts.model || 'speech-2.8-hd',
    ...(opts.noiseReduction ? { need_noise_reduction: true } : {}),
    // Note: "volumn" is the MiniMax API's spelling (their typo, not ours)
    ...(opts.volumeNormalization ? { need_volumn_normalization: true } : {}),
  };

  log.info({ fileId, voiceId, previewTextLength: previewText.length }, 'Cloning voice via MiniMax');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Failed to read error body');
      log.error(
        { status: response.status, statusText: response.statusText, errorText },
        'MiniMax Voice Clone API returned HTTP error',
      );
      const retryable = response.status >= 500 || response.status === 429;
      return err(
        'MINIMAX_HTTP_ERROR',
        `MiniMax Voice Clone API returned HTTP ${response.status}: ${response.statusText}`,
        { retryable, context: { status: response.status } },
      );
    }

    const body = (await response.json()) as VoiceCloneResponse;
    const apiErr = checkApiError(body.base_resp);
    if (apiErr) return apiErr as Result<never>;

    if (!body.data?.audio) {
      return err('MINIMAX_EMPTY_RESPONSE', 'Voice clone response missing audio data', { retryable: true });
    }

    const audioResult = decodeHexAudio(body.data.audio);
    if (!audioResult.ok) return audioResult as Result<never>;

    const result: VoiceCloneResult = {
      voiceId: body.data.voice_id || voiceId,
      previewAudio: audioResult.data,
      status: body.data.status ?? 2,
    };

    const duration = Date.now() - startTime;
    log.info({ duration, voiceId: result.voiceId, audioSize: result.previewAudio.length, status: result.status }, 'Voice cloned successfully');
    broadcastLog('info', `Voice cloned: ${result.voiceId} (${duration}ms)`, 'ai:minimax-voice');
    return ok(result);
  } catch (error: unknown) {
    return handleFetchError(error, 'clone', startTime);
  }
}

/**
 * Design a voice from a natural language description.
 *
 * Uses MiniMax's voice generation to create a custom voice matching
 * the given description. Returns a preview audio and voice ID that
 * can be used with the T2A synthesis service.
 *
 * @param description - Natural language voice description (e.g., "warm female voice, mid-30s, professional tone")
 * @param previewText - Text to synthesize as a preview
 * @param voiceId - Optional custom voice ID (auto-generated if omitted)
 * @returns Result containing the voice ID and preview audio
 */
export async function designVoice(
  description: string,
  previewText: string,
  voiceId?: string,
): Promise<Result<VoiceDesignResult>> {
  const startTime = Date.now();

  const apiKey = getApiKey();
  if (!apiKey) {
    return err('MINIMAX_NOT_CONFIGURED', 'MiniMax API key is not configured.', { retryable: false });
  }

  // Validate inputs
  if (!description || description.trim().length === 0) {
    return err('INVALID_INPUT', 'Voice description must not be empty', { retryable: false });
  }

  if (description.length > 1000) {
    return err('INVALID_INPUT', 'Voice description exceeds maximum length of 1000 characters', { retryable: false });
  }

  if (!previewText || previewText.trim().length === 0) {
    return err('INVALID_INPUT', 'Preview text must not be empty', { retryable: false });
  }

  if (previewText.length > MAX_PREVIEW_TEXT_LENGTH) {
    return err(
      'INVALID_INPUT',
      `Preview text exceeds maximum length of ${MAX_PREVIEW_TEXT_LENGTH} characters (got ${previewText.length})`,
      { retryable: false },
    );
  }

  if (voiceId) {
    const voiceIdErr = validateVoiceId(voiceId);
    if (voiceIdErr) return voiceIdErr as Result<never>;
  }

  // Build URL with optional group_id
  let url = 'https://api.minimax.io/v1/voice_generation';
  const groupId = getGroupId();
  if (groupId) {
    url = `${url}?GroupId=${encodeURIComponent(groupId)}`;
  }

  const requestBody: Record<string, unknown> = {
    voice_description: description,
    text: previewText,
    model: 'speech-2.8-hd',
  };

  if (voiceId) {
    requestBody.voice_id = voiceId;
  }

  log.info({ descriptionLength: description.length, previewTextLength: previewText.length, voiceId: voiceId || '(auto)' }, 'Designing voice via MiniMax');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Failed to read error body');
      log.error(
        { status: response.status, statusText: response.statusText, errorText },
        'MiniMax Voice Design API returned HTTP error',
      );
      const retryable = response.status >= 500 || response.status === 429;
      return err(
        'MINIMAX_HTTP_ERROR',
        `MiniMax Voice Design API returned HTTP ${response.status}: ${response.statusText}`,
        { retryable, context: { status: response.status } },
      );
    }

    const body = (await response.json()) as VoiceCloneResponse;
    const apiErr = checkApiError(body.base_resp);
    if (apiErr) return apiErr as Result<never>;

    if (!body.data?.audio) {
      return err('MINIMAX_EMPTY_RESPONSE', 'Voice design response missing audio data', { retryable: true });
    }

    const audioResult = decodeHexAudio(body.data.audio);
    if (!audioResult.ok) return audioResult as Result<never>;

    const result: VoiceDesignResult = {
      voiceId: body.data.voice_id || voiceId || 'auto-generated',
      previewAudio: audioResult.data,
    };

    const duration = Date.now() - startTime;
    log.info({ duration, voiceId: result.voiceId, audioSize: result.previewAudio.length }, 'Voice designed successfully');
    broadcastLog('info', `Voice designed: ${result.voiceId} (${duration}ms)`, 'ai:minimax-voice');
    return ok(result);
  } catch (error: unknown) {
    return handleFetchError(error, 'design', startTime);
  }
}

/**
 * Check whether the MiniMax voice service is available.
 */
export function isVoiceServiceAvailable(): boolean {
  return !!getApiKey();
}
