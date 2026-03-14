/**
 * Storage Layer
 *
 * Swappable storage backend. SQLite by default, designed for
 * future migration to Postgres/Redis.
 *
 * Creates all v2 tables: buildings, floors, rooms, tables_v2, agents,
 * messages, tasks, todos, exit_documents, phase_gates, raid_entries,
 * agent_sessions, migrations.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../core/logger.js';
import type { Config } from '../core/config.js';

const log = logger.child({ module: 'storage' });

let db: Database.Database | null = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    name TEXT NOT NULL,
    working_directory TEXT,
    repo_url TEXT,
    allowed_paths TEXT DEFAULT '[]',
    config TEXT DEFAULT '{}',
    active_phase TEXT DEFAULT 'strategy',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL REFERENCES buildings(id),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    config TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    floor_id TEXT NOT NULL REFERENCES floors(id),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    allowed_tools TEXT DEFAULT '[]',
    file_scope TEXT DEFAULT 'assigned',
    exit_template TEXT DEFAULT '{}',
    escalation TEXT DEFAULT '{}',
    provider TEXT DEFAULT 'configurable',
    config TEXT DEFAULT '{}',
    status TEXT DEFAULT 'idle',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tables_v2 (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    type TEXT NOT NULL DEFAULT 'focus',
    chairs INTEGER DEFAULT 1,
    description TEXT,
    config TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    building_id TEXT REFERENCES buildings(id),
    capabilities TEXT DEFAULT '[]',
    room_access TEXT DEFAULT '[]',
    badge TEXT,
    status TEXT DEFAULT 'idle',
    current_room_id TEXT REFERENCES rooms(id),
    current_table_id TEXT REFERENCES tables_v2(id),
    config TEXT DEFAULT '{}',
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    nickname TEXT,
    bio TEXT,
    photo_url TEXT,
    specialization TEXT,
    gender TEXT,
    profile_generated INTEGER DEFAULT 0,
    age INTEGER,
    backstory TEXT,
    communication_style TEXT,
    expertise_areas TEXT DEFAULT '[]',
    subject_reference TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    agent_id TEXT REFERENCES agents(id),
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    attachments TEXT DEFAULT '[]',
    thread_id TEXT,
    parent_id TEXT REFERENCES messages(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    building_id TEXT REFERENCES buildings(id),
    room_id TEXT REFERENCES rooms(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    thread_id TEXT,
    title TEXT NOT NULL,
    rationale TEXT,
    steps TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    reviewed_by TEXT,
    review_comment TEXT,
    reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL REFERENCES buildings(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    parent_id TEXT REFERENCES tasks(id),
    milestone_id TEXT,
    assignee_id TEXT REFERENCES agents(id),
    room_id TEXT REFERENCES rooms(id),
    table_id TEXT REFERENCES tables_v2(id),
    phase TEXT,
    priority TEXT DEFAULT 'normal',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    agent_id TEXT REFERENCES agents(id),
    room_id TEXT REFERENCES rooms(id),
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    exit_doc_ref TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL REFERENCES buildings(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
    due_date TEXT,
    phase TEXT,
    ordinal INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS exit_documents (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    type TEXT NOT NULL,
    completed_by TEXT NOT NULL,
    fields TEXT DEFAULT '{}',
    artifacts TEXT DEFAULT '[]',
    raid_entry_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS phase_gates (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL REFERENCES buildings(id),
    phase TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    criteria TEXT DEFAULT '[]',
    exit_doc_id TEXT REFERENCES exit_documents(id),
    signoff_reviewer TEXT,
    signoff_verdict TEXT,
    signoff_conditions TEXT DEFAULT '[]',
    signoff_timestamp TEXT,
    next_phase_input TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS raid_entries (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL REFERENCES buildings(id),
    type TEXT NOT NULL CHECK(type IN ('risk', 'assumption', 'issue', 'decision')),
    phase TEXT NOT NULL,
    room_id TEXT REFERENCES rooms(id),
    summary TEXT NOT NULL,
    rationale TEXT,
    decided_by TEXT,
    approved_by TEXT,
    affected_areas TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'closed')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    room_id TEXT,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    room_id TEXT NOT NULL REFERENCES rooms(id),
    table_type TEXT NOT NULL DEFAULT 'focus',
    tools TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'ended')),
    messages TEXT DEFAULT '[]',
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY,
    source_room_id TEXT NOT NULL REFERENCES rooms(id),
    source_message_id TEXT,
    target_room_id TEXT NOT NULL REFERENCES rooms(id),
    target_entry_id TEXT,
    target_type TEXT NOT NULL CHECK(target_type IN ('message', 'raid', 'exit-doc', 'room')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_activity_log (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    event_type TEXT NOT NULL,
    event_data TEXT DEFAULT '{}',
    building_id TEXT,
    room_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_stats (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    metric TEXT NOT NULL,
    value REAL DEFAULT 0,
    period TEXT DEFAULT 'all-time',
    recorded_at TEXT DEFAULT (datetime('now')),
    UNIQUE(agent_id, metric, period)
  );

  CREATE TABLE IF NOT EXISTS agent_emails (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    from_id TEXT NOT NULL REFERENCES agents(id),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'unread',
    building_id TEXT REFERENCES buildings(id),
    parent_id TEXT REFERENCES agent_emails(id),
    created_at TEXT DEFAULT (datetime('now')),
    read_at TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_email_recipients (
    id TEXT PRIMARY KEY,
    email_id TEXT NOT NULL REFERENCES agent_emails(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    type TEXT DEFAULT 'to',
    read_at TEXT
  );

  CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type);
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(current_room_id);
  CREATE INDEX IF NOT EXISTS idx_agents_building ON agents(building_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_building ON tasks(building_id);
  CREATE INDEX IF NOT EXISTS idx_todos_task ON todos(task_id);
  CREATE INDEX IF NOT EXISTS idx_todos_agent ON todos(agent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_table ON tasks(table_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id);
  CREATE INDEX IF NOT EXISTS idx_milestones_building ON milestones(building_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);
  CREATE INDEX IF NOT EXISTS idx_raid_building ON raid_entries(building_id);
  CREATE INDEX IF NOT EXISTS idx_raid_phase ON raid_entries(phase);
  CREATE INDEX IF NOT EXISTS idx_raid_type ON raid_entries(type);
  CREATE INDEX IF NOT EXISTS idx_exit_docs_room ON exit_documents(room_id);
  CREATE INDEX IF NOT EXISTS idx_phase_gates_building ON phase_gates(building_id);
  CREATE INDEX IF NOT EXISTS idx_notes_agent ON notes(agent_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON agent_sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_room ON agent_sessions(room_id);
  CREATE INDEX IF NOT EXISTS idx_citations_source ON citations(source_room_id);
  CREATE INDEX IF NOT EXISTS idx_citations_target ON citations(target_room_id);
  CREATE INDEX IF NOT EXISTS idx_citations_type ON citations(target_type);
  CREATE INDEX IF NOT EXISTS idx_activity_agent ON agent_activity_log(agent_id);
  CREATE INDEX IF NOT EXISTS idx_activity_type ON agent_activity_log(event_type);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON agent_activity_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_stats_agent ON agent_stats(agent_id);
  CREATE INDEX IF NOT EXISTS idx_stats_metric ON agent_stats(metric);
  CREATE INDEX IF NOT EXISTS idx_stats_compound ON agent_stats(agent_id, metric, period);
  CREATE INDEX IF NOT EXISTS idx_plans_building ON plans(building_id);
  CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id);
  CREATE INDEX IF NOT EXISTS idx_plans_thread ON plans(thread_id);
  CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
  CREATE INDEX IF NOT EXISTS idx_emails_thread ON agent_emails(thread_id);
  CREATE INDEX IF NOT EXISTS idx_emails_from ON agent_emails(from_id);
  CREATE INDEX IF NOT EXISTS idx_emails_building ON agent_emails(building_id);
  CREATE INDEX IF NOT EXISTS idx_emails_status ON agent_emails(status);
  CREATE INDEX IF NOT EXISTS idx_emails_priority ON agent_emails(priority);
  CREATE INDEX IF NOT EXISTS idx_email_recipients_email ON agent_email_recipients(email_id);
  CREATE INDEX IF NOT EXISTS idx_email_recipients_agent ON agent_email_recipients(agent_id);
  CREATE INDEX IF NOT EXISTS idx_email_recipients_unread ON agent_email_recipients(agent_id, read_at);
`;

/**
 * Column definitions that may be missing from existing tables.
 * Each entry: [table, column, column_definition].
 * Used by migrateSchema() to ADD COLUMN if the table already existed
 * before the column was introduced.
 */
