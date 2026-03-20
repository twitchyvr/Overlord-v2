/**
 * Overlord v2 — E2E Test Template: Socket.IO API
 *
 * USE THIS TEMPLATE when testing Socket.IO API endpoints directly.
 * This is useful for:
 *   - Testing API behavior without UI interaction
 *   - Verifying data round-trips (create → fetch → verify)
 *   - Testing error handling and edge cases
 *   - Setting up complex test data quickly
 *
 * Pattern:
 *   - Uses page.evaluate() to call window.overlordSocket methods
 *   - Tests API contracts: success responses, error responses, validation
 *   - Verifies persistence: create → fetch → matches
 *
 * Naming convention: <entity>-api.spec.ts
 * Example: building-api.spec.ts, agent-api.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Socket API: [ENTITY NAME]
// ────────────────────────────────────────────────────────────────

test.describe('[Entity] Socket.IO API', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'API Test Building');
    await selectBuilding(page, buildingId);
  });

  // ═══════════════════════════════════════════════════════════
  // Section 1: Create Operations
  // ═══════════════════════════════════════════════════════════

  test('create returns ok:true with valid data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      // Replace with actual API call:
      // const res = await window.overlordSocket.createEntity({ name: 'Test' });
      // return res;
      return { ok: true };
    });

    expect(result?.ok).toBe(true);
    // expect(result.data?.id).toBeTruthy();
    // expect(result.data?.name).toBe('Test');
  });

  test('create returns error with invalid data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      // Replace with actual API call with invalid data:
      // const res = await window.overlordSocket.createEntity({});
      // return res;
      return { ok: false, error: { code: 'VALIDATION_ERROR' } };
    });

    expect(result?.ok).toBe(false);
    // expect(result?.error?.code).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════
  // Section 2: Fetch Operations
  // ═══════════════════════════════════════════════════════════

  test('fetch returns created entity with all fields', async ({ page }) => {
    // Create first
    const createResult = await page.evaluate(async () => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      // const res = await window.overlordSocket.createEntity({ name: 'Fetch Test' });
      // return res;
      return { ok: true, data: { id: 'test-id' } };
    });

    expect(createResult?.ok).toBe(true);
    // const entityId = createResult.data.id;

    // Fetch and verify
    // const fetchResult = await page.evaluate(async (id: string) => {
    //   if (!window.overlordSocket) throw new Error('Socket not connected');
    //   const res = await window.overlordSocket.fetchEntity(id);
    //   return res;
    // }, entityId);

    // expect(fetchResult?.ok).toBe(true);
    // expect(fetchResult.data?.name).toBe('Fetch Test');
  });

  test('fetch list returns all created entities', async ({ page }) => {
    // Create multiple
    // for (const name of ['A', 'B', 'C']) {
    //   await page.evaluate(async (n: string) => {
    //     await window.overlordSocket.createEntity({ name: n });
    //   }, name);
    // }

    // Fetch list
    // const listResult = await page.evaluate(async () => {
    //   const res = await window.overlordSocket.fetchEntities();
    //   return res;
    // });

    // expect(listResult?.ok).toBe(true);
    // expect(listResult.data).toBeInstanceOf(Array);
    // expect(listResult.data.length).toBe(3);
  });

  // ═══════════════════════════════════════════════════════════
  // Section 3: Update Operations
  // ═══════════════════════════════════════════════════════════

  test('update modifies entity fields correctly', async ({ page }) => {
    // Create
    // const createResult = await page.evaluate(async () => { ... });
    // const entityId = createResult.data.id;

    // Update
    // const updateResult = await page.evaluate(async (id: string) => {
    //   const res = await window.overlordSocket.updateEntity(id, { name: 'Updated' });
    //   return res;
    // }, entityId);

    // expect(updateResult?.ok).toBe(true);

    // Verify update persisted
    // const fetchResult = await page.evaluate(async (id: string) => {
    //   return await window.overlordSocket.fetchEntity(id);
    // }, entityId);

    // expect(fetchResult.data?.name).toBe('Updated');
  });

  // ═══════════════════════════════════════════════════════════
  // Section 4: Delete Operations
  // ═══════════════════════════════════════════════════════════

  test('delete removes entity and subsequent fetch fails', async ({ page }) => {
    // Create
    // const createResult = await page.evaluate(async () => { ... });
    // const entityId = createResult.data.id;

    // Delete
    // const deleteResult = await page.evaluate(async (id: string) => {
    //   return await window.overlordSocket.deleteEntity(id);
    // }, entityId);

    // expect(deleteResult?.ok).toBe(true);

    // Verify gone from list
    // const listResult = await page.evaluate(async () => {
    //   return await window.overlordSocket.fetchEntities();
    // });

    // const found = (listResult.data || []).find((e: any) => e.id === entityId);
    // expect(found).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════
  // Section 5: CRUD Round-Trip
  // ═══════════════════════════════════════════════════════════

  test('full CRUD lifecycle: create → read → update → delete', async ({ page }) => {
    // Create
    // const created = await page.evaluate(async () => { ... });
    // expect(created?.ok).toBe(true);
    // const id = created.data.id;

    // Read
    // const read = await page.evaluate(async (eid: string) => { ... }, id);
    // expect(read?.ok).toBe(true);

    // Update
    // const updated = await page.evaluate(async (eid: string) => { ... }, id);
    // expect(updated?.ok).toBe(true);

    // Delete
    // const deleted = await page.evaluate(async (eid: string) => { ... }, id);
    // expect(deleted?.ok).toBe(true);

    // Verify gone
    // const verify = await page.evaluate(async () => { ... });
    // expect(verify.data?.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════
  // Section 6: Edge Cases
  // ═══════════════════════════════════════════════════════════

  test('handles non-existent entity gracefully', async ({ page }) => {
    // const result = await page.evaluate(async () => {
    //   return await window.overlordSocket.fetchEntity('non-existent-id');
    // });

    // expect(result?.ok).toBe(false);
    // expect(result?.error?.code).toBe('NOT_FOUND');
  });

  test('handles duplicate creation gracefully', async ({ page }) => {
    // Create first
    // await page.evaluate(async () => {
    //   await window.overlordSocket.createEntity({ name: 'Duplicate' });
    // });

    // Create again with same data
    // const result = await page.evaluate(async () => {
    //   return await window.overlordSocket.createEntity({ name: 'Duplicate' });
    // });

    // Should either succeed (allowing duplicates) or return proper error
    // Adjust based on your API's behavior
  });
});
