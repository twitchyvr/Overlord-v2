/**
 * Building Manager
 *
 * CRUD for buildings and floors — the top two levels of the spatial model.
 * Building → Floor → Room → Table → Chair.
 *
 * A building represents a project. Floors organize rooms by function.
 * When a building is created, default floors are provisioned based on config.
 */

import { randomUUID } from 'crypto';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err, safeJsonParse } from '../core/contracts.js';
import { setBuildingExecutionState, getBuildingExecutionState } from '../core/execution-signal.js';
import type { ExecutionState } from '../core/execution-signal.js';
import type { Result, ErrResult, BuildingRow, FloorRow } from '../core/contracts.js';

function uid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// ─── Agent Identity Generator (#560) ───

interface AgentIdentity {
  firstName: string;
  lastName: string;
  displayName: string;
  gender: string;
  bio: string;
  specialization: string;
  age: number;
  backstory: string;
  communicationStyle: string;
  expertiseAreas: string[];
}

const FIRST_NAMES_F = ['Aria', 'Maya', 'Elena', 'Zara', 'Nadia', 'Sierra', 'Luna', 'Freya', 'Ivy', 'Cora', 'Iris', 'Sage', 'Nova', 'Ada', 'Vera', 'Mila', 'Leah', 'Rosa', 'Tara', 'Kira'];
const FIRST_NAMES_M = ['Leo', 'Kai', 'Ravi', 'Omar', 'Felix', 'Jace', 'Marco', 'Theo', 'Ezra', 'Dion', 'Cole', 'Atlas', 'Nico', 'Reid', 'Quinn', 'Soren', 'Arlo', 'Dean', 'Rhys', 'Elio'];
const LAST_NAMES = ['Chen', 'Park', 'Santos', 'Andersen', 'Russo', 'Okafor', 'Nakamura', 'Levy', 'Rivera', 'Singh', 'Kim', 'Weber', 'Torres', 'Laurent', 'Yamamoto', 'Shah', 'Moreau', 'Petrov', 'Ngozi', 'Alvarez'];

const ROLE_SPECIALIZATIONS: Record<string, string[]> = {
  strategist: ['Project strategy & planning', 'Resource allocation', 'Stakeholder alignment', 'Risk assessment'],
  developer: ['Full-stack development', 'API design', 'Database architecture', 'Performance optimization'],
  tester: ['QA automation', 'Edge case analysis', 'Regression testing', 'Test strategy'],
  architect: ['System design', 'Scalability patterns', 'API contracts', 'Technical debt management'],
  researcher: ['Requirements gathering', 'User research', 'Competitive analysis', 'Domain exploration'],
};

function generateAgentIdentity(archetype: string, role: string, usedNames: Set<string>): AgentIdentity {
  const gender = Math.random() < 0.5 ? 'female' : 'male';
  const firstNames = gender === 'female' ? FIRST_NAMES_F : FIRST_NAMES_M;

  // Pick a unique name combination — guaranteed unique via suffix fallback
  let firstName = '', lastName = '', displayName = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    displayName = `${firstName} ${lastName}`;
    if (!usedNames.has(displayName)) break;
  }
  // Guarantee uniqueness: append suffix to lastName so first+last stays consistent
  if (usedNames.has(displayName)) {
    let suffix = 2;
    while (usedNames.has(`${firstName} ${lastName}-${suffix}`)) suffix++;
    lastName = `${lastName}-${suffix}`;
    displayName = `${firstName} ${lastName}`;
  }

  const specs = ROLE_SPECIALIZATIONS[role] || ROLE_SPECIALIZATIONS.developer || ['General expertise'];
  const specialization = specs[Math.floor(Math.random() * specs.length)];

  // Age diversity: 25-60 range with experience scaling (#562)
  const age = 25 + Math.floor(Math.random() * 36);
  const yearsExp = Math.max(1, age - 22 - Math.floor(Math.random() * 5));
  const seniority = yearsExp >= 15 ? 'senior' : yearsExp >= 8 ? 'mid-level' : 'early-career';

  const STYLES = ['Analytical and precise', 'Collaborative and empathetic', 'Direct and action-oriented', 'Thoughtful and methodical', 'Creative and experimental'];
  const communicationStyle = STYLES[Math.floor(Math.random() * STYLES.length)];

  const expertiseAreas = [specialization, ...specs.filter(s => s !== specialization).slice(0, 2)];

  const backstory = `${yearsExp} years of experience in ${specialization.toLowerCase()}. Previously worked on ${
    ['enterprise SaaS platforms', 'open-source developer tools', 'fintech applications', 'healthcare systems', 'e-commerce platforms', 'IoT infrastructure'][Math.floor(Math.random() * 6)]
  }. Known for ${communicationStyle.toLowerCase()} approach.`;

  const bio = `${displayName} is a ${seniority} ${specialization.toLowerCase()} specialist (${yearsExp}y exp). ${communicationStyle}. ${
    seniority === 'senior' ? 'Mentors junior team members and drives architectural decisions.' :
    seniority === 'mid-level' ? 'Balances independent work with team collaboration.' :
    'Eager learner who brings fresh perspectives to the team.'
  }`;

  return { firstName, lastName, displayName, gender, bio, specialization, age, backstory, communicationStyle, expertiseAreas };
}

