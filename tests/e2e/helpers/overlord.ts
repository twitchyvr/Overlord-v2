/**
 * Overlord v2 — E2E Test Page Object Helpers
 *
 * Provides high-level actions that map to real user interactions:
 *   - Navigation between views
 *   - Waiting for socket connection
 *   - Creating buildings, agents, tasks
 *   - Interacting with modals, drawers, toasts
 *
 * All methods use real CSS selectors from the actual codebase.
 */

import { type Page, type Locator, expect } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:4000';
const SOCKET_CONNECT_TIMEOUT = 15_000;
const UI_SETTLE_MS = 500;
const MODAL_ANIMATION_MS = 400;
const DRAWER_ANIMATION_MS = 400;

// ────────────────────────────────────────────────────────────────
// Core Navigation & Connection
// ────────────────────────────────────────────────────────────────

/**
 * Navigate to the Overlord app and wait for socket connection.
 * After connection, the loading state disappears and a view renders.
 */
export async function gotoAppAndConnect(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Wait for Socket.IO to connect — indicated by the connection dot
  // turning green (class "connected")
  await page.waitForSelector('#toolbar-connection.connected', {
    timeout: SOCKET_CONNECT_TIMEOUT,
  });

  // Wait for the loading state to disappear (removed after system:status)
  await page.waitForSelector('#loading-state', {
    state: 'detached',
    timeout: SOCKET_CONNECT_TIMEOUT,
  });

  // Brief settle for view rendering
  await page.waitForTimeout(UI_SETTLE_MS);
}

/**
 * Navigate to a specific toolbar view by clicking the toolbar button.
 */
export async function navigateToView(
  page: Page,
  viewName: 'dashboard' | 'chat' | 'agents' | 'tasks' | 'activity' | 'raid-log' | 'phase' | 'strategist'
): Promise<void> {
  const toolbarBtn = page.locator(`#app-toolbar .toolbar-btn[data-view="${viewName}"]`);
  await toolbarBtn.click();

  // Wait for the view container to appear
  await page.waitForSelector(`.view-container.view-${viewName}`, {
    timeout: 10_000,
  });

  // Brief settle for async rendering
  await page.waitForTimeout(UI_SETTLE_MS);
}

// ────────────────────────────────────────────────────────────────
// Building Operations
// ────────────────────────────────────────────────────────────────

/**
 * Create a building via the Strategist view's Quick Start template.
 * This is the primary way to get a building into the system.
 *
 * @param page - Playwright page
 * @param projectName - Name for the project
 * @param template - Template card to click ('web-app' | 'microservices' | etc.)
 * @returns Promise that resolves when building is created and dashboard shows
 */
export async function createBuildingViaStrategist(
  page: Page,
  projectName: string,
  template: string = 'web-app'
): Promise<void> {
  // Navigate to strategist view
  await navigateToView(page, 'strategist');

  // Fill in the project name input
  const nameInput = page.locator('.strategist-view input[type="text"]').first();
  if (await nameInput.isVisible()) {
    await nameInput.fill(projectName);
  }

  // Click the template card
  const templateCard = page.locator(`.template-card[data-template="${template}"], .template-card`).first();
  if (await templateCard.isVisible()) {
    await templateCard.click();
  }

  // Click the Create / Launch button
  const createBtn = page.locator('.btn-primary').filter({ hasText: /create|launch|start/i }).first();
  if (await createBtn.isVisible()) {
    await createBtn.click();
  }

  // Wait for building to be created (toast or navigation)
  await page.waitForTimeout(3000);
}

/**
 * Create a building directly via Socket.IO (faster for test setup).
 * Evaluates JS in the browser context to call window.overlordSocket.
 */
export async function createBuildingDirect(page: Page, name: string): Promise<string> {
  const result = await page.evaluate(async (buildingName: string) => {
    if (!window.overlordSocket) throw new Error('Socket not connected');
    const res = await window.overlordSocket.createBuilding({ name: buildingName });
    if (!res?.ok) throw new Error(res?.error?.message || 'Failed to create building');
    return res.data.id || res.data.buildingId;
  }, name);

  // Wait for store to update and building view to refresh
  await page.waitForTimeout(UI_SETTLE_MS);
  return result;
}

