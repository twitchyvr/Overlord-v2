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
import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err, safeJsonParse } from '../core/contracts.js';
import type { Result, ErrResult, BuildingRow, FloorRow } from '../core/contracts.js';

function uid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
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
  config?: Record<string, unknown>;
  provisionFloors?: boolean;
}

/**
 * Create a new building (project container).
 * By default provisions all standard floors.
 */
export function createBuilding({ name, projectId, config = {}, provisionFloors = true }: CreateBuildingParams): Result {
  const db = getDb();
  const id = uid('bld');

  db.prepare(`
    INSERT INTO buildings (id, project_id, name, config)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId || null, name, JSON.stringify(config));

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

  log.info({ id, name, projectId }, 'Building created');
  return ok({ id, name, floorIds });
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
export function updateBuilding(buildingId: string, updates: { name?: string; config?: Record<string, unknown> }): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  db.prepare(`
    UPDATE buildings SET
      name = COALESCE(?, name),
      config = COALESCE(?, config),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updates.name || null,
    updates.config ? JSON.stringify(updates.config) : null,
    buildingId,
  );

  log.info({ buildingId, updates: Object.keys(updates) }, 'Building updated');
  return ok({ buildingId });
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

  // 4. Create agent DB rows with room access
  for (const agent of blueprint.agentRoster) {
    const agentId = uid('agent');
    db.prepare(`
      INSERT INTO agents (id, name, role, building_id, room_access)
      VALUES (?, ?, ?, ?, ?)
    `).run(agentId, agent.name, agent.role, buildingId, JSON.stringify(agent.rooms));
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

  // 4. Create agent DB rows with capabilities and room access
  for (const agentDef of plan.agentDefinitions) {
    const agentId = uid('agent');
    db.prepare(`
      INSERT INTO agents (id, name, role, building_id, capabilities, room_access)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      agentDef.name,
      agentDef.role,
      buildingId,
      JSON.stringify(agentDef.capabilities || []),
      JSON.stringify(agentDef.roomAccess || []),
    );
    agentsCreated++;
  }

  log.info({ buildingId, floorsCreated, roomsCreated, agentsCreated }, 'Custom plan applied');
  return ok({ buildingId, floorsCreated, roomsCreated, agentsCreated });
}
