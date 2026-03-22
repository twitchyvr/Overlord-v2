/**
 * Universal I/O Contracts
 *
 * Every module, room, tool, agent, and plugin follows this pattern.
 * "Content can change. Hierarchy stays consistent."
 */

import { z } from 'zod';
export type { Config } from './config.js';

// ─── TypeScript Interfaces ───

export interface ResultMetadata {
  duration?: number;
  roomId?: string;
  agentId?: string;
  phase?: string;
}

export interface ResultError {
  code: string;
  message: string;
  retryable: boolean;
  context?: Record<string, unknown>;
}

export interface OkResult<T = unknown> {
  ok: true;
  data: T;
  metadata?: ResultMetadata;
}

export interface ErrResult {
  ok: false;
  error: ResultError;
}

export type Result<T = unknown> = OkResult<T> | ErrResult;

export interface TableConfig {
  chairs: number;
  description: string;
}

export interface ExitTemplate {
  type: string;
  fields: string[];
}

export type FileScope = 'assigned' | 'read-only' | 'full';

export interface RoomContract {
  roomType: string;
  floor: string;
  tables: Record<string, TableConfig>;
  tools: string[];
  fileScope: FileScope;
  exitRequired: ExitTemplate;
  escalation?: Record<string, string>;
  provider: string;
  /** Whether resource locking is enabled for tools in this room. Default: true (#941). */
  resourceLocking?: boolean;
}

export interface SecurityBadge {
  rooms: string[];
  clearance: 'standard' | 'elevated' | 'admin';
  canExport: boolean;
}

export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  roomAccess: string[];
  badge?: string;
  parsedBadge?: SecurityBadge | null;
}

export type RaidType = 'risk' | 'assumption' | 'issue' | 'decision';
export type RaidStatus = 'active' | 'superseded' | 'closed';

export interface RaidEntry {
  id: string;
  type: RaidType;
  phase: string;
  roomId: string;
  summary: string;
  rationale?: string;
  decidedBy: string;
  approvedBy?: string;
  affectedAreas: string[];
  timestamp: string;
  status: RaidStatus;
}

export type GateStatus = 'pending' | 'go' | 'no-go' | 'conditional';
export type GateVerdict = 'GO' | 'NO-GO' | 'CONDITIONAL';

export interface PhaseGateCriterion {
  label: string;
  met: boolean;
  evidenceUrl?: string;
}

export interface PhaseGateSignoff {
  reviewer: string;
  verdict: GateVerdict;
  conditions: string[];
  timestamp: string;
}

export interface PhaseGate {
  id: string;
  phase: string;
  status: GateStatus;
  criteria: PhaseGateCriterion[];
  exitDocId?: string;
  raidEntries: string[];
  signoff?: PhaseGateSignoff;
  nextPhaseInput?: Record<string, unknown>;
}

export interface ExitDocument {
  id: string;
  roomId: string;
  type: string;
  completedBy: string;
  fields: Record<string, unknown>;
  artifacts: string[];
  raidEntries: string[];
  timestamp: string;
}

// ─── DB Row Types (snake_case from SQLite) ───

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  building_id: string | null;
  capabilities: string;
  room_access: string;
  badge: string | null;
  status: string;
  current_room_id: string | null;
  current_table_id: string | null;
  config: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  nickname: string | null;
  bio: string | null;
  photo_url: string | null;
  specialization: string | null;
  gender: string | null;
  age: number | null;
  backstory: string | null;
  communication_style: string | null;
  expertise_areas: string;
  profile_generated: number;
  provider: string;
  created_at: string;
  updated_at: string;
}

// ─── Security Level ───

export type SecurityLevel = 'permissive' | 'standard' | 'strict' | 'paranoid';

export const SECURITY_LEVELS: readonly SecurityLevel[] = ['permissive', 'standard', 'strict', 'paranoid'] as const;

export const DEFAULT_SECURITY_LEVEL: SecurityLevel = 'standard';

export interface BuildingConfig {
  securityLevel?: SecurityLevel;
  effortLevel?: string;
  projectDescription?: string;
  template?: string;
  [key: string]: unknown;
}

export interface BuildingRow {
  id: string;
  project_id: string | null;
  name: string;
  working_directory: string | null;
  repo_url: string | null;
  allowed_paths: string;
  config: string;
  active_phase: string;
  created_at: string;
  updated_at: string;
}

export interface FloorRow {
  id: string;
  building_id: string;
  type: string;
  name: string;
  sort_order: number;
  is_active: number;
  config: string;
  created_at: string;
}

export interface PhaseGateRow {
  id: string;
  building_id: string;
  phase: string;
  status: string;
  criteria: string;
  exit_doc_id: string | null;
  signoff_reviewer: string | null;
  signoff_verdict: string | null;
  signoff_conditions: string;
  signoff_timestamp: string | null;
  next_phase_input: string;
  created_at: string;
}

