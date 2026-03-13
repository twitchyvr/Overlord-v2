import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeBrowserTools } from '../../../src/tools/providers/browser-tools.js';

vi.mock('../../../src/tools/providers/shell.js', () => ({ executeShell: vi.fn() }));

import { executeShell } from '../../../src/tools/providers/shell.js';
const mockShell = vi.mocked(executeShell);

beforeEach(() => { vi.clearAllMocks(); });

describe('Browser Tools', () => {
  describe('screenshot action', () => {
    it('fetches HTML preview', async () => {
      mockShell.mockResolvedValue({
        stdout: '<html><head><title>Test Page</title></head><body>Hello</body></html>',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const r = await executeBrowserTools({ action: 'screenshot', url: 'http://localhost:3000' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('screenshot');
        expect(r.data.url).toBe('http://localhost:3000');
        expect(r.data.title).toBe('Test Page');
        expect(r.data.html).toContain('<html>');
        expect(r.data.output).toContain('Fetched HTML preview');
      }
    });

    it('handles page without title', async () => {
      mockShell.mockResolvedValue({
        stdout: '<html><body>No title here</body></html>',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const r = await executeBrowserTools({ action: 'screenshot', url: 'http://localhost:3000' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.title).toBeUndefined();
      }
    });
  });

  describe('navigate action', () => {
    it('returns status code and title', async () => {
      // First call returns status code, second returns HTML
      mockShell
        .mockResolvedValueOnce({ stdout: '200', stderr: '', exitCode: 0, timedOut: false })
        .mockResolvedValueOnce({
          stdout: '<html><head><title>My App</title></head></html>',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        });

      const r = await executeBrowserTools({ action: 'navigate', url: 'http://example.com' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('navigate');
        expect(r.data.statusCode).toBe(200);
        expect(r.data.title).toBe('My App');
        expect(r.data.output).toContain('HTTP 200');
      }
    });

    it('handles non-200 status codes', async () => {
      mockShell
        .mockResolvedValueOnce({ stdout: '404', stderr: '', exitCode: 0, timedOut: false })
        .mockResolvedValueOnce({ stdout: '<html><head><title>Not Found</title></head></html>', stderr: '', exitCode: 0, timedOut: false });

      const r = await executeBrowserTools({ action: 'navigate', url: 'http://example.com/missing' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.statusCode).toBe(404);
      }
    });

    it('handles unparseable status code', async () => {
      mockShell
        .mockResolvedValueOnce({ stdout: 'error', stderr: '', exitCode: 1, timedOut: false })
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1, timedOut: false });

      const r = await executeBrowserTools({ action: 'navigate', url: 'http://invalid' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.statusCode).toBe(0);
      }
    });
  });

  describe('inspect action', () => {
    it('extracts page structure', async () => {
      mockShell.mockResolvedValue({
        stdout: `<html>
          <head><title>Test</title></head>
          <body>
            <h1>Main Heading</h1>
            <h2>Sub Heading</h2>
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
            <form action="/submit"></form>
          </body>
        </html>`,
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const r = await executeBrowserTools({ action: 'inspect', url: 'http://localhost:3000' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.action).toBe('inspect');
        expect(r.data.title).toBe('Test');
        expect(r.data.output).toContain('Main Heading');
        expect(r.data.output).toContain('Sub Heading');
        expect(r.data.output).toContain('About');
        expect(r.data.output).toContain('/contact');
        expect(r.data.output).toContain('Forms: 1');
      }
    });

    it('handles empty page', async () => {
      mockShell.mockResolvedValue({
        stdout: '<html><body></body></html>',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const r = await executeBrowserTools({ action: 'inspect', url: 'http://localhost:3000' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.output).toContain('No structural elements found');
      }
    });
  });

  describe('error handling', () => {
    it('rejects missing URL', async () => {
      const r = await executeBrowserTools({ action: 'screenshot', url: '' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('MISSING_URL');
    });

    it('rejects unknown action', async () => {
      const r = await executeBrowserTools({ action: 'unknown' as 'screenshot', url: 'http://test.com' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_ACTION');
    });

    it('catches shell errors', async () => {
      mockShell.mockRejectedValue(new Error('curl failed'));
      const r = await executeBrowserTools({ action: 'screenshot', url: 'http://test.com' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('BROWSER_ERROR');
    });
  });
});
