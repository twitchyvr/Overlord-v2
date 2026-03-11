/**
 * Web Tool Provider
 *
 * HTTP-based web search and webpage fetching.
 * Uses DuckDuckGo HTML search (no API key needed) and
 * native fetch() for webpage retrieval with text extraction.
 */

import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'tool:web' });

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
  const { query, maxResults = 5 } = params;
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

  const html = await response.text();
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
  const { url, maxLength = 10000 } = params;
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
  const body = await response.text();

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
