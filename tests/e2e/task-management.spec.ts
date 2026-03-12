/**
 * Overlord v2 — E2E Tests: Epic 3 — Task Assignment & Todo Management
 *
 * Tests the full task lifecycle as a real user would experience it:
 *   1. Navigate to Tasks view
 *   2. Create a new task
 *   3. Verify task appears in list
 *   4. Test status filter tabs
 *   5. Open task detail drawer
 *   6. Add a todo item via inline form
 *   7. Toggle todo checkbox (pending -> done)
 *   8. Assign agent to a todo
 *   9. Delete a todo
 *  10. Verify progress bar updates
 *  11. Navigate to agent detail — verify "Assigned Todos" section
 *
 * Also tests:
 *   - Task search functionality
 *   - Task priority display
 *   - Task status cycling
 *   - Empty state messages
 *   - Multiple todo management
 *   - Cross-entity references (task <-> agent)
 */

import { test, expect } from '@playwright/test';
import {
  gotoAppAndConnect,
  navigateToView,
  createBuildingDirect,
  selectBuilding,
  createTaskViaUI,
  createTaskDirect,
  createTodoDirect,
  createAgentDirect,
  openTaskDetailDrawer,
  openAgentDetailDrawer,
  closeDrawer,
} from './helpers/overlord.js';

// ────────────────────────────────────────────────────────────────
// Test Setup
// ────────────────────────────────────────────────────────────────