const EXPECTED_COLUMNS: Array<[string, string, string]> = [
  ['agents', 'building_id', 'TEXT REFERENCES buildings(id)'],
  ['agents', 'first_name', 'TEXT'],
  ['agents', 'last_name', 'TEXT'],
  ['agents', 'display_name', 'TEXT'],
  ['agents', 'bio', 'TEXT'],
  ['agents', 'photo_url', 'TEXT'],
  ['agents', 'specialization', 'TEXT'],
  ['agents', 'nickname', 'TEXT'],
  ['agents', 'gender', 'TEXT'],
  ['agents', 'profile_generated', 'INTEGER DEFAULT 0'],
  ['tasks', 'table_id', 'TEXT REFERENCES tables_v2(id)'],
  ['tables_v2', 'config', "TEXT DEFAULT '{}'"],
  ['buildings', 'working_directory', 'TEXT'],
  ['buildings', 'repo_url', 'TEXT'],
  ['buildings', 'allowed_paths', "TEXT DEFAULT '[]'"],
  ['messages', 'attachments', "TEXT DEFAULT '[]'"],
  ['phase_gates', 'criteria', "TEXT DEFAULT '[]'"],
  ['agents', 'age', 'INTEGER'],
  ['agents', 'backstory', 'TEXT'],
  ['agents', 'communication_style', 'TEXT'],
  ['agents', 'expertise_areas', "TEXT DEFAULT '[]'"],
  ['agents', 'subject_reference', 'TEXT'],
];

