/**
 * Vision Support Tests
 *
 * Tests the multi-provider image content handling utilities.
 *
 * @see Issue #375
 */

import { describe, it, expect } from 'vitest';
import {
  isImageContent,
  formatImageForProvider,
  canProviderHandleVision,
  parseDataUri,
} from '../../../src/ai/vision-support.js';
import type { ImageData } from '../../../src/ai/vision-support.js';

const sampleImageData: ImageData = {
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  mediaType: 'image/png',
};

describe('Vision Support', () => {
  describe('isImageContent', () => {
    it('detects Anthropic-style image blocks', () => {
      expect(isImageContent({ type: 'image', source: { type: 'base64' } })).toBe(true);
    });

    it('detects OpenAI-style image blocks', () => {
      expect(isImageContent({ type: 'image_url', image_url: { url: 'data:...' } })).toBe(true);
    });

    it('returns false for text blocks', () => {
      expect(isImageContent({ type: 'text', text: 'hello' })).toBe(false);
    });

    it('returns false for tool_use blocks', () => {
      expect(isImageContent({ type: 'tool_use', name: 'bash' })).toBe(false);
    });

    it('returns false for tool_result blocks', () => {
      expect(isImageContent({ type: 'tool_result', content: 'ok' })).toBe(false);
    });

    it('returns false for null/undefined block', () => {
      expect(isImageContent(null as unknown as { type: string })).toBe(false);
      expect(isImageContent(undefined as unknown as { type: string })).toBe(false);
    });

    it('returns false for block with non-string type', () => {
      expect(isImageContent({ type: 123 } as unknown as { type: string })).toBe(false);
    });
  });

  describe('formatImageForProvider', () => {
    it('formats for Anthropic (native base64 format)', () => {
      const result = formatImageForProvider('anthropic', sampleImageData);

      expect(result.type).toBe('image');
      expect((result as { source: { type: string; media_type: string; data: string } }).source).toEqual({
        type: 'base64',
        media_type: 'image/png',
        data: sampleImageData.base64,
      });
    });

    it('formats for MiniMax (same as Anthropic)', () => {
      const result = formatImageForProvider('minimax', sampleImageData);

      expect(result.type).toBe('image');
      expect((result as { source: { type: string; media_type: string; data: string } }).source).toEqual({
        type: 'base64',
        media_type: 'image/png',
        data: sampleImageData.base64,
      });
    });

    it('formats for OpenAI (data URI format)', () => {
      const result = formatImageForProvider('openai', sampleImageData);

      expect(result.type).toBe('image_url');
      const openaiResult = result as { image_url: { url: string; detail: string } };
      expect(openaiResult.image_url.url).toContain('data:image/png;base64,');
      expect(openaiResult.image_url.url).toContain(sampleImageData.base64);
      expect(openaiResult.image_url.detail).toBe('auto');
    });

    it('formats for Ollama (same as OpenAI)', () => {
      const result = formatImageForProvider('ollama', sampleImageData);

      expect(result.type).toBe('image_url');
      const ollamaResult = result as { image_url: { url: string } };
      expect(ollamaResult.image_url.url).toContain('data:image/png;base64,');
    });

    it('falls back to Anthropic format for unknown providers', () => {
      const result = formatImageForProvider('unknown-provider', sampleImageData);

      expect(result.type).toBe('image');
      expect((result as { source: { type: string } }).source.type).toBe('base64');
    });

    it('handles JPEG media type', () => {
      const jpegData: ImageData = { base64: 'abc123', mediaType: 'image/jpeg' };
      const result = formatImageForProvider('anthropic', jpegData);

      expect((result as { source: { media_type: string } }).source.media_type).toBe('image/jpeg');
    });

    it('handles WebP media type', () => {
      const webpData: ImageData = { base64: 'webpdata', mediaType: 'image/webp' };
      const result = formatImageForProvider('openai', webpData);

      const openaiResult = result as { image_url: { url: string } };
      expect(openaiResult.image_url.url).toContain('data:image/webp;base64,');
    });
  });

  describe('canProviderHandleVision', () => {
    it('returns true for Anthropic', () => {
      expect(canProviderHandleVision('anthropic')).toBe(true);
    });

    it('returns true for MiniMax', () => {
      expect(canProviderHandleVision('minimax')).toBe(true);
    });

    it('returns true for OpenAI', () => {
      expect(canProviderHandleVision('openai')).toBe(true);
    });

    it('returns false for Ollama (no vision by default)', () => {
      expect(canProviderHandleVision('ollama')).toBe(false);
    });

    it('returns false for unknown providers', () => {
      expect(canProviderHandleVision('custom-local')).toBe(false);
    });
  });

  describe('parseDataUri', () => {
    it('parses a valid PNG data URI', () => {
      const result = parseDataUri('data:image/png;base64,iVBOR');

      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('image/png');
      expect(result!.base64).toBe('iVBOR');
    });

    it('parses a valid JPEG data URI', () => {
      const result = parseDataUri('data:image/jpeg;base64,/9j/4AAQ');

      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('image/jpeg');
      expect(result!.base64).toBe('/9j/4AAQ');
    });

    it('parses a valid GIF data URI', () => {
      const result = parseDataUri('data:image/gif;base64,R0lGOD');

      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('image/gif');
    });

    it('parses a valid WebP data URI', () => {
      const result = parseDataUri('data:image/webp;base64,UklGR');

      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('image/webp');
    });

    it('returns null for non-image data URIs', () => {
      expect(parseDataUri('data:text/plain;base64,aGVsbG8=')).toBeNull();
    });

    it('returns null for malformed URIs', () => {
      expect(parseDataUri('not-a-data-uri')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseDataUri('')).toBeNull();
    });

    it('returns null for unsupported image formats', () => {
      expect(parseDataUri('data:image/bmp;base64,Qk0=')).toBeNull();
    });
  });
});
