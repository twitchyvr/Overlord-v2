/**
 * MiniMax Text-to-Audio (T2A) Service
 *
 * Converts text to speech using MiniMax's T2A v2 API.
 * Supports 300+ voices, emotion control, speed/pitch tuning,
 * and multiple audio formats (mp3, wav, flac, pcm).
 *
 * API: POST https://api.minimax.io/v1/t2a_v2
 * Auth: Bearer token via MINIMAX_API_KEY
 * Models: speech-2.8-hd ($100/M chars), speech-2.8-turbo ($60/M chars)
 *
 * Limits:
 * - Max 10,000 characters per request
 * - Streaming recommended for >3,000 characters
 *
 * Layer: AI (depends on Core only)
 */

import { logger, broadcastLog } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import { config } from '../core/config.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'ai:minimax-speech' });

const MINIMAX_T2A_URL = 'https://api.minimax.io/v1/t2a_v2';
const MAX_TEXT_LENGTH = 10_000;
const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB max decoded audio
const FETCH_TIMEOUT_MS = 60_000; // 60s timeout for speech synthesis

// ─── Types ───

export type SpeechModel = 'speech-2.8-hd' | 'speech-2.8-turbo';
export type SpeechEmotion = 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'calm' | 'fluent' | 'whisper';
export type AudioFormat = 'mp3' | 'pcm' | 'flac' | 'wav';

export type SoundEffect = 'spacious_echo' | 'auditorium_echo' | 'lofi_telephone' | 'robotic';

export interface VoiceModify {
  /** Pitch shift -100 to 100 */
  pitch?: number;
  /** Intensity -100 to 100 */
  intensity?: number;
  /** Timbre shift -100 to 100 */
  timbre?: number;
}

export interface TimbreWeight {
  /** Voice ID to blend */
  voiceId: string;
  /** Weight 1-100 */
  weight: number;
}

export interface SpeechOptions {
  /** Voice ID — system voice or cloned voice (default: 'male-qn-qingse') */
  voiceId?: string;
  /** Speech model (default: 'speech-2.8-hd') */
  model?: SpeechModel;
  /** Speed multiplier 0.5-2.0 (default: 1.0) */
  speed?: number;
  /** Volume 0-10 (default: 1) */
  vol?: number;
  /** Pitch shift -12 to 12 semitones (default: 0) */
  pitch?: number;
  /** Emotion preset */
  emotion?: SpeechEmotion;
  /** Output audio format (default: 'mp3') */
  format?: AudioFormat;
  /** Sample rate in Hz (default: 32000) */
  sampleRate?: number;
  /** Bitrate in bps (default: 128000) */
  bitrate?: number;
  /** Language boost for non-Chinese text (e.g., 'English', 'Japanese') */
  languageBoost?: string;
  /** Sound effect applied to voice output (#1222) */
  soundEffect?: SoundEffect;
  /** Fine-tune voice pitch/intensity/timbre (#1222) */
  voiceModify?: VoiceModify;
  /** Blend up to 4 voices with weights (#1222) */
  timbreWeights?: TimbreWeight[];
  /** Generate subtitles alongside audio (#1222) */
  subtitleEnable?: boolean;
  /** Custom pronunciation rules for project jargon (#1222) */
  pronunciationTones?: Array<{ text: string; pronunciation: string }>;
}

export interface SpeechResult {
  /** Raw audio data as a Buffer */
  audio: Buffer;
  /** MIME type of the audio */
  mimeType: string;
  /** Audio duration in milliseconds (if reported by API) */
  durationMs?: number;
  /** Sample rate used */
  sampleRate?: number;
  /** Number of characters synthesized */
  charCount: number;
}

