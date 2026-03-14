/**
 * Browser Tools Provider
 *
 * Foundation for browser automation. Currently uses shell commands (curl)
 * as a placeholder. Full Playwright integration will replace this later.
 *
 * Actions: screenshot (basic HTML fetch), navigate (HTTP GET), inspect (HTML structure)
 */

import { ok, err } from '../../core/contracts.js';
import { executeShell } from './shell.js';
import type { Result } from '../../core/contracts.js';

export type BrowserAction = 'screenshot' | 'navigate' | 'inspect';

export interface BrowserToolsResult {
  action: BrowserAction;
  url: string;
  statusCode?: number;
  title?: string;
  html?: string;
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

export async function executeBrowserTools(params: {
  action: BrowserAction;
  url: string;
  selector?: string;
}): Promise<Result<BrowserToolsResult>> {
  const { action, url } = params;

  if (!url) {
    return err('MISSING_URL', 'URL is required', { retryable: false });
  }

  try {
    switch (action) {
      case 'screenshot':
        return await screenshotAction(url);
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
 * Screenshot action: Fetch the first 100 lines of HTML as a placeholder.
 * Full Playwright screenshot support will replace this.
 */
async function screenshotAction(url: string): Promise<Result<BrowserToolsResult>> {
  const result = await executeShell({
    command: `curl -sL -m 10 "${url}" | head -100`,
    timeout: 15_000,
  });

  const html = result.stdout;
  const title = extractTitle(html);

  return ok({
    action: 'screenshot',
    url,
    title,
    html: html.slice(0, 5000),
    output: `Fetched HTML preview (${html.length} chars)${title ? ` — title: "${title}"` : ''}`,
  });
}

/**
 * Navigate action: HTTP GET, return status code and title.
 */
async function navigateAction(url: string): Promise<Result<BrowserToolsResult>> {
  const result = await executeShell({
    command: `curl -sL -o /dev/null -w "%{http_code}" -m 10 "${url}"`,
    timeout: 15_000,
  });

  const statusCode = parseInt(result.stdout.trim(), 10) || 0;

  // Also fetch the page to get the title
  const pageResult = await executeShell({
    command: `curl -sL -m 10 "${url}" | head -50`,
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
    command: `curl -sL -m 10 "${url}"`,
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
