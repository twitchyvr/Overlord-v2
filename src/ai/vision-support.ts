/**
 * Vision Support — Multi-Provider Image Content Handling
 *
 * Provides utilities for working with image content blocks across
 * different AI providers. Each provider has its own format for image
 * messages; this module normalizes detection and formatting.
 *
 * Supported providers:
 *   - Anthropic: `{ type: 'image', source: { type: 'base64', media_type, data } }`
 *   - MiniMax: Uses Anthropic-compatible format (same shape)
 *   - OpenAI: `{ type: 'image_url', image_url: { url: 'data:...' } }`
 *   - Ollama: `{ type: 'image_url', image_url: { url: 'data:...' } }` (OpenAI-compat)
 *
 * Layer: AI (depends on Core only)
 *
 * @see Issue #375
 */

import { logger } from '../core/logger.js';

const log = logger.child({ module: 'ai:vision' });

// ─── Types ───

export interface ImageData {
  /** Base64-encoded image data (no data URI prefix) */
  base64: string;
  /** MIME type of the image */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/** Anthropic-format image content block */
export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/** OpenAI-format image content block */
export interface OpenAIImageBlock {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/** Union type for all supported image content block formats */
export type ImageContentBlock = AnthropicImageBlock | OpenAIImageBlock;

/** Generic content block (text or image) */
export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

// ─── Providers with Vision Support ───

const VISION_PROVIDERS = new Set(['anthropic', 'minimax', 'openai']);

// ─── Public API ───

/**
 * Check whether a content block represents an image.
 *
 * Detects both Anthropic-style (`type: 'image'`) and
 * OpenAI-style (`type: 'image_url'`) image blocks.
 */
export function isImageContent(block: ContentBlock): boolean {
  if (!block || typeof block.type !== 'string') return false;
  return block.type === 'image' || block.type === 'image_url';
}

/**
 * Format image data for a specific AI provider.
 *
 * Each provider expects images in a different structure:
 * - Anthropic/MiniMax: `{ type: 'image', source: { type: 'base64', media_type, data } }`
 * - OpenAI/Ollama: `{ type: 'image_url', image_url: { url: 'data:<mime>;base64,<data>' } }`
 *
 * @param provider - Target AI provider name
 * @param imageData - The image data to format
 * @returns Formatted content block for the provider
 */
export function formatImageForProvider(
  provider: string,
  imageData: ImageData,
): ImageContentBlock {
  log.debug(
    { provider, mediaType: imageData.mediaType, dataLength: imageData.base64.length },
    'Formatting image for provider',
  );

  switch (provider) {
    case 'anthropic':
    case 'minimax': {
      // Anthropic and MiniMax use the same native format
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageData.mediaType,
          data: imageData.base64,
        },
      };
    }

    case 'openai':
    case 'ollama': {
      // OpenAI and Ollama use data URI format
      const dataUri = `data:${imageData.mediaType};base64,${imageData.base64}`;
      return {
        type: 'image_url',
        image_url: {
          url: dataUri,
          detail: 'auto',
        },
      };
    }

    default: {
      // Fallback to Anthropic format for unknown providers
      log.warn(
        { provider },
        'Unknown provider for vision — falling back to Anthropic format',
      );
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageData.mediaType,
          data: imageData.base64,
        },
      };
    }
  }
}

/**
 * Check whether a given AI provider supports vision (image inputs).
 *
 * @param provider - AI provider name
 * @returns true if the provider can handle image content blocks
 */
export function canProviderHandleVision(provider: string): boolean {
  return VISION_PROVIDERS.has(provider);
}

/**
 * Parse a data URI into ImageData.
 *
 * @param dataUri - A data URI string like `data:image/png;base64,iVBOR...`
 * @returns ImageData if valid, null otherwise
 */
export function parseDataUri(dataUri: string): ImageData | null {
  const match = dataUri.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  if (!match) return null;

  return {
    mediaType: match[1] as ImageData['mediaType'],
    base64: match[2],
  };
}