export interface RaidEntryRow {
  id: string;
  building_id: string;
  type: string;
  phase: string;
  room_id: string | null;
  summary: string;
  rationale: string | null;
  decided_by: string | null;
  approved_by: string | null;
  affected_areas: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RoomRow {
  id: string;
  floor_id: string;
  type: string;
  name: string;
  allowed_tools: string;
  file_scope: string;
  exit_template: string;
  escalation: string;
  provider: string;
  config: string;
  status: string;
  created_at: string;
}

export interface TaskRow {
  id: string;
  building_id: string;
  title: string;
  description: string | null;
  status: string;
  parent_id: string | null;
  milestone_id: string | null;
  assignee_id: string | null;
  room_id: string | null;
  table_id: string | null;
  phase: string | null;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface TodoRow {
  id: string;
  task_id: string;
  agent_id: string | null;
  room_id: string | null;
  description: string;
  status: string;
  exit_doc_ref: string | null;
  created_at: string;
  completed_at: string | null;
}

// ─── Tool Types ───

/**
 * Describes a resource that a tool requires a lock on.
 * Used by the tool middleware to transparently acquire/release locks (#941).
 */
export interface ToolResourceDescriptor {
  /** Resource type prefix: 'file', 'git', 'browser', 'build', 'shell', 'database', etc. */
  type: string;
  /**
   * How to derive the resource key:
   *  - 'static': lock on `type:<buildingId>` (e.g., 'git:building-123')
   *  - 'param': lock on `type:<paramValue>` (e.g., 'file:src/foo.ts')
   */
  mode: 'static' | 'param';
  /** Which param key to read when mode is 'param' (e.g., 'path', 'destination') */
  paramKey?: string;
  /** Override lock options for this resource */
  lockOptions?: { ttl?: number; maxWait?: number };
}

/**
 * Concurrency mode for a tool (#942).
 *  - 'concurrent': Any number of agents can call simultaneously (read-only tools)
 *  - 'serialized': One agent at a time per resource, others queue (write tools)
 *  - 'exclusive': One agent globally, all others blocked (destructive ops like browser, rebase)
 */
export type ToolConcurrencyMode = 'concurrent' | 'serialized' | 'exclusive';

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context?: ToolContext) => Promise<unknown>;
  /** Resources this tool needs locks on. Empty/undefined = no locking needed (#941). */
  resources?: ToolResourceDescriptor[];
  /**
   * Concurrency mode for this tool (#942).
   * Default: 'serialized' for tools with resources, 'concurrent' for tools without.
   * 'exclusive' tools acquire a global lock blocking all other tool execution.
   */
  concurrencyMode?: ToolConcurrencyMode;
}

// ── Merge Queue Types (#944) ──

export type MergeQueuePriority = 'hotfix' | 'feature' | 'refactor' | 'auto';

export type MergeQueueEntryStatus =
  | 'queued'
  | 'rebasing'
  | 'testing'
  | 'merging'
  | 'merged'
  | 'failed'
  | 'cancelled';

