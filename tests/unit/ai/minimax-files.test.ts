/**
 * MiniMax File Management Service Tests (#913)
 *
 * Tests upload, retrieve, list, and delete operations.
 * Uses mocked fetch — no real API key needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockConfig = {
  get: vi.fn((key: string) => {
    if (key === 'MINIMAX_API_KEY') return 'test-api-key';
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

const { uploadFile, retrieveFile, listFiles, deleteFile, isFileManagementAvailable } =
  await import('../../../src/ai/minimax-files.js');

// ─── Helpers ───

function makeFileObject(overrides: Record<string, unknown> = {}) {
  return {
    file_id: 123456789,
    bytes: 5896337,
    created_at: 1700469398,
    filename: 'test-audio.mp3',
    purpose: 'voice_clone',
    ...overrides,
  };
}

function makeSuccessUploadResponse(fileObj = makeFileObject()) {
  return { file: fileObj, base_resp: { status_code: 0, status_msg: 'success' } };
}

function makeSuccessRetrieveResponse(fileObj = makeFileObject({ download_url: 'https://example.com/download' })) {
  return { file: fileObj, base_resp: { status_code: 0, status_msg: 'success' } };
}

function makeSuccessListResponse(files = [makeFileObject(), makeFileObject({ file_id: 987654321, filename: 'test2.mp3' })]) {
  return { files, base_resp: { status_code: 0, status_msg: 'success' } };
}

function makeSuccessDeleteResponse(fileId = 123456789) {
  return { file_id: fileId, base_resp: { status_code: 0, status_msg: 'success' } };
}

// ─── Tests ───

describe('MiniMax File Management Service (#913)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'MINIMAX_API_KEY') return 'test-api-key';
      return undefined;
    });

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeSuccessUploadResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isFileManagementAvailable()', () => {
    it('returns true when API key is configured', () => {
      expect(isFileManagementAvailable()).toBe(true);
    });

    it('returns false when API key is missing', () => {
      mockConfig.get.mockReturnValue(undefined);
      expect(isFileManagementAvailable()).toBe(false);
    });
  });

  describe('uploadFile()', () => {
    it('uploads a file and returns metadata', async () => {
      const buffer = Buffer.from('fake-audio-data');
      const result = await uploadFile(buffer, 'test.mp3', 'voice_clone');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.fileId).toBe('123456789');
      expect(result.data.bytes).toBe(5896337);
      expect(result.data.filename).toBe('test-audio.mp3');
      expect(result.data.purpose).toBe('voice_clone');
    });

    it('sends multipart form data with correct auth', async () => {
      const buffer = Buffer.from('test');
      await uploadFile(buffer, 'audio.wav', 'prompt_audio');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/files/upload');
      expect(opts!.method).toBe('POST');
      expect(opts!.headers).toEqual({ 'Authorization': 'Bearer test-api-key' });
      expect(opts!.body).toBeInstanceOf(FormData);
    });

    it('returns error when API key is missing', async () => {
      mockConfig.get.mockReturnValue(undefined);
      const result = await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NOT_CONFIGURED');
    });

    it('returns error for empty buffer', async () => {
      const result = await uploadFile(Buffer.alloc(0), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for empty filename', async () => {
      const result = await uploadFile(Buffer.from('data'), '', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error when file exceeds max upload size', async () => {
      // Create a buffer that claims to be >100MB
      const bigBuffer = { length: 101 * 1024 * 1024 } as Buffer;
      const result = await uploadFile(bigBuffer, 'huge.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('maximum upload size');
    });

    it('returns error on HTTP 500', async () => {
      fetchSpy.mockResolvedValue(new Response('Error', { status: 500 }));
      const result = await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_HTTP_ERROR');
      expect(result.error.retryable).toBe(true);
    });

    it('returns error on API-level error (auth failed)', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: 'Authentication failed' },
      }), { status: 200 }));

      const result = await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_API_ERROR');
      expect(result.error.message).toContain('Authentication failed');
    });

    it('marks rate-limit errors as retryable', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 1002, status_msg: 'Rate limit' },
      }), { status: 200 }));

      const result = await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.retryable).toBe(true);
    });

    it('returns error when response has no file object', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_INVALID_RESPONSE');
    });

    it('handles network errors', async () => {
      fetchSpy.mockRejectedValue(new Error('Network unreachable'));
      const result = await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NETWORK_ERROR');
    });

    it('handles timeout errors', async () => {
      const timeoutErr = new Error('timed out');
      timeoutErr.name = 'AbortError';
      fetchSpy.mockRejectedValue(timeoutErr);

      const result = await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_TIMEOUT');
    });

    it('includes AbortSignal timeout on fetch', async () => {
      await uploadFile(Buffer.from('data'), 'f.mp3', 'voice_clone');
      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts!.signal).toBeTruthy();
    });
  });

  describe('retrieveFile()', () => {
    beforeEach(() => {
      fetchSpy.mockResolvedValue(new Response(
        JSON.stringify(makeSuccessRetrieveResponse()),
        { status: 200 },
      ));
    });

    it('retrieves file metadata', async () => {
      const result = await retrieveFile('123456789');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.fileId).toBe('123456789');
      expect(result.data.downloadUrl).toBe('https://example.com/download');
    });

    it('sends GET with file_id query param', async () => {
      await retrieveFile('999');
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/files/retrieve?file_id=999');
      expect(opts!.method).toBe('GET');
    });

    it('returns error for empty file ID', async () => {
      const result = await retrieveFile('');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error when API key missing', async () => {
      mockConfig.get.mockReturnValue(undefined);
      const result = await retrieveFile('123');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_NOT_CONFIGURED');
    });

    it('URL-encodes file ID', async () => {
      await retrieveFile('file with spaces');
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/files/retrieve?file_id=file%20with%20spaces');
    });
  });

  describe('listFiles()', () => {
    beforeEach(() => {
      fetchSpy.mockResolvedValue(new Response(
        JSON.stringify(makeSuccessListResponse()),
        { status: 200 },
      ));
    });

    it('lists files by purpose', async () => {
      const result = await listFiles('voice_clone');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(2);
      expect(result.data[0].fileId).toBe('123456789');
      expect(result.data[1].fileId).toBe('987654321');
    });

    it('sends GET with purpose query param', async () => {
      await listFiles('prompt_audio');
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/files/list?purpose=prompt_audio');
      expect(opts!.method).toBe('GET');
    });

    it('returns empty array when no files exist', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        files: [],
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await listFiles('voice_clone');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    });

    it('handles missing files array gracefully', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 0 },
      }), { status: 200 }));

      const result = await listFiles('voice_clone');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    });
  });

  describe('deleteFile()', () => {
    beforeEach(() => {
      fetchSpy.mockResolvedValue(new Response(
        JSON.stringify(makeSuccessDeleteResponse()),
        { status: 200 },
      ));
    });

    it('deletes a file and returns the ID', async () => {
      const result = await deleteFile('123456789', 'voice_clone');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.fileId).toBe('123456789');
    });

    it('sends POST with file_id and purpose in JSON body', async () => {
      await deleteFile('555', 't2a_async_input');
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.minimax.io/v1/files/delete');
      expect(opts!.method).toBe('POST');
      expect(opts!.headers).toEqual({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-key',
      });
      const body = JSON.parse(opts!.body as string);
      expect(body.file_id).toBe(555); // Converted to number
      expect(body.purpose).toBe('t2a_async_input');
    });

    it('returns error for empty file ID', async () => {
      const result = await deleteFile('', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('returns error for non-numeric file ID', async () => {
      const result = await deleteFile('not-a-number', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('numeric');
    });

    it('returns error on API failure', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({
        base_resp: { status_code: 1013, status_msg: 'Internal service error' },
      }), { status: 200 }));

      const result = await deleteFile('123', 'voice_clone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('MINIMAX_API_ERROR');
    });
  });
});
