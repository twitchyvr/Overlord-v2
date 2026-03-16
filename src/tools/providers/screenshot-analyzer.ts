/**
 * Screenshot Analyzer Tool Provider
 *
 * Reads a screenshot PNG file and sends it to the AI provider (MiniMax M2.5)
 * with a vision prompt. Returns a text description of what's visible on screen.
 *
 * This completes the visual dogfooding loop:
 *   screenshot tool → PNG file → analyze_screenshot → text description
 *
 * Layer: Tools (imports from Core only)
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { ok, err } from '../../core/contracts.js';
import { logger } from '../../core/logger.js';
import type { Result, AIProviderAPI } from '../../core/contracts.js';

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
  '.gif': 'image/gif',
};

/**
 * Analyze a screenshot by sending it to the AI provider's vision capabilities.
 * The AI describes what it sees, lists UI elements, and flags any issues.
 */
export async function analyzeScreenshot(params: {
  screenshotPath: string;
  prompt?: string;
  ai: AIProviderAPI;
  provider?: string;
}): Promise<Result<ScreenshotAnalysis>> {
  const { screenshotPath, prompt, ai, provider = 'minimax' } = params;

  if (!existsSync(screenshotPath)) {
    return err('FILE_NOT_FOUND', `Screenshot not found: ${screenshotPath}`, { retryable: false });
  }

  const ext = extname(screenshotPath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    return err('UNSUPPORTED_FORMAT', `Unsupported image format: ${ext}. Use PNG, JPG, WebP, or GIF.`, { retryable: false });
  }

  try {
    // Size guard — check before reading to avoid buffering huge files
    const fileSize = statSync(screenshotPath).size;
    if (fileSize > 7_500_000) {
      return err('IMAGE_TOO_LARGE', `Screenshot is ${(fileSize / 1_000_000).toFixed(1)}MB — max 7.5MB`, { retryable: false });
    }

    // Read image as base64
    const imageBuffer = readFileSync(screenshotPath);
    const base64Data = imageBuffer.toString('base64');

    const userPrompt = prompt || 'Describe what you see in this screenshot of a web application. List the main UI elements, any data being displayed, and flag anything that looks broken, malformed, or missing.';

    const systemPrompt = `You are a QA engineer visually inspecting a web application screenshot. Analyze the screenshot and return a JSON response wrapped in \`\`\`json code blocks.

Required JSON structure:
\`\`\`json
{
  "description": "Brief 1-2 sentence description of the page",
  "elements": ["List of visible UI elements: buttons, forms, navigation, data displays, etc."],
  "issues": ["List any visual issues: missing data, broken layouts, overlapping elements, empty states that should have data, etc. Empty array if page looks correct."]
}
\`\`\`

Be specific about what you see. If data appears malformed (wrong format, truncated, NaN, undefined), flag it. If sections are empty that should have content, flag it. Return ONLY the JSON.`;

    // Vision requires a provider that supports image content blocks.
    // MiniMax M2.5 does NOT support vision — it silently ignores image blocks.
    // Try providers in order: anthropic (Claude) → openai (GPT-4o) → error.
    const visionProviders = ['anthropic', 'openai'];
    let usedProvider = provider;

    // If the requested provider isn't vision-capable, try others
    if (provider === 'minimax') {
      const visionAdapter = visionProviders.find(p => ai.getAdapter(p) !== null);
      if (!visionAdapter) {
        return err('NO_VISION_PROVIDER',
          'Screenshot analysis requires a vision-capable AI provider (Anthropic Claude or OpenAI GPT-4o). ' +
          'MiniMax M2.5 does not support image analysis. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY.',
          { retryable: false });
      }
      usedProvider = visionAdapter;
      log.info({ from: provider, to: usedProvider }, 'Switching to vision-capable provider for screenshot analysis');
    }

    // Send to AI with image content block
    const result = await ai.sendMessage({
      provider: usedProvider,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
      options: {
        system: systemPrompt,
        maxTokens: 1024,
      },
    });

    if (!result.ok) {
      log.warn({ err: result.error }, 'AI vision analysis failed');
      return err(result.error.code, result.error.message, { retryable: result.error.retryable ?? true });
    }

    // Extract text from response
    const response = result.data as { content: Array<{ type: string; text?: string }> };
    const textBlock = response.content?.find(b => b.type === 'text');
    const text = textBlock?.text || '';

    // Try to parse JSON from response
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
        // JSON parse failed — return raw text as description
      }
    }

    return ok({
      description: text,
      elements: [],
      issues: [],
      screenshotPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: message, screenshotPath }, 'Screenshot analysis failed');
    return err('ANALYSIS_FAILED', `Screenshot analysis failed: ${message}`, { retryable: true });
  }
}