export interface MergeQueueEntry {
  id: string;
  buildingId: string;
  branch: string;
  worktreePath: string;
  agentId: string;
  priority: MergeQueuePriority;
  status: MergeQueueEntryStatus;
  position: number;
  mainDrift: MergeDriftInfo | null;
  failureReason: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MergeDriftInfo {
  commitsBehind: number;
  overlappingFiles: string[];
  driftLevel: 'low' | 'medium' | 'high';
}

export interface MergeQueueSnapshot {
  buildingId: string;
  entries: MergeQueueEntry[];
  currentlyMerging: string | null;
  updatedAt: number;
}

export interface MergeQueueRow {
  id: string;
  building_id: string;
  branch: string;
  worktree_path: string;
  agent_id: string;
  priority: string;
  status: string;
  position: number;
  main_drift: string;
  failure_reason: string | null;
  enqueued_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export const MERGE_PRIORITY_ORDER: Record<MergeQueuePriority, number> = {
  hotfix: 0,
  feature: 1,
  refactor: 2,
  auto: 3,
};

export interface RepoContextEntry {
  name: string;
  url: string;
  relationship: 'main' | 'dependency' | 'fork' | 'reference' | 'submodule';
  localPath?: string;
  branch?: string;
}

export interface FileOriginEntry {
  filePath: string;
  repoName: string;
  sourceFilePath?: string;
  modifiedLocally: boolean;
}

export interface ToolContext {
  roomId: string;
  roomType: string;
  agentId: string;
  fileScope: string;
  /** Building ID — for project-scoped tools (#788) */
  buildingId?: string;
  /** Building's project working directory — tools use this as cwd */
  workingDirectory?: string;
  /** Additional paths the building has been granted access to */
  allowedPaths?: string[];
  /** Linked repos and file origin tracking for this building */
  repoContext?: {
    repos: RepoContextEntry[];
    fileOrigins: FileOriginEntry[];
    truncatedOrigins?: boolean;
  };
}

// ─── AI Types ───

export interface AIAdapter {
  name: string;
  sendMessage: (
    messages: unknown[],
    tools: ToolDefinition[],
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  validateConfig: () => boolean;
}

// ─── Layer Init Return Types ───

export interface RoomManagerAPI {
  createRoom: (params: { type: string; floorId: string; name: string; config?: Record<string, unknown> }) => Result;
  enterRoom: (params: { roomId: string; agentId: string; tableType?: string }) => Result;
  exitRoom: (params: { roomId: string; agentId: string; reason?: 'disconnect' | 'normal' | 'reassignment' }) => Result;
  getRoom: (roomId: string) => import('./contracts.js').BaseRoomLike | null;
  listRooms: () => RoomRow[];
  registerRoomType: (type: string, factory: BaseRoomConstructor) => void;
  hydrateRoomsFromDb: () => { activated: number; skipped: number; failed: number };
  updateRoom: (roomId: string, updates: { name?: string; config?: Record<string, unknown>; allowedTools?: string[]; fileScope?: string; exitTemplate?: Record<string, unknown>; provider?: string }) => Result;
  deleteRoom: (roomId: string) => Result;
  updateTable: (tableId: string, updates: { type?: string; chairs?: number; description?: string }) => Result;
  deleteTable: (tableId: string) => Result;
}

export interface BuildingManagerAPI {
  createBuilding: (params: { name: string; projectId?: string; workingDirectory?: string; repoUrl?: string; allowedPaths?: string[]; config?: Record<string, unknown>; provisionFloors?: boolean }) => Result;
  getBuilding: (buildingId: string) => Result;
  listBuildings: (projectId?: string) => Result;
  updateBuilding: (buildingId: string, updates: { name?: string; workingDirectory?: string; repoUrl?: string; allowedPaths?: string[]; config?: Record<string, unknown> }) => Result;
  addAllowedPath: (buildingId: string, path: string) => Result;
  removeAllowedPath: (buildingId: string, path: string) => Result;
  createFloor: (params: { buildingId: string; type: string; name: string; sortOrder?: number; config?: Record<string, unknown> }) => Result;
  getFloor: (floorId: string) => Result;
  listFloors: (buildingId: string) => Result;
  getFloorByType: (buildingId: string, floorType: string) => Result;
  updateFloor: (floorId: string, updates: { name?: string; sortOrder?: number; config?: Record<string, unknown>; isActive?: boolean }) => Result;
  deleteFloor: (floorId: string) => Result;
  sortFloors: (buildingId: string, floorIds: string[]) => Result;
}

export interface AgentProfileFields {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  nickname?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  specialization?: string | null;
  gender?: string | null;
  profileGenerated?: boolean;
  /** Subject reference for visual consistency across profile photo regenerations (#384) */
  subjectReference?: string | null;
}

export interface AgentRegistryAPI {
  registerAgent: (params: {
    name: string; role: string; capabilities?: string[];
    roomAccess?: string[]; badge?: string | null; config?: Record<string, unknown>;
    buildingId?: string | null;
    firstName?: string | null; lastName?: string | null; displayName?: string | null;
    nickname?: string | null; bio?: string | null; photoUrl?: string | null; specialization?: string | null;
    gender?: string;
  }) => Result;
  removeAgent: (agentId: string) => Result;
  getAgent: (agentId: string) => ParsedAgent | null;
  listAgents: (filters?: { status?: string; roomId?: string; buildingId?: string }) => ParsedAgent[];
  updateAgent: (agentId: string, updates: Record<string, unknown>) => Result;
  updateAgentProfile: (agentId: string, profile: AgentProfileFields) => Result;
}

export interface ToolRegistryAPI {
  registerTool: (def: ToolDefinition) => void;
  getTool: (name: string) => ToolDefinition | null;
  getToolsForRoom: (allowedToolNames: string[]) => ToolDefinition[];
  executeInRoom: (params: {
    toolName: string; params: Record<string, unknown>;
    roomAllowedTools: string[]; context: ToolContext;
    /** Whether resource locking is enabled. Default: true (#941). */
    resourceLocking?: boolean;
  }) => Promise<Result>;
}

export interface AIProviderAPI {
  getAdapter: (name: string) => AIAdapter | null;
  sendMessage: (params: {
    provider: string; messages: unknown[];
    tools?: ToolDefinition[]; options?: Record<string, unknown>;
  }) => Promise<Result>;
  registerAdapter: (name: string, adapter: AIAdapter) => void;
}

export interface ParsedAgent {
  id: string;
  name: string;
  role: string;
  building_id: string | null;
  capabilities: string[];
  room_access: string[];
  badge: string | null;
  status: string;
  current_room_id: string | null;
  current_table_id: string | null;
  config: Record<string, unknown>;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  nickname: string | null;
  bio: string | null;
  photo_url: string | null;
  specialization: string | null;
  profile_generated: boolean;
  provider: string;
  created_at: string;
  updated_at: string;
}

export interface BaseRoomLike {
  id: string;
  type: string;
  config: RoomContract;
  getAllowedTools(): string[];
  hasTool(toolName: string): boolean;
  readonly fileScope: FileScope;
  readonly exitRequired: ExitTemplate;
  readonly escalation: Record<string, string>;
  validateExitDocument(document: Record<string, unknown>): Result;
  validateExitDocumentValues(document: Record<string, unknown>): Result;
  buildContextInjection(): Record<string, unknown>;
  getRules(): string[];
  getOutputFormat(): unknown;