/**
 * Detect and apply schema migrations for existing databases.
 *
 * `CREATE TABLE IF NOT EXISTS` never modifies existing tables, so new columns
 * added after initial table creation must be back-filled with ALTER TABLE.
 * This runs BEFORE the main schema SQL so that CREATE INDEX statements
 * referencing newly-added columns don't fail.
 */
function migrateSchema(database: Database.Database): void {
  for (const [table, column, definition] of EXPECTED_COLUMNS) {
    // Check if the table exists
    const tableExists = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    ).get(table);
    if (!tableExists) continue; // Table doesn't exist yet — CREATE TABLE will handle it

    // Check if the column exists
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const hasColumn = columns.some((c) => c.name === column);
    if (hasColumn) continue; // Column already exists

    // Add the missing column
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    log.info({ table, column }, 'Migration: added missing column to existing table');
  }
}

/**
 * Initialize the SQLite database with WAL mode and the v2 schema.
 * Note: Database.prototype.exec() is SQLite's SQL execution method,
 * not Node's child_process exec — no shell injection risk.
 */
export async function initStorage(cfg: Config): Promise<Database.Database> {
  const dbPath = cfg.get('DB_PATH');
  const dir = dirname(dbPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Migrate existing tables before running schema (adds missing columns)
  migrateSchema(db);

  // SQLite exec() runs SQL statements — not a shell command
  db.exec(SCHEMA_SQL);
  log.info({ path: dbPath }, 'Database initialized with v2 schema');

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initStorage() first.');
  return db;
}
