/**
 * Web Tool Provider Tests
 *
 * Tests web search and webpage fetch with mocked fetch().
 * No actual network calls — all HTTP responses are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webSearch, fetchWebpage, MAX_RESULTS_CAP, MAX_LENGTH_CAP, MAX_QUERY_LENGTH } from '../../../src/tools/providers/web.js';

// Mock global fetch
const mockFetch = vi.fn();

describe('Web Tool Provider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('webSearch', () => {
    it('sends query to DuckDuckGo HTML endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '<html></html>',
      });

      await webSearch({ query: 'test query' });

      expect(mockFetch).toHaveBeenCalledOnce();
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('html.duckduckgo.com');
      expect(callUrl).toContain('q=test%20query');
    });

    it('parses search results from DuckDuckGo HTML', async () => {
      const html = `
        <div class="results">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=abc">Example Page One</a>
          <a class="result__snippet" href="#">This is the first result snippet</a>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2&rut=def">Example Page Two</a>
          <a class="result__snippet" href="#">This is the second result snippet</a>
        </div>
      `;

      mockFetch.mockResolvedValue({ ok: true, text: async () => html });

      const results = await webSearch({ query: 'test' });
      expect(results.length).toBe(2);
      expect(results[0].title).toBe('Example Page One');
      expect(results[0].url).toBe('https://example.com/page1');
      expect(results[0].snippet).toBe('This is the first result snippet');
      expect(results[1].title).toBe('Example Page Two');
    });

    it('respects maxResults parameter', async () => {
      const html = `
        <a class="result__a" href="https://a.com">A</a>
        <a class="result__snippet" href="#">Snippet A</a>
        <a class="result__a" href="https://b.com">B</a>
        <a class="result__snippet" href="#">Snippet B</a>
        <a class="result__a" href="https://c.com">C</a>
        <a class="result__snippet" href="#">Snippet C</a>
      `;

      mockFetch.mockResolvedValue({ ok: true, text: async () => html });

      const results = await webSearch({ query: 'test', maxResults: 2 });
      expect(results.length).toBe(2);
    });

    it('returns empty array when no results found', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '<html><body>No results</body></html>',
      });

      const results = await webSearch({ query: 'impossible query xyz' });
      expect(results).toEqual([]);
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      await expect(webSearch({ query: 'test' })).rejects.toThrow('HTTP 503');
    });

    it('strips HTML tags from titles and snippets', async () => {
      const html = `
        <a class="result__a" href="https://example.com">Title with <b>bold</b> text</a>
        <a class="result__snippet" href="#">Snippet with <em>emphasis</em> &amp; entities</a>
      `;

      mockFetch.mockResolvedValue({ ok: true, text: async () => html });

      const results = await webSearch({ query: 'test' });
      expect(results[0].title).toBe('Title with bold text');
      expect(results[0].snippet).toBe('Snippet with emphasis & entities');
    });

    it('defaults maxResults to 5', async () => {
      // Create 10 results
      let html = '';
      for (let i = 0; i < 10; i++) {
        html += `<a class="result__a" href="https://example.com/${i}">Result ${i}</a>\n`;
        html += `<a class="result__snippet" href="#">Snippet ${i}</a>\n`;
      }

      mockFetch.mockResolvedValue({ ok: true, text: async () => html });

      const results = await webSearch({ query: 'test' });
      expect(results.length).toBe(5);
    });

    it('sends correct User-Agent header', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => '' });
      await webSearch({ query: 'test' });

      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.headers['User-Agent']).toContain('Overlord');
    });
  });

  describe('fetchWebpage', () => {
    it('fetches and extracts text from HTML page', async () => {
      const html = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <nav>Navigation</nav>
            <main><p>Main content here</p></main>
            <footer>Footer</footer>
          </body>
        </html>
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => html,
      });

      const result = await fetchWebpage({ url: 'https://example.com' });
      expect(result.url).toBe('https://example.com');
      expect(result.title).toBe('Test Page');
      expect(result.content).toContain('Main content here');
      // Should strip nav and footer
      expect(result.content).not.toContain('Navigation');
      expect(result.content).not.toContain('Footer');
    });

    it('returns plain text content directly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => 'Plain text content',
      });

      const result = await fetchWebpage({ url: 'https://example.com/file.txt' });
      expect(result.content).toBe('Plain text content');
      expect(result.title).toBe('');
    });

    it('respects maxLength parameter', async () => {
      const longContent = 'A'.repeat(50000);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => longContent,
      });

      const result = await fetchWebpage({ url: 'https://example.com', maxLength: 100 });
      expect(result.content.length).toBe(100);
    });

    it('defaults maxLength to 10000', async () => {
      const longContent = 'X'.repeat(20000);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => longContent,
      });

      const result = await fetchWebpage({ url: 'https://example.com' });
      expect(result.content.length).toBe(10000);
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(fetchWebpage({ url: 'https://example.com/missing' }))
        .rejects.toThrow('HTTP 404');
    });

    it('removes script and style tags from content', async () => {
      const html = `
        <html>
          <head><title>Test</title></head>
          <body>
            <script>alert('xss')</script>
            <style>.foo { color: red; }</style>
            <p>Real content</p>
          </body>
        </html>
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => html,
      });

      const result = await fetchWebpage({ url: 'https://example.com' });
      expect(result.content).toContain('Real content');
      expect(result.content).not.toContain('alert');
      expect(result.content).not.toContain('color: red');
    });

    it('prefers <article> over <body> for content extraction', async () => {
      const html = `
        <html>
          <head><title>Article Page</title></head>
          <body>
            <header>Site Header</header>
            <article><p>Article content</p></article>
            <aside>Sidebar</aside>
          </body>
        </html>
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => html,
      });

      const result = await fetchWebpage({ url: 'https://example.com/article' });
      expect(result.content).toContain('Article content');
    });

    it('decodes HTML entities in content', async () => {
      const html = `
        <html>
          <head><title>Entities &amp; Test</title></head>
          <body><p>Price: &lt;$10 &amp; &gt;$5 &quot;sale&quot;</p></body>
        </html>
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => html,
      });

      const result = await fetchWebpage({ url: 'https://example.com' });
      expect(result.title).toBe('Entities & Test');
      expect(result.content).toContain('<$10');
      expect(result.content).toContain('>$5');
    });
  });

  describe('input validation — URL scheme', () => {
    it('rejects file:// URLs', async () => {
      await expect(fetchWebpage({ url: 'file:///etc/passwd' }))
        .rejects.toThrow('URL scheme "file:" is not allowed');
    });

    it('rejects ftp:// URLs', async () => {
      await expect(fetchWebpage({ url: 'ftp://example.com/pub' }))
        .rejects.toThrow('URL scheme "ftp:" is not allowed');
    });

    it('rejects data: URLs', async () => {
      await expect(fetchWebpage({ url: 'data:text/html,<script>alert(1)</script>' }))
        .rejects.toThrow('URL scheme "data:" is not allowed');
    });

    it('rejects javascript: URLs', async () => {
      await expect(fetchWebpage({ url: 'javascript:alert(1)' }))
        .rejects.toThrow('URL scheme "javascript:" is not allowed');
    });

    it('rejects invalid URLs', async () => {
      await expect(fetchWebpage({ url: 'not a url' }))
        .rejects.toThrow('Invalid URL');
    });

    it('allows http:// URLs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => 'ok',
      });
      const result = await fetchWebpage({ url: 'http://example.com' });
      expect(result.content).toBe('ok');
    });

    it('allows https:// URLs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => 'ok',
      });
      const result = await fetchWebpage({ url: 'https://example.com' });
      expect(result.content).toBe('ok');
    });
  });

  describe('input validation — SSRF prevention', () => {
    it('blocks localhost', async () => {
      await expect(fetchWebpage({ url: 'http://localhost:3000' }))
        .rejects.toThrow('localhost/loopback');
    });

    it('blocks 127.0.0.1', async () => {
      await expect(fetchWebpage({ url: 'http://127.0.0.1:8080' }))
        .rejects.toThrow('localhost/loopback');
    });

    it('blocks ::1 (IPv6 loopback)', async () => {
      await expect(fetchWebpage({ url: 'http://[::1]:8080' }))
        .rejects.toThrow('localhost/loopback');
    });

    it('blocks 10.x.x.x (RFC-1918)', async () => {
      await expect(fetchWebpage({ url: 'http://10.0.0.1' }))
        .rejects.toThrow('private network (10.x.x.x)');
    });

    it('blocks 172.16.x.x (RFC-1918)', async () => {
      await expect(fetchWebpage({ url: 'http://172.16.0.1' }))
        .rejects.toThrow('private network (172.16-31.x.x)');
    });

    it('blocks 172.31.x.x (RFC-1918 upper bound)', async () => {
      await expect(fetchWebpage({ url: 'http://172.31.255.255' }))
        .rejects.toThrow('private network (172.16-31.x.x)');
    });

    it('blocks 192.168.x.x (RFC-1918)', async () => {
      await expect(fetchWebpage({ url: 'http://192.168.1.1' }))
        .rejects.toThrow('private network (192.168.x.x)');
    });

    it('blocks 169.254.x.x (link-local)', async () => {
      await expect(fetchWebpage({ url: 'http://169.254.169.254' }))
        .rejects.toThrow('link-local');
    });

    it('allows public IP addresses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => 'ok',
      });
      const result = await fetchWebpage({ url: 'http://93.184.216.34' });
      expect(result.content).toBe('ok');
    });
  });

  describe('input validation — bounds checking', () => {
    it('caps maxResults at MAX_RESULTS_CAP', async () => {
      // Create more results than the cap allows
      let html = '';
      for (let i = 0; i < MAX_RESULTS_CAP + 20; i++) {
        html += `<a class="result__a" href="https://example.com/${i}">Result ${i}</a>\n`;
        html += `<a class="result__snippet" href="#">Snippet ${i}</a>\n`;
      }
      mockFetch.mockResolvedValue({ ok: true, text: async () => html });

      const results = await webSearch({ query: 'test', maxResults: 999 });
      expect(results.length).toBe(MAX_RESULTS_CAP);
    });

    it('caps maxLength at MAX_LENGTH_CAP', async () => {
      const longContent = 'A'.repeat(MAX_LENGTH_CAP + 100_000);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => longContent,
      });

      const result = await fetchWebpage({ url: 'https://example.com', maxLength: 999_999 });
      expect(result.content.length).toBe(MAX_LENGTH_CAP);
    });

    it('rejects query longer than MAX_QUERY_LENGTH', async () => {
      const longQuery = 'a'.repeat(MAX_QUERY_LENGTH + 1);
      await expect(webSearch({ query: longQuery }))
        .rejects.toThrow(`Query too long: ${longQuery.length} characters`);
    });

    it('accepts query at exactly MAX_QUERY_LENGTH', async () => {
      const exactQuery = 'a'.repeat(MAX_QUERY_LENGTH);
      mockFetch.mockResolvedValue({ ok: true, text: async () => '' });

      const results = await webSearch({ query: exactQuery });
      expect(results).toEqual([]);
    });

    it('ensures maxResults is at least 1', async () => {
      const html = `
        <a class="result__a" href="https://example.com/1">R1</a>
        <a class="result__snippet" href="#">S1</a>
      `;
      mockFetch.mockResolvedValue({ ok: true, text: async () => html });

      const results = await webSearch({ query: 'test', maxResults: 0 });
      expect(results.length).toBe(1);
    });

    it('ensures maxLength is at least 1', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => 'Some content',
      });

      const result = await fetchWebpage({ url: 'https://example.com', maxLength: 0 });
      expect(result.content.length).toBe(1);
    });
  });

  describe('response body size limiting', () => {
    it('truncates oversized response bodies', async () => {
      // Simulate a 2MB response (over the 1MB limit)
      const hugeBody = 'X'.repeat(2_000_000);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => hugeBody,
      });

      const result = await fetchWebpage({ url: 'https://example.com' });
      // Content should be limited by both response body cap and maxLength
      expect(result.content.length).toBeLessThanOrEqual(10000); // default maxLength
    });
  });
});