/**
 * Select a building (activates it in the store) via Socket.IO.
 */
export async function selectBuilding(page: Page, buildingId: string): Promise<void> {
  await page.evaluate(async (id: string) => {
    if (!window.overlordSocket) throw new Error('Socket not connected');
    await window.overlordSocket.selectBuilding(id);
  }, buildingId);

  // Wait for data to hydrate (floors, rooms, agents, etc.)
  await page.waitForTimeout(1500);
}

// ────────────────────────────────────────────────────────────────
// Agent Operations
// ────────────────────────────────────────────────────────────────

/**
 * Create an agent via the UI modal in the Agents view.
 */
export async function createAgentViaUI(
  page: Page,
  name: string,
  role: string = 'developer'
): Promise<void> {
  // Click "+ Create Agent" button
  const createBtn = page.locator('.agents-view-actions .btn-primary').filter({ hasText: /create agent/i });
  await createBtn.click();

  // Wait for the create modal to appear
  await page.waitForSelector('.agent-create-form', { timeout: 5000 });
  await page.waitForTimeout(MODAL_ANIMATION_MS);

  // Fill the name field
  const nameInput = page.locator('.agent-create-form .form-input[type="text"]').first();
  await nameInput.fill(name);

  // Select role from the dropdown
  const roleSelect = page.locator('.agent-create-form select.form-input').first();
  await roleSelect.selectOption(role);

  // Uncheck auto-generate profile to avoid external API calls
  const autoGenCheckbox = page.locator('.agent-create-autogen-label input[type="checkbox"]');
  if (await autoGenCheckbox.isChecked()) {
    await autoGenCheckbox.uncheck();
  }

  // Click "Create Agent" submit button
  const submitBtn = page.locator('.agent-create-actions .btn-primary').filter({ hasText: /create agent/i });
  await submitBtn.click();

  // Wait for modal to close (agent created)
  await page.waitForSelector('.agent-create-form', {
    state: 'detached',
    timeout: 10_000,
  });

  // Wait for agent list to update
  await page.waitForTimeout(1000);
}

/**
 * Create an agent directly via Socket.IO (for faster test setup).
 */
export async function createAgentDirect(
  page: Page,
  name: string,
  role: string = 'developer',
  buildingId?: string
): Promise<string> {
  const result = await page.evaluate(
    async ({ agentName, agentRole, bId }: { agentName: string; agentRole: string; bId?: string }) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      // Use provided buildingId, or try to get it from the socket bridge's internal store
      let activeBuildingId = bId;
      if (!activeBuildingId) {
        // Fallback: read from socket bridge's exposed store getter
        try {
          activeBuildingId = (window.overlordSocket as any)._getActiveBuildingId?.() || undefined;
        } catch { /* ignore */ }
      }
      const res = await window.overlordSocket.registerAgent({
        name: agentName,
        role: agentRole,
        capabilities: ['chat'],
        roomAccess: ['*'],
        buildingId: activeBuildingId,
        autoGenerateProfile: false,
      });
      if (!res?.ok) throw new Error(res?.error?.message || 'Failed to create agent');
      return res.data.id;
    },
    { agentName: name, agentRole: role, bId: buildingId }
  );

  await page.waitForTimeout(UI_SETTLE_MS);
  return result;
}

/**
 * Click on an agent card to open the detail drawer.
 */
export async function openAgentDetailDrawer(
  page: Page,
  agentName: string
): Promise<void> {
  // Find the agent card containing the name
  const card = page.locator('.agents-view-card').filter({
    has: page.locator('.agents-view-card-name', { hasText: agentName }),
  });

  await card.click();

  // Wait for drawer to open
  await page.waitForSelector('.drawer.open', { timeout: 5000 });
  await page.waitForTimeout(DRAWER_ANIMATION_MS);
}