interface T2AResponseData {
  data?: {
    audio?: string;  // hex-encoded audio
    status?: number; // 1=synthesizing, 2=complete
    extra_info?: {
      audio_length?: number;
      audio_sample_rate?: number;
      audio_size?: number;
      bitrate?: number;
      word_count?: number;
    };
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

function getMimeType(format: AudioFormat): string {
  switch (format) {
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'pcm': return 'audio/pcm';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildRequestBody(text: string, opts: SpeechOptions = {}): Record<string, unknown> {
  // Voice setting — single voice or timbre blend (#1222)
  const voiceSetting: Record<string, unknown> = opts.timbreWeights && opts.timbreWeights.length > 0
    ? {
        // Timbre mixing: blend up to 4 voices
        timbre_weights: opts.timbreWeights.map(tw => ({
          voice_id: tw.voiceId,
          weight: clamp(tw.weight, 1, 100),
        })),
      }
    : {
        voice_id: opts.voiceId || 'male-qn-qingse',
      };

  // Common voice settings
  if (opts.speed !== undefined) voiceSetting.speed = clamp(opts.speed, 0.5, 2.0);
  if (opts.vol !== undefined) voiceSetting.vol = clamp(opts.vol, 0, 10);
  if (opts.pitch !== undefined) voiceSetting.pitch = clamp(opts.pitch, -12, 12);
  if (opts.emotion) voiceSetting.emotion = opts.emotion;

  const body: Record<string, unknown> = {
    model: opts.model || 'speech-2.8-hd',
    text,
    stream: false,
    voice_setting: voiceSetting,
    audio_setting: {
      format: opts.format || 'mp3',
      sample_rate: opts.sampleRate || 32000,
      bitrate: opts.bitrate || 128000,
      channel: 1,
    },
  };

  if (opts.languageBoost) {
    body.language_boost = opts.languageBoost;
  }

  // Voice personality features (#1222)
  if (opts.soundEffect) {
    body.sound_effect = opts.soundEffect;
  }
  if (opts.voiceModify) {
    body.voice_modify = {
      ...(opts.voiceModify.pitch !== undefined ? { pitch: clamp(opts.voiceModify.pitch, -100, 100) } : {}),
      ...(opts.voiceModify.intensity !== undefined ? { intensity: clamp(opts.voiceModify.intensity, -100, 100) } : {}),
      ...(opts.voiceModify.timbre !== undefined ? { timbre: clamp(opts.voiceModify.timbre, -100, 100) } : {}),
    };
  }
  if (opts.subtitleEnable) {
    body.subtitle_enable = true;
  }
  if (opts.pronunciationTones && opts.pronunciationTones.length > 0) {
    body.pronunciation_dict = {
      tone: opts.pronunciationTones,
    };
  }

  return body;
}

function parseResponse(responseBody: unknown, format: AudioFormat): Result<SpeechResult> {
  const body = responseBody as T2AResponseData;

  // Check for API error
  if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
    return err(
      'MINIMAX_API_ERROR',
      `MiniMax T2A API error: ${body.base_resp.status_msg || 'Unknown error'}`,
      { retryable: true, context: { statusCode: body.base_resp.status_code } },
    );
  }

  if (!body.data?.audio) {
    return err(
      'MINIMAX_EMPTY_RESPONSE',
      'MiniMax T2A API returned no audio data',
      { retryable: true },
    );
  }

  // Validate hex string before decoding
  const hexStr = body.data.audio;
  if (hexStr.length === 0 || hexStr.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hexStr)) {
    return err(
      'MINIMAX_INVALID_RESPONSE',
      'MiniMax T2A API returned invalid hex-encoded audio',
      { retryable: false },
    );
  }

  // Guard against excessively large audio responses (hex is 2x the decoded size)
  const decodedSize = hexStr.length / 2;
  if (decodedSize > MAX_AUDIO_SIZE) {
    return err(
      'MINIMAX_RESPONSE_TOO_LARGE',
      `MiniMax T2A audio response too large: ${decodedSize} bytes (max ${MAX_AUDIO_SIZE})`,
      { retryable: false },
    );
  }

  // Audio is hex-encoded — decode to Buffer
  const audioBuffer = Buffer.from(hexStr, 'hex');

  const extra = body.data.extra_info;
  return ok({
    audio: audioBuffer,
    mimeType: getMimeType(format),
    durationMs: extra?.audio_length,
    sampleRate: extra?.audio_sample_rate,
    charCount: extra?.word_count || 0,
  });
}

// ─── Public API ───

/**
 * Convert text to speech using MiniMax T2A API.
 *
 * @param text - Text to synthesize (max 10,000 characters)
 * @param opts - Voice, model, and audio settings
 * @returns Result containing audio Buffer and metadata
 */
export async function synthesizeSpeech(
  text: string,
  opts: SpeechOptions = {},
): Promise<Result<SpeechResult>> {
  const startTime = Date.now();

  // Validate API key
  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('MINIMAX_API_KEY is not configured — cannot synthesize speech');
    return err(
      'MINIMAX_NOT_CONFIGURED',
      'MiniMax API key is not configured. Set MINIMAX_API_KEY in environment.',
      { retryable: false },
    );
  }

  // Validate text
  if (!text || text.trim().length === 0) {
    return err('INVALID_INPUT', 'Speech text must not be empty', { retryable: false });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return err(
      'INVALID_INPUT',
      `Speech text exceeds maximum length of ${MAX_TEXT_LENGTH} characters (got ${text.length})`,
      { retryable: false },
    );
  }

  const format = opts.format || 'mp3';
  const requestBody = buildRequestBody(text, opts);

  // Build URL with optional group_id query param
  let url = MINIMAX_T2A_URL;
  const groupId = getGroupId();
  if (groupId) {
    url = `${MINIMAX_T2A_URL}?GroupId=${encodeURIComponent(groupId)}`;
  }

  log.info(
    {
      textLength: text.length,
      model: opts.model || 'speech-2.8-hd',
      voiceId: opts.voiceId || 'male-qn-qingse',
      format,
    },
    'Sending MiniMax T2A request',
  );

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
        'MiniMax T2A API returned HTTP error',
      );