const log = logger.child({ module: 'building-manager' });

/** Known floor types and their default sort order */
const DEFAULT_FLOORS: { type: string; name: string; sortOrder: number }[] = [
  { type: 'strategy', name: 'Strategy Floor', sortOrder: 0 },
  { type: 'collaboration', name: 'Collaboration Floor', sortOrder: 1 },
  { type: 'execution', name: 'Execution Floor', sortOrder: 2 },
  { type: 'governance', name: 'Governance Floor', sortOrder: 3 },
  { type: 'operations', name: 'Operations Floor', sortOrder: 4 },
  { type: 'integration', name: 'Integration Floor', sortOrder: 5 },
];

// ─── Buildings ───

interface CreateBuildingParams {
  name: string;
  projectId?: string;
  workingDirectory?: string;
  repoUrl?: string;
  allowedPaths?: string[];
  config?: Record<string, unknown>;
  provisionFloors?: boolean;
}

/**
 * Create a new building (project container).
 * By default provisions all standard floors.
 */
export function createBuilding({ name, projectId, workingDirectory, repoUrl, allowedPaths = [], config = {}, provisionFloors = true }: CreateBuildingParams): Result {
  const db = getDb();
  const id = uid('bld');

  db.prepare(`
    INSERT INTO buildings (id, project_id, name, working_directory, repo_url, allowed_paths, config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId || null, name, workingDirectory || null, repoUrl || null, JSON.stringify(allowedPaths), JSON.stringify(config));

  const floorIds: string[] = [];

  if (provisionFloors) {
    for (const floor of DEFAULT_FLOORS) {
      const floorId = uid('floor');
      db.prepare(`
        INSERT INTO floors (id, building_id, type, name, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(floorId, id, floor.type, floor.name, floor.sortOrder);
      floorIds.push(floorId);
    }
    log.info({ buildingId: id, floors: floorIds.length }, 'Default floors provisioned');
  }

  log.info({ id, name, projectId, workingDirectory, repoUrl }, 'Building created');
  return ok({ id, name, workingDirectory: workingDirectory || null, repoUrl: repoUrl || null, allowedPaths, floorIds });
}

/**
 * Get a building by ID with its floors
 */
export function getBuilding(buildingId: string): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  const floors = db.prepare(
    'SELECT * FROM floors WHERE building_id = ? ORDER BY sort_order',
  ).all(buildingId) as FloorRow[];

  return ok({
    ...building,
    config: safeJsonParse(building.config, {}),
    floors,
  });
}

/**
 * List all buildings, optionally filtered by project
 */
export function listBuildings(projectId?: string): Result {
  const db = getDb();
  let rows: BuildingRow[];
  if (projectId) {
    rows = db.prepare('SELECT * FROM buildings WHERE project_id = ? ORDER BY created_at').all(projectId) as BuildingRow[];
  } else {
    rows = db.prepare('SELECT * FROM buildings ORDER BY created_at').all() as BuildingRow[];
  }
  return ok(rows.map((b) => ({ ...b, config: safeJsonParse(b.config, {}) })));
}

/**
 * Update a building's config or name (atomic single UPDATE)
 */
