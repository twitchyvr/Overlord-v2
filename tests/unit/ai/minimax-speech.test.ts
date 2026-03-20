/**
 * MiniMax Speech (T2A) Service Tests (#911)
 *
 * Tests the text-to-audio synthesis service.
 * Uses mocked fetch — no real API key needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config
const mockConfig = {
  get: vi.fn((key: string) => {
    if (key === 'MINIMAX_API_KEY') return 'test-api-key';
    if (key === 'MINIMAX_GROUP_ID') return '';
    return undefined;
  }),
  validate: vi.fn(),
};

vi.mock('../../../src/core/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
  broadcastLog: vi.fn(),
}));

const { synthesizeSpeech, isSpeechAvailable } = await import('../../../src/ai/minimax-speech.js');

// ─── Helpers ───

function makeHexAudio(bytes: number[] = [0xFF, 0xFB, 0x90, 0x00]): string {
  return Buffer.from(bytes).toString('hex');
}

function makeSuccessResponse(hexAudio: string) {
  return {
    data: {
      audio: hexAudio,
      status: 2,
      extra_info: {
        audio_length: 1500,
        audio_sample_rate: 32000,
        audio_size: 4,
        bitrate: 128000,
        word_count: 5,
      },
    },
    base_resp: { status_code: 0, status_msg: 'success' },
  };
}

// ─── Tests ───

describe('MiniMax Speech Service (#911)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'MINIMAX_API_KEY') return 'test-api-key';
      if (key === 'MINIMAX_GROUP_ID') return '';
      return undefined;
    });

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeSuccessResponse(makeHexAudio())), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isSpeechAvailable()', () => {
    it('returns true when API key is configured', () => {
      expect(isSpeechAvailable()).toBe(true);
    });

    it('returns false when API key is missing', () => {
      mockConfig.get.mockReturnValue(undefined);
      expect(isSpeechAvailable()).toBe(false);
    });
  });

  describe('synthesizeSpeech()', () => {
    it('synthesizes speech and returns audio buffer', async () => {
      const result = await synthesizeSpeech('Hello world');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.audio).toBeInstanceOf(Buffer);
      expect(result.data.audio.length).toBeGreaterThan(0);
      expect(result.data.mimeType).toBe('audio/mpeg');
      expect(result.data.durationMs).toBe(1500);
      expect(result.data.charCount).toBe(5);
    });

    it('sends correct request to MiniMax T2A endpoint', async () => {
      await synthesizeSpeech('Test text', {
        voiceId: 'female-en-us-1',
        model: 'speech-2.8-turbo',
        speed: 1.5,
        emotion: 'happy',
        format: 'wav',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/t2a_v2');
      expect(options!.method).toBe('POST');
      expect(options!.headers).toEqual({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-key',
      });

      const body = JSON.parse(options!.body as string);
      expect(body.model).toBe('speech-2.8-turbo');
      expect(body.text).toBe('Test text');
      expect(body.stream).toBe(false);
      expect(body.voice_setting.voice_id).toBe('female-en-us-1');
      expect(body.voice_setting.speed).toBe(1.5);
      expect(body.voice_setting.emotion).toBe('happy');
      expect(body.audio_setting.format).toBe('wav');
    });

    it('appends GroupId query param when configured', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'MINIMAX_API_KEY') return 'test-api-key';
        if (key === 'MINIMAX_GROUP_ID') return 'group-123';
        return undefined;
      });

      await synthesizeSpeech('Hello');

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/t2a_v2?GroupId=group-123');
    });

    it('returns error when API key is not configured', async () => {
      mockConfig.get.mockReturnValue(undefined);
      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NOT_CONFIGURED');
    });

    it('returns error for empty text', async () => {
      const result = await synthesizeSpeech('');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error when text exceeds 10,000 characters', async () => {
      const longText = 'a'.repeat(10001);
      const result = await synthesizeSpeech(longText);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('10000');
    });

    it('returns error on HTTP failure', async () => {
      fetchSpy.mockResolvedValue(new Response('Internal Server Error', { status: 500 }));
      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_HTTP_ERROR');
      expect(result.error.retryable).toBe(true);
    });

    it('returns non-retryable error on 400', async () => {
      fetchSpy.mockResolvedValue(new Response('Bad Request', { status: 400 }));
      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_HTTP_ERROR');
      expect(result.error.retryable).toBe(false);
    });

    it('returns error on API-level error in response body', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: 'Insufficient balance' },
      }), { status: 200 }));

      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_API_ERROR');
      expect(result.error.message).toContain('Insufficient balance');
    });

    it('returns error when response has no audio data', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        data: { status: 2 },
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_EMPTY_RESPONSE');
    });

    it('handles network errors gracefully', async () => {
      fetchSpy.mockRejectedValue(new Error('Network unreachable'));
      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NETWORK_ERROR');
      expect(result.error.retryable).toBe(true);
    });

    it('handles timeout errors', async () => {
      const timeoutError = new Error('request timed out');
      timeoutError.name = 'AbortError';
      fetchSpy.mockRejectedValue(timeoutError);

      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_TIMEOUT');
      expect(result.error.retryable).toBe(true);
    });

    it('clamps speed to valid range', async () => {
      await synthesizeSpeech('Hello', { speed: 5.0 });
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.voice_setting.speed).toBe(2.0);
    });

    it('clamps pitch to valid range', async () => {
      await synthesizeSpeech('Hello', { pitch: -20 });
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.voice_setting.pitch).toBe(-12);
    });

    it('uses default model speech-2.8-hd when not specified', async () => {
      await synthesizeSpeech('Hello');
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.model).toBe('speech-2.8-hd');
    });

    it('returns correct MIME type for wav format', async () => {
      const result = await synthesizeSpeech('Hello', { format: 'wav' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.mimeType).toBe('audio/wav');
    });

    it('includes language_boost when specified', async () => {
      await synthesizeSpeech('Hello world', { languageBoost: 'English' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.language_boost).toBe('English');
    });

    it('returns error for invalid hex audio data', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        data: { audio: 'ZZZZ', status: 2 },
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_INVALID_RESPONSE');
    });

    it('returns error for odd-length hex string', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        data: { audio: 'abc', status: 2 },
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await synthesizeSpeech('Hello');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_INVALID_RESPONSE');
    });

    it('clamps vol to valid range', async () => {
      await synthesizeSpeech('Hello', { vol: 15 });
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.voice_setting.vol).toBe(10);
    });

    it('includes AbortSignal timeout on fetch', async () => {
      await synthesizeSpeech('Hello');
      const [, options] = fetchSpy.mock.calls[0];
      expect(options!.signal).toBeTruthy();
    });

    it('URL-encodes GroupId', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'MINIMAX_API_KEY') return 'test-api-key';
        if (key === 'MINIMAX_GROUP_ID') return 'group with spaces';
        return undefined;
      });

      await synthesizeSpeech('Hello');
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/t2a_v2?GroupId=group%20with%20spaces');
    });
  });
});