      const retryable = response.status >= 500 || response.status === 429;
      return err(
        'MINIMAX_HTTP_ERROR',
        `MiniMax T2A API returned HTTP ${response.status}: ${response.statusText}`,
        { retryable, context: { status: response.status, statusText: response.statusText } },
      );
    }

    const responseBody: unknown = await response.json();
    const result = parseResponse(responseBody, format);

    const duration = Date.now() - startTime;

    if (result.ok) {
      log.info(
        {
          duration,
          audioSize: result.data.audio.length,
          durationMs: result.data.durationMs,
          charCount: result.data.charCount,
        },
        'MiniMax T2A synthesis complete',
      );
      broadcastLog('info', `Speech synthesized (${duration}ms, ${result.data.audio.length} bytes)`, 'ai:minimax-speech');
    } else {
      log.warn({ duration, error: result.error }, 'MiniMax T2A synthesis failed (API-level error)');
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
      log.warn({ duration }, 'MiniMax T2A request timed out');
      return err('MINIMAX_TIMEOUT', 'MiniMax T2A request timed out', { retryable: true, context: { duration } });
    }

    log.error({ duration, error: message }, 'MiniMax T2A failed (network/fetch error)');
    return err(
      'MINIMAX_NETWORK_ERROR',
      `MiniMax T2A network error: ${message}`,
      { retryable: true, context: { duration } },
    );
  }
}

/**
 * Check whether the MiniMax T2A service is available.
 */
export function isSpeechAvailable(): boolean {
  return !!getApiKey();
}

// ─── Async T2A Pro (#1221) ───────────────────────────────

export interface AsyncT2AOptions {
  voiceId?: string;
  model?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  audioFormat?: 'mp3' | 'wav' | 'flac';
  subtitleEnable?: boolean;
  pronunciationDict?: Record<string, string>;
}

export interface AsyncT2ATask {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
  subtitleUrl?: string;
  charCount?: number;
  durationMs?: number;
  error?: string;
}

/**
 * Submit a long text (up to 1M chars) for async T2A processing.
 * Returns a task ID that can be polled for status.
 */