export function updateBuilding(buildingId: string, updates: { name?: string; workingDirectory?: string; repoUrl?: string; allowedPaths?: string[]; config?: Record<string, unknown> }): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  db.prepare(`
    UPDATE buildings SET
      name = COALESCE(?, name),
      working_directory = COALESCE(?, working_directory),
      repo_url = COALESCE(?, repo_url),
      allowed_paths = COALESCE(?, allowed_paths),
      config = COALESCE(?, config),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updates.name !== undefined ? updates.name : null,
    updates.workingDirectory !== undefined ? updates.workingDirectory : null,
    updates.repoUrl !== undefined ? updates.repoUrl : null,
    updates.allowedPaths ? JSON.stringify(updates.allowedPaths) : null,
    updates.config ? JSON.stringify(updates.config) : null,
    buildingId,
  );

  log.info({ buildingId, updates: Object.keys(updates) }, 'Building updated');
  return ok({ buildingId });
}

// ─── Building Execution Control (#965, #969) ───

const VALID_EXECUTION_STATES = new Set<ExecutionState>(['running', 'paused', 'aborted']);
const VALID_TRANSITIONS: Record<string, ExecutionState[]> = {
  stopped: ['running'],
  running: ['paused', 'aborted'],
  paused: ['running', 'aborted'],
};

/**
 * Get a building's current execution state.
 * Reads from the in-memory signal (authoritative) with DB fallback.
 */
export function getBuildingExecState(buildingId: string): Result {
  const state = getBuildingExecutionState(buildingId);
  // Map internal 'aborted' to user-friendly 'stopped'
  const userState = state === 'aborted' ? 'stopped' : state;
  return ok({ buildingId, executionState: userState });
}

/**
 * Transition a building's execution state (start/pause/stop).
 * Validates the transition and updates both in-memory signal and DB.
 */
export function transitionBuildingExecution(buildingId: string, targetState: ExecutionState): Result {
  const db = getDb();
  const building = db.prepare('SELECT id, execution_state FROM buildings WHERE id = ?').get(buildingId) as { id: string; execution_state?: string } | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  if (!VALID_EXECUTION_STATES.has(targetState)) {
    return err('INVALID_STATE', `Invalid execution state: ${targetState}`);
  }

  // Get current in-memory state (authoritative)
  const currentState = getBuildingExecutionState(buildingId);

  // Validate transition
  const allowed = VALID_TRANSITIONS[currentState] || ['running'];
  if (!allowed.includes(targetState)) {
    return err('INVALID_TRANSITION', `Cannot transition from ${currentState} to ${targetState}`);
  }

  // Update in-memory signal (immediate effect on all agents)
  setBuildingExecutionState(buildingId, targetState);

  // Persist to DB (user-friendly mapping: 'aborted' → 'stopped')
  const dbState = targetState === 'aborted' ? 'stopped' : targetState;
  db.prepare('UPDATE buildings SET execution_state = ?, updated_at = datetime(?) WHERE id = ?')
    .run(dbState, new Date().toISOString(), buildingId);

  const userState = targetState === 'aborted' ? 'stopped' : targetState;
  log.info({ buildingId, from: currentState, to: targetState, userState }, 'Building execution state changed');
  return ok({ buildingId, executionState: userState, previousState: currentState === 'aborted' ? 'stopped' : currentState });
}

/**
 * Get execution stats for a building (agent counts, for live dashboard).
 */
export function getBuildingExecutionStats(buildingId: string): Result {
  const db = getDb();
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(buildingId) as { id: string } | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  const state = getBuildingExecutionState(buildingId);
  const userState = state === 'aborted' ? 'stopped' : state;

  const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents WHERE building_id = ?').get(buildingId) as { count: number };
  const activeAgents = db.prepare("SELECT COUNT(*) as count FROM agents WHERE building_id = ? AND status = 'active'").get(buildingId) as { count: number };

  // Get token usage from agent_stats (all-time for this building's agents)
  let tokensUsed = 0;
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(CAST(value AS INTEGER)), 0) as total
      FROM agent_stats
      WHERE agent_id IN (SELECT id FROM agents WHERE building_id = ?)
        AND metric = 'tokens_total' AND period = 'all-time'
    `).get(buildingId) as { total: number } | undefined;
    tokensUsed = row?.total || 0;
  } catch { /* stats table may not exist in tests */ }

  return ok({
    buildingId,
    executionState: userState,
    activeAgents: activeAgents.count,
    totalAgents: totalAgents.count,
    tokensUsed,
  });
}

/**
 * Add an allowed path to a building's permission list.
 * Returns a warning if the path is dangerous (but still adds it).
 */
