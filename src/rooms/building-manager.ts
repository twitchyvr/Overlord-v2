/**
 * Building Manager
 *
 * CRUD for buildings and floors — the top two levels of the spatial model.
 * Building → Floor → Room → Table → Chair.
 *
 * A building represents a project. Floors organize rooms by function.
 * When a building is created, default floors are provisioned based on config.
 */

import { getDb } from '../storage/db.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, BuildingRow } from '../core/contracts.js';

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
  const id = `bld_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO buildings (id, project_id, name, config)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId || null, name, JSON.stringify(config));

  const floorIds: string[] = [];

  if (provisionFloors) {
    for (const floor of DEFAULT_FLOORS) {
      const floorId = `floor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    config: JSON.parse(building.config || '{}'),
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
  return ok(rows.map((b) => ({ ...b, config: JSON.parse(b.config || '{}') })));
}

/**
 * Update a building's config or name
 */
export function updateBuilding(buildingId: string, updates: { name?: string; config?: Record<string, unknown> }): Result {
  const db = getDb();
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as BuildingRow | undefined;
  if (!building) return err('BUILDING_NOT_FOUND', `Building ${buildingId} does not exist`);

  if (updates.name) {
    db.prepare('UPDATE buildings SET name = ?, updated_at = datetime(?) WHERE id = ?')
      .run(updates.name, new Date().toISOString(), buildingId);
  }
  if (updates.config) {
    db.prepare('UPDATE buildings SET config = ?, updated_at = datetime(?) WHERE id = ?')
      .run(JSON.stringify(updates.config), new Date().toISOString(), buildingId);
  }

  log.info({ buildingId, updates: Object.keys(updates) }, 'Building updated');
  return ok({ buildingId });
}

// ─── Floors ───

interface FloorRow {
  id: string;
  building_id: string;
  type: string;
  name: string;
  sort_order: number;
  is_active: number;
  config: string;
  created_at: string;
}

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

  const id = `floor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
    config: JSON.parse(floor.config || '{}'),
    rooms,
  });
}

/**
 * List all floors in a building
 */
export function listFloors(buildingId: string): Result {
  const db = getDb();
  const floors = db.prepare(
    'SELECT * FROM floors WHERE building_id = ? ORDER BY sort_order',
  ).all(buildingId) as FloorRow[];

  return ok(floors.map((f) => ({ ...f, config: JSON.parse(f.config || '{}') })));
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
  return ok(floor);
}
