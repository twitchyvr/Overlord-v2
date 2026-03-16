/**
 * Browser Tools Provider
 *
 * Real browser automation via Playwright for screenshots, navigation,
 * and page inspection. Falls back to curl if Playwright is unavailable.
 *
 * Actions: screenshot (Playwright headless), navigate (HTTP GET), inspect (HTML structure)
 */

import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Result } from '../../core/contracts.js';

export type BrowserAction = 'screenshot' | 'navigate' | 'inspect';

export interface BrowserToolsResult {
  action: BrowserAction;
  url: string;
  statusCode?: number;
  title?: string;
  html?: string;
  screenshotPath?: string;
  output: string;
}

/**
 * Extract the <title> from an HTML string.
 */
function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Extract basic page structure (headings, links, forms) from HTML.
 */
function extractStructure(html: string): string {
  const parts: string[] = [];

  // Headings
  const headings = html.match(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/gi) || [];
  if (headings.length > 0) {
    parts.push('Headings:');
    for (const h of headings.slice(0, 20)) {
      const text = h.replace(/<[^>]*>/g, '').trim();
      if (text) parts.push('  - ' + text);
    }
  }

  // Links
  const links = html.match(/<a\s+[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi) || [];
  if (links.length > 0) {
    parts.push('Links (' + links.length + '):');
    for (const link of links.slice(0, 20)) {
      const hrefMatch = link.match(/href="([^"]*)"/);
      const text = link.replace(/<[^>]*>/g, '').trim();
      if (hrefMatch) parts.push('  - ' + (text || '(no text)') + ' -> ' + hrefMatch[1]);
    }
  }

  // Forms
  const forms = html.match(/<form[^>]*>/gi) || [];
  if (forms.length > 0) {
    parts.push('Forms: ' + forms.length);
  }

  return parts.join('\n') || 'No structural elements found';
}

/**
 * Validate URL is HTTP(S) and safe for shell interpolation.
 */
function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'URL must use http:// or https:// protocol';
    }
    return null;
  } catch {
    return 'Invalid URL format';
  }
}

export async function executeBrowserTools(params: {
  action: BrowserAction;
  url: string;
  selector?: string;
}): Promise<Result<BrowserToolsResult>> {
  const { action, url } = params;

  if (!url) {
    return err('MISSING_URL', 'URL is required', { retryable: false });
  }

  const urlError = validateUrl(url);
  if (urlError) {
    return err('INVALID_URL', urlError, { retryable: false });
  }

  try {
    switch (action) {
      case 'screenshot':
        return await screenshotAction(url, params.selector);
      case 'navigate':
        return await navigateAction(url);
      case 'inspect':
        return await inspectAction(url);
      default:
        return err('INVALID_ACTION', `Unknown browser action: ${action}`, { retryable: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err('BROWSER_ERROR', `Browser action failed: ${message}`, { retryable: true });
  }
}

/**
 * Screenshot action: Launch headless Playwright browser, navigate, and take a real screenshot.
 * Returns the file path so agents can pass it to MiniMax understand_image for visual analysis.
 * Falls back to curl HTML fetch if Playwright is not installed.
 */
async function screenshotAction(url: string, selector?: string): Promise<Result<BrowserToolsResult>> {
  // Ensure screenshot output directory exists
  const screenshotDir = join(tmpdir(), 'overlord-screenshots');
  if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
  }
  const timestamp = Date.now();
  const filename = `screenshot-${timestamp}.png`;
  const screenshotPath = join(screenshotDir, filename);

  // Step 1: Try to import Playwright (may not be installed)
  let chromiumModule: { launch: (opts: { headless: boolean }) => Promise<unknown> };
  try {
    const pw = await import('playwright');
    chromiumModule = pw.chromium;
  } catch {
    // Playwright not installed — fall back to curl HTML fetch
    const result = await executeShell({
      command: `curl -sL -m 10 '${url.replace(/'/g, "'\\''")}' | head -100`,
      timeout: 15_000,
    });

    const html = result.stdout;
    const title = extractTitle(html);

    return ok({
      action: 'screenshot',
      url,
      title,
      html: html.slice(0, 5000),
      output: `[Playwright unavailable — HTML fallback] Fetched HTML preview (${html.length} chars)${title ? ` — title: "${title}"` : ''}. Install Playwright for real screenshots: npx playwright install chromium`,
    });
  }

  // Step 2: Playwright is available — launch browser and screenshot
  const browser = await (chromiumModule as { launch: (o: object) => Promise<{ newPage: (o: object) => Promise<{ goto: (u: string, o: object) => Promise<void>; $: (s: string) => Promise<{ screenshot: (o: object) => Promise<void> } | null>; screenshot: (o: object) => Promise<void>; title: () => Promise<string> }>; close: () => Promise<void> }> }).launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });

    if (selector) {
      const element = await page.$(selector);
      if (element) {
        await element.screenshot({ path: screenshotPath });
      } else {
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }
    } else {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }

    const title = await page.title();

    return ok({
      action: 'screenshot',
      url,
      title,
      screenshotPath,
      output: `Screenshot saved to ${screenshotPath} (1280x720)${title ? ` — title: "${title}"` : ''}. Use MiniMax understand_image tool to analyze this screenshot visually.`,
    });
  } finally {
    await browser.close();
  }
}

/**
 * Navigate action: HTTP GET, return status code and title.
 */
async function navigateAction(url: string): Promise<Result<BrowserToolsResult>> {
  const result = await executeShell({
    command: `curl -sL -o /dev/null -w "%{http_code}" -m 10 '${url.replace(/'/g, "'\\''")}'`,
    timeout: 15_000,
  });

  const statusCode = parseInt(result.stdout.trim(), 10) || 0;

  // Also fetch the page to get the title
  const pageResult = await executeShell({
    command: `curl -sL -m 10 '${url.replace(/'/g, "'\\''")}' | head -50`,
    timeout: 15_000,
  });

  const title = extractTitle(pageResult.stdout);

  return ok({
    action: 'navigate',
    url,
    statusCode,
    title,
    output: `HTTP ${statusCode}${title ? ` — "${title}"` : ''}`,
  });
}

/**
 * Inspect action: Fetch page HTML and extract basic structure.
 */
async function inspectAction(url: string): Promise<Result<BrowserToolsResult>> {
  const result = await executeShell({
    command: `curl -sL -m 10 '${url.replace(/'/g, "'\\''")}'`,
    timeout: 15_000,
  });

  const html = result.stdout;
  const title = extractTitle(html);
  const structure = extractStructure(html);

  return ok({
    action: 'inspect',
    url,
    title,
    html: html.slice(0, 10_000),
    output: `Page structure:\n${structure}`,
  });
}