export function addAllowedPath(buildingId: string, pathToAdd: string): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  const resolvedPath = resolvePath(pathToAdd);

  const current: string[] = safeJsonParse(building.allowed_paths, []);
  if (current.includes(resolvedPath)) {
    return ok({ buildingId, path: resolvedPath, action: 'already_exists', allowedPaths: current });
  }

  current.push(resolvedPath);
  db.prepare('UPDATE buildings SET allowed_paths = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(current), buildingId);

  log.info({ buildingId, path: resolvedPath }, 'Allowed path added');
  return ok({ buildingId, path: resolvedPath, action: 'added', allowedPaths: current });
}

/**
 * Remove an allowed path from a building's permission list.
 */
export function removeAllowedPath(buildingId: string, pathToRemove: string): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  const resolvedPath = resolvePath(pathToRemove);

  const current: string[] = safeJsonParse(building.allowed_paths, []);
  const filtered = current.filter((p) => p !== resolvedPath);

  if (filtered.length === current.length) {
    return err('PATH_NOT_FOUND', `Path "${resolvedPath}" is not in the allowed list`);
  }

  db.prepare('UPDATE buildings SET allowed_paths = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(filtered), buildingId);

  log.info({ buildingId, path: resolvedPath }, 'Allowed path removed');
  return ok({ buildingId, path: resolvedPath, action: 'removed', allowedPaths: filtered });
}

// ─── Floors ───

interface CreateFloorParams {
  buildingId: string;
  type: string;
  name: string;
  sortOrder?: number;
  config?: Record<string, unknown>;
}

/**
 * Create a floor within a building
 */
export function createFloor({ buildingId, type, name, sortOrder, config = {} }: CreateFloorParams): Result {
  const db = getDb();

  // Verify building exists
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(buildingId) as { id: string } | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  // Auto-assign sort order if not provided
  const order = sortOrder ?? (db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM floors WHERE building_id = ?',
  ).get(buildingId) as { next: number }).next;

  const id = uid('floor');

  db.prepare(`
    INSERT INTO floors (id, building_id, type, name, sort_order, config)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, buildingId, type, name, order, JSON.stringify(config));

  log.info({ id, buildingId, type, name }, 'Floor created');
  return ok({ id, buildingId, type, name, sortOrder: order });
}

/**
 * Get a floor by ID with its rooms
 */
export function getFloor(floorId: string): Result {
  const db = getDb();
  const floor = db.prepare('SELECT * FROM floors WHERE id = ?').get(floorId) as FloorRow | undefined;
  if (!floor) return err('FLOOR_NOT_FOUND', `Floor ${floorId} does not exist`);

  const rooms = db.prepare('SELECT * FROM rooms WHERE floor_id = ? ORDER BY created_at').all(floorId);

  return ok({
    ...floor,
    config: safeJsonParse(floor.config, {}),
    rooms,
  });
}

/**
 * List all floors in a building, each with its rooms attached.
 * This is the primary query the UI uses — building-view needs floor.rooms
 * to render room cards inside each floor bar.
 */
export function listFloors(buildingId: string): Result {
  const db = getDb();
  const floors = db.prepare(
    'SELECT * FROM floors WHERE building_id = ? ORDER BY sort_order',
  ).all(buildingId) as FloorRow[];

  // Attach rooms to each floor so the building-view can render them
  const roomsByFloor = new Map<string, Record<string, unknown>[]>();
  const allRooms = db.prepare(
    'SELECT * FROM rooms WHERE floor_id IN (SELECT id FROM floors WHERE building_id = ?) ORDER BY created_at',
  ).all(buildingId) as Array<Record<string, unknown>>;

  for (const room of allRooms) {
    const floorId = room.floor_id as string;
    if (!roomsByFloor.has(floorId)) {
      roomsByFloor.set(floorId, []);
    }
    roomsByFloor.get(floorId)!.push({
      ...room,
      config: safeJsonParse(room.config as string, {}),
      allowed_tools: safeJsonParse(room.allowed_tools as string, []),
      exit_template: safeJsonParse(room.exit_template as string, {}),
      escalation: safeJsonParse(room.escalation as string, {}),
    });
  }

  // Also attach agent counts per room for the building-view badges
  const agentCounts = db.prepare(`
    SELECT current_room_id, COUNT(*) as count
    FROM agents
    WHERE building_id = ? AND current_room_id IS NOT NULL
    GROUP BY current_room_id
  `).all(buildingId) as Array<{ current_room_id: string; count: number }>;

  const agentCountMap = new Map(agentCounts.map(r => [r.current_room_id, r.count]));

  return ok(floors.map((f) => ({
    ...f,
    config: safeJsonParse(f.config, {}),
    rooms: (roomsByFloor.get(f.id) || []).map(r => ({
      ...r,
      agentCount: agentCountMap.get(r.id as string) || 0,
    })),
  })));
}

/**
 * Get a floor by building and type (convenience for room creation)
 */
export function getFloorByType(buildingId: string, floorType: string): Result {
  const db = getDb();
  const floor = db.prepare(
    'SELECT * FROM floors WHERE building_id = ? AND type = ?',
  ).get(buildingId, floorType) as FloorRow | undefined;

  if (!floor) return err('FLOOR_NOT_FOUND', `No ${floorType} floor in building ${buildingId}`);
  return ok({ ...floor, config: safeJsonParse((floor as any).config, {}) });
}

/**
 * Update a floor's properties (name, sortOrder, config, isActive).
 * Does NOT allow changing the floor's type or building — those are identity.
 */
export function updateFloor(
  floorId: string,
  updates: { name?: string; sortOrder?: number; config?: Record<string, unknown>; isActive?: boolean },
): Result {
  const db = getDb();
  const floor = db.prepare('SELECT * FROM floors WHERE id = ?').get(floorId) as FloorRow | undefined;
  if (!floor) return err('FLOOR_NOT_FOUND', `Floor ${floorId} does not exist`);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.sortOrder !== undefined) {
    fields.push('sort_order = ?');
    values.push(updates.sortOrder);
  }
  if (updates.config !== undefined) {
    fields.push('config = ?');
    values.push(JSON.stringify(updates.config));
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  if (fields.length === 0) {
    return ok({ floorId, message: 'No fields to update' });
  }

  values.push(floorId);
  db.prepare(`UPDATE floors SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  log.info({ floorId, updates: Object.keys(updates) }, 'Floor updated');
  return ok({ floorId });
}

