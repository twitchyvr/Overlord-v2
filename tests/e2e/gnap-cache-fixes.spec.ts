/**
 * Overlord v2 — E2E Tests: GNAP Scoping & Cache Headers (#623)
 *
 * Verifies:
 * 1. GNAP status/test events require buildingId and return proper error contracts
 * 2. Cache headers are present in dev mode (Cache-Control: no-store)
 * 3. GNAP error responses use ok: false (not ok: true with embedded errors)
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

test.describe('Issue #623: GNAP Scoping & Cache Fixes', () => {

  // ─── Cache Headers ──────────────────────────────────────────────

  test('#623-cache: Static files include no-cache and no-store headers in development', async ({ page }) => {
    // Intercept a static CSS response to check headers set by express.static
    const headerPromise = new Promise<Record<string, string>>((resolve) => {
      page.on('response', (resp) => {
        if (resp.url().includes('.css') || resp.url().includes('.js')) {
          resolve(resp.headers());
        }
      });
    });

    await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded' });

    const headers = await headerPromise;
    // In development, express.static sets no-store, no-cache headers
    expect(headers['cache-control']).toBeDefined();
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['cache-control']).toContain('no-cache');
    expect(headers['pragma']).toBe('no-cache');
  });

  // ─── GNAP Error Contract ────────────────────────────────────────

  test.describe('GNAP scoping with building', () => {
    let buildingId: string;

    test.beforeEach(async ({ page }) => {
      await gotoAppAndConnect(page);
      buildingId = await createBuildingDirect(page, 'GNAP Test Building');
      await selectBuilding(page, buildingId);
    });

    test('#623-gnap: gnap:status returns ok:false when GNAP mode is not active', async ({ page }) => {
      // By default, MESSAGING_MODE is 'internal', not 'gnap'
      const result = await page.evaluate(async (bid: string) => {
        return new Promise((resolve) => {
          window.overlordSocket.socket.emit('gnap:status', { buildingId: bid }, (resp: any) => {
            resolve(resp);
          });
        });
      }, buildingId);

      // Error responses must use ok: false (code review finding #3)
      const resp = result as { ok: boolean; error?: { code: string; message: string } };
      expect(resp.ok).toBe(false);
      expect(resp.error).toBeDefined();
      expect(resp.error!.code).toBe('GNAP_DISABLED');
    });

    test('#623-gnap: gnap:test returns ok:false when GNAP mode is not active', async ({ page }) => {
      const result = await page.evaluate(async (bid: string) => {
        return new Promise((resolve) => {
          window.overlordSocket.socket.emit('gnap:test', { buildingId: bid }, (resp: any) => {
            resolve(resp);
          });
        });
      }, buildingId);

      const resp = result as { ok: boolean; error?: { code: string; message: string } };
      expect(resp.ok).toBe(false);
      expect(resp.error).toBeDefined();
      expect(resp.error!.code).toBe('GNAP_DISABLED');
    });

    test('#623-gnap: gnap:status requires buildingId (Zod validation)', async ({ page }) => {
      // Send empty payload — should fail Zod validation
      const result = await page.evaluate(async () => {
        return new Promise((resolve) => {
          window.overlordSocket.socket.emit('gnap:status', {}, (resp: any) => {
            resolve(resp);
          });
        });
      });

      // Zod validation failure should return ok: false
      const resp = result as { ok: boolean; error?: { code: string } };
      expect(resp.ok).toBe(false);
    });

    test('#623-gnap: gnap:test requires buildingId (Zod validation)', async ({ page }) => {
      // Send empty payload — should fail Zod validation
      const result = await page.evaluate(async () => {
        return new Promise((resolve) => {
          window.overlordSocket.socket.emit('gnap:test', {}, (resp: any) => {
            resolve(resp);
          });
        });
      });

      const resp = result as { ok: boolean; error?: { code: string } };
      expect(resp.ok).toBe(false);
    });

    test('#623-gnap: Settings panel opens via settings button', async ({ page }) => {
      // Settings uses #settings-btn (icon button), not a data-view toolbar button
      const settingsBtn = page.locator('#settings-btn');
      await expect(settingsBtn).toBeVisible({ timeout: 5000 });
      await settingsBtn.click();
      await page.waitForTimeout(1000);

      // Settings panel should be visible
      const settingsPanel = page.locator('.settings-view, .settings-panel, [class*="settings"]');
      await expect(settingsPanel.first()).toBeVisible({ timeout: 5000 });
    });
  });
});