  // Lifecycle hooks — rooms actively participate in agent work
  onAgentEnter(agentId: string, tableType: string): Result;
  onAgentExit(agentId: string): Result;
  onBeforeToolCall(toolName: string, agentId: string, input: Record<string, unknown>): Result;
  onAfterToolCall(toolName: string, agentId: string, result: Result): void;
  onMessage(agentId: string, content: string, role: 'user' | 'assistant'): void;

  // Bus injection for event emission
  setBus(bus: import('../core/bus.js').Bus): void;
}

export type BaseRoomConstructor = new (id: string, config?: Partial<RoomContract>) => BaseRoomLike;

// ─── Base Result Envelope (Zod — for runtime validation at boundaries) ───

export const ResultSchema = z.object({
  ok: z.boolean(),
  data: z.any().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().default(false),
      context: z.record(z.any()).optional(),
    })
    .optional(),
  metadata: z
    .object({
      duration: z.number().optional(),
      roomId: z.string().optional(),
      agentId: z.string().optional(),
      phase: z.string().optional(),
    })
    .optional(),
});

export function ok<T>(data: T, metadata?: ResultMetadata): OkResult<T> {
  return { ok: true, data, metadata };
}

export function err(
  code: string,
  message: string,
  { retryable = false, context }: { retryable?: boolean; context?: Record<string, unknown> } = {},
): ErrResult {
  return { ok: false, error: { code, message, retryable, context } };
}

/**
 * Safely parse a JSON string, returning a fallback value if parsing fails.
 * Use this for all database fields that store serialized JSON to prevent
 * crashes from corrupted data.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Zod Schemas (for runtime validation at system boundaries) ───

export const RoomContractSchema = z.object({
  roomType: z.string(),
  floor: z.string(),
  tables: z.record(
    z.object({
      chairs: z.number().int().positive(),
      description: z.string(),
    }),
  ),
  tools: z.array(z.string()),
  fileScope: z.enum(['assigned', 'read-only', 'full']).default('assigned'),
  exitRequired: z.object({
    type: z.string(),
    fields: z.array(z.string()),
  }),
  escalation: z.record(z.string()).optional(),
  provider: z.string().default('configurable'),
});

export const SecurityBadgeSchema = z.object({
  rooms: z.array(z.string()),
  clearance: z.enum(['standard', 'elevated', 'admin']),
  canExport: z.boolean(),
});

export const AgentIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  capabilities: z.array(z.string()),
  roomAccess: z.array(z.string()),
  badge: z.string().optional(),
  parsedBadge: SecurityBadgeSchema.nullable().optional(),
});

export const RaidEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['risk', 'assumption', 'issue', 'decision']),
  phase: z.string(),
  roomId: z.string(),
  summary: z.string(),
  rationale: z.string().optional(),
  decidedBy: z.string(),
  approvedBy: z.string().optional(),
  affectedAreas: z.array(z.string()).default([]),
  timestamp: z.string().datetime(),
  status: z.enum(['active', 'superseded', 'closed']).default('active'),
});

export const ExitDocumentSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  type: z.string(),
  completedBy: z.string(),
  fields: z.record(z.any()),
  artifacts: z.array(z.string()).default([]),
  raidEntries: z.array(z.string()).default([]),
  timestamp: z.string().datetime(),
});

export const PhaseGateSchema = z.object({
  id: z.string(),
  phase: z.string(),
  status: z.enum(['pending', 'go', 'no-go', 'conditional']),
  exitDocId: z.string().optional(),
  raidEntries: z.array(z.string()).default([]),
  signoff: z
    .object({
      reviewer: z.string(),
      verdict: z.enum(['GO', 'NO-GO', 'CONDITIONAL']),
      conditions: z.array(z.string()).default([]),
      timestamp: z.string().datetime(),
    })
    .optional(),
  nextPhaseInput: z.record(z.any()).optional(),
});