/**
 * Delete a floor after verifying it has no rooms.
 * If the floor still has rooms, the caller must move or delete them first.
 */
export function deleteFloor(floorId: string): Result {
  const db = getDb();
  const floor = db.prepare('SELECT * FROM floors WHERE id = ?').get(floorId) as FloorRow | undefined;
  if (!floor) return err('FLOOR_NOT_FOUND', `Floor ${floorId} does not exist`);

  // Cascade check — refuse to delete a floor that still has rooms
  const roomCount = db.prepare(
    'SELECT COUNT(*) as count FROM rooms WHERE floor_id = ?',
  ).get(floorId) as { count: number };

  if (roomCount.count > 0) {
    return err(
      'FLOOR_HAS_ROOMS',
      `Floor ${floorId} still has ${roomCount.count} room(s). Move or delete them first.`,
      { context: { floorId, roomCount: roomCount.count } },
    );
  }

  db.prepare('DELETE FROM floors WHERE id = ?').run(floorId);

  log.info({ floorId, buildingId: floor.building_id }, 'Floor deleted');
  return ok({ floorId });
}

/**
 * Reorder floors within a building by updating sort_order based on array position.
 * The floorIds array defines the new order — index 0 gets sort_order 0, etc.
 * All provided floor IDs must belong to the specified building.
 */
export function sortFloors(buildingId: string, floorIds: string[]): Result {
  const db = getDb();

  // Verify building exists
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(buildingId) as { id: string } | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  // Verify all floor IDs belong to this building
  const existingFloors = db.prepare(
    'SELECT id FROM floors WHERE building_id = ?',
  ).all(buildingId) as Array<{ id: string }>;
  const existingIds = new Set(existingFloors.map(f => f.id));

  for (const fid of floorIds) {
    if (!existingIds.has(fid)) {
      return err(
        'FLOOR_NOT_IN_BUILDING',
        `Floor ${fid} does not belong to building ${buildingId}`,
        { context: { floorId: fid, buildingId } },
      );
    }
  }

  // Update sort_order for each floor based on position in the array
  const updateStmt = db.prepare('UPDATE floors SET sort_order = ? WHERE id = ?');
  const runAll = db.transaction(() => {
    for (let i = 0; i < floorIds.length; i++) {
      updateStmt.run(i, floorIds[i]);
    }
  });
  runAll();

  log.info({ buildingId, floorCount: floorIds.length }, 'Floors reordered');
  return ok({ buildingId, order: floorIds });
}

// ─── Blueprint Application Pipeline ───

