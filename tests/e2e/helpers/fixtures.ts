/**
 * Overlord v2 — E2E Test Fixtures
 *
 * Reusable test fixtures that extend Playwright's base test with common setup.
 * Use these instead of repeating boilerplate in every spec file.
 *
 * Usage:
 *   import { test, expect } from './helpers/fixtures.js';
 *   // Instead of: import { test, expect } from '@playwright/test';
 *
 *   test('my test', async ({ connectedPage, buildingId }) => {
 *     // connectedPage = page already connected to Overlord
 *     // buildingId = pre-created building already selected
 *   });
 */

import { test as base, expect, type Page } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
  navigateToView,
  createAgentDirect,
  createTaskDirect,
  createFloorDirect,
  createRoomDirect,
} from './overlord.js';

// ────────────────────────────────────────────────────────────────
// Extended Fixtures
// ────────────────────────────────────────────────────────────────

type OverlordFixtures = {
  /** Page with Overlord connected (socket ready, loading complete) */
  connectedPage: Page;

  /** Pre-created building ID (building already selected) */
  buildingId: string;

  /** Pre-created building with a full floor + room structure */
  fullBuilding: {
    buildingId: string;
    floorId: string;
    roomId: string;
  };

  /** Pre-created building with an agent */
  buildingWithAgent: {
    buildingId: string;
    agentId: string;
  };

  /** Pre-created building with tasks */
  buildingWithTasks: {
    buildingId: string;
    taskIds: string[];
  };

  /** Console error collector — captures errors during test */
  consoleErrors: string[];
};

export const test = base.extend<OverlordFixtures>({
  // ── Connected Page ──────────────────────────────────────────
  connectedPage: async ({ page }, use) => {
    await gotoAppAndConnect(page);
    await use(page);
  },

  // ── Building (created + selected) ──────────────────────────
  buildingId: async ({ page }, use) => {
    await gotoAppAndConnect(page);
    const buildingId = await createBuildingDirect(page, `Test ${Date.now()}`);
    await selectBuilding(page, buildingId);
    await use(buildingId);
  },

  // ── Full Building (building + floor + room) ────────────────
  fullBuilding: async ({ page }, use) => {
    await gotoAppAndConnect(page);
    const buildingId = await createBuildingDirect(page, `Full Building ${Date.now()}`);
    await selectBuilding(page, buildingId);
    const floorId = await createFloorDirect(page, buildingId, 'execution', 'Test Floor');
    const roomId = await createRoomDirect(page, floorId, 'code-lab', 'Test Code Lab');
    await use({ buildingId, floorId, roomId });
  },

  // ── Building with Agent ────────────────────────────────────
  buildingWithAgent: async ({ page }, use) => {
    await gotoAppAndConnect(page);
    const buildingId = await createBuildingDirect(page, `Agent Building ${Date.now()}`);
    await selectBuilding(page, buildingId);
    const agentId = await createAgentDirect(page, 'Test Agent', 'developer');
    await use({ buildingId, agentId });
  },

  // ── Building with Tasks ────────────────────────────────────
  buildingWithTasks: async ({ page }, use) => {
    await gotoAppAndConnect(page);
    const buildingId = await createBuildingDirect(page, `Task Building ${Date.now()}`);
    await selectBuilding(page, buildingId);
    const taskIds = [];
    for (let i = 0; i < 3; i++) {
      const id = await createTaskDirect(page, buildingId, `Task ${i + 1}`, '', 'normal');
      taskIds.push(id);
    }
    await use({ buildingId, taskIds });
  },

  // ── Console Error Collector ────────────────────────────────
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    await use(errors);
  },
});

export { expect };

// ────────────────────────────────────────────────────────────────
// Assertion Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Assert that an action completes within a time budget.
 * Useful for performance assertions.
 */
export async function assertWithinTime(
  action: () => Promise<void>,
  maxMs: number,
  label: string = 'action'
): Promise<number> {
  const start = Date.now();
  await action();
  const elapsed = Date.now() - start;
  expect(elapsed, `${label} took ${elapsed}ms, max ${maxMs}ms`).toBeLessThan(maxMs);
  return elapsed;
}

/**
 * Assert no unexpected console errors occurred.
 * Filters out known/expected errors (favicon, API keys, etc.)
 */
export function assertNoUnexpectedErrors(
  errors: string[],
  knownPatterns: string[] = ['favicon', 'API key', 'Failed to load resource']
): void {
  const unexpected = errors.filter(
    (e) => !knownPatterns.some((p) => e.includes(p))
  );
  expect(unexpected, `Unexpected console errors: ${unexpected.join(', ')}`).toHaveLength(0);
}

/**
 * Wait for a Socket.IO event to be emitted (via bus observer).
 * Useful for testing event-driven flows.
 */
export async function waitForSocketEvent(
  page: Page,
  eventName: string,
  timeoutMs: number = 10_000
): Promise<any> {
  return page.evaluate(
    async ({ event, timeout }: { event: string; timeout: number }) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
        const socket = (window as any).overlordSocket?.socket;
        if (!socket) {
          clearTimeout(timer);
          reject(new Error('Socket not connected'));
          return;
        }
        socket.once(event, (data: any) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
    },
    { event: eventName, timeout: timeoutMs }
  );
}