/**
 * Close the currently open drawer.
 */
export async function closeDrawer(page: Page): Promise<void> {
  const closeBtn = page.locator('.drawer-close-btn');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    // Wait for animation
    await page.waitForSelector('.drawer.open', {
      state: 'detached',
      timeout: 3000,
    }).catch(() => {
      // Drawer may already be gone
    });
    await page.waitForTimeout(DRAWER_ANIMATION_MS);
  }
}

// ────────────────────────────────────────────────────────────────
// Task Operations
// ────────────────────────────────────────────────────────────────

/**
 * Create a task via the Task view's "New Task" modal.
 */
export async function createTaskViaUI(
  page: Page,
  title: string,
  description: string = '',
  priority: string = 'normal'
): Promise<void> {
  // Click "New Task" button
  const newTaskBtn = page.locator('.task-view-actions .btn-primary').filter({ hasText: /new task/i });
  await newTaskBtn.click();

  // Wait for modal
  await page.waitForSelector('.task-create-form', { timeout: 5000 });
  await page.waitForTimeout(MODAL_ANIMATION_MS);

  // Fill title
  const titleInput = page.locator('#task-create-title');
  await titleInput.fill(title);

  // Fill description
  if (description) {
    const descInput = page.locator('#task-create-desc');
    await descInput.fill(description);
  }

  // Select priority
  if (priority !== 'normal') {
    const prioritySelect = page.locator('#task-create-priority');
    await prioritySelect.selectOption(priority);
  }

  // Click "Create Task" submit
  const submitBtn = page.locator('.task-create-actions .btn-primary').filter({ hasText: /create task/i });
  await submitBtn.click();

  // Wait for modal to close
  await page.waitForSelector('.task-create-form', {
    state: 'detached',
    timeout: 10_000,
  });

  // Wait for task list to update
  await page.waitForTimeout(1000);
}

/**
 * Click on a task card to open the task detail drawer.
 */
export async function openTaskDetailDrawer(
  page: Page,
  taskTitle: string
): Promise<void> {
  // Find the task card
  const card = page.locator('.card-task').filter({
    hasText: taskTitle,
  });

  await card.click();

  // Wait for drawer to open
  await page.waitForSelector('.drawer.open', { timeout: 5000 });
  await page.waitForTimeout(DRAWER_ANIMATION_MS);
}

// ────────────────────────────────────────────────────────────────
// Modal Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Wait for a modal to open (any modal).
 */
export async function waitForModal(page: Page, timeout: number = 5000): Promise<Locator> {
  await page.waitForSelector('.modal-wrapper', { timeout });
  await page.waitForTimeout(MODAL_ANIMATION_MS);
  return page.locator('.modal-wrapper').last();
}

/**
 * Close the topmost open modal.
 */
export async function closeModal(page: Page): Promise<void> {
  const closeBtn = page.locator('.modal-wrapper .modal-close').last();
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await page.waitForTimeout(MODAL_ANIMATION_MS);
  }
}

// ────────────────────────────────────────────────────────────────
// Toast Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Wait for a toast notification containing specific text.
 */
export async function waitForToast(
  page: Page,
  textPattern: string | RegExp,
  timeout: number = 10_000
): Promise<void> {
  const toastLocator = page.locator('#toast-container .toast').filter({
    hasText: typeof textPattern === 'string' ? textPattern : undefined,
  });

  if (typeof textPattern === 'string') {
    await toastLocator.first().waitFor({ state: 'visible', timeout });
  } else {
    await page.locator('#toast-container .toast').filter({
      has: page.locator(`text=${textPattern}`),
    }).first().waitFor({ state: 'visible', timeout });
  }
}

/**
 * Assert that a success toast appeared.
 */
export async function expectSuccessToast(
  page: Page,
  textPattern: string | RegExp = /.*/
): Promise<void> {
  const toast = page.locator('#toast-container .toast.toast-success, #toast-container .toast-success').first();
  await expect(toast).toBeVisible({ timeout: 10_000 });
  if (typeof textPattern === 'string') {
    await expect(toast).toContainText(textPattern);
  }
}