interface BlueprintData {
  floorsNeeded: string[];
  roomConfig: Array<{ floor: string; rooms: string[] }>;
  agentRoster: Array<{ name: string; role: string; rooms: string[] }>;
}

interface CustomPlanData {
  floors: Array<{ type: string; name: string }>;
  roomAssignments: Array<{ floor: string; roomType: string; roomName: string; config?: Record<string, unknown> }>;
  agentDefinitions: Array<{ name: string; role: string; capabilities?: string[]; roomAccess?: string[] }>;
}

/**
 * Apply a building-blueprint exit document (from Strategist) to provision
 * floors, rooms, and agents for a building.
 *
 * This is the automated pipeline that turns a Strategist's exit document
 * into a fully scaffolded building — floors created, rooms inserted as
 * DB rows (plan records, not active instances), and agents registered.
 */
export function applyBlueprint(buildingId: string, blueprint: BlueprintData): Result {
  const db = getDb();

  // 1. Verify building exists
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(buildingId) as { id: string } | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  let floorsCreated = 0;
  let roomsCreated = 0;
  let agentsCreated = 0;

  // 2. Provision floors that don't already exist
  for (const floorType of blueprint.floorsNeeded) {
    const existing = db.prepare(
      'SELECT id FROM floors WHERE building_id = ? AND type = ?',
    ).get(buildingId, floorType) as { id: string } | undefined;

    if (!existing) {
      const result = createFloor({
        buildingId,
        type: floorType,
        name: `${floorType.charAt(0).toUpperCase() + floorType.slice(1)} Floor`,
      });
      if (result.ok) {
        floorsCreated++;
      } else {
        log.warn({ buildingId, floorType, error: (result as ErrResult).error }, 'Failed to create floor during blueprint apply');
      }
    }
  }

  // 3. Create room DB rows on each floor
  for (const entry of blueprint.roomConfig) {
    const floor = db.prepare(
      'SELECT id FROM floors WHERE building_id = ? AND type = ?',
    ).get(buildingId, entry.floor) as { id: string } | undefined;

    if (!floor) {
      log.warn({ buildingId, floorType: entry.floor }, 'Floor not found for room config — skipping');
      continue;
    }

    for (const roomType of entry.rooms) {
      const roomId = uid('room');
      db.prepare(`
        INSERT INTO rooms (id, floor_id, type, name, config)
        VALUES (?, ?, ?, ?, ?)
      `).run(roomId, floor.id, roomType, roomType, JSON.stringify({}));
      roomsCreated++;
    }
  }

  // 3b. Provision default rooms for the integration floor when the
  //     blueprint requests it but doesn't specify integration-specific
  //     rooms in roomConfig (#509)
  const blueprintRequestsIntegration = blueprint.floorsNeeded.includes('integration');
  const blueprintHasIntegrationRooms = blueprint.roomConfig.some(e => e.floor === 'integration');

  if (blueprintRequestsIntegration) {
    const integrationFloor = db.prepare(
      'SELECT id FROM floors WHERE building_id = ? AND type = ?',
    ).get(buildingId, 'integration') as { id: string } | undefined;

    if (integrationFloor) {
      const existingIntegrationRooms = db.prepare(
        'SELECT COUNT(*) as count FROM rooms WHERE floor_id = ?',
      ).get(integrationFloor.id) as { count: number };

      if (existingIntegrationRooms.count === 0 && !blueprintHasIntegrationRooms) {
        const DEFAULT_INTEGRATION_ROOMS = ['data-exchange', 'provider-hub', 'plugin-bay'];
        const INTEGRATION_ROOM_NAMES: Record<string, string> = {
          'data-exchange': 'Data Exchange',
          'provider-hub': 'Provider Hub',
          'plugin-bay': 'Plugin Bay',
        };
        for (const roomType of DEFAULT_INTEGRATION_ROOMS) {
          const roomId = uid('room');
          db.prepare(`
            INSERT INTO rooms (id, floor_id, type, name, config)
            VALUES (?, ?, ?, ?, ?)
          `).run(roomId, integrationFloor.id, roomType, INTEGRATION_ROOM_NAMES[roomType], JSON.stringify({}));
          roomsCreated++;
        }
        log.info({ buildingId, rooms: DEFAULT_INTEGRATION_ROOMS }, 'Default integration floor rooms provisioned');
      }
    }
  }

  // 4. Create agent DB rows with human-readable names and profiles (#560, #575)
  const usedNames = new Set<string>();
  for (const agent of blueprint.agentRoster) {
    const agentId = uid('agent');
    const profile = generateAgentIdentity(agent.name, agent.role, usedNames);
    usedNames.add(profile.displayName);

    db.prepare(`
      INSERT INTO agents (id, name, role, building_id, room_access,
        first_name, last_name, display_name, gender, bio, specialization,
        age, backstory, communication_style, expertise_areas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId, agent.name, agent.role, buildingId, JSON.stringify(agent.rooms),
      profile.firstName, profile.lastName, profile.displayName,
      profile.gender, profile.bio, profile.specialization,
      profile.age, profile.backstory, profile.communicationStyle, JSON.stringify(profile.expertiseAreas),
    );
    agentsCreated++;
  }

  log.info({ buildingId, floorsCreated, roomsCreated, agentsCreated }, 'Blueprint applied');
  return ok({ buildingId, floorsCreated, roomsCreated, agentsCreated });
}

/**
 * Apply a custom-building-plan exit document (from Building Architect) to
 * provision floors, rooms, and agents with full configuration control.
 *
 * Unlike applyBlueprint, this accepts explicit names, configs, and
 * capabilities for each entity — used when the plan comes from an
 * architect room rather than the strategist's template output.
 */
export function applyCustomPlan(buildingId: string, plan: CustomPlanData): Result {
  const db = getDb();

  // 1. Verify building exists
  const building = db.prepare('SELECT id FROM buildings WHERE id = ?').get(buildingId) as { id: string } | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  let floorsCreated = 0;
  let roomsCreated = 0;
  let agentsCreated = 0;

  // 2. Create floors that don't already exist
  for (const floorDef of plan.floors) {
    const existing = db.prepare(
      'SELECT id FROM floors WHERE building_id = ? AND type = ?',
    ).get(buildingId, floorDef.type) as { id: string } | undefined;

    if (!existing) {
      const result = createFloor({
        buildingId,
        type: floorDef.type,
        name: floorDef.name,
      });
      if (result.ok) {
        floorsCreated++;
      } else {
        log.warn({ buildingId, floorType: floorDef.type, error: (result as ErrResult).error }, 'Failed to create floor during custom plan apply');
      }
    }
  }

  // 3. Create room DB rows with config
  for (const assignment of plan.roomAssignments) {
    const floor = db.prepare(
      'SELECT id FROM floors WHERE building_id = ? AND type = ?',
    ).get(buildingId, assignment.floor) as { id: string } | undefined;

    if (!floor) {
      log.warn({ buildingId, floorType: assignment.floor }, 'Floor not found for room assignment — skipping');
      continue;
    }

    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO rooms (id, floor_id, type, name, config)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, floor.id, assignment.roomType, assignment.roomName, JSON.stringify(assignment.config || {}));
    roomsCreated++;
  }

  // 4. Create agent DB rows with rich identities (same as applyBlueprint, #562)
  const usedNames = new Set<string>();
  for (const agentDef of plan.agentDefinitions) {
    const agentId = uid('agent');
    const profile = generateAgentIdentity(agentDef.name, agentDef.role, usedNames);
    usedNames.add(profile.displayName);

    db.prepare(`
      INSERT INTO agents (id, name, role, building_id, capabilities, room_access,
        first_name, last_name, display_name, gender, bio, specialization,
        age, backstory, communication_style, expertise_areas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId, agentDef.name, agentDef.role, buildingId,
      JSON.stringify(agentDef.capabilities || []),
      JSON.stringify(agentDef.roomAccess || []),
      profile.firstName, profile.lastName, profile.displayName,
      profile.gender, profile.bio, profile.specialization,
      profile.age, profile.backstory, profile.communicationStyle, JSON.stringify(profile.expertiseAreas),
    );
    agentsCreated++;
  }

  log.info({ buildingId, floorsCreated, roomsCreated, agentsCreated }, 'Custom plan applied');
  return ok({ buildingId, floorsCreated, roomsCreated, agentsCreated });
}

// ─── Health Score ───

const PHASE_SCORES: Record<string, number> = {
  strategy: 4,
  discovery: 8,
  architecture: 12,
  execution: 17,
  review: 21,
  deploy: 25,
};

export interface HealthScoreBreakdown {
  phaseProgress: number;
  taskCompletion: number;
  raidHealth: number;
  agentActivity: number;
  total: number;
}

/**
 * Calculate a 0-100 health score for a building (project).
 *
 * Components (each 0-25):
 * - Phase Progress: how far through the phase pipeline
 * - Task Completion: % of tasks marked done
 * - RAID Health: fewer open risks/issues = healthier
 * - Agent Activity: recent message volume indicates momentum
 */
export function getHealthScore(buildingId: string): Result {
  const db = getDb();

  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  // 1. Phase Progress (0-25)
  const phase = building.active_phase || 'strategy';
  const phaseProgress = PHASE_SCORES[phase] ?? 0;

  // 2. Task Completion (0-25)
  const taskStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
    FROM tasks WHERE building_id = ?
  `).get(buildingId) as { total: number; done: number };

  const taskCompletion = taskStats.total > 0
    ? Math.round((taskStats.done / taskStats.total) * 25)
    : 0;

  // 3. RAID Health (0-25) — fewer active risks/issues = healthier
  const raidStats = db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'risk' AND status = 'active' THEN 1 ELSE 0 END) as risks,
      SUM(CASE WHEN type = 'issue' AND status = 'active' THEN 1 ELSE 0 END) as issues
    FROM raid_entries WHERE building_id = ?
  `).get(buildingId) as { risks: number; issues: number };

  const raidPenalty = (raidStats.risks || 0) * 5 + (raidStats.issues || 0) * 3;
  const raidHealth = Math.max(0, 25 - raidPenalty);

  // 4. Agent Activity (0-25) — messages in last 7 days
  const activityCount = db.prepare(`
    SELECT COUNT(*) as count FROM messages
    WHERE room_id IN (
      SELECT r.id FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE f.building_id = ?
    )
    AND created_at >= datetime('now', '-7 days')
  `).get(buildingId) as { count: number };

  // Scale: 0 msgs = 0, 50+ msgs = 25 (linear with cap)
  const agentActivity = Math.min(25, Math.round((activityCount.count / 50) * 25));

  const total = phaseProgress + taskCompletion + raidHealth + agentActivity;

  return ok({
    buildingId,
    score: { phaseProgress, taskCompletion, raidHealth, agentActivity, total },
  });
}

