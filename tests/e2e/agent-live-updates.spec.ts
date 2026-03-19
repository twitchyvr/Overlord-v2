/**
 * E2E tests for Issue #850: Agent panel live-updates
 *
 * Verifies that:
 * 1. New agents appear in the agents panel immediately after creation
 * 2. Agent count increases when agents are added
 * 3. Events are scoped to the active building (no cross-project bleed)
 */
import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  createBuildingDirect,
  selectBuilding,
} from './helpers/overlord.js';

/** Click the Agents toolbar button and wait for the agents view heading. */
async function goToAgentsView(page: import('@playwright/test').Page) {
  const btn = page.locator('#app-toolbar .toolbar-btn[data-view="agents"]');
  await btn.click();
  await page.waitForSelector('text=Agents', { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/** Create agent via raw socket with profile fields to prevent auto-rename. */
async function createTestAgent(
  page: import('@playwright/test').Page,
  name: string,
  role: string,
  buildingId: string,
) {
  return page.evaluate(
    async (args: { name: string; role: string; buildingId: string }) => {
      const socket = (window as any).overlordSocket?.socket;
      if (!socket) throw new Error('Socket not connected');
      return new Promise<string>((resolve, reject) => {
        socket.emit('agent:register', {
          name: args.name,
          role: args.role,
          capabilities: ['chat'],
          roomAccess: ['*'],
          buildingId: args.buildingId,
          firstName: args.name,
          bio: 'Test agent',
        }, (res: any) => {
          if (res?.ok) resolve(res.data.id);
          else reject(new Error(res?.error?.message || 'Failed'));
        });
      });
    },
    { name, role, buildingId }
  );
}

test.describe('Issue #850: Agent Panel Live Updates', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, `LiveUpdate Test ${Date.now()}`);
    await selectBuilding(page, buildingId);
    await goToAgentsView(page);
  });

  test('#850: newly created agent increases the agent count', async ({ page }) => {
    // Count agents before (onboarding auto-creates a strategist = 1)
    const beforeCount = await page.locator('.agents-view-card').count();
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    // Create a new agent
    await createTestAgent(page, 'TestDevAgent', 'developer', buildingId);
    await page.waitForTimeout(2000);

    // Count should increase by 1
    const afterCount = await page.locator('.agents-view-card').count();
    expect(afterCount).toBe(beforeCount + 1);
  });

  test('#850: agent profile update does not crash or remove agent', async ({ page }) => {
    const agentId = await createTestAgent(page, 'UpdateAgent', 'developer', buildingId);
    await page.waitForTimeout(1500);

    const beforeCount = await page.locator('.agents-view-card').count();

    // Update agent status via socket
    await page.evaluate(async (id: string) => {
      const socket = (window as any).overlordSocket?.socket;
      if (!socket) throw new Error('Socket not connected');
      await new Promise<void>((resolve, reject) => {
        socket.emit('agent:update', { agentId: id, status: 'active' }, (res: any) => {
          if (res?.ok) resolve();
          else reject(new Error(res?.error?.message || 'Update failed'));
        });
      });
    }, agentId);

    await page.waitForTimeout(1000);

    // Agent count should not decrease after update
    const afterCount = await page.locator('.agents-view-card').count();
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  test('#850: building isolation — other building agents do not appear', async ({ page }) => {
    // Count agents in current building
    const beforeCount = await page.locator('.agents-view-card').count();

    // Create a second building
    const otherBuildingId = await createBuildingDirect(page, `Other Building ${Date.now()}`);

    // Create agent in the OTHER building (should NOT appear in current view)
    await createTestAgent(page, 'OtherBuildingAgent', 'developer', otherBuildingId);
    await page.waitForTimeout(2000);

    // Count should NOT increase (agent belongs to other building)
    const afterCount = await page.locator('.agents-view-card').count();
    expect(afterCount).toBe(beforeCount);
  });

  test('#850: multiple agents created in sequence all appear', async ({ page }) => {
    const beforeCount = await page.locator('.agents-view-card').count();

    // Create 3 agents
    for (let i = 0; i < 3; i++) {
      await createTestAgent(page, `SeqAgent${i}`, 'developer', buildingId);
      await page.waitForTimeout(500);
    }

    await page.waitForTimeout(2000);

    // Should have 3 more agents than before
    const afterCount = await page.locator('.agents-view-card').count();
    expect(afterCount).toBe(beforeCount + 3);
  });
});