// ────────────────────────────────────────────────────────────────
// Floor & Room Operations (Building View)
// ────────────────────────────────────────────────────────────────

/**
 * Click "Add Floor" in the building view header.
 */
export async function clickAddFloor(page: Page): Promise<void> {
  const btn = page.locator('#building-panel .btn-primary').filter({ hasText: /add floor/i });
  await btn.click();
  await page.waitForSelector('.add-floor-modal, .add-room-type-grid', { timeout: 5000 });
  await page.waitForTimeout(MODAL_ANIMATION_MS);
}

/**
 * Click "Edit Building" in the building view header.
 */
export async function clickEditBuilding(page: Page): Promise<void> {
  const btn = page.locator('#building-panel .btn-ghost').filter({ hasText: /edit building/i });
  await btn.click();
  await page.waitForSelector('.edit-building-modal', { timeout: 5000 });
  await page.waitForTimeout(MODAL_ANIMATION_MS);
}

/**
 * Expand a floor section in the building view to show its rooms.
 */
export async function expandFloor(page: Page, floorName: string): Promise<void> {
  const floorBar = page.locator('.floor-section').filter({
    has: page.locator('.floor-section-name', { hasText: floorName }),
  });

  // Only click the header if not already expanded
  const isExpanded = await floorBar.evaluate(el => el.classList.contains('expanded'));
  if (!isExpanded) {
    const header = floorBar.locator('.floor-section-header');
    await header.click();
    await page.waitForTimeout(UI_SETTLE_MS);
  }
}

/**
 * Click "+ Add Room" on an expanded floor.
 */
export async function clickAddRoomOnFloor(page: Page, floorName: string): Promise<void> {
  // First expand the floor
  await expandFloor(page, floorName);

  // Click the Add Room button within the expanded floor content
  const floorBar = page.locator('.floor-section.expanded').filter({
    has: page.locator('.floor-section-name', { hasText: floorName }),
  });
  const addRoomBtn = floorBar.locator('.floor-add-room-btn, .btn-ghost').filter({ hasText: /room/i });
  await addRoomBtn.click();

  // Wait for modal
  await page.waitForSelector('.add-room-modal, .add-room-type-grid', { timeout: 5000 });
  await page.waitForTimeout(MODAL_ANIMATION_MS);
}

// ────────────────────────────────────────────────────────────────
// Direct Socket.IO Helpers (for test data setup)
// ────────────────────────────────────────────────────────────────

/**
 * Create a floor directly via Socket.IO.
 */
export async function createFloorDirect(
  page: Page,
  buildingId: string,
  type: string,
  name: string
): Promise<string> {
  const result = await page.evaluate(
    async ({ bid, ftype, fname }: { bid: string; ftype: string; fname: string }) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      const res = await window.overlordSocket.createFloor(bid, ftype, fname);
      if (!res?.ok) throw new Error(res?.error?.message || 'Failed to create floor');
      return res.data.id;
    },
    { bid: buildingId, ftype: type, fname: name }
  );

  await page.waitForTimeout(UI_SETTLE_MS);
  return result;
}

/**
 * Create a room directly via Socket.IO.
 */
export async function createRoomDirect(
  page: Page,
  floorId: string,
  type: string,
  name?: string
): Promise<string> {
  const result = await page.evaluate(
    async ({ fid, rtype, rname }: { fid: string; rtype: string; rname?: string }) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      const res = await window.overlordSocket.createRoom({
        floorId: fid,
        type: rtype,
        name: rname,
      });
      if (!res?.ok) throw new Error(res?.error?.message || 'Failed to create room');
      return res.data.id;
    },
    { fid: floorId, rtype: type, rname: name }
  );

  await page.waitForTimeout(UI_SETTLE_MS);
  return result;
}

/**
 * Create a task directly via Socket.IO.
 */
