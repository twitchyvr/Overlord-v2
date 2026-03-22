/**
 * MiniMax Voice Cloning & Design Service Tests (#912)
 *
 * Tests clone, design, and availability operations.
 * Uses mocked fetch — no real API key needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockConfig = {
  get: vi.fn((key: string) => {
    if (key === 'MINIMAX_API_KEY') return 'test-api-key';
    if (key === 'MINIMAX_GROUP_ID') return 'test-group-id';
    return undefined;
  }),
  validate: vi.fn(),
};

vi.mock('../../../src/core/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  broadcastLog: vi.fn(),
}));

const { cloneVoice, designVoice, isVoiceServiceAvailable } =
  await import('../../../src/ai/minimax-voice.js');

// ─── Helpers ───

function makeHexAudio(size = 100): string {
  return 'ab'.repeat(size); // valid hex, each 'ab' = 1 byte
}

function makeSuccessCloneResponse(voiceId = 'test-voice-abc', audioHex = makeHexAudio()) {
  return {
    data: { audio: audioHex, voice_id: voiceId, status: 2 },
    base_resp: { status_code: 0, status_msg: 'success' },
  };
}

function makeSuccessDesignResponse(voiceId = 'designed-voice-xyz', audioHex = makeHexAudio()) {
  return {
    data: { audio: audioHex, voice_id: voiceId, status: 2 },
    base_resp: { status_code: 0, status_msg: 'success' },
  };
}

// ─── Tests ───

describe('MiniMax Voice Cloning & Design Service (#912)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'MINIMAX_API_KEY') return 'test-api-key';
      if (key === 'MINIMAX_GROUP_ID') return 'test-group-id';
      return undefined;
    });

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeSuccessCloneResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isVoiceServiceAvailable()', () => {
    it('returns true when API key is configured', () => {
      expect(isVoiceServiceAvailable()).toBe(true);
    });

    it('returns false when API key is missing', () => {
      mockConfig.get.mockReturnValue(undefined);
      expect(isVoiceServiceAvailable()).toBe(false);
    });
  });

  describe('cloneVoice()', () => {
    it('clones a voice and returns preview audio', async () => {
      const result = await cloneVoice('file-123', 'my-voice-id', 'Hello world test');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.voiceId).toBe('test-voice-abc');
      expect(result.data.previewAudio).toBeInstanceOf(Buffer);
      expect(result.data.previewAudio.length).toBe(100);
      expect(result.data.status).toBe(2);
    });

    it('sends correct request with auth and body', async () => {
      await cloneVoice('file-456', 'agent-voice-test', 'Test text');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain('https://api.minimax.io/v1/voice_clone');
      expect(url).toContain('GroupId=test-group-id');
      expect(opts!.method).toBe('POST');
      expect(opts!.headers).toEqual({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-key',
      });

      const body = JSON.parse(opts!.body as string);
      expect(body.file_id).toBe('file-456');
      expect(body.voice_id).toBe('agent-voice-test');
      expect(body.text).toBe('Test text');
      expect(body.model).toBe('speech-2.8-hd');
    });

    it('includes noise reduction and volume normalization when requested', async () => {
      await cloneVoice('file-1', 'voice-options-ab', 'Test', {
        noiseReduction: true,
        volumeNormalization: true,
      });

      const [, opts] = fetchSpy.mock.calls[0];
      const body = JSON.parse(opts!.body as string);
      expect(body.need_noise_reduction).toBe(true);
      expect(body.need_volumn_normalization).toBe(true);
    });

    it('returns error when API key is missing', async () => {
      mockConfig.get.mockReturnValue(undefined);
      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NOT_CONFIGURED');
    });

    it('returns error for empty file ID', async () => {
      const result = await cloneVoice('', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for empty voice ID', async () => {
      const result = await cloneVoice('file-1', '', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for voice ID too short', async () => {
      const result = await cloneVoice('file-1', 'ab', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('8-256 characters');
    });

    it('returns error for voice ID starting with number', async () => {
      const result = await cloneVoice('file-1', '1invalid-voice', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('start with a letter');
    });

    it('returns error for voice ID ending with hyphen', async () => {
      const result = await cloneVoice('file-1', 'my-voice-', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for empty preview text', async () => {
      const result = await cloneVoice('file-1', 'my-voice-id', '');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for preview text exceeding max length', async () => {
      const longText = 'x'.repeat(501);
      const result = await cloneVoice('file-1', 'my-voice-id', longText);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('500');
    });

    it('returns error on HTTP 500', async () => {
      fetchSpy.mockResolvedValue(new Response('Error', { status: 500, statusText: 'Server Error' }));
      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_HTTP_ERROR');
      expect(result.error.retryable).toBe(true);
    });

    it('returns error on API-level error', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: 'Authentication failed' },
      }), { status: 200 }));

      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_API_ERROR');
      expect(result.error.message).toContain('Authentication failed');
    });

    it('marks rate-limit errors as retryable', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 1002, status_msg: 'Rate limit' },
      }), { status: 200 }));

      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.retryable).toBe(true);
    });

    it('returns error when response has no audio', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        data: {},
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_EMPTY_RESPONSE');
    });

    it('returns error for invalid hex audio', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        data: { audio: 'not-valid-hex!', voice_id: 'test', status: 2 },
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_INVALID_RESPONSE');
    });

    it('handles network errors', async () => {
      fetchSpy.mockRejectedValue(new Error('Network unreachable'));
      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NETWORK_ERROR');
    });

    it('handles timeout errors', async () => {
      const timeoutErr = new Error('timed out');
      timeoutErr.name = 'AbortError';
      fetchSpy.mockRejectedValue(timeoutErr);

      const result = await cloneVoice('file-1', 'my-voice-id', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_TIMEOUT');
    });

    it('includes AbortSignal on fetch', async () => {
      await cloneVoice('file-1', 'my-voice-id', 'Test');
      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts!.signal).toBeTruthy();
    });
  });

  describe('designVoice()', () => {
    beforeEach(() => {
      fetchSpy.mockResolvedValue(new Response(
        JSON.stringify(makeSuccessDesignResponse()),
        { status: 200 },
      ));
    });

    it('designs a voice and returns preview audio', async () => {
      const result = await designVoice('warm female voice', 'Hello world');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.voiceId).toBe('designed-voice-xyz');
      expect(result.data.previewAudio).toBeInstanceOf(Buffer);
      expect(result.data.previewAudio.length).toBe(100);
    });

    it('sends correct request to voice generation endpoint', async () => {
      await designVoice('deep male voice', 'Test preview');

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain('https://api.minimax.io/v1/voice_generation');
      expect(url).toContain('GroupId=test-group-id');
      expect(opts!.method).toBe('POST');

      const body = JSON.parse(opts!.body as string);
      expect(body.voice_description).toBe('deep male voice');
      expect(body.text).toBe('Test preview');
      expect(body.model).toBe('speech-2.8-hd');
    });

    it('includes custom voice ID when provided', async () => {
      await designVoice('warm voice', 'Test', 'custom-voice-id');

      const [, opts] = fetchSpy.mock.calls[0];
      const body = JSON.parse(opts!.body as string);
      expect(body.voice_id).toBe('custom-voice-id');
    });

    it('returns error when API key is missing', async () => {
      mockConfig.get.mockReturnValue(undefined);
      const result = await designVoice('warm voice', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NOT_CONFIGURED');
    });

    it('returns error for empty description', async () => {
      const result = await designVoice('', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for description exceeding max length', async () => {
      const longDesc = 'x'.repeat(1001);
      const result = await designVoice(longDesc, 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for empty preview text', async () => {
      const result = await designVoice('warm voice', '');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('validates custom voice ID when provided', async () => {
      const result = await designVoice('warm voice', 'Test', '1bad-id');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error on HTTP error', async () => {
      fetchSpy.mockResolvedValue(new Response('Error', { status: 503, statusText: 'Service Unavailable' }));
      const result = await designVoice('warm voice', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_HTTP_ERROR');
      expect(result.error.retryable).toBe(true);
    });

    it('returns error on API error', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 1013, status_msg: 'Internal error' },
      }), { status: 200 }));

      const result = await designVoice('warm voice', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_API_ERROR');
    });

    it('handles network errors', async () => {
      fetchSpy.mockRejectedValue(new Error('DNS resolution failed'));
      const result = await designVoice('warm voice', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NETWORK_ERROR');
    });

    it('handles timeout errors', async () => {
      const timeoutErr = new Error('timed out');
      timeoutErr.name = 'AbortError';
      fetchSpy.mockRejectedValue(timeoutErr);

      const result = await designVoice('warm voice', 'Test');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_TIMEOUT');
    });
  });
});

// ─── Agent Voice Custom Voice Tests ───

import { getAgentVoice, getVoiceProfiles } from '../../../src/agents/agent-voice.js';

describe('Agent Voice — Custom Voice Support (#912)', () => {
  it('returns custom voice when config has cloned voice', () => {
    const config = {
      voice: { voiceId: 'my-cloned-voice', type: 'cloned', tone: 'warm', speed: 0.9 },
    };
    const profile = getAgentVoice('agent-1', 'Alice', 'strategist', config);
    expect(profile.voiceId).toBe('my-cloned-voice');
    expect(profile.name).toBe('Custom');
    expect(profile.tone).toBe('warm');
    expect(profile.speed).toBe(0.9);
  });

  it('returns custom voice when config has designed voice', () => {
    const config = {
      voice: { voiceId: 'designed-voice-xyz', type: 'designed' },
    };
    const profile = getAgentVoice('agent-2', 'Bob', 'architect', config);
    expect(profile.voiceId).toBe('designed-voice-xyz');
    expect(profile.name).toBe('Custom');
  });

  it('falls back to system voice when type is system', () => {
    const config = {
      voice: { voiceId: 'vocal-3', type: 'system' },
    };
    const profile = getAgentVoice('agent-3', 'Carol', 'developer', config);
    // Should use deterministic assignment, not custom
    const profiles = getVoiceProfiles();
    expect(profiles.map(p => p.voiceId)).toContain(profile.voiceId);
  });

  it('falls back to deterministic voice when no config provided', () => {
    const profile = getAgentVoice('agent-4', 'Dave', 'tester');
    const profiles = getVoiceProfiles();
    expect(profiles.map(p => p.voiceId)).toContain(profile.voiceId);
  });

  it('falls back to deterministic voice when config has no voice', () => {
    const config = { someOtherSetting: true };
    const profile = getAgentVoice('agent-5', 'Eve', 'reviewer', config);
    const profiles = getVoiceProfiles();
    expect(profiles.map(p => p.voiceId)).toContain(profile.voiceId);
  });

  it('uses default speed and tone for custom voice without those fields', () => {
    const config = {
      voice: { voiceId: 'minimal-clone', type: 'cloned' },
    };
    const profile = getAgentVoice('agent-6', 'Frank', 'lead', config);
    expect(profile.speed).toBe(1.0);
    expect(profile.tone).toBe('custom');
  });
});