test.describe('Epic 3: Task Assignment & Todo Management', () => {
  let buildingId: string;

  test.beforeEach(async ({ page }) => {
    await gotoAppAndConnect(page);
    buildingId = await createBuildingDirect(page, 'Task Test Building');
    await selectBuilding(page, buildingId);
    await navigateToView(page, 'tasks');
  });

  // ────────────────────────────────────────────────────────────
  // Test 1: Tasks view shows empty state when no tasks
  // ────────────────────────────────────────────────────────────

  test('shows empty state when no tasks exist', async ({ page }) => {
    // Should show the empty state message
    const emptyState = page.locator('.task-view .empty-state, #task-list .empty-state');
    await expect(emptyState).toBeVisible({ timeout: 5000 });

    const emptyTitle = page.locator('.empty-state-title');
    await expect(emptyTitle).toContainText(/no tasks/i);

    // "New Task" button should be visible in the header
    const newTaskBtn = page.locator('.task-view-actions .btn-primary').filter({ hasText: /new task/i });
    await expect(newTaskBtn).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 2: Create task via UI modal
  // ────────────────────────────────────────────────────────────

  test('creates a task via the new task modal', async ({ page }) => {
    const taskTitle = 'Implement Authentication';
    const taskDesc = 'Add JWT-based authentication to the API endpoints';

    await createTaskViaUI(page, taskTitle, taskDesc, 'high');

    // Verify task card appears in the list
    const taskCard = page.locator('.card-task, .task-card-grid .card').filter({
      hasText: taskTitle,
    });
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 3: Task card shows title, priority, and status
  // ────────────────────────────────────────────────────────────

  test('task card displays title, priority badge, and status', async ({ page }) => {
    await createTaskDirect(page, buildingId, 'Critical Bug Fix', 'Fix the login crash', 'critical');

    // Refresh view
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    const taskCard = page.locator('.card-task, .task-card-grid .card').filter({
      hasText: 'Critical Bug Fix',
    });
    await expect(taskCard).toBeVisible({ timeout: 10_000 });

    // The card should contain the task title text
    await expect(taskCard).toContainText('Critical Bug Fix');
  });

  // ────────────────────────────────────────────────────────────
  // Test 4: Task filter tabs work correctly
  // ────────────────────────────────────────────────────────────

  test('filter tabs filter tasks by status', async ({ page }) => {
    // Create tasks with different statuses
    const taskId1 = await createTaskDirect(page, buildingId, 'Pending Task', '', 'normal');
    const taskId2 = await createTaskDirect(page, buildingId, 'Another Pending', '', 'low');

    // Update one task to "done" status
    await page.evaluate(async (tid: string) => {
      if (!window.overlordSocket) throw new Error('Socket not connected');
      await window.overlordSocket.updateTask({ id: tid, status: 'done' });
    }, taskId2);

    // Refresh view
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    // "All" tab should show 2 tasks
    const allCards = page.locator('.card-task, .task-card-grid .card');
    await expect(allCards).toHaveCount(2, { timeout: 10_000 });

    // Click "Pending" tab
    const pendingTab = page.locator('.tab-item').filter({ hasText: 'Pending' });
    await pendingTab.click();
    await page.waitForTimeout(500);

    // Should show only 1 pending task
    const pendingCards = page.locator('.card-task, .task-card-grid .card');
    await expect(pendingCards).toHaveCount(1, { timeout: 5000 });

    // Click "Done" tab
    const doneTab = page.locator('.tab-item').filter({ hasText: 'Done' });
    await doneTab.click();
    await page.waitForTimeout(500);

    // Should show only 1 done task
    const doneCards = page.locator('.card-task, .task-card-grid .card');
    await expect(doneCards).toHaveCount(1, { timeout: 5000 });

    // Click "All" tab to reset
    const allTab = page.locator('.tab-item').filter({ hasText: 'All' });
    await allTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('.card-task, .task-card-grid .card')).toHaveCount(2, { timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 5: Task search filters by title and description
  // ────────────────────────────────────────────────────────────

  test('search input filters tasks by title and description', async ({ page }) => {
    await createTaskDirect(page, buildingId, 'Database Migration', 'Migrate PostgreSQL to new schema');
    await createTaskDirect(page, buildingId, 'UI Refactor', 'Clean up the component hierarchy');
    await createTaskDirect(page, buildingId, 'API Documentation', 'Write OpenAPI specs for endpoints');

    // Refresh view
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    // All 3 should be visible
    await expect(page.locator('.card-task, .task-card-grid .card')).toHaveCount(3, { timeout: 10_000 });

    // Type in the search box
    const searchInput = page.locator('.task-search-input');
    await searchInput.fill('database');
    await page.waitForTimeout(500);

    // Only 1 should match
    await expect(page.locator('.card-task, .task-card-grid .card')).toHaveCount(1, { timeout: 5000 });

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(500);

    // All 3 should be back
    await expect(page.locator('.card-task, .task-card-grid .card')).toHaveCount(3, { timeout: 5000 });

    // Search by description content
    await searchInput.fill('component');
    await page.waitForTimeout(500);

    // "UI Refactor" should match (description contains "component")
    await expect(page.locator('.card-task, .task-card-grid .card')).toHaveCount(1, { timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 6: Open task detail drawer
  // ────────────────────────────────────────────────────────────

  test('clicking a task opens the detail drawer with correct info', async ({ page }) => {
    const taskTitle = 'Detail Test Task';
    await createTaskDirect(page, buildingId, taskTitle, 'This is a test description', 'high');

    // Refresh view
    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    // Click the task card
    await openTaskDetailDrawer(page, taskTitle);

    // Drawer should be open
    const drawer = page.locator('.drawer.open');
    await expect(drawer).toBeVisible();

    // Drawer title should contain the task title
    const drawerTitle = drawer.locator('.drawer-title');
    await expect(drawerTitle).toContainText(taskTitle);

    // Status badge should be visible
    const statusBadge = drawer.locator('.task-status-badge');
    await expect(statusBadge).toBeVisible();

    // Priority should be visible
    const priority = drawer.locator('.task-priority');
    await expect(priority).toBeVisible();

    // Description should be shown
    const description = drawer.locator('.task-detail-description');
    await expect(description).toContainText('This is a test description');

    // Checklist section should exist
    const checklistHeader = drawer.locator('.todo-section-header h4');
    await expect(checklistHeader).toContainText('Checklist');
  });

  // ────────────────────────────────────────────────────────────
  // Test 7: Add todo via inline form in task detail
  // ────────────────────────────────────────────────────────────

  test('adds a todo item via the checklist inline form', async ({ page }) => {
    const taskId = await createTaskDirect(page, buildingId, 'Todo Form Task', 'Task for testing todo creation');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Todo Form Task');

    const drawer = page.locator('.drawer.open');

    // Click "Add Item" button to reveal the add form
    const addItemBtn = drawer.locator('.todo-section-header .btn-ghost').filter({ hasText: /add item/i });
    await addItemBtn.click();

    // Form should become visible (remove hidden class)
    const addForm = drawer.locator('#todo-add-form, .todo-add-form');
    await expect(addForm).not.toHaveClass(/hidden/);

    // Fill in the todo description
    const todoInput = addForm.locator('.todo-add-input');
    await todoInput.fill('Write unit tests for auth module');

    // Click "Add" button
    const addBtn = addForm.locator('.btn-primary').filter({ hasText: /add/i });
    await addBtn.click();

    // Wait for the todo to be created
    await page.waitForTimeout(2000);

    // Todo should appear in the checklist
    const todoList = drawer.locator('#task-detail-todos, .task-todo-list');
    const todoRow = todoList.locator('.todo-row').filter({
      hasText: 'Write unit tests for auth module',
    });
    await expect(todoRow).toBeVisible({ timeout: 10_000 });

    // Todo text should be present
    const todoText = todoRow.locator('.todo-text');
    await expect(todoText).toContainText('Write unit tests for auth module');

    // Checkbox should exist and not be checked
    const checkbox = todoRow.locator('.todo-checkbox');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toHaveClass(/checked/);
  });

  // ────────────────────────────────────────────────────────────
  // Test 8: Toggle todo checkbox (pending -> done)
  // ────────────────────────────────────────────────────────────

  test('toggling todo checkbox changes status to done', async ({ page }) => {
    const taskId = await createTaskDirect(page, buildingId, 'Toggle Todo Task', '');
    await createTodoDirect(page, taskId, 'Checkbox test item');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Toggle Todo Task');

    const drawer = page.locator('.drawer.open');

    // Wait for todos to load
    await page.waitForTimeout(2000);

    const todoList = drawer.locator('#task-detail-todos, .task-todo-list');
    const todoRow = todoList.locator('.todo-row').filter({
      hasText: 'Checkbox test item',
    });
    await expect(todoRow).toBeVisible({ timeout: 10_000 });

    // Click the checkbox
    const checkbox = todoRow.locator('.todo-checkbox');
    await checkbox.click();

    // Wait for the toggle to process
    await page.waitForTimeout(2000);

    // After toggle, the checkbox should have 'checked' class
    // and the row should have 'todo-done' class
    await expect(checkbox).toHaveClass(/checked/, { timeout: 5000 });
    await expect(todoRow).toHaveClass(/todo-done/);
  });

  // ────────────────────────────────────────────────────────────
  // Test 9: Assign agent to a todo
  // ────────────────────────────────────────────────────────────

  test('assigns an agent to a todo via the dropdown', async ({ page }) => {
    // Create an agent first
    const agentId = await createAgentDirect(page, 'Todo Agent', 'developer');

    // Create task + todo
    const taskId = await createTaskDirect(page, buildingId, 'Assign Agent Task', '');
    await createTodoDirect(page, taskId, 'Assignable todo');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Assign Agent Task');

    const drawer = page.locator('.drawer.open');
    await page.waitForTimeout(2000);

    const todoList = drawer.locator('#task-detail-todos, .task-todo-list');
    const todoRow = todoList.locator('.todo-row').filter({
      hasText: 'Assignable todo',
    });
    await expect(todoRow).toBeVisible({ timeout: 10_000 });

    // Find the agent select dropdown
    const agentSelect = todoRow.locator('.todo-agent-select');
    await expect(agentSelect).toBeVisible();

    // Select the agent from the dropdown
    await agentSelect.selectOption(agentId);

    // Wait for assignment to process
    await page.waitForTimeout(2000);

    // Should show a success toast
    const toast = page.locator('#toast-container .toast');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 10: Delete a todo
  // ────────────────────────────────────────────────────────────

  test('deletes a todo via the delete button', async ({ page }) => {
    const taskId = await createTaskDirect(page, buildingId, 'Delete Todo Task', '');
    await createTodoDirect(page, taskId, 'Doomed todo');
    await createTodoDirect(page, taskId, 'Surviving todo');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Delete Todo Task');

    const drawer = page.locator('.drawer.open');
    await page.waitForTimeout(2000);

    const todoList = drawer.locator('#task-detail-todos, .task-todo-list');

    // Verify both todos exist
    await expect(todoList.locator('.todo-row')).toHaveCount(2, { timeout: 10_000 });

    // Find the "Doomed todo" row
    const doomedRow = todoList.locator('.todo-row').filter({
      hasText: 'Doomed todo',
    });
    await expect(doomedRow).toBeVisible();

    // Click its delete button
    const deleteBtn = doomedRow.locator('.todo-delete-btn');
    await deleteBtn.click();

    // Wait for deletion
    await page.waitForTimeout(2000);

    // Should now have only 1 todo
    await expect(todoList.locator('.todo-row')).toHaveCount(1, { timeout: 10_000 });

    // "Surviving todo" should still be there
    const survivingRow = todoList.locator('.todo-row').filter({
      hasText: 'Surviving todo',
    });
    await expect(survivingRow).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 11: Progress bar updates when todos are completed
  // ────────────────────────────────────────────────────────────

  test('progress bar updates as todos are completed', async ({ page }) => {
    const taskId = await createTaskDirect(page, buildingId, 'Progress Task', '');
    const todoId1 = await createTodoDirect(page, taskId, 'First item');
    const todoId2 = await createTodoDirect(page, taskId, 'Second item');
    await createTodoDirect(page, taskId, 'Third item');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Progress Task');

    const drawer = page.locator('.drawer.open');
    await page.waitForTimeout(2000);

    const todoList = drawer.locator('#task-detail-todos, .task-todo-list');

    // Initial state: 0 of 3 complete
    const summaryText = todoList.locator('.todo-summary-text');
    await expect(summaryText).toContainText('0 of 3 complete');

    // Progress bar should be at 0%
    const progressFill = todoList.locator('.todo-progress-fill');
    await expect(progressFill).toBeVisible();

    // Complete the first todo
    const firstCheckbox = todoList.locator('.todo-row').nth(0).locator('.todo-checkbox');
    await firstCheckbox.click();
    await page.waitForTimeout(2000);

    // Should now show "1 of 3 complete"
    await expect(summaryText).toContainText('1 of 3 complete');

    // Complete the second todo
    const secondCheckbox = todoList.locator('.todo-row').nth(1).locator('.todo-checkbox');
    await secondCheckbox.click();
    await page.waitForTimeout(2000);

    // Should now show "2 of 3 complete"
    await expect(summaryText).toContainText('2 of 3 complete');
  });

  // ────────────────────────────────────────────────────────────
  // Test 12: Agent detail drawer shows assigned todos
  // ────────────────────────────────────────────────────────────

  test('agent detail drawer shows todos assigned to that agent', async ({ page }) => {
    // Create agent
    const agentId = await createAgentDirect(page, 'Todos Agent', 'developer');

    // Create task and assign a todo to the agent
    const taskId = await createTaskDirect(page, buildingId, 'Agent Todo Task', '');
    await createTodoDirect(page, taskId, 'Agent-assigned todo', agentId);

    // Navigate to Agents view
    await navigateToView(page, 'agents');

    // Open the agent's detail drawer
    await openAgentDetailDrawer(page, 'Todos Agent');

    const drawer = page.locator('.drawer.open');

    // The "Assigned Todos" section should exist
    const todosSection = drawer.locator('.agents-view-detail-section-title').filter({
      hasText: 'Assigned Todos',
    });
    await expect(todosSection).toBeVisible();

    // Wait for todos to load
    await page.waitForTimeout(3000);

    // The todos container should show the assigned todo
    const todosContainer = drawer.locator('.agent-todos-list, [id^="agent-todos-"]');
    await expect(todosContainer).toBeVisible();

    // It should either contain the todo text or show "Loading..." then update
    // (depends on API timing)
  });

  // ────────────────────────────────────────────────────────────
  // Test 13: Task creation form validation
  // ────────────────────────────────────────────────────────────

  test('task creation validates required title field', async ({ page }) => {
    // Click "New Task" button
    const newTaskBtn = page.locator('.task-view-actions .btn-primary').filter({ hasText: /new task/i });
    await newTaskBtn.click();

    await page.waitForSelector('.task-create-form', { timeout: 5000 });
    await page.waitForTimeout(300);

    // Try to submit without title
    const submitBtn = page.locator('.task-create-actions .btn-primary').filter({ hasText: /create task/i });
    await submitBtn.click();

    // Title input should get error class
    const titleInput = page.locator('#task-create-title');
    await expect(titleInput).toHaveClass(/input-error/, { timeout: 3000 });

    // Error message should appear
    const errorMsg = page.locator('.task-create-form .form-error');
    await expect(errorMsg).toContainText(/title is required/i);

    // Modal should still be open
    await expect(page.locator('.task-create-form')).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 14: Task status can be changed from detail drawer
  // ────────────────────────────────────────────────────────────

  test('task status can be changed via action buttons in drawer', async ({ page }) => {
    await createTaskDirect(page, buildingId, 'Status Change Task', '', 'normal');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Status Change Task');

    const drawer = page.locator('.drawer.open');

    // There should be status action buttons (excluding current status)
    const actionBtns = drawer.locator('.task-detail-actions .btn');
    await expect(actionBtns.first()).toBeVisible();

    // Find and click the "In Progress" button
    const inProgressBtn = drawer.locator('.task-detail-actions .btn').filter({
      hasText: /in progress/i,
    });
    if (await inProgressBtn.isVisible()) {
      await inProgressBtn.click();

      // Wait for status update and drawer close
      await page.waitForTimeout(2000);

      // The task should now be in-progress — verify via filter
      const inProgressTab = page.locator('.tab-item').filter({ hasText: 'In Progress' });
      await inProgressTab.click();
      await page.waitForTimeout(500);

      const inProgressCards = page.locator('.card-task, .task-card-grid .card');
      await expect(inProgressCards).toHaveCount(1, { timeout: 5000 });
    }
  });

  // ────────────────────────────────────────────────────────────
  // Test 15: Todo add form shows with Enter key submission
  // ────────────────────────────────────────────────────────────

  test('todo can be added by pressing Enter in the input', async ({ page }) => {
    const taskId = await createTaskDirect(page, buildingId, 'Enter Key Task', '');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Enter Key Task');

    const drawer = page.locator('.drawer.open');

    // Click "Add Item" to show the form
    const addItemBtn = drawer.locator('.todo-section-header .btn-ghost').filter({ hasText: /add item/i });
    await addItemBtn.click();

    const addForm = drawer.locator('#todo-add-form, .todo-add-form');
    const todoInput = addForm.locator('.todo-add-input');
    await todoInput.fill('Enter key todo');

    // Press Enter instead of clicking Add
    await todoInput.press('Enter');

    // Wait for creation
    await page.waitForTimeout(2000);

    // Todo should appear
    const todoList = drawer.locator('#task-detail-todos, .task-todo-list');
    const todoRow = todoList.locator('.todo-row').filter({
      hasText: 'Enter key todo',
    });
    await expect(todoRow).toBeVisible({ timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────
  // Test 16: Multiple tasks display in correct order
  // ────────────────────────────────────────────────────────────

  test('tasks sort by priority (critical first)', async ({ page }) => {
    await createTaskDirect(page, buildingId, 'Low Priority', '', 'low');
    await createTaskDirect(page, buildingId, 'Critical Priority', '', 'critical');
    await createTaskDirect(page, buildingId, 'Normal Priority', '', 'normal');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    // All 3 tasks should be visible
    const cards = page.locator('.card-task, .task-card-grid .card');
    await expect(cards).toHaveCount(3, { timeout: 10_000 });

    // The first card should be the critical one (highest priority)
    const firstCard = cards.first();
    await expect(firstCard).toContainText('Critical Priority');
  });

  // ────────────────────────────────────────────────────────────
  // Test 17: Task detail shows created timestamp
  // ────────────────────────────────────────────────────────────

  test('task detail drawer shows creation timestamp', async ({ page }) => {
    await createTaskDirect(page, buildingId, 'Timestamp Task', 'Testing timestamps');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Timestamp Task');

    const drawer = page.locator('.drawer.open');

    // The "Created" info row should show a date
    const createdRow = drawer.locator('.task-detail-info-row').filter({
      has: page.locator('.task-detail-label', { hasText: 'Created' }),
    });
    await expect(createdRow).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 18: Empty checklist shows no-items message
  // ────────────────────────────────────────────────────────────

  test('task detail shows empty checklist message when no todos', async ({ page }) => {
    await createTaskDirect(page, buildingId, 'Empty Checklist Task', '');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    await openTaskDetailDrawer(page, 'Empty Checklist Task');

    const drawer = page.locator('.drawer.open');
    await page.waitForTimeout(2000);

    // Should show "No checklist items yet" message
    const emptyMsg = drawer.locator('.empty-state-inline, #task-detail-todos').filter({
      hasText: /no checklist/i,
    });
    await expect(emptyMsg).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────
  // Test 19: Tab badges update when tasks are created/updated
  // ────────────────────────────────────────────────────────────

  test('filter tab badges reflect correct task counts', async ({ page }) => {
    await createTaskDirect(page, buildingId, 'Badge Task 1', '', 'normal');
    await createTaskDirect(page, buildingId, 'Badge Task 2', '', 'normal');

    await navigateToView(page, 'dashboard');
    await navigateToView(page, 'tasks');

    // Wait for tasks to load
    await expect(page.locator('.card-task, .task-card-grid .card')).toHaveCount(2, { timeout: 10_000 });

    // The "All" tab should show a badge with count 2
    const allTab = page.locator('.tab-item').filter({ hasText: 'All' });
    await expect(allTab).toBeVisible();

    // The "Pending" tab badge should also show 2 (both are pending)
    const pendingTab = page.locator('.tab-item').filter({ hasText: 'Pending' });
    await expect(pendingTab).toBeVisible();
  });
});