export async function createTaskDirect(
  page: Page,
  buildingId: string,
  title: string,
  description: string = '',
  priority: string = 'normal'
): Promise<string> {
  const result = await page.evaluate(
    async (params: { bid: string; t: string; d: string; p: string }) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      const res = await window.overlordSocket.createTask({
        buildingId: params.bid,
        title: params.t,
        description: params.d,
        priority: params.p,
      });
      if (!res?.ok) throw new Error(res?.error?.message || 'Failed to create task');
      return res.data.id;
    },
    { bid: buildingId, t: title, d: description, p: priority }
  );

  await page.waitForTimeout(UI_SETTLE_MS);
  return result;
}

/**
 * Create a todo item directly via Socket.IO.
 */
export async function createTodoDirect(
  page: Page,
  taskId: string,
  description: string,
  agentId?: string
): Promise<string> {
  const result = await page.evaluate(
    async (params: { tid: string; desc: string; aid?: string }) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      const res = await window.overlordSocket.createTodo({
        taskId: params.tid,
        description: params.desc,
        agentId: params.aid || null,
        status: 'pending',
      });
      if (!res?.ok) throw new Error(res?.error?.message || 'Failed to create todo');
      return res.data.id;
    },
    { tid: taskId, desc: description, aid: agentId }
  );

  await page.waitForTimeout(UI_SETTLE_MS);
  return result;
}

// ────────────────────────────────────────────────────────────────
// Type augmentation for window.overlordSocket
// ────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    overlordSocket: {
      socket: any;
      emit: (event: string, data: any) => Promise<any>;
      emitWithAck: (event: string, data: any) => Promise<any>;
      createBuilding: (params: any) => Promise<any>;
      selectBuilding: (id: string) => Promise<any>;
      updateBuilding: (id: string, updates: any) => Promise<any>;
      fetchBuilding: (id: string) => Promise<any>;
      fetchFloors: (id: string) => Promise<any>;
      fetchFloor: (id: string) => Promise<any>;
      fetchRooms: () => Promise<any>;
      fetchRoom: (id: string) => Promise<any>;
      createFloor: (bid: string, type: string, name: string, opts?: any) => Promise<any>;
      updateFloor: (id: string, updates: any) => Promise<any>;
      deleteFloor: (id: string) => Promise<any>;
      createRoom: (params: any) => Promise<any>;
      updateRoom: (id: string, updates: any) => Promise<any>;
      deleteRoom: (id: string) => Promise<any>;
      registerAgent: (params: any) => Promise<any>;
      fetchAgents: (filters?: any) => Promise<any>;
      fetchAgent: (id: string) => Promise<any>;
      updateAgentProfile: (id: string, profile: any) => Promise<any>;
      generateAgentProfile: (id: string) => Promise<any>;
      generateAgentPhoto: (id: string) => Promise<any>;
      createTask: (params: any) => Promise<any>;
      updateTask: (params: any) => Promise<any>;
      fetchTasks: (bid: string, filters?: any) => Promise<any>;
      getTask: (id: string) => Promise<any>;
      createTodo: (params: any) => Promise<any>;
      toggleTodo: (id: string) => Promise<any>;
      deleteTodo: (id: string) => Promise<any>;
      fetchTodos: (taskId: string) => Promise<any>;
      assignTodoToAgent: (todoId: string, agentId: string) => Promise<any>;
      unassignTodoFromAgent: (todoId: string) => Promise<any>;
      listTodosByAgent: (agentId: string) => Promise<any>;
      createTable: (roomId: string, type: string, chairs?: number, desc?: string) => Promise<any>;
      updateTable: (id: string, updates: any) => Promise<any>;
      deleteTable: (id: string) => Promise<any>;
      fetchTables: (roomId: string) => Promise<any>;
      moveAgent: (agentId: string, roomId: string, tableType?: string) => Promise<any>;
      analyzeCodebase: (directoryPath: string, enhanceWithAI?: boolean) => Promise<any>;
      applyBlueprint: (params: any) => Promise<any>;
    };
  }
}
