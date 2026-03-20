# Playwright E2E Test Templates

Copy-and-customize starter templates for writing Overlord v2 E2E tests.

## Quick Start

Use the scaffolding script to generate a new spec file:

```bash
npx tsx scripts/new-e2e-test.ts <template> <name> [--issue <number>]
```

### Examples

```bash
# New feature test
npx tsx scripts/new-e2e-test.ts feature pipeline-status --issue 608

# Bug fix verification
npx tsx scripts/new-e2e-test.ts bugfix settings-tabs --issue 598

# Full view test
npx tsx scripts/new-e2e-test.ts view raid-log

# Regression suite
npx tsx scripts/new-e2e-test.ts regression navigation

# Performance tests
npx tsx scripts/new-e2e-test.ts performance data-load

# Accessibility tests
npx tsx scripts/new-e2e-test.ts accessibility modals
```

## Available Templates

| Template | When to Use | File Pattern |
|----------|-------------|--------------|
| **feature** | New feature or epic — comprehensive test suite | `<feature>.spec.ts` |
| **bugfix** | Bug fix — reproduce the bug, verify the fix | `fix-<issue>.spec.ts` or append to `dogfood-fixes.spec.ts` |
| **view** | Entire view/page — render, interact, state, filters | `<view>-view.spec.ts` |
| **modal-form** | Modal dialog — lifecycle, validation, submit, dismiss | `<entity>-modal.spec.ts` |
| **socket-api** | Socket.IO API — CRUD operations, edge cases | `<entity>-api.spec.ts` |
| **regression** | Quick regression checks per area | `regression-<area>.spec.ts` |
| **accessibility** | Keyboard nav, ARIA, focus management | `accessibility-<area>.spec.ts` |
| **performance** | Timing, large data, rapid interactions | `performance-<area>.spec.ts` |

## Template Structure

Every template follows this pattern:

```typescript
import { test, expect } from '@playwright/test';
import { gotoAppAndConnect, ... } from './helpers/overlord.js';

test.describe('Feature Name', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Test Building');
    await selectBuilding(page, buildingId);
  });

  test('description of expected behavior', async ({ page }) => {
    // Setup → Action → Assertion
  });
});
```

## Key Conventions

1. **Every test is independent** — `beforeEach` creates a fresh building
2. **Use socket helpers for setup** — `createBuildingDirect`, `createAgentDirect`, etc. are faster than UI interactions for test data
3. **Use UI helpers for assertions** — `navigateToView`, `openAgentDetailDrawer`, etc. simulate real user behavior
4. **Reference issue numbers** — `test('#598: Settings tabs switch without hanging', ...)`
5. **Wait for async operations** — Use `waitForTimeout` after socket calls, `waitForSelector` for UI elements
6. **Test both positive and negative paths** — Verify success AND error handling

## Available Helpers

All helpers are in `tests/e2e/helpers/overlord.ts`:

### Navigation
- `gotoAppAndConnect(page)` — Navigate and wait for socket connection
- `navigateToView(page, viewName)` — Switch toolbar view

### Building
- `createBuildingDirect(page, name)` — Create via socket (fast)
- `createBuildingViaStrategist(page, name, template)` — Create via UI (for UI tests)
- `selectBuilding(page, id)` — Activate a building

### Agents
- `createAgentDirect(page, name, role)` — Create via socket
- `createAgentViaUI(page, name, role)` — Create via modal
- `openAgentDetailDrawer(page, name)` — Click agent card

### Tasks
- `createTaskDirect(page, buildingId, title, desc, priority)` — Create via socket
- `createTaskViaUI(page, title, desc, priority)` — Create via modal
- `createTodoDirect(page, taskId, desc, agentId?)` — Create todo via socket
- `openTaskDetailDrawer(page, title)` — Click task card

### Building Config
- `createFloorDirect(page, buildingId, type, name)` — Create floor via socket
- `createRoomDirect(page, floorId, type, name?)` — Create room via socket
- `expandFloor(page, name)` — Expand a floor bar
- `clickAddFloor(page)` — Open add floor modal
- `clickAddRoomOnFloor(page, floorName)` — Open add room modal

### UI Elements
- `waitForModal(page)` — Wait for any modal to open
- `closeModal(page)` — Close topmost modal
- `closeDrawer(page)` — Close open drawer
- `waitForToast(page, text)` — Wait for toast notification
- `expectSuccessToast(page, text?)` — Assert success toast

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run a specific spec
npx playwright test tests/e2e/pipeline-status.spec.ts

# Run with headed browser (see what's happening)
npx playwright test --headed tests/e2e/pipeline-status.spec.ts

# Run with debug mode (step through)
npx playwright test --debug tests/e2e/pipeline-status.spec.ts

# Show HTML report after run
npx playwright show-report test-results/html-report
```