// ─── Auto-Discovery of Local Repos (#971) ───

/** Directories to skip during auto-discovery (case-insensitive) */
const AUTO_DISCOVER_SKIP = new Set(['overlord-v2', 'development docs']);

/** Humanize a directory name: kebab-case / snake_case → Title Case */
function humanizeDirName(dirName: string): string {
  return dirName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Scan ~/GitRepos/ for git repositories and create a building for each.
 * Skips Overlord-v2 itself and non-git directories.
 * Only runs when the buildings table is empty (first run / fresh DB).
 *
 * Returns the number of buildings created.
 */
export function autoDiscoverRepos(): number {
  const db = getDb();

  const existingCount = (db.prepare('SELECT COUNT(*) as count FROM buildings').get() as { count: number }).count;
  if (existingCount > 0) {
    log.info({ existingCount }, 'Buildings already exist — skipping auto-discovery');
    return 0;
  }

  const gitReposDir = join(homedir(), 'GitRepos');
  if (!existsSync(gitReposDir)) {
    log.warn({ path: gitReposDir }, 'GitRepos directory not found — skipping auto-discovery');
    return 0;
  }

  let entries: string[];
  try {
    entries = readdirSync(gitReposDir);
  } catch (e) {
    log.error({ err: e }, 'Failed to read GitRepos directory');
    return 0;
  }

  let created = 0;

  for (const entry of entries) {
    const fullPath = join(gitReposDir, entry);

    try {
      if (!statSync(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }

    if (AUTO_DISCOVER_SKIP.has(entry.toLowerCase())) continue;
    if (!existsSync(join(fullPath, '.git'))) continue;

    // Try to get remote URL
    let repoUrl: string | undefined;
    try {
      repoUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: fullPath, encoding: 'utf8', timeout: 5000 }).trim();
    } catch {
      // No remote — that's fine
    }

    const displayName = humanizeDirName(entry);
    const result = createBuilding({
      name: displayName,
      projectId: `project_${entry.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      workingDirectory: fullPath,
      repoUrl,
      allowedPaths: [fullPath],
    });

    if (result.ok) {
      created++;
      log.info({ name: displayName, path: fullPath, repoUrl }, 'Auto-discovered repo → building created');
    } else {
      log.error({ name: displayName, error: result.error }, 'Failed to create building for discovered repo');
    }
  }

  log.info({ created, scanned: entries.length }, 'Auto-discovery complete');
  return created;
}
