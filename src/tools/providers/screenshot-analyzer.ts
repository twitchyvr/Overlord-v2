/**
 * Screenshot Analyzer Tool Provider
 *
 * Reads a screenshot PNG file and sends it to MiniMax's Coding Plan VLM API
 * for visual analysis. Returns a text description of what's visible on screen.
 *
 * Uses the MiniMax /v1/coding_plan/vlm endpoint directly — same API that
 * powers the understand_image MCP tool. Works with Coding Plan API keys.
 *
 * This completes the visual dogfooding loop:
 *   screenshot tool → PNG file → analyze_screenshot → text description
 *
 * Layer: Tools (imports from Core only)
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { ok, err } from '../../core/contracts.js';
import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import type { Result } from '../../core/contracts.js';

const log = logger.child({ module: 'tools:screenshot-analyzer' });

export interface ScreenshotAnalysis {
  description: string;
  elements: string[];
  issues: string[];
  screenshotPath: string;
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const VLM_API_URL = 'https://api.minimax.io/v1/coding_plan/vlm';
const VLM_TIMEOUT_MS = 30_000;

/**
 * Get the MiniMax API key for VLM calls.
 * Prefers MINIMAX_VLM_API_KEY (dedicated VLM key), falls back to MINIMAX_API_KEY.
 */
function getVlmApiKey(): string | null {
  return process.env.MINIMAX_VLM_API_KEY
    || config.get('MINIMAX_API_KEY')
    || process.env.MINIMAX_API_KEY
    || null;
}

/**
 * Analyze a screenshot by sending it to MiniMax's Coding Plan VLM API.
 * Returns a structured analysis with description, UI elements, and issues.
 */
export async function analyzeScreenshot(params: {
  screenshotPath: string;
  prompt?: string;
}): Promise<Result<ScreenshotAnalysis>> {
  const { screenshotPath, prompt } = params;

  const apiKey = getVlmApiKey();
  if (!apiKey) {
    return err('NO_API_KEY',
      'MiniMax API key not configured. Set MINIMAX_API_KEY or MINIMAX_VLM_API_KEY in .env.',
      { retryable: false });
  }

  if (!existsSync(screenshotPath)) {
    return err('FILE_NOT_FOUND', `Screenshot not found: ${screenshotPath}`, { retryable: false });
  }

  const ext = extname(screenshotPath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    return err('UNSUPPORTED_FORMAT', `Unsupported image format: ${ext}. Use PNG, JPG, or WebP.`, { retryable: false });
  }

  try {
    // Size guard — check before reading to avoid buffering huge files
    const fileSize = statSync(screenshotPath).size;
    if (fileSize > 7_500_000) {
      return err('IMAGE_TOO_LARGE', `Screenshot is ${(fileSize / 1_000_000).toFixed(1)}MB — max 7.5MB`, { retryable: false });
    }

    // Read image as base64 data URI
    const imageBuffer = readFileSync(screenshotPath);
    const base64Data = imageBuffer.toString('base64');
    const dataUri = `data:${mediaType};base64,${base64Data}`;

    const userPrompt = prompt ||
      'Describe what you see in this screenshot of a web application. ' +
      'List the main UI elements, any data being displayed, and flag anything ' +
      'that looks broken, malformed, or missing. Be specific.';

    // Call MiniMax Coding Plan VLM API directly
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(VLM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: userPrompt,
          image_url: dataUri,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        return err('VLM_TIMEOUT', 'VLM analysis timed out after 30 seconds', { retryable: true });
      }
      throw fetchErr;
    }

    if (!response.ok) {
      const errorText = await response.text();
      log.warn({ status: response.status, body: errorText.slice(0, 500) }, 'MiniMax VLM API error');
      return err('VLM_API_ERROR', `MiniMax VLM returned ${response.status}: ${errorText.slice(0, 200)}`, { retryable: response.status >= 500 });
    }

    const data = await response.json() as { content?: string; error?: string };

    if (!data.content) {
      return err('VLM_EMPTY', 'MiniMax VLM returned empty content', { retryable: true });
    }

    const text = data.content;

    // Try to parse structured JSON from the response
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]) as { description?: string; elements?: string[]; issues?: string[] };
        return ok({
          description: parsed.description || text,
          elements: Array.isArray(parsed.elements) ? parsed.elements : [],
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          screenshotPath,
        });
      } catch {
        // JSON parse failed — return raw text
      }
    }

    // VLM typically returns plain text — parse it into structured format
    const lines = text.split('\n').filter(l => l.trim());
    const elements: string[] = [];
    const issues: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
        const content = trimmed.slice(2).trim();
        if (/broken|missing|error|issue|malform|empty|undefined|NaN/i.test(content)) {
          issues.push(content);
        } else {
          elements.push(content);
        }
      }
    }

    return ok({
      description: lines[0] || text.slice(0, 200),
      elements: elements.length > 0 ? elements : [text.slice(0, 500)],
      issues,
      screenshotPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: message, screenshotPath }, 'Screenshot analysis failed');
    return err('ANALYSIS_FAILED', `Screenshot analysis failed: ${message}`, { retryable: true });
  }
}