export async function submitAsyncT2A(
  text: string,
  opts: AsyncT2AOptions = {},
): Promise<Result<{ taskId: string }>> {
  const apiKey = getApiKey();
  if (!apiKey) return err('NO_API_KEY', 'MiniMax API key not configured', { retryable: false });

  const baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat';
  const groupId = process.env.MINIMAX_GROUP_ID || '';

  try {
    const body: Record<string, unknown> = {
      model: opts.model || 'speech-02-hd',
      text,
      voice_setting: {
        voice_id: opts.voiceId || 'male-qn-qingse',
        speed: opts.speed ?? 1.0,
        vol: opts.volume ?? 1.0,
        pitch: opts.pitch ?? 0,
      },
      audio_setting: {
        format: opts.audioFormat || 'mp3',
        sample_rate: 32000,
      },
    };

    if (opts.subtitleEnable) {
      (body as Record<string, unknown>).subtitle_enable = true;
    }

    if (opts.pronunciationDict && Object.keys(opts.pronunciationDict).length > 0) {
      (body as Record<string, unknown>).pronunciation_dict = {
        tone: Object.entries(opts.pronunciationDict).map(([word, pinyin]) => ({
          word, tone: pinyin,
        })),
      };
    }

    const response = await fetch(`${baseUrl}/v1/t2a_pro?GroupId=${groupId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return err('T2A_SUBMIT_FAILED', `Async T2A submission failed: ${response.status} ${errText}`, { retryable: response.status >= 500 });
    }

    const data = await response.json() as { task_id?: string; base_resp?: { status_code?: number; status_msg?: string } };

    if (data.base_resp?.status_code !== 0 && data.base_resp?.status_code !== undefined) {
      return err('T2A_API_ERROR', data.base_resp.status_msg || 'Unknown T2A error', { retryable: false });
    }

    if (!data.task_id) {
      return err('T2A_NO_TASK_ID', 'No task_id in T2A response', { retryable: false });
    }

    log.info({ taskId: data.task_id, charCount: text.length }, 'Async T2A task submitted');
    return ok({ taskId: data.task_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('T2A_NETWORK_ERROR', `Async T2A network error: ${msg}`, { retryable: true });
  }
}

/**
 * Poll the status of an async T2A task.
 */
export async function pollAsyncT2A(taskId: string): Promise<Result<AsyncT2ATask>> {
  const apiKey = getApiKey();
  if (!apiKey) return err('NO_API_KEY', 'MiniMax API key not configured', { retryable: false });

  const baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat';
  const groupId = process.env.MINIMAX_GROUP_ID || '';

  try {
    const response = await fetch(`${baseUrl}/v1/t2a_pro/${taskId}?GroupId=${groupId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return err('T2A_POLL_FAILED', `T2A poll failed: ${response.status}`, { retryable: response.status >= 500 });
    }

    const data = await response.json() as {
      status?: number; // 0=processing, 1=completed, 2=failed
      file_url?: string;
      subtitle_url?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    };

    if (data.base_resp?.status_code !== 0 && data.base_resp?.status_code !== undefined) {
      return err('T2A_API_ERROR', data.base_resp.status_msg || 'Unknown T2A error', { retryable: false });
    }

    const statusMap: Record<number, AsyncT2ATask['status']> = {
      0: 'processing', 1: 'completed', 2: 'failed',
    };

    return ok({
      taskId,
      status: statusMap[data.status ?? 0] || 'pending',
      audioUrl: data.file_url,
      subtitleUrl: data.subtitle_url,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('T2A_NETWORK_ERROR', `T2A poll error: ${msg}`, { retryable: true });
  }
}

/**
 * Generate a project briefing as spoken audio.
 * Convenience wrapper: builds text summary → submits async T2A → returns task ID.
 */
export async function generateProjectBriefing(
  buildingName: string,
  phase: string,
  tasksDone: number,
  tasksTotal: number,
  activeRisks: number,
  agentSummary: string,
  opts: AsyncT2AOptions = {},
): Promise<Result<{ taskId: string }>> {
  const briefing = [
    `Project briefing for ${buildingName}.`,
    `The project is currently in the ${phase} phase.`,
    tasksTotal > 0
      ? `${tasksDone} of ${tasksTotal} tasks have been completed, that's ${Math.round((tasksDone / tasksTotal) * 100)} percent.`
      : 'No tasks have been created yet.',
    activeRisks > 0
      ? `There ${activeRisks === 1 ? 'is' : 'are'} ${activeRisks} active ${activeRisks === 1 ? 'risk' : 'risks'} to be aware of.`
      : 'No active risks have been identified.',
    agentSummary || 'The team is standing by.',
    'End of briefing.',
  ].join(' ');

  return submitAsyncT2A(briefing, opts);
}
