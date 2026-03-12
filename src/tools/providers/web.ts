/**
 * Web Tool Provider
 *
 * HTTP-based web search and webpage fetching.
 * Uses DuckDuckGo HTML search (no API key needed) and
 * native fetch() for webpage retrieval with text extraction.
 *
 * All inputs are validated: URL scheme, private IP blocking,
 * bounded maxResults/maxLength, and query length limits.
 */

import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:web' });

/** Hard caps for input parameters — exported for tests */
export const MAX_RESULTS_CAP = 20;
export const MAX_LENGTH_CAP = 100_000;
export const MAX_QUERY_LENGTH = 500;
/** Max response body size we'll read (1 MB) */
const MAX_RESPONSE_BODY = 1_048_576;

/**
 * Validate that a URL uses http: or https: scheme only.
 * Blocks file://, ftp://, data:, javascript:, etc.
 */
function validateUrlScheme(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL scheme "${parsed.protocol}" is not allowed — only http: and https: are permitted`);
  }
}

/**
 * Block requests to private/internal network addresses (SSRF prevention).
 * Rejects localhost, loopback, link-local, and RFC-1918 private ranges.
 */
function blockPrivateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  const hostname = parsed.hostname.toLowerCase();

  // Localhost / loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    throw new Error('Requests to localhost/loopback addresses are blocked');
  }

  // IPv4 private ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) throw new Error('Requests to private network (10.x.x.x) are blocked');
    if (a === 172 && b >= 16 && b <= 31) throw new Error('Requests to private network (172.16-31.x.x) are blocked');
    if (a === 192 && b === 168) throw new Error('Requests to private network (192.168.x.x) are blocked');
    if (a === 169 && b === 254) throw new Error('Requests to link-local address (169.254.x.x) are blocked');
    if (a === 0) throw new Error('Requests to 0.x.x.x are blocked');
  }
}

/**
 * Read response body with a size limit to prevent memory exhaustion.
 * Falls back to text() with truncation.
 */
async function safeReadBody(response: Response, maxBytes: number): Promise<string> {
  // If the response has a content-length header, check it first
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    log.warn({ contentLength, maxBytes }, 'Response body exceeds size limit — will truncate');
  }

  const body = await response.text();
  if (body.length > maxBytes) {
    log.warn({ actual: body.length, limit: maxBytes }, 'Response body truncated');
    return body.slice(0, maxBytes);
  }
  return body;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchParams {
  query: string;
  maxResults?: number;
}

interface FetchWebpageParams {
  url: string;
  maxLength?: number;
}

/**
 * Search the web using DuckDuckGo HTML.
 * Parses the HTML response to extract search results.
 */
export async function webSearch(params: WebSearchParams): Promise<SearchResult[]> {
  const { query, maxResults: rawMax = 5 } = params;

  // Validate query length
  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(`Query too long: ${query.length} characters (max ${MAX_QUERY_LENGTH})`);
  }

  // Cap maxResults
  const maxResults = Math.min(Math.max(1, rawMax), MAX_RESULTS_CAP);

  log.info({ query, maxResults }, 'Web search');

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Overlord-v2/1.0 (AI Agent Framework)',
    },
  });

  if (!response.ok) {
    throw new Error(`Search failed: HTTP ${response.status}`);
  }

  const html = await safeReadBody(response, MAX_RESPONSE_BODY);
  return parseDuckDuckGoResults(html, maxResults);
}

/**
 * Parse DuckDuckGo HTML search results.
 * Extracts title, URL, and snippet from result divs.
 */
function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks
  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const titles: { url: string; title: string }[] = [];
  const snippets: string[] = [];

  let match;
  while ((match = resultPattern.exec(html)) !== null && titles.length < maxResults) {
    const rawUrl = match[1];
    const title = stripHtmlTags(match[2]).trim();
    const actualUrl = extractDDGUrl(rawUrl);
    if (title && actualUrl) {
      titles.push({ url: actualUrl, title });
    }
  }

  while ((match = snippetPattern.exec(html)) !== null && snippets.length < maxResults) {
    snippets.push(stripHtmlTags(match[1]).trim());
  }

  for (let i = 0; i < titles.length; i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

/**
 * Extract actual URL from DuckDuckGo redirect URL
 */
function extractDDGUrl(redirectUrl: string): string {
  try {
    if (redirectUrl.includes('uddg=')) {
      const url = new URL(redirectUrl, 'https://duckduckgo.com');
      const actualUrl = url.searchParams.get('uddg');
      return actualUrl || redirectUrl;
    }
    return redirectUrl;
  } catch {
    return redirectUrl;
  }
}

/**
 * Strip HTML tags from a string
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Fetch a webpage and extract its text content.
 * Strips HTML tags and returns plain text.
 */
export async function fetchWebpage(params: FetchWebpageParams): Promise<{
  url: string;
  title: string;
  content: string;
}> {
  const { url, maxLength: rawMax = 10000 } = params;

  // Validate URL scheme (http/https only)
  validateUrlScheme(url);

  // Block private/internal network addresses (SSRF prevention)
  blockPrivateUrl(url);

  // Cap maxLength
  const maxLength = Math.min(Math.max(1, rawMax), MAX_LENGTH_CAP);

  log.info({ url, maxLength }, 'Fetching webpage');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Overlord-v2/1.0 (AI Agent Framework)',
      Accept: 'text/html,application/xhtml+xml,text/plain',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status} for ${url}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const body = await safeReadBody(response, MAX_RESPONSE_BODY);

  // If it's plain text, return directly
  if (contentType.includes('text/plain')) {
    return { url, title: '', content: body.slice(0, maxLength) };
  }

  // Extract title
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtmlTags(titleMatch[1]).trim() : '';

  // Extract main content — prefer <main>, <article>, or <body>
  const mainMatch = body.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const articleMatch = body.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const rawHtml = mainMatch?.[1] || articleMatch?.[1] || bodyMatch?.[1] || body;

  // Remove scripts, styles, nav, header, footer
  let content = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  content = stripHtmlTags(content)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  return { url, title, content };
}
