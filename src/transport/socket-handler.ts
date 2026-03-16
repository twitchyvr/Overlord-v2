/**
 * Transport Layer — Socket.IO Handler
 *
 * Maps socket events to bus events. Organized by domain.
 * Replaces v1's 137-handler hub.js with typed, domain-organized handlers.
 *
 * CRITICAL: Every socket.on handler is wrapped in try/catch via the `handle()`
 * utility to prevent unhandled exceptions from crashing the server.
 *
 * All incoming payloads are validated with Zod schemas before processing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'crypto';
import { logger, broadcastLog } from '../core/logger.js';
import { config as appConfig } from '../core/config.js';
import type { Bus } from '../core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI, AIProviderAPI } from '../core/contracts.js';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { AgentSession } from '../agents/agent-session.js';
import { createBuilding, getBuilding, listBuildings, updateBuilding, addAllowedPath, removeAllowedPath, listFloors, getFloor, createFloor, updateFloor, deleteFloor, sortFloors, getHealthScore } from '../rooms/building-manager.js';
import { getGitInfo, initGitRepo, cloneGitRepo } from '../tools/git-detector.js';
import { getGates, canAdvance, signoffGate, createGate, getPendingGates, resolveConditions, getStalePendingGates, getPhaseOrder } from '../rooms/phase-gate.js';
import { searchRaid, addRaidEntry, updateRaidEntry, updateRaidStatus } from '../rooms/raid-log.js';
import { submitExitDocument } from '../rooms/room-manager.js';
import { getDb } from '../storage/db.js';
import { handleBlueprintSubmission } from '../rooms/phase-zero.js';
import { addCitation, getCitations, getBacklinks } from '../rooms/citation-tracker.js';
import { parseCommandText, dispatchCommand, handleMention, resolveReference, listCommands } from '../commands/index.js';
import type { CommandContext, ParsedToken } from '../commands/index.js';
import type { z } from 'zod';

import {
  validate,
  BuildingCreateSchema, BuildingGetSchema, BuildingListSchema, BuildingApplyBlueprintSchema, BuildingUpdateSchema, BuildingHealthScoreSchema,
  FolderAddPathSchema, FolderRemovePathSchema, FolderListPathsSchema,
  GitDetectSchema, GitInitSchema, GitCloneSchema,
  FloorListSchema, FloorGetSchema, FloorCreateSchema, FloorUpdateSchema, FloorDeleteSchema, FloorSortSchema,
  RoomCreateSchema, RoomGetSchema, RoomEnterSchema, RoomExitSchema, RoomUpdateSchema, RoomDeleteSchema,
  TableCreateSchema, TableListSchema, TableUpdateSchema, TableDeleteSchema, AgentMoveSchema,
  AgentRegisterSchema, AgentGetSchema, AgentListSchema, AgentUpdateSchema, AgentUpdateProfileSchema,
  AgentGenerateProfileSchema,
  AgentGeneratePhotoSchema,
  ChatMessageSchema,
  ConversationListSchema, ConversationLoadSchema, ConversationCreateSchema, ConversationDeleteSchema,
  EmptyPayloadSchema, PhaseStatusSchema, PhaseGateSchema, PhaseGateCreateSchema,
  PhaseGatesSchema, PhaseCanAdvanceSchema, PhasePendingGatesSchema,
  PhaseResolveConditionsSchema, PhaseStaleGatesSchema, PhaseGateSignoffSchema, PhaseAdvanceSchema,
  RaidSearchSchema, RaidListSchema, RaidAddSchema, RaidUpdateSchema, RaidEditSchema,
  TaskCreateSchema, TaskUpdateSchema, TaskListSchema, TaskGetSchema,
  TaskAssignTableSchema, TaskUnassignTableSchema,
  MilestoneCreateSchema, MilestoneUpdateSchema, MilestoneListSchema, MilestoneGetSchema, MilestoneDeleteSchema,
  TodoCreateSchema, TodoToggleSchema, TodoListSchema, TodoDeleteSchema,
  TodoAssignAgentSchema, TodoUnassignAgentSchema,
  ExitDocSubmitSchema, ExitDocGetSchema, ExitDocListSchema,
  CitationListSchema, CitationBacklinksSchema,
  TableSetContextSchema, TableGetContextSchema, TableClearContextSchema,
  TableGetAssignmentsSchema, TableDivideWorkSchema,
  AgentStatsGetSchema, AgentActivityLogSchema, AgentLeaderboardSchema,
  PlanSubmitSchema, PlanReviewSchema, PlanGetSchema, PlanListSchema,
  EmailSendSchema, EmailReplySchema, EmailForwardSchema,
  EmailInboxSchema, EmailGetSchema, EmailThreadSchema,
  EmailMarkReadSchema, EmailUnreadCountSchema, EmailSentSchema,
  SessionNoteWriteSchema, SessionNoteReadSchema, SessionNoteListSchema,
  SessionNoteDeleteSchema, SessionNoteClearSchema,
  SearchGlobalSchema,
  PluginListSchema, PluginGetSchema, PluginToggleSchema,
  PluginConfigGetSchema, PluginConfigSetSchema, PluginActivitySchema,
  PluginSourceGetSchema, PluginSourceSaveSchema, PluginCreateSchema,
  PluginDeleteSchema, PluginValidateSchema, PluginExportSchema,
  PluginImportSchema, PluginLogSubscribeSchema,
  QualityConfigGetSchema, QualityConfigSetSchema,
  ActivityHistorySchema,
  AgentResetSchema,
  RoomProviderSetSchema,
  RoomEscalateSchema,
  PipelineRecordSchema, PipelineGetSchema, PipelineBuildingSchema, PipelineLoopBackSchema,
  MemorySearchSchema, MemoryContextSchema, MemoryStatsSchema,
  ModelProviderSchema, ModelRecommendSchema, ModelGetSchema, ModelCompareSchema,
  MessagingModeSchema, GnapBuildingSchema,
  LogLevelSetSchema,
  RepoAddSchema, RepoRemoveSchema, RepoListSchema, RepoUpdateSchema, RepoAnalyzeSchema, RepoSyncStatusSchema, RepoSyncFetchSchema,
} from './schemas.js';
import { getStatsSummary, getActivityLog, getBuildingActivityLog, getLeaderboard, onRoomJoin, onRoomLeave, onStatusChange, onTaskComplete, onTaskAssign, onMessageSent, onSessionStart, onSessionEnd } from '../agents/agent-stats.js';
import { resetBuildingAgents } from '../agents/agent-registry.js';
import { writeNote, readNote, listNotes, deleteNote, clearNotes } from '../tools/providers/session-notes.js';
import { getQualityConfig } from '../tools/quality-defaults.js';
import { globalSearch } from '../storage/global-search.js';
import { listPlugins, getPlugin, loadPlugin, unloadPlugin, reloadPlugin, getPluginLogs } from '../plugins/plugin-loader.js';
import { validateLuaSyntax } from '../plugins/lua-validator.js';
import { exportBundle, importBundle } from '../plugins/plugin-bundler.js';
import { sendEmail, getInbox, getSentEmails, getEmail, getThread, markAsRead, getUnreadCount, replyToEmail, forwardEmail } from '../agents/agent-email.js';
import { recordEvidence, getTaskEvidence, getTaskPipelineStatus, getBuildingEvidence, loopBackToCode } from '../rooms/pipeline-evidence.js';
import { searchMemory, getRecentContext, getMemoryStats } from '../agents/agent-memory.js';
import { listModels, getProviderModels, getRecommendedModel, getModel, compareModels } from '../ai/model-registry.js';
import { GnapMessagingAdapter } from '../agents/gnap-messaging-adapter.js';
import type { PipelineStage } from '../rooms/pipeline-evidence.js';
import { generateFullProfile } from '../ai/agent-profile-service.js';
import type { FullProfileResult } from '../ai/agent-profile-service.js';
import { analyzeRepos } from '../ai/repo-analysis-service.js';
import { checkSyncStatus, fetchLatestCommit } from '../ai/repo-sync-service.js';
import { generateAgentProfilePhoto } from '../ai/profile-generator.js';
import { isImageGenerationAvailable } from '../ai/minimax-image.js';
import { writeAgentPhoto } from '../ai/agent-photo-store.js';

const log = logger.child({ module: 'transport' });

// ─── Helpers ───

/**
 * Parse JSON string fields in an exit_documents row.
 * DB stores `fields`, `artifacts`, `raid_entry_ids` as JSON strings.
 */
function parseExitDocRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    fields: safeJsonParse(row.fields as string, {}),
    artifacts: safeJsonParse(row.artifacts as string, []),
    raid_entry_ids: safeJsonParse(row.raid_entry_ids as string, []),
  };
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ─── Types ───

type Ack = (res: unknown) => void;

/**
 * Tracks what resources a socket has created/entered so we can clean up on disconnect.
 */
interface SocketAssociations {
  agentIds: Set<string>;
  /** Map of agentId → roomId for active room memberships */
  roomMemberships: Map<string, string>;
}

interface InitTransportParams {
  io: SocketIOServer;
  bus: Bus;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
  ai: AIProviderAPI;
}

// ─── Per-socket tracking for disconnect cleanup ───

const socketAssociations = new Map<string, SocketAssociations>();

function getAssociations(socketId: string): SocketAssociations {
  let assoc = socketAssociations.get(socketId);
  if (!assoc) {
    assoc = { agentIds: new Set(), roomMemberships: new Map() };
    socketAssociations.set(socketId, assoc);
  }
  return assoc;
}

// ─── Handler registration utility ───

/**
 * Build a safe error response envelope for ack callbacks.
 */
function errorResponse(event: string, thrown: unknown): { ok: false; error: { code: string; message: string; retryable: boolean } } {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  broadcastLog('error', `Handler "${event}" failed: ${message}`, 'transport');
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: `Handler "${event}" failed: ${message}`,
      retryable: false,
    },
  };
}

/**
 * Register a socket event handler with schema validation, try/catch, and error logging.
 *
 * For simple handlers: validate → call handler → ack result.
 * For complex handlers: validate → custom logic in handler body.
 *
 * Uses z.output<S> (Zod's output type) so handlers see post-default values
 * (e.g. `.optional().default('')` resolves to `string`, not `string | undefined`).
 */
function handle<S extends z.ZodTypeAny>(
  socket: Socket,
  event: string,
  schema: S | null,
  handler: (parsed: z.output<NonNullable<S>>, ack?: Ack) => void | Promise<void>,
): void {
  socket.on(event, async (data: unknown, ack?: Ack) => {
    try {
      if (schema) {
        const parsed = validate(schema, data, event, ack);
        if (!parsed) return;
        await handler(parsed, ack);
      } else {
        await handler(data as z.output<NonNullable<S>>, ack);
      }
    } catch (e) {
      log.error({ event, err: e, socketId: socket.id }, 'Handler threw');
      if (ack) ack(errorResponse(event, e));
    }
  });
}

// ─── Main transport initialization ───

export function initTransport({ io, bus, rooms, agents, tools: _tools, ai }: InitTransportParams): void {
  io.on('connection', (socket: Socket) => {
    log.info({ id: socket.id }, 'Client connected');
    broadcastLog('info', `Client connected (${socket.id})`, 'transport');

    // ─── Building Selection (room-based isolation #593) ───
    // When a client selects a building, they join a Socket.IO room for that building.
    // This ensures events are scoped to the active building.
    socket.on('building:select', (data: { buildingId?: string }, ack?: (res: unknown) => void) => {
      const buildingId = data?.buildingId;
      if (!buildingId) {
        if (ack) ack({ ok: false, error: { code: 'MISSING_BUILDING_ID', message: 'buildingId is required' } });
        return;
      }
      // Leave all previous building rooms
      for (const room of socket.rooms) {
        if (room.startsWith('building:') && room !== `building:${buildingId}`) {
          socket.leave(room);
        }
      }
      // Join the new building room
      socket.join(`building:${buildingId}`);
      log.info({ socketId: socket.id, buildingId }, 'Client joined building room');
      if (ack) ack({ ok: true });
    });

    // ─── Building Events ───

    handle(socket, 'building:create', BuildingCreateSchema, (parsed, ack) => {
      // Default working directory if none specified (#540)
      // Ensures Code Lab has a directory to write files from the start
      let workingDirectory = parsed.workingDirectory;
      if (!workingDirectory) {
        const kebabName = parsed.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        workingDirectory = `/tmp/overlord-projects/${kebabName}`;
      }
      // Ensure the directory exists
      try {
        fs.mkdirSync(workingDirectory, { recursive: true });
      } catch (e) {
        log.warn({ err: e, dir: workingDirectory }, 'Failed to create default working directory');
      }

      const result = createBuilding({
        name: parsed.name,
        projectId: parsed.projectId,
        workingDirectory,
        repoUrl: parsed.repoUrl,
        config: {
          ...(parsed.effortLevel ? { effortLevel: parsed.effortLevel } : {}),
        },
      });
      if (result.ok) {
        const buildingData = result.data as { id: string; name: string; workingDirectory: string | null; repoUrl: string | null; floorIds: string[] };
        broadcastLog('info', `Building created: ${buildingData.name}`, 'building');
        bus.emit('building:created', {
          buildingId: buildingData.id,
          name: buildingData.name,
          workingDirectory: buildingData.workingDirectory,
          repoUrl: buildingData.repoUrl,
          floorIds: buildingData.floorIds,
        });
      }
      if (ack) ack(result);
    });

    handle(socket, 'building:get', BuildingGetSchema, (parsed, ack) => {
      if (ack) ack(getBuilding(parsed.buildingId));
    });

    handle(socket, 'building:list', BuildingListSchema, (parsed, ack) => {
      if (ack) ack(listBuildings(parsed?.projectId));
    });

    handle(socket, 'building:update', BuildingUpdateSchema, (parsed, ack) => {
      const result = updateBuilding(parsed.buildingId, {
        name: parsed.name,
        workingDirectory: parsed.workingDirectory,
        repoUrl: parsed.repoUrl,
        allowedPaths: parsed.allowedPaths,
        config: parsed.config,
      });
      if (result.ok) {
        broadcastLog('info', `Building updated: ${parsed.buildingId}`, 'building');
        bus.emit('building:updated', {
          id: parsed.buildingId,
          name: parsed.name,
          workingDirectory: parsed.workingDirectory,
          repoUrl: parsed.repoUrl,
        });
      }
      if (ack) ack(result);
    });

    handle(socket, 'building:health-score', BuildingHealthScoreSchema, (parsed, ack) => {
      if (ack) ack(getHealthScore(parsed.buildingId));
    });

    // ─── Folder / Path Permission Events ───

    handle(socket, 'folder:add-path', FolderAddPathSchema, (parsed, ack) => {
      const result = addAllowedPath(parsed.buildingId, parsed.path);
      if (result.ok) {
        const data = result.data as { allowedPaths: string[] };
        broadcastLog('info', `Allowed path added: ${parsed.path}`, 'building');
        bus.emit('building:updated', { id: parsed.buildingId, allowedPaths: data.allowedPaths });
      }
      if (ack) ack(result);
    });

    handle(socket, 'folder:remove-path', FolderRemovePathSchema, (parsed, ack) => {
      const result = removeAllowedPath(parsed.buildingId, parsed.path);
      if (result.ok) {
        const data = result.data as { allowedPaths: string[] };
        broadcastLog('info', `Allowed path removed: ${parsed.path}`, 'building');
        bus.emit('building:updated', { id: parsed.buildingId, allowedPaths: data.allowedPaths });
      }
      if (ack) ack(result);
    });

    handle(socket, 'folder:list-paths', FolderListPathsSchema, (parsed, ack) => {
      const buildingResult = getBuilding(parsed.buildingId);
      if (!buildingResult.ok) {
        if (ack) ack(buildingResult);
        return;
      }
      const building = buildingResult.data as Record<string, unknown>;
      const allowedPaths = safeJsonParse(building.allowed_paths as string, []);
      if (ack) ack({ ok: true, data: { buildingId: parsed.buildingId, allowedPaths } });
    });

    // ─── Git Detection Events ───

    handle(socket, 'git:detect', GitDetectSchema, (parsed, ack) => {
      const info = getGitInfo(parsed.path);
      if (ack) ack({ ok: true, data: info });
    });

    handle(socket, 'git:init', GitInitSchema, (parsed, ack) => {
      const result = initGitRepo(parsed.path);
      if (result.success) {
        broadcastLog('info', `Git repo initialized: ${parsed.path}`, 'git');
      }
      if (ack) ack({ ok: result.success, data: result, error: result.success ? undefined : { code: 'GIT_INIT_FAILED', message: result.message } });
    });

    handle(socket, 'git:clone', GitCloneSchema, (parsed, ack) => {
      const result = cloneGitRepo(parsed.url, parsed.targetDir);
      if (result.success) {
        broadcastLog('info', `Git repo cloned: ${parsed.url} → ${parsed.targetDir}`, 'git');
      }
      if (ack) ack({ ok: result.success, data: result, error: result.success ? undefined : { code: 'GIT_CLONE_FAILED', message: result.message } });
    });

    handle(socket, 'building:apply-blueprint', BuildingApplyBlueprintSchema, async (parsed, ack) => {
      const result = await handleBlueprintSubmission({
        buildingId: parsed.buildingId,
        blueprint: parsed.blueprint,
        agentId: parsed.agentId,
      });
      // Blueprint creates room DB records — hydrate them into active instances
      // so they're immediately usable (getRoom works, room detail views load)
      if (result.ok) {
        rooms.hydrateRoomsFromDb();
      }
      if (ack) ack(result);
    });

    handle(socket, 'system:status', EmptyPayloadSchema, (_data, ack) => {
      const result = listBuildings();
      const buildings = result.ok ? (result.data as Array<{ id: string; name: string; active_phase: string; config: Record<string, unknown>; repo_url?: string }>) : [];

      // Enrich with floor/agent counts
      const db = getDb();
      const floorCounts = db.prepare(
        'SELECT building_id, COUNT(*) as count FROM floors GROUP BY building_id'
      ).all() as Array<{ building_id: string; count: number }>;
      const floorMap = new Map(floorCounts.map(r => [r.building_id, r.count]));

      const agentCounts = db.prepare(
        `SELECT f.building_id, COUNT(DISTINCT a.id) as count
         FROM agents a JOIN rooms r ON a.current_room_id = r.id
         JOIN floors f ON r.floor_id = f.id
         GROUP BY f.building_id`
      ).all() as Array<{ building_id: string; count: number }>;
      const agentMap = new Map(agentCounts.map(r => [r.building_id, r.count]));

      // Compute health scores for each building
      const healthMap = new Map<string, { phaseProgress: number; taskCompletion: number; raidHealth: number; agentActivity: number; total: number }>();
      for (const b of buildings) {
        const hResult = getHealthScore(b.id);
        if (hResult.ok) {
          healthMap.set(b.id, (hResult.data as { score: { phaseProgress: number; taskCompletion: number; raidHealth: number; agentActivity: number; total: number } }).score);
        }
      }

      if (ack) ack({
        ok: true,
        data: {
          isNewUser: buildings.length === 0,
          buildings: buildings.map((b) => ({
            id: b.id,
            name: b.name,
            activePhase: b.active_phase,
            description: (b.config as Record<string, unknown>)?.description || '',
            repoUrl: b.repo_url || '',
            floorCount: floorMap.get(b.id) || 0,
            agentCount: agentMap.get(b.id) || 0,
            healthScore: healthMap.get(b.id) || null,
          })),
        },
      });
    });

    // ─── Floor Events ───

    handle(socket, 'floor:list', FloorListSchema, (parsed, ack) => {
      if (ack) ack(listFloors(parsed.buildingId));
    });

    handle(socket, 'floor:get', FloorGetSchema, (parsed, ack) => {
      if (ack) ack(getFloor(parsed.floorId));
    });

    handle(socket, 'floor:create', FloorCreateSchema, (parsed, ack) => {
      const result = createFloor(parsed as Parameters<typeof createFloor>[0]);
      if (result.ok) {
        const floorData = result.data as { id: string; buildingId: string; type: string; name: string };
        broadcastLog('info', `Floor created: ${floorData.name}`, 'building');
        bus.emit('floor:created', floorData);
      }
      if (ack) ack(result);
    });

    handle(socket, 'floor:update', FloorUpdateSchema, (parsed, ack) => {
      const result = updateFloor(parsed.floorId, {
        name: parsed.name,
        sortOrder: parsed.sortOrder,
        config: parsed.config,
        isActive: parsed.isActive,
      });
      if (result.ok) {
        broadcastLog('info', `Floor updated: ${parsed.floorId}`, 'building');
        bus.emit('floor:updated', { floorId: parsed.floorId });
      }
      if (ack) ack(result);
    });

    handle(socket, 'floor:delete', FloorDeleteSchema, (parsed, ack) => {
      const result = deleteFloor(parsed.floorId);
      if (result.ok) {
        broadcastLog('info', `Floor deleted: ${parsed.floorId}`, 'building');
        bus.emit('floor:deleted', { floorId: parsed.floorId });
      }
      if (ack) ack(result);
    });

    handle(socket, 'floor:sort', FloorSortSchema, (parsed, ack) => {
      const result = sortFloors(parsed.buildingId, parsed.floorIds);
      if (result.ok) {
        broadcastLog('info', `Floors reordered in building ${parsed.buildingId}`, 'building');
        bus.emit('floor:sorted', { buildingId: parsed.buildingId, order: parsed.floorIds });
      }
      if (ack) ack(result);
    });

    // ─── Room Events ───

    handle(socket, 'room:create', RoomCreateSchema, (parsed, ack) => {
      if (ack) ack(rooms.createRoom(parsed as Parameters<typeof rooms.createRoom>[0]));
    });

    handle(socket, 'room:get', RoomGetSchema, (parsed, ack) => {
      const room = rooms.getRoom(parsed.roomId);
      if (!room) {
        if (ack) ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: `Room ${parsed.roomId} does not exist`, retryable: false } });
        return;
      }
      // Fetch agents currently seated in this room from DB
      const roomDb = getDb();
      const seatedAgents = roomDb.prepare(
        'SELECT id, name, role, status, current_table_id FROM agents WHERE current_room_id = ?',
      ).all(parsed.roomId) as Array<Record<string, unknown>>;

      // Fetch tables for this room
      const roomTables = roomDb.prepare(
        'SELECT id, type, chairs, description FROM tables_v2 WHERE room_id = ?',
      ).all(parsed.roomId) as Array<Record<string, unknown>>;

      // Get room name from DB
      const roomRow = roomDb.prepare('SELECT name, floor_id FROM rooms WHERE id = ?').get(parsed.roomId) as { name: string; floor_id: string } | undefined;

      if (ack) ack({
        ok: true,
        data: {
          id: room.id,
          type: room.type,
          name: roomRow?.name || room.type,
          floorId: roomRow?.floor_id,
          tools: room.getAllowedTools(),
          fileScope: room.fileScope,
          exitRequired: room.exitRequired,
          escalation: room.escalation,
          tables: room.config.tables,
          activeTables: roomTables,
          agents: seatedAgents,
          rules: room.getRules(),
        },
      });
    });

    handle(socket, 'room:list', EmptyPayloadSchema, (_data, ack) => {
      if (ack) ack({ ok: true, data: rooms.listRooms() });
    });

    handle(socket, 'room:enter', RoomEnterSchema, (parsed, ack) => {
      const result = rooms.enterRoom(parsed as Parameters<typeof rooms.enterRoom>[0]);
      if (result.ok) {
        getAssociations(socket.id).roomMemberships.set(parsed.agentId, parsed.roomId);
        // Record stats — look up room type for activity context
        const room = rooms.getRoom(parsed.roomId);
        const roomType = room?.type ?? 'unknown';
        const agent = agents.getAgent(parsed.agentId);
        onRoomJoin(parsed.agentId, parsed.roomId, roomType, agent?.building_id ?? undefined);
        onSessionStart(parsed.agentId, parsed.roomId, agent?.building_id ?? undefined);
      }
      if (ack) ack(result);
    });

    handle(socket, 'room:exit', RoomExitSchema, (parsed, ack) => {
      // Explicitly pass only roomId/agentId — never allow client to set 'reason: disconnect'
      // which would bypass exit-doc enforcement (only the disconnect handler may set that)
      const result = rooms.exitRoom({ roomId: parsed.roomId, agentId: parsed.agentId });
      if (result.ok) {
        getAssociations(socket.id).roomMemberships.delete(parsed.agentId);
        // Record stats — look up room type for activity context
        const room = rooms.getRoom(parsed.roomId);
        const roomType = room?.type ?? 'unknown';
        const agent = agents.getAgent(parsed.agentId);
        const buildingId = agent?.building_id ?? undefined;
        onRoomLeave(parsed.agentId, parsed.roomId, roomType, buildingId);

        // End active session and record duration
        const session = AgentSession.findActive(parsed.agentId, parsed.roomId);
        if (session) {
          session.end();
          session.save();
          const durationMs = session.endedAt! - session.startedAt;
          onSessionEnd(parsed.agentId, parsed.roomId, durationMs, buildingId);
        }
      }
      if (ack) ack(result);
    });

    // ─── Room-to-Room Escalation (#589) ───

    handle(socket, 'room:escalate', RoomEscalateSchema, (parsed, ack) => {
      const db = getDb();

      // Validate fromRoomId exists in this building (review finding #2)
      const fromRoom = db.prepare(`
        SELECT r.id FROM rooms r
        JOIN floors f ON r.floor_id = f.id
        WHERE r.id = ? AND f.building_id = ?
      `).get(parsed.fromRoomId, parsed.buildingId) as { id: string } | undefined;
      if (!fromRoom) {
        if (ack) ack({ ok: false, error: { code: 'INVALID_SOURCE', message: `Source room ${parsed.fromRoomId} not found in this building`, retryable: false } });
        return;
      }

      // Find the target room by type within this building
      const targetRoom = db.prepare(`
        SELECT r.id, r.type, r.name FROM rooms r
        JOIN floors f ON r.floor_id = f.id
        WHERE f.building_id = ? AND r.type = ?
        LIMIT 1
      `).get(parsed.buildingId, parsed.toRoomType) as { id: string; type: string; name: string } | undefined;

      if (!targetRoom) {
        if (ack) ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: `No ${parsed.toRoomType} room found in this building`, retryable: false } });
        return;
      }

      // Store the escalation context as a message in the target room
      if (parsed.contextSummary) {
        const msgId = randomUUID();
        db.prepare(`
          INSERT INTO messages (id, room_id, agent_id, role, content, created_at)
          VALUES (?, ?, NULL, 'system', ?, datetime('now'))
        `).run(msgId, targetRoom.id, `[Escalation] ${parsed.reason}\n\nContext:\n${parsed.contextSummary}`);
      }

      log.info({ from: parsed.fromRoomId, to: targetRoom.id, toType: parsed.toRoomType, reason: parsed.reason }, 'Room escalation');
      broadcastLog('info', `Escalation: ${parsed.toRoomType} (${parsed.reason})`, 'rooms');

      bus.emit('room:escalated', {
        fromRoomId: parsed.fromRoomId,
        toRoomId: targetRoom.id,
        toRoomType: parsed.toRoomType,
        toRoomName: targetRoom.name,
        buildingId: parsed.buildingId,
        reason: parsed.reason,
      });

      if (ack) ack({ ok: true, data: { toRoomId: targetRoom.id, toRoomName: targetRoom.name, toRoomType: parsed.toRoomType } });
    });

    handle(socket, 'room:update', RoomUpdateSchema, (parsed, ack) => {
      const result = rooms.updateRoom(parsed.roomId, {
        name: parsed.name,
        config: parsed.config,
        allowedTools: parsed.allowedTools,
        fileScope: parsed.fileScope,
        exitTemplate: parsed.exitTemplate,
        provider: parsed.provider,
      });
      if (result.ok) {
        broadcastLog('info', `Room updated: ${parsed.roomId}`, 'rooms');
        bus.emit('room:updated', { roomId: parsed.roomId });
      }
      if (ack) ack(result);
    });

    handle(socket, 'room:delete', RoomDeleteSchema, (parsed, ack) => {
      const result = rooms.deleteRoom(parsed.roomId);
      if (result.ok) {
        broadcastLog('info', `Room deleted: ${parsed.roomId}`, 'rooms');
        bus.emit('room:deleted', { roomId: parsed.roomId });
      }
      if (ack) ack(result);
    });

    // ─── Table Events ───

    handle(socket, 'table:create', TableCreateSchema, (parsed, ack) => {
      const db = getDb();
      const tableId = `table_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Verify room exists
      const roomRow = db.prepare('SELECT id, type FROM rooms WHERE id = ?').get(parsed.roomId) as { id: string; type: string } | undefined;
      if (!roomRow) {
        if (ack) ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: `Room ${parsed.roomId} does not exist`, retryable: false } });
        return;
      }

      db.prepare('INSERT INTO tables_v2 (id, room_id, type, chairs, description) VALUES (?, ?, ?, ?, ?)').run(
        tableId, parsed.roomId, parsed.type, parsed.chairs, parsed.description || null,
      );

      const table = db.prepare('SELECT * FROM tables_v2 WHERE id = ?').get(tableId);
      log.info({ tableId, roomId: parsed.roomId, type: parsed.type }, 'Table created');
      broadcastLog('info', `Table "${parsed.type}" created in room ${roomRow.type}`, 'rooms');
      bus.emit('table:created', table as Record<string, unknown>);
      if (ack) ack({ ok: true, data: table });
    });

    handle(socket, 'table:list', TableListSchema, (parsed, ack) => {
      const db = getDb();
      const tables = db.prepare('SELECT * FROM tables_v2 WHERE room_id = ? ORDER BY created_at').all(parsed.roomId);

      // Include agent count per table
      const result = (tables as Array<Record<string, unknown>>).map(t => {
        const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents WHERE current_table_id = ?').get(t.id) as { count: number };
        return { ...t, agentCount: agentCount.count };
      });

      if (ack) ack({ ok: true, data: result });
    });

    handle(socket, 'table:update', TableUpdateSchema, (parsed, ack) => {
      const result = rooms.updateTable(parsed.tableId, {
        type: parsed.type,
        chairs: parsed.chairs,
        description: parsed.description,
      });
      if (result.ok) {
        broadcastLog('info', `Table updated: ${parsed.tableId}`, 'rooms');
        bus.emit('table:updated', { tableId: parsed.tableId });
      }
      if (ack) ack(result);
    });

    handle(socket, 'table:delete', TableDeleteSchema, (parsed, ack) => {
      const result = rooms.deleteTable(parsed.tableId);
      if (result.ok) {
        broadcastLog('info', `Table deleted: ${parsed.tableId}`, 'rooms');
        bus.emit('table:deleted', { tableId: parsed.tableId });
      }
      if (ack) ack(result);
    });

    // ─── Table Context Events (Fleet Coordination) ───

    handle(socket, 'table:set-context', TableSetContextSchema, (parsed, ack) => {
      const db = getDb();

      // Verify table exists
      const table = db.prepare('SELECT id, config FROM tables_v2 WHERE id = ?').get(parsed.tableId) as { id: string; config: string | null } | undefined;
      if (!table) {
        if (ack) ack({ ok: false, error: { code: 'TABLE_NOT_FOUND', message: `Table ${parsed.tableId} does not exist`, retryable: false } });
        return;
      }

      // Parse existing config, set the key, write back
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(table.config || '{}') as Record<string, unknown>;
      } catch {
        config = {};
      }
      config[parsed.key] = parsed.value;

      db.prepare('UPDATE tables_v2 SET config = ? WHERE id = ?')
        .run(JSON.stringify(config), parsed.tableId);

      log.info({ tableId: parsed.tableId, key: parsed.key }, 'Table context updated');
      broadcastLog('info', `Table context key "${parsed.key}" set on table ${parsed.tableId}`, 'rooms');
      bus.emit('table:context-updated', { tableId: parsed.tableId, key: parsed.key, value: parsed.value, context: config });
      if (ack) ack({ ok: true, data: { tableId: parsed.tableId, context: config } });
    });

    handle(socket, 'table:get-context', TableGetContextSchema, (parsed, ack) => {
      const db = getDb();

      const table = db.prepare('SELECT id, config FROM tables_v2 WHERE id = ?').get(parsed.tableId) as { id: string; config: string | null } | undefined;
      if (!table) {
        if (ack) ack({ ok: false, error: { code: 'TABLE_NOT_FOUND', message: `Table ${parsed.tableId} does not exist`, retryable: false } });
        return;
      }

      let context: Record<string, unknown>;
      try {
        context = JSON.parse(table.config || '{}') as Record<string, unknown>;
      } catch {
        context = {};
      }

      if (ack) ack({ ok: true, data: { tableId: parsed.tableId, context } });
    });

    handle(socket, 'table:clear-context', TableClearContextSchema, (parsed, ack) => {
      const db = getDb();

      const table = db.prepare('SELECT id FROM tables_v2 WHERE id = ?').get(parsed.tableId) as { id: string } | undefined;
      if (!table) {
        if (ack) ack({ ok: false, error: { code: 'TABLE_NOT_FOUND', message: `Table ${parsed.tableId} does not exist`, retryable: false } });
        return;
      }

      db.prepare('UPDATE tables_v2 SET config = ? WHERE id = ?')
        .run('{}', parsed.tableId);

      log.info({ tableId: parsed.tableId }, 'Table context cleared');
      broadcastLog('info', `Table context cleared for table ${parsed.tableId}`, 'rooms');
      bus.emit('table:context-updated', { tableId: parsed.tableId, key: null, value: null, context: {} });
      if (ack) ack({ ok: true, data: { tableId: parsed.tableId, context: {} } });
    });

    // ─── Table Work Division Events (Fleet Coordination) ───

    handle(socket, 'table:get-assignments', TableGetAssignmentsSchema, (parsed, ack) => {
      const db = getDb();

      // Verify table exists
      const table = db.prepare('SELECT id, room_id FROM tables_v2 WHERE id = ?').get(parsed.tableId) as { id: string; room_id: string } | undefined;
      if (!table) {
        if (ack) ack({ ok: false, error: { code: 'TABLE_NOT_FOUND', message: `Table ${parsed.tableId} does not exist`, retryable: false } });
        return;
      }

      // Get tasks assigned to this table
      const tasks = db.prepare('SELECT * FROM tasks WHERE table_id = ? ORDER BY created_at DESC').all(parsed.tableId);

      // Get agents seated at this table
      const agents = db.prepare('SELECT id, name, role, status FROM agents WHERE current_table_id = ?').all(parsed.tableId) as Array<{ id: string; name: string; role: string; status: string }>;

      // Get todos assigned to agents seated at this table
      const agentIds = agents.map(a => a.id);
      let todos: unknown[] = [];
      if (agentIds.length > 0) {
        const placeholders = agentIds.map(() => '?').join(', ');
        todos = db.prepare(`SELECT * FROM todos WHERE agent_id IN (${placeholders}) ORDER BY created_at`).all(...agentIds);
      }

      if (ack) ack({ ok: true, data: { tableId: parsed.tableId, tasks, todos, agents } });
    });

    handle(socket, 'table:divide-work', TableDivideWorkSchema, (parsed, ack) => {
      const db = getDb();

      // Verify table exists
      const table = db.prepare('SELECT id FROM tables_v2 WHERE id = ?').get(parsed.tableId) as { id: string } | undefined;
      if (!table) {
        if (ack) ack({ ok: false, error: { code: 'TABLE_NOT_FOUND', message: `Table ${parsed.tableId} does not exist`, retryable: false } });
        return;
      }

      // Verify task exists
      const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(parsed.taskId) as { id: string; title: string } | undefined;
      if (!task) {
        if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${parsed.taskId} does not exist`, retryable: false } });
        return;
      }

      // Verify all agents exist and are seated at this table
      for (const item of parsed.todoDescriptions) {
        const agent = db.prepare('SELECT id, current_table_id FROM agents WHERE id = ?').get(item.agentId) as { id: string; current_table_id: string | null } | undefined;
        if (!agent) {
          if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${item.agentId} does not exist`, retryable: false } });
          return;
        }
        if (agent.current_table_id !== parsed.tableId) {
          if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_AT_TABLE', message: `Agent ${item.agentId} is not seated at table ${parsed.tableId}`, retryable: false } });
          return;
        }
      }

      // Create todos for each agent
      const now = new Date().toISOString();
      const createdTodos: unknown[] = [];

      const insertStmt = db.prepare(`
        INSERT INTO todos (id, task_id, agent_id, description, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', datetime(?))
      `);

      for (const item of parsed.todoDescriptions) {
        const todoId = randomUUID();
        insertStmt.run(todoId, parsed.taskId, item.agentId, item.description, now);
        const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId);
        createdTodos.push(todo);
        bus.emit('todo:created', todo as Record<string, unknown>);
      }

      log.info({ tableId: parsed.tableId, taskId: parsed.taskId, todoCount: createdTodos.length }, 'Work divided at table');
      broadcastLog('info', `Work divided: ${createdTodos.length} todos created for task "${task.title}" at table ${parsed.tableId}`, 'tasks');
      bus.emit('table:work-divided', { tableId: parsed.tableId, taskId: parsed.taskId, todos: createdTodos });
      if (ack) ack({ ok: true, data: { tableId: parsed.tableId, taskId: parsed.taskId, todos: createdTodos } });
    });

    // ─── Agent Move (convenience: exit old room + enter new room in one step) ───

    handle(socket, 'agent:move', AgentMoveSchema, (parsed, ack) => {
      const db = getDb();
      const agent = db.prepare('SELECT id, current_room_id FROM agents WHERE id = ?').get(parsed.agentId) as { id: string; current_room_id: string | null } | undefined;

      if (!agent) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
        return;
      }

      // Exit current room if any — use 'reassignment' reason to bypass exit doc (#571)
      if (agent.current_room_id) {
        const exitResult = rooms.exitRoom({ roomId: agent.current_room_id, agentId: parsed.agentId, reason: 'reassignment' });
        if (!exitResult.ok) {
          if (ack) ack(exitResult);
          return;
        }
        getAssociations(socket.id).roomMemberships.delete(parsed.agentId);
        bus.emit('room:agent:exited', { roomId: agent.current_room_id, agentId: parsed.agentId, reason: 'move' });
      }

      // Enter new room
      const enterResult = rooms.enterRoom({ roomId: parsed.roomId, agentId: parsed.agentId, tableType: parsed.tableType ?? undefined });
      if (enterResult.ok) {
        getAssociations(socket.id).roomMemberships.set(parsed.agentId, parsed.roomId);
        bus.emit('room:agent:entered', { roomId: parsed.roomId, agentId: parsed.agentId, tableType: parsed.tableType });
        broadcastLog('info', `Agent ${parsed.agentId} moved to room`, 'rooms');
      }
      if (ack) ack(enterResult);
    });

    // ─── Agent Events ───

    handle(socket, 'agent:register', AgentRegisterSchema, (parsed, ack) => {
      const result = agents.registerAgent(parsed as Parameters<typeof agents.registerAgent>[0]);
      if (result.ok) {
        const agentId = (result.data as { id: string }).id;
        getAssociations(socket.id).agentIds.add(agentId);

        // Auto-generate profile in background if no profile fields were provided
        const hasProfile = parsed.firstName || parsed.lastName || parsed.bio;
        if (!hasProfile && parsed.role) {
          // Look up building context for relevant specializations (#511)
          let projectContext: string | undefined;
          try {
            const db = getDb();
            const buildings = db.prepare(
              'SELECT name, config FROM buildings ORDER BY created_at DESC LIMIT 1',
            ).all() as Array<{ name: string; config: string }>;
            if (buildings.length > 0) {
              const bConfig = buildings[0].config ? JSON.parse(buildings[0].config) : {};
              const desc = bConfig.projectDescription || '';
              const template = bConfig.template || '';
              if (desc || template) {
                projectContext = `Building: ${buildings[0].name}. ${template ? `Type: ${template}.` : ''} ${desc}`.trim();
              }
            }
          } catch {
            // Non-fatal — continue without project context
          }

          // Fire-and-forget: don't block registration
          generateFullProfile(ai, parsed.role, undefined, {
            provider: 'minimax',
            projectContext,
          }).then((genResult) => {
            if (genResult.ok) {
              const profileResult = genResult.data as FullProfileResult;
              const updateResult = agents.updateAgentProfile(agentId, profileResult.profile);
              if (updateResult.ok) {
                const updatedAgent = agents.getAgent(agentId);
                bus.emit('agent:profile-updated', { agentId, profile: updatedAgent });
                bus.emit('agent:profile-generated', {
                  agentId,
                  generation: profileResult.generation,
                  warnings: profileResult.warnings,
                  autoGenerated: true,
                });
                broadcastLog('info', `Auto-generated AI profile for agent ${parsed.name}: ${profileResult.profile.displayName || 'unnamed'}`, 'agents');
              }
            } else {
              log.warn({ agentId, error: genResult.error }, 'Auto-profile generation failed (non-blocking)');
            }
          }).catch((genErr: unknown) => {
            log.warn({ agentId, err: genErr }, 'Auto-profile generation threw (non-blocking)');
          });
        }
      }
      if (ack) ack(result);
    });

    handle(socket, 'agent:get', AgentGetSchema, (parsed, ack) => {
      const agent = agents.getAgent(parsed.agentId);
      if (!agent) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
        return;
      }
      if (ack) ack({ ok: true, data: agent });
    });

    handle(socket, 'agent:list', AgentListSchema, (parsed, ack) => {
      if (ack) ack({ ok: true, data: agents.listAgents(parsed as Parameters<typeof agents.listAgents>[0]) });
    });

    handle(socket, 'agent:update-profile', AgentUpdateProfileSchema, (parsed, ack) => {
      const result = agents.updateAgentProfile(parsed.agentId, {
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        displayName: parsed.displayName,
        nickname: parsed.nickname,
        bio: parsed.bio,
        photoUrl: parsed.photoUrl,
        specialization: parsed.specialization,
        profileGenerated: parsed.profileGenerated,
      });
      if (result.ok) {
        const updatedAgent = agents.getAgent(parsed.agentId);
        bus.emit('agent:profile-updated', { agentId: parsed.agentId, profile: updatedAgent });
        broadcastLog('info', `Agent profile updated: ${parsed.agentId}`, 'agents');
      }
      if (ack) ack(result);
    });

    handle(socket, 'agent:update', AgentUpdateSchema, (parsed, ack) => {
      const { agentId, ...updates } = parsed;
      const result = agents.updateAgent(agentId, updates);
      if (result.ok) {
        bus.emit('agent:updated', { agentId, updates: Object.keys(updates) });
        broadcastLog('info', `Agent updated: ${agentId}`, 'agents');
      }
      if (ack) ack(result);
    });

    handle(socket, 'agent:generate-profile', AgentGenerateProfileSchema, async (parsed, ack) => {
      const agent = agents.getAgent(parsed.agentId);
      if (!agent) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
        return;
      }

      const role = parsed.role || agent.role || 'General Agent';
      const capabilities = parsed.capabilities || agent.capabilities || [];

      // Look up building context for relevant specializations (#511)
      let profileProjectContext: string | undefined;
      if (agent.building_id) {
        try {
          const bRow = getDb().prepare('SELECT name, config FROM buildings WHERE id = ?').get(agent.building_id) as { name: string; config: string } | undefined;
          if (bRow) {
            const bCfg = bRow.config ? JSON.parse(bRow.config) : {};
            const desc = bCfg.projectDescription || '';
            const tmpl = bCfg.template || '';
            if (desc || tmpl) {
              profileProjectContext = `Building: ${bRow.name}. ${tmpl ? `Type: ${tmpl}.` : ''} ${desc}`.trim();
            }
          }
        } catch { /* non-fatal */ }
      }

      broadcastLog('info', `Generating AI profile for agent ${agent.name} (${role})...`, 'agents');

      const result = await generateFullProfile(ai, role, capabilities, {
        skipBio: parsed.skipBio,
        skipPhoto: parsed.skipPhoto,
        gender: parsed.gender,
        provider: parsed.provider,
        projectContext: profileProjectContext,
        existing: {
          firstName: agent.first_name,
          lastName: agent.last_name,
          displayName: agent.display_name,
          nickname: agent.nickname,
          bio: agent.bio,
          photoUrl: agent.photo_url,
          specialization: agent.specialization,
        },
      });

      if (result.ok) {
        const profileResult = result.data as FullProfileResult;
        // Apply the generated profile to the agent in the database
        const updateResult = agents.updateAgentProfile(parsed.agentId, profileResult.profile);

        if (updateResult.ok) {
          const updatedAgent = agents.getAgent(parsed.agentId);
          bus.emit('agent:profile-updated', { agentId: parsed.agentId, profile: updatedAgent });
          bus.emit('agent:profile-generated', {
            agentId: parsed.agentId,
            generation: profileResult.generation,
            warnings: profileResult.warnings,
          });
          broadcastLog('info', `AI profile generated for agent ${agent.name}: ${profileResult.profile.displayName || 'unnamed'}`, 'agents');
        }

        if (ack) ack({
          ok: true,
          data: {
            agentId: parsed.agentId,
            profile: profileResult.profile,
            generation: profileResult.generation,
            warnings: profileResult.warnings,
          },
        });
      } else {
        broadcastLog('warn', `AI profile generation failed for agent ${agent.name}: ${result.error.message}`, 'agents');
        if (ack) ack(result);
      }
    });

    // ─── Agent Photo Generation (MiniMax image-01) ───

    handle(socket, 'agent:generate-photo', AgentGeneratePhotoSchema, async (parsed, ack) => {
      const agent = agents.getAgent(parsed.agentId);
      if (!agent) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
        return;
      }

      if (!isImageGenerationAvailable()) {
        if (ack) ack({ ok: false, error: { code: 'IMAGE_GEN_NOT_AVAILABLE', message: 'MiniMax image generation is not available. MINIMAX_API_KEY is not configured.', retryable: false } });
        return;
      }

      const role = agent.role || 'agent';
      broadcastLog('info', `Generating profile photo for agent ${agent.name} (${role})...`, 'agents');

      const result = await generateAgentProfilePhoto(
        agent.name,
        role,
        agent.specialization || undefined,
      );

      if (!result.ok) {
        broadcastLog('warn', `Photo generation failed for agent ${agent.name}: ${result.error.message}`, 'agents');
        if (ack) ack(result);
        return;
      }

      // Write photo to disk
      const photoWriteResult = writeAgentPhoto(parsed.agentId, result.data.base64);
      if (!photoWriteResult.ok) {
        if (ack) ack(photoWriteResult);
        return;
      }

      const photoUrl = (photoWriteResult.data as { photoUrl: string }).photoUrl;

      // Update agent profile with the new photo URL
      const profileUpdateResult = agents.updateAgentProfile(parsed.agentId, {
        photoUrl,
        profileGenerated: true,
      });

      if (profileUpdateResult.ok) {
        const updatedAgent = agents.getAgent(parsed.agentId);
        bus.emit('agent:profile-updated', { agentId: parsed.agentId, profile: updatedAgent });
        broadcastLog('info', `Profile photo generated for agent ${agent.name}`, 'agents');
      }

      if (ack) ack({
        ok: true,
        data: {
          agentId: parsed.agentId,
          photoUrl,
          mimeType: result.data.mimeType,
        },
      });
    });

    // ─── Agent Stats ───

    handle(socket, 'agent:stats', AgentStatsGetSchema, (parsed, ack) => {
      const summary = getStatsSummary(parsed.agentId);
      if (ack) ack({ ok: true, data: summary });
    });

    handle(socket, 'agent:activity-log', AgentActivityLogSchema, (parsed, ack) => {
      const entries = getActivityLog(parsed.agentId, {
        limit: parsed.limit,
        offset: parsed.offset,
        eventType: parsed.eventType,
      });
      if (ack) ack({ ok: true, data: entries });
    });

    handle(socket, 'agent:leaderboard', AgentLeaderboardSchema, (parsed, ack) => {
      const leaderboard = getLeaderboard(parsed.metric, {
        limit: parsed.limit,
        buildingId: parsed.buildingId,
      });
      if (ack) ack({ ok: true, data: leaderboard });
    });

    // ─── Messaging Mode + GNAP Status (#601, #622) ───

    handle(socket, 'settings:messaging-mode', MessagingModeSchema, (parsed, ack) => {
      process.env.MESSAGING_MODE = parsed.mode;
      log.info({ mode: parsed.mode }, 'Messaging mode changed');
      if (ack) ack({ ok: true, data: { mode: parsed.mode } });
    });

    handle(socket, 'gnap:status', GnapBuildingSchema, (parsed, ack) => {
      const mode = process.env.MESSAGING_MODE || 'internal';
      if (mode !== 'gnap') {
        if (ack) ack({ ok: false, error: { code: 'GNAP_DISABLED', message: 'GNAP is not the active messaging mode', retryable: false } });
        return;
      }
      // Look up the building's working directory
      const db = getDb();
      const building = db.prepare('SELECT working_directory FROM buildings WHERE id = ?').get(parsed.buildingId) as { working_directory: string | null } | undefined;
      if (!building?.working_directory) {
        if (ack) ack({ ok: false, error: { code: 'NO_WORKING_DIR', message: 'Building has no working directory set', retryable: false } });
        return;
      }
      try {
        const adapter = new GnapMessagingAdapter({ repoPath: building.working_directory });
        const status = adapter.getStatus();
        if (ack) ack({ ok: true, data: { ...status, mode, buildingId: parsed.buildingId } });
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'GNAP_ERROR', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    handle(socket, 'gnap:test', GnapBuildingSchema, async (parsed, ack) => {
      const mode = process.env.MESSAGING_MODE || 'internal';
      if (mode !== 'gnap') {
        if (ack) ack({ ok: false, error: { code: 'GNAP_DISABLED', message: 'Switch to GNAP mode first in Settings', retryable: false } });
        return;
      }
      const db = getDb();
      const building = db.prepare('SELECT working_directory FROM buildings WHERE id = ?').get(parsed.buildingId) as { working_directory: string | null } | undefined;
      if (!building?.working_directory) {
        if (ack) ack({ ok: false, error: { code: 'NO_WORKING_DIR', message: 'Building has no working directory — set one in Settings > Folders', retryable: false } });
        return;
      }
      try {
        const adapter = new GnapMessagingAdapter({ repoPath: building.working_directory });
        const result = await adapter.sendTest();
        if (ack) ack({ ok: result.ok, data: { ...result, buildingId: parsed.buildingId, directory: building.working_directory } });
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'GNAP_ERROR', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    // ─── Model Registry (#556) ───

    handle(socket, 'models:list', EmptyPayloadSchema, (_data, ack) => {
      if (ack) ack(listModels());
    });

    handle(socket, 'models:provider', ModelProviderSchema, (parsed, ack) => {
      if (ack) ack(getProviderModels(parsed.provider));
    });

    handle(socket, 'models:recommend', ModelRecommendSchema, (parsed, ack) => {
      if (ack) ack(getRecommendedModel(parsed.roomType, parsed.provider));
    });

    handle(socket, 'models:get', ModelGetSchema, (parsed, ack) => {
      if (ack) ack(getModel(parsed.modelId));
    });

    handle(socket, 'models:compare', ModelCompareSchema, (parsed, ack) => {
      if (ack) ack(compareModels(parsed.modelIds));
    });

    // ─── Agent Memory (#557) ───

    handle(socket, 'memory:search', MemorySearchSchema, (parsed, ack) => {
      if (ack) ack(searchMemory(parsed));
    });

    handle(socket, 'memory:context', MemoryContextSchema, (parsed, ack) => {
      if (ack) ack(getRecentContext(parsed.buildingId, parsed.agentId, parsed.limit));
    });

    handle(socket, 'memory:stats', MemoryStatsSchema, (parsed, ack) => {
      if (ack) ack(getMemoryStats(parsed.buildingId));
    });

    // ─── Pipeline Evidence (#612) ───

    handle(socket, 'pipeline:record', PipelineRecordSchema, (parsed, ack) => {
      const result = recordEvidence({
        taskId: parsed.taskId,
        buildingId: parsed.buildingId,
        stage: parsed.stage as PipelineStage,
        status: parsed.status as 'passed' | 'failed' | 'skipped',
        evidenceData: parsed.evidenceData,
        attempt: parsed.attempt,
        durationMs: parsed.durationMs,
      });
      if (result.ok) {
        bus.emit('pipeline:evidence-recorded', { taskId: parsed.taskId, stage: parsed.stage, status: parsed.status });
      }
      if (ack) ack(result);
    });

    handle(socket, 'pipeline:status', PipelineGetSchema, (parsed, ack) => {
      if (ack) ack(getTaskPipelineStatus(parsed.taskId));
    });

    handle(socket, 'pipeline:evidence', PipelineGetSchema, (parsed, ack) => {
      if (ack) ack(getTaskEvidence(parsed.taskId));
    });

    handle(socket, 'pipeline:building-evidence', PipelineBuildingSchema, (parsed, ack) => {
      if (ack) ack(getBuildingEvidence(parsed.buildingId, parsed.stage as PipelineStage | undefined));
    });

    handle(socket, 'pipeline:loop-back', PipelineLoopBackSchema, (parsed, ack) => {
      const result = loopBackToCode({
        taskId: parsed.taskId,
        buildingId: parsed.buildingId,
        failedStage: parsed.failedStage as PipelineStage,
        errors: parsed.errors,
        attempt: parsed.attempt,
      });
      if (result.ok) {
        const data = result.data as Record<string, unknown>;
        bus.emit('pipeline:loop-back', { taskId: parsed.taskId, stage: parsed.failedStage, action: data.action });
      }
      if (ack) ack(result);
    });

    // ─── Agent Reset (#559) ───

    handle(socket, 'agent:reset-all', AgentResetSchema, (parsed, ack) => {
      const result = resetBuildingAgents(parsed.buildingId);
      if (result.ok) {
        io.emit('agents:reset', { buildingId: parsed.buildingId });
      }
      if (ack) ack(result);
    });

    // ─── Activity History (#565) ───

    handle(socket, 'activity:history', ActivityHistorySchema, (parsed, ack) => {
      const entries = getBuildingActivityLog(parsed.buildingId, {
        limit: parsed.limit,
        offset: parsed.offset,
        eventType: parsed.eventType,
      });
      if (ack) ack({ ok: true, data: entries });
    });

    // ─── Agent Email Events ───

    handle(socket, 'email:send', EmailSendSchema, (parsed, ack) => {
      const result = sendEmail({
        fromId: parsed.fromId,
        to: parsed.to,
        cc: parsed.cc || [],
        subject: parsed.subject,
        body: parsed.body,
        priority: parsed.priority,
        buildingId: parsed.buildingId,
      });

      if (result.ok) {
        const email = getEmail((result.data as { id: string }).id);
        if (email) {
          bus.emit('email:dispatched', email as unknown as Record<string, unknown>);
          // Notify recipients
          for (const agentId of [...parsed.to, ...(parsed.cc || [])]) {
            io.emit('email:received', { agentId, email });
          }
        }
      }
      if (ack) ack(result);
    });

    handle(socket, 'email:reply', EmailReplySchema, (parsed, ack) => {
      const result = replyToEmail(parsed.emailId, parsed.fromId, parsed.body, {
        replyAll: parsed.replyAll,
        priority: parsed.priority,
      });

      if (result.ok) {
        const email = getEmail((result.data as { id: string }).id);
        if (email) {
          bus.emit('email:dispatched', email as unknown as Record<string, unknown>);
          for (const r of email.recipients) {
            io.emit('email:received', { agentId: r.agent_id, email });
          }
        }
      }
      if (ack) ack(result);
    });

    handle(socket, 'email:forward', EmailForwardSchema, (parsed, ack) => {
      const result = forwardEmail(parsed.emailId, parsed.fromId, parsed.to, parsed.body || undefined);

      if (result.ok) {
        const email = getEmail((result.data as { id: string }).id);
        if (email) {
          bus.emit('email:dispatched', email as unknown as Record<string, unknown>);
          for (const r of email.recipients) {
            io.emit('email:received', { agentId: r.agent_id, email });
          }
        }
      }
      if (ack) ack(result);
    });

    handle(socket, 'email:inbox', EmailInboxSchema, (parsed, ack) => {
      const emails = getInbox(parsed.agentId, {
        status: parsed.status,
        priority: parsed.priority,
        limit: parsed.limit,
        offset: parsed.offset,
      });
      if (ack) ack({ ok: true, data: emails });
    });

    handle(socket, 'email:sent', EmailSentSchema, (parsed, ack) => {
      const emails = getSentEmails(parsed.agentId, {
        limit: parsed.limit,
        offset: parsed.offset,
      });
      if (ack) ack({ ok: true, data: emails });
    });

    handle(socket, 'email:get', EmailGetSchema, (parsed, ack) => {
      const email = getEmail(parsed.emailId);
      if (!email) {
        if (ack) ack({ ok: false, error: { code: 'EMAIL_NOT_FOUND', message: `Email ${parsed.emailId} not found`, retryable: false } });
        return;
      }
      if (ack) ack({ ok: true, data: email });
    });

    handle(socket, 'email:thread', EmailThreadSchema, (parsed, ack) => {
      const thread = getThread(parsed.threadId);
      if (ack) ack({ ok: true, data: thread });
    });

    handle(socket, 'email:mark-read', EmailMarkReadSchema, (parsed, ack) => {
      const result = markAsRead(parsed.emailId, parsed.agentId);
      if (result.ok) {
        io.emit('email:read', { emailId: parsed.emailId, agentId: parsed.agentId });
      }
      if (ack) ack(result);
    });

    handle(socket, 'email:unread-count', EmailUnreadCountSchema, (parsed, ack) => {
      const count = getUnreadCount(parsed.agentId);
      if (ack) ack({ ok: true, data: { agentId: parsed.agentId, count } });
    });

    // ─── Session Notes ───

    handle(socket, 'session-note:write', SessionNoteWriteSchema, (parsed, ack) => {
      const result = writeNote(parsed.agentId, parsed.key, parsed.value, parsed.buildingId);
      if (ack) ack({ ok: result.ok, data: result.ok ? { message: result.message } : undefined, error: result.ok ? undefined : { code: 'NOTE_WRITE_FAILED', message: result.message, retryable: false } });
    });

    handle(socket, 'session-note:read', SessionNoteReadSchema, (parsed, ack) => {
      const note = readNote(parsed.agentId, parsed.key);
      if (!note) {
        if (ack) ack({ ok: false, error: { code: 'NOTE_NOT_FOUND', message: `Note "${parsed.key}" not found`, retryable: false } });
        return;
      }
      if (ack) ack({ ok: true, data: note });
    });

    handle(socket, 'session-note:list', SessionNoteListSchema, (parsed, ack) => {
      const notes = listNotes(parsed.agentId);
      if (ack) ack({ ok: true, data: { notes, count: notes.length } });
    });

    handle(socket, 'session-note:delete', SessionNoteDeleteSchema, (parsed, ack) => {
      const result = deleteNote(parsed.agentId, parsed.key);
      if (ack) ack({ ok: result.ok, data: result.ok ? { message: result.message } : undefined, error: result.ok ? undefined : { code: 'NOTE_NOT_FOUND', message: result.message, retryable: false } });
    });

    handle(socket, 'session-note:clear', SessionNoteClearSchema, (parsed, ack) => {
      const result = clearNotes(parsed.agentId);
      if (ack) ack({ ok: true, data: { count: result.count } });
    });

    // ─── Global Search ───

    handle(socket, 'search:global', SearchGlobalSchema, (parsed, ack) => {
      const result = globalSearch({
        buildingId: parsed.buildingId,
        query: parsed.query,
        filters: parsed.filters,
        limit: parsed.limit,
      });
      if (ack) ack(result);
    });

    // ─── Plugin Management Events ───

    handle(socket, 'plugin:list', PluginListSchema, (_parsed, ack) => {
      const all = listPlugins();
      const items = all.map(p => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        author: p.manifest.author || 'Unknown',
        status: p.status,
        permissions: p.manifest.permissions,
        hooks: Object.keys(p.hooks),
        provides: p.manifest.provides || {},
        loadedAt: p.loadedAt,
        error: p.error || null,
        isBuiltIn: p.isBuiltIn,
        engine: p.manifest.engine,
      }));
      if (ack) ack({ ok: true, data: { plugins: items, total: items.length } });
    });

    handle(socket, 'plugin:get', PluginGetSchema, (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }
      const data = {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        author: plugin.manifest.author || 'Unknown',
        engine: plugin.manifest.engine,
        entrypoint: plugin.manifest.entrypoint,
        status: plugin.status,
        permissions: plugin.manifest.permissions,
        hooks: Object.keys(plugin.hooks),
        provides: plugin.manifest.provides || {},
        loadedAt: plugin.loadedAt,
        error: plugin.error || null,
        isBuiltIn: plugin.isBuiltIn,
        dir: plugin.dir,
      };
      if (ack) ack({ ok: true, data });
    });

    handle(socket, 'plugin:toggle', PluginToggleSchema, async (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }

      if (parsed.enabled && plugin.status !== 'active') {
        // Re-load plugin
        const result = await loadPlugin(plugin.manifest, '');
        if (ack) ack(result.ok ? { ok: true, data: { pluginId: parsed.pluginId, status: 'active' } } : result);
        if (result.ok) {
          io.emit('plugin:status-changed', { pluginId: parsed.pluginId, status: 'active' });
          bus.emit('plugin:status-changed', { pluginId: parsed.pluginId, status: 'active' });
        }
      } else if (!parsed.enabled && plugin.status === 'active') {
        // Unload plugin
        const result = unloadPlugin(parsed.pluginId);
        if (ack) ack(result.ok ? { ok: true, data: { pluginId: parsed.pluginId, status: 'unloaded' } } : result);
        if (result.ok) {
          io.emit('plugin:status-changed', { pluginId: parsed.pluginId, status: 'unloaded' });
          bus.emit('plugin:status-changed', { pluginId: parsed.pluginId, status: 'unloaded' });
        }
      } else {
        if (ack) ack({ ok: true, data: { pluginId: parsed.pluginId, status: plugin.status } });
      }
    });

    handle(socket, 'plugin:config:get', PluginConfigGetSchema, (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }
      // Read config from plugin's storage namespace
      const config = plugin.context.storage.get('__config__') || {};
      if (ack) ack({ ok: true, data: { pluginId: parsed.pluginId, config } });
    });

    handle(socket, 'plugin:config:set', PluginConfigSetSchema, (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }
      // Store config in plugin's storage namespace
      const config = (plugin.context.storage.get('__config__') || {}) as Record<string, unknown>;
      config[parsed.key] = parsed.value;
      plugin.context.storage.set('__config__', config);
      if (ack) ack({ ok: true, data: { pluginId: parsed.pluginId, key: parsed.key } });
      io.emit('plugin:config-changed', { pluginId: parsed.pluginId, key: parsed.key, value: parsed.value });
    });

    handle(socket, 'plugin:activity', PluginActivitySchema, (_parsed, ack) => {
      // Activity is tracked via bus events — return recent plugin-related events from memory
      // For now, return empty list (activity tracking will be wired via bus listener)
      if (ack) ack({ ok: true, data: { events: [], total: 0 } });
    });

    // ─── Plugin Source / IDE Events ───

    handle(socket, 'plugin:source:get', PluginSourceGetSchema, (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }

      const dir = plugin.dir;
      if (!dir) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NO_DIR', message: `Plugin "${parsed.pluginId}" has no stored directory`, retryable: false } });
        return;
      }



      const entrypointPath = path.join(dir, plugin.manifest.entrypoint);

      try {
        const code = fs.readFileSync(entrypointPath, 'utf-8');
        if (ack) ack({
          ok: true,
          data: {
            pluginId: parsed.pluginId,
            code,
            isBuiltIn: plugin.isBuiltIn,
            manifest: plugin.manifest,
          },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_SOURCE_READ_ERROR', message, retryable: false } });
      }
    });

    handle(socket, 'plugin:source:save', PluginSourceSaveSchema, async (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }






      let targetDir = plugin.dir;

      // For built-in plugins, save to user plugin dir (creating an override)
      if (plugin.isBuiltIn) {
        const pluginBaseDir = path.resolve(appConfig.get('PLUGIN_DIR'));
        targetDir = path.join(pluginBaseDir, plugin.manifest.id);
        fs.mkdirSync(targetDir, { recursive: true });

        // Copy manifest to user dir if not present
        const manifestDest = path.join(targetDir, 'plugin.json');
        if (!fs.existsSync(manifestDest)) {
          fs.writeFileSync(manifestDest, JSON.stringify(plugin.manifest, null, 2), 'utf-8');
        }
      }

      const entrypointPath = path.join(targetDir, plugin.manifest.entrypoint);

      try {
        fs.writeFileSync(entrypointPath, parsed.code, 'utf-8');

        // Hot-reload the plugin
        const result = await reloadPlugin(parsed.pluginId);
        if (result.ok) {
          io.emit('plugin:source-changed', { pluginId: parsed.pluginId });
          io.emit('plugin:status-changed', { pluginId: parsed.pluginId, status: 'active' });
        }
        if (ack) ack(result.ok
          ? { ok: true, data: { pluginId: parsed.pluginId, reloaded: true } }
          : { ok: false, error: { code: 'PLUGIN_RELOAD_ERROR', message: result.error.message, retryable: false } },
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_SOURCE_WRITE_ERROR', message, retryable: false } });
      }
    });

    handle(socket, 'plugin:create', PluginCreateSchema, async (parsed, ack) => {





      // Check for ID conflict
      if (getPlugin(parsed.id)) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_DUPLICATE', message: `Plugin "${parsed.id}" already exists`, retryable: false } });
        return;
      }

      const pluginBaseDir = path.resolve(appConfig.get('PLUGIN_DIR'));
      const pluginDir = path.join(pluginBaseDir, parsed.id);

      // Create plugin directory
      fs.mkdirSync(pluginDir, { recursive: true });

      // Create manifest
      const manifest = {
        id: parsed.id,
        name: parsed.name,
        version: '1.0.0',
        description: parsed.description || 'Custom Overlord script',
        author: 'User',
        engine: 'lua' as const,
        entrypoint: 'main.lua',
        permissions: ['bus:emit', 'storage:read', 'storage:write'] as string[],
      };
      fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      // Read template
      const templateName = parsed.template || 'blank';
      const templatePath = path.join(pluginBaseDir, '..', 'plugins', 'templates', `${templateName}.lua`);
      let templateCode = '-- New plugin\nregisterHook("onLoad", function()\n  overlord.log.info("Plugin loaded")\nend)\n';

      try {
        if (fs.existsSync(templatePath)) {
          templateCode = fs.readFileSync(templatePath, 'utf-8');
        } else {
          // Try alternate path structure
          const altPath = path.join(path.resolve('.'), 'plugins', 'templates', `${templateName}.lua`);
          if (fs.existsSync(altPath)) {
            templateCode = fs.readFileSync(altPath, 'utf-8');
          }
        }
      } catch {
        // Use default template on read failure
      }

      // Replace template placeholders
      templateCode = templateCode
        .replace(/\{\{PLUGIN_NAME\}\}/g, parsed.name)
        .replace(/\{\{PLUGIN_DESCRIPTION\}\}/g, parsed.description || 'Custom Overlord script')
        .replace(/\{\{PLUGIN_ID\}\}/g, parsed.id);

      fs.writeFileSync(path.join(pluginDir, 'main.lua'), templateCode, 'utf-8');

      // Load the new plugin
      const result = await loadPlugin(manifest as any, pluginDir);
      if (result.ok) {
        io.emit('plugin:status-changed', { pluginId: parsed.id, status: 'active' });
        bus.emit('plugin:status-changed', { pluginId: parsed.id, status: 'active' });
      }
      if (ack) ack(result.ok
        ? { ok: true, data: { pluginId: parsed.id, manifest } }
        : { ok: false, error: { code: 'PLUGIN_CREATE_ERROR', message: result.error.message, retryable: false } },
      );
    });

    handle(socket, 'plugin:delete', PluginDeleteSchema, (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }

      // Refuse to delete built-in plugins
      if (plugin.isBuiltIn) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_DELETE_BUILTIN', message: 'Cannot delete built-in plugins', retryable: false } });
        return;
      }

      const dir = plugin.dir;

      // Unload first
      unloadPlugin(parsed.pluginId);

      // Remove the plugin directory
      if (dir) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ pluginId: parsed.pluginId, error: message }, 'Failed to remove plugin directory');
        }
      }

      io.emit('plugin:status-changed', { pluginId: parsed.pluginId, status: 'deleted' });
      bus.emit('plugin:status-changed', { pluginId: parsed.pluginId, status: 'deleted' });
      if (ack) ack({ ok: true, data: { pluginId: parsed.pluginId } });
    });

    handle(socket, 'plugin:validate', PluginValidateSchema, async (parsed, ack) => {
      const result = await validateLuaSyntax(parsed.code);
      if (ack) ack({ ok: true, data: result });
    });

    handle(socket, 'plugin:export', PluginExportSchema, (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }
      const dir = plugin.dir;
      if (!dir) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NO_DIR', message: `Plugin "${parsed.pluginId}" has no stored directory`, retryable: false } });
        return;
      }
      const result = exportBundle(dir);
      if (ack) ack(result.ok
        ? { ok: true, data: { pluginId: parsed.pluginId, bundle: result.data } }
        : result,
      );
    });

    handle(socket, 'plugin:import', PluginImportSchema, async (parsed, ack) => {



      const pluginBaseDir = path.resolve(appConfig.get('PLUGIN_DIR'));
      const result = importBundle(parsed.bundle, pluginBaseDir);
      if (!result.ok) {
        if (ack) ack(result);
        return;
      }

      const manifest = result.data;
      const pluginDir = path.join(pluginBaseDir, manifest.id);

      // Load the imported plugin
      const loadResult = await loadPlugin(manifest, pluginDir);
      if (loadResult.ok) {
        io.emit('plugin:status-changed', { pluginId: manifest.id, status: 'active' });
        bus.emit('plugin:status-changed', { pluginId: manifest.id, status: 'active' });
      }
      if (ack) ack(loadResult.ok
        ? { ok: true, data: { pluginId: manifest.id, manifest } }
        : { ok: false, error: { code: 'PLUGIN_IMPORT_LOAD_ERROR', message: loadResult.error.message, retryable: false } },
      );
    });

    handle(socket, 'plugin:log:subscribe', PluginLogSubscribeSchema, (parsed, ack) => {
      const plugin = getPlugin(parsed.pluginId);
      if (!plugin) {
        if (ack) ack({ ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Plugin "${parsed.pluginId}" not found`, retryable: false } });
        return;
      }

      // Return existing logs and subscribe to live updates
      const logs = getPluginLogs(parsed.pluginId);
      socket.join(`plugin-logs:${parsed.pluginId}`);
      if (ack) ack({ ok: true, data: { pluginId: parsed.pluginId, logs } });
    });

    handle(socket, 'plugin:log:unsubscribe', PluginLogSubscribeSchema, (parsed, ack) => {
      socket.leave(`plugin-logs:${parsed.pluginId}`);
      if (ack) ack({ ok: true, data: { pluginId: parsed.pluginId } });
    });

    // --- Quality Config ---

    handle(socket, 'quality:config:get', QualityConfigGetSchema, (_data, ack) => {
      const cfg = getQualityConfig();
      if (ack) ack({ ok: true, data: cfg });
    });

    handle(socket, 'quality:config:set', QualityConfigSetSchema, (parsed, ack) => {
      const envKeyMap: Record<string, string> = {
        autoLint: 'QUALITY_AUTO_LINT',
        autoTypecheck: 'QUALITY_AUTO_TYPECHECK',
        autoTest: 'QUALITY_AUTO_TEST',
        autoSecurityScan: 'QUALITY_AUTO_SECURITY_SCAN',
        minCoverage: 'QUALITY_MIN_COVERAGE',
      };
      const envKey = envKeyMap[parsed.key];
      if (envKey) {
        process.env[envKey] = String(parsed.value);
      }
      const cfg = getQualityConfig();
      io.emit('quality:config-changed', cfg);
      if (ack) ack({ ok: true, data: cfg });
    });

    // ─── Command List ───

    handle(socket, 'command:list', EmptyPayloadSchema, (_data, ack) => {
      const commands = listCommands().map(cmd => ({
        id: cmd.name,
        name: cmd.name,
        description: cmd.description,
        usage: cmd.usage,
        aliases: cmd.aliases || [],
        scope: cmd.scope,
      }));
      if (ack) ack({ ok: true, data: commands });
    });

    // ─── Chat Events (with command/mention/reference parsing) ───

    handle(socket, 'chat:message', ChatMessageSchema, async (parsed) => {
      const text = parsed.text;
      const buildingId = parsed.buildingId;
      const roomId = parsed.roomId;
      const agentId = parsed.agentId;

      // Coerce schema token objects to ParsedToken interface
      const tokens: ParsedToken[] = (parsed.tokens ?? []).map((t) => ({
        type: (t.type || 'command') as ParsedToken['type'],
        char: t.char || '',
        id: t.id || '',
        label: t.label || t.value || '',
      }));

      // 1. Check if message starts with '/' → dispatch as command
      const cmdParsed = parseCommandText(text);
      if (cmdParsed) {
        const ctx: CommandContext = {
          command: cmdParsed.command, args: cmdParsed.args, rawText: text,
          socketId: socket.id, buildingId, roomId, agentId, tokens, bus,
        };
        const result = await dispatchCommand(ctx);
        if (!result.silent) {
          socket.emit('chat:response', {
            type: 'command', command: cmdParsed.command,
            ok: result.ok, response: result.response, data: result.data,
          });
        }
        return;
      }

      // 2. Process @mention tokens
      const mentionTokens = tokens.filter(t => t.type === 'agent' || t.char === '@');
      for (const token of mentionTokens) {
        try {
          const mentionCtx: CommandContext = {
            command: '', args: [], rawText: text,
            socketId: socket.id, buildingId, roomId, agentId, tokens, bus,
          };
          const mentionResult = await handleMention(token, mentionCtx);
          if (mentionResult.notified) {
            socket.emit('chat:response', {
              type: 'mention', agentId: mentionResult.agentId, response: mentionResult.response,
            });
          }
        } catch (mentionErr) {
          log.error({ event: 'chat:message', mentionErr, tokenId: token.id }, 'Mention processing failed');
        }
      }

      // 3. Process #reference tokens — resolve and record citations
      const refTokens = tokens.filter(t => t.type === 'reference' || t.char === '#');
      for (const token of refTokens) {
        try {
          const refCtx: CommandContext = {
            command: '', args: [], rawText: text,
            socketId: socket.id, buildingId, roomId, agentId, tokens, bus,
          };
          const refResult = await resolveReference(token, refCtx);
          if (refResult.resolved) {
            socket.emit('chat:response', {
              type: 'reference', target: refResult.target, content: refResult.content,
            });

            // Record a citation if the source room context is available
            if (roomId && refResult.content && typeof refResult.content === 'object') {
              const content = refResult.content as Record<string, unknown>;
              const targetRoomId = (content.id as string) || '';
              const targetType = token.id.startsWith('raid') ? 'raid' as const : 'room' as const;
              const targetEntryId = targetType === 'raid' ? (content.id as string) : undefined;

              if (targetRoomId || targetType === 'raid') {
                const citResult = addCitation({
                  sourceRoomId: roomId,
                  targetRoomId: targetType === 'raid' ? roomId : targetRoomId,
                  targetEntryId,
                  targetType,
                  createdBy: agentId || socket.id,
                });
                if (citResult.ok) {
                  bus.emit('citation:added', citResult.data as unknown as Record<string, unknown>);
                }
              }
            }
          }
        } catch (refErr) {
          log.error({ event: 'chat:message', refErr, tokenId: token.id }, 'Reference resolution failed');
        }
      }

      // 4. Process attachments — strip base64 data for storage, keep metadata
      const attachmentsMeta = (parsed.attachments || []).map((att: Record<string, unknown>) => ({
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        size: att.size,
        url: att.url || null,
      }));

      // 5. Validate recipient agent IDs if present (#585 review finding)
      let validatedRecipients = parsed.recipients || [];
      if (validatedRecipients.length > 0) {
        const db = getDb();
        validatedRecipients = validatedRecipients.filter((rid: string) => {
          return !!db.prepare('SELECT id FROM agents WHERE id = ?').get(rid);
        });
      }

      // 6. Regular message — forward to bus (include threadId for persistence)
      bus.emit('chat:message', {
        socketId: socket.id,
        ...parsed,
        recipients: validatedRecipients,
        attachments: attachmentsMeta,
      });

      // Broadcast attachments to other clients (without base64 data)
      if (attachmentsMeta.length > 0) {
        io.emit('chat:attachments', {
          threadId: parsed.threadId || '',
          agentId: parsed.agentId || '',
          attachments: attachmentsMeta,
        });
      }

      // Record message stats if sent by an agent
      if (parsed.agentId) {
        onMessageSent(parsed.agentId, parsed.roomId || '', parsed.buildingId || undefined);
      }
    });

    // ─── Conversation Events ───

    handle(socket, 'conversation:list', ConversationListSchema, (parsed, ack) => {
      const db = getDb();
      const buildingId = parsed.buildingId || '';
      const roomId = parsed.roomId || '';
      // Get distinct threads with their latest message and metadata
      const rows = db.prepare(`
        SELECT
          m.thread_id,
          m.room_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          (SELECT content FROM messages WHERE thread_id = m.thread_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_message
        FROM messages m
        WHERE (? = '' OR m.room_id IN (SELECT id FROM rooms WHERE floor_id IN (SELECT id FROM floors WHERE building_id = ?)))
          AND (? = '' OR m.room_id = ?)
        GROUP BY m.thread_id
        ORDER BY last_message_at DESC
        LIMIT 50
      `).all(buildingId, buildingId, roomId, roomId) as Array<{
        thread_id: string;
        room_id: string;
        last_message_at: string;
        message_count: number;
        first_message: string;
      }>;

      const conversations = rows.map((r) => ({
        threadId: r.thread_id,
        roomId: r.room_id,
        lastMessageAt: r.last_message_at,
        messageCount: r.message_count,
        title: r.first_message ? r.first_message.slice(0, 80) + (r.first_message.length > 80 ? '...' : '') : 'Untitled',
      }));

      if (ack) ack({ ok: true, data: conversations });
    });

    handle(socket, 'conversation:load', ConversationLoadSchema, (parsed, ack) => {
      const db = getDb();
      const messages = db.prepare(`
        SELECT id, room_id, agent_id, role, content, tool_calls, attachments, thread_id, created_at
        FROM messages
        WHERE thread_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      `).all(parsed.threadId, parsed.limit || 100) as Array<{
        id: string; room_id: string; agent_id: string | null;
        role: string; content: string; tool_calls: string | null;
        attachments: string | null; thread_id: string; created_at: string;
      }>;

      const formatted = messages.map((m) => {
        let toolCalls: unknown;
        if (m.tool_calls) {
          try { toolCalls = JSON.parse(m.tool_calls); } catch { /* corrupted — skip */ }
        }
        let attachments: unknown[] = [];
        if (m.attachments) {
          try { attachments = JSON.parse(m.attachments); } catch { /* corrupted — skip */ }
        }
        return {
          id: m.id,
          roomId: m.room_id,
          agentId: m.agent_id,
          role: m.role,
          content: m.content,
          toolCalls,
          attachments,
          threadId: m.thread_id,
          timestamp: new Date(m.created_at).getTime(),
        };
      });

      if (ack) ack({ ok: true, data: formatted });
    });

    handle(socket, 'conversation:create', ConversationCreateSchema, (parsed, ack) => {
      const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (ack) ack({ ok: true, data: { threadId, title: parsed.title || 'New Conversation', roomId: parsed.roomId } });
    });

    handle(socket, 'conversation:delete', ConversationDeleteSchema, (parsed, ack) => {
      const db = getDb();
      db.prepare('DELETE FROM messages WHERE thread_id = ?').run(parsed.threadId);
      if (ack) ack({ ok: true });
    });

    // ─── Plan Events ───

    handle(socket, 'plan:submit', PlanSubmitSchema, (parsed, ack) => {
      const db = getDb();
      const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      db.prepare(`
        INSERT INTO plans (id, building_id, room_id, agent_id, thread_id, title, rationale, steps, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        id,
        parsed.buildingId || null,
        parsed.roomId || null,
        parsed.agentId,
        parsed.threadId || null,
        parsed.title,
        parsed.rationale || null,
        JSON.stringify(parsed.steps),
      );

      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Record<string, unknown>;
      const planWithSteps = { ...plan, steps: JSON.parse((plan.steps as string) || '[]') };
      log.info({ planId: id, agentId: parsed.agentId, title: parsed.title }, 'Plan submitted');
      // bus.emit triggers forward('plan:submitted') → io.emit automatically; no manual io.emit needed
      bus.emit('plan:submitted', planWithSteps as unknown as Record<string, unknown>);
      if (ack) ack({ ok: true, data: planWithSteps });
    });

    handle(socket, 'plan:review', PlanReviewSchema, (parsed, ack) => {
      const db = getDb();
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(parsed.planId) as Record<string, unknown> | undefined;
      if (!plan) {
        if (ack) ack({ ok: false, error: { code: 'PLAN_NOT_FOUND', message: `Plan ${parsed.planId} does not exist`, retryable: false } });
        return;
      }

      const statusMap: Record<string, string> = {
        'approved': 'approved',
        'rejected': 'rejected',
        'changes-requested': 'changes-requested',
      };

      db.prepare(`
        UPDATE plans SET status = ?, reviewed_by = ?, review_comment = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(statusMap[parsed.verdict], parsed.reviewer, parsed.comment || null, parsed.planId);

      const updated = db.prepare('SELECT * FROM plans WHERE id = ?').get(parsed.planId) as Record<string, unknown>;
      const updatedWithSteps = { ...updated, steps: JSON.parse((updated.steps as string) || '[]') };
      log.info({ planId: parsed.planId, verdict: parsed.verdict, reviewer: parsed.reviewer }, 'Plan reviewed');
      // bus.emit triggers forward('plan:reviewed') → io.emit automatically; no manual io.emit needed
      bus.emit('plan:reviewed', updatedWithSteps as unknown as Record<string, unknown>);

      // If approved, auto-create tasks from plan steps (atomic transaction)
      if (parsed.verdict === 'approved' && updated.building_id) {
        const steps = JSON.parse((updated.steps as string) || '[]') as Array<{ id: string; description: string }>;
        const parentTaskId = `task_${randomUUID()}`;

        const createTasks = db.transaction(() => {
          // Create parent task for the plan
          db.prepare(`
            INSERT INTO tasks (id, building_id, title, description, status, assignee_id, phase, priority)
            VALUES (?, ?, ?, ?, 'pending', ?, 'execution', 'normal')
          `).run(parentTaskId, updated.building_id, updated.title, updated.rationale || '', updated.agent_id);

          // Create child tasks for each step (randomUUID avoids collision)
          for (const step of steps) {
            const stepTaskId = `task_${randomUUID()}`;
            db.prepare(`
              INSERT INTO tasks (id, building_id, title, status, parent_id, assignee_id, phase, priority)
              VALUES (?, ?, ?, 'pending', ?, ?, 'execution', 'normal')
            `).run(stepTaskId, updated.building_id, step.description, parentTaskId, updated.agent_id);
          }
        });
        createTasks();

        log.info({ planId: parsed.planId, parentTaskId, stepCount: steps.length }, 'Tasks created from approved plan');
        bus.emit('task:created', { planId: parsed.planId, parentTaskId });
      }

      if (ack) ack({ ok: true, data: updatedWithSteps });
    });

    handle(socket, 'plan:get', PlanGetSchema, (parsed, ack) => {
      const db = getDb();
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(parsed.planId) as Record<string, unknown> | undefined;
      if (!plan) {
        if (ack) ack({ ok: false, error: { code: 'PLAN_NOT_FOUND', message: `Plan ${parsed.planId} does not exist`, retryable: false } });
        return;
      }
      if (ack) ack({ ok: true, data: { ...plan, steps: JSON.parse((plan.steps as string) || '[]') } });
    });

    handle(socket, 'plan:list', PlanListSchema, (parsed, ack) => {
      const db = getDb();
      let sql = 'SELECT * FROM plans WHERE 1=1';
      const params: unknown[] = [];

      if (parsed.buildingId) { sql += ' AND building_id = ?'; params.push(parsed.buildingId); }
      if (parsed.agentId) { sql += ' AND agent_id = ?'; params.push(parsed.agentId); }
      if (parsed.status) { sql += ' AND status = ?'; params.push(parsed.status); }
      if (parsed.threadId) { sql += ' AND thread_id = ?'; params.push(parsed.threadId); }

      sql += ' ORDER BY created_at DESC LIMIT 200';

      const plans = (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((p) => ({
        ...p,
        steps: JSON.parse((p.steps as string) || '[]'),
      }));

      if (ack) ack({ ok: true, data: plans });
    });

    // ─── Phase Events ───

    handle(socket, 'phase:status', PhaseStatusSchema, (parsed, ack) => {
      bus.emit('phase:status', { socketId: socket.id, buildingId: parsed.buildingId });
      if (ack) ack({ ok: true });
    });

    handle(socket, 'phase:gate', PhaseGateSchema, (parsed, ack) => {
      bus.emit('phase:gate', { socketId: socket.id, buildingId: parsed.buildingId, phase: parsed.phase });
      if (ack) ack({ ok: true });
    });

    handle(socket, 'phase:gates', PhaseGatesSchema, (parsed, ack) => {
      if (ack) ack(getGates(parsed.buildingId));
    });

    handle(socket, 'phase:can-advance', PhaseCanAdvanceSchema, (parsed, ack) => {
      if (ack) ack(canAdvance(parsed.buildingId));
    });

    handle(socket, 'phase:pending-gates', PhasePendingGatesSchema, (parsed, ack) => {
      if (ack) ack(getPendingGates(parsed?.buildingId));
    });

    handle(socket, 'phase:resolve-conditions', PhaseResolveConditionsSchema, async (parsed, ack) => {
      const result = await resolveConditions({
        gateId: parsed.gateId,
        resolvedConditions: parsed.resolvedConditions,
        resolver: parsed.resolver,
      });
      if (result.ok) {
        const resultData = result.data as Record<string, unknown>;
        if (resultData.verdict === 'GO') {
          bus.emit('phase:gate:signed-off', resultData);
          // Look up building context for phase:advanced event
          const gateRow = getDb().prepare('SELECT building_id, phase FROM phase_gates WHERE id = ?').get(parsed.gateId) as { building_id: string; phase: string } | undefined;
          if (gateRow) {
            bus.emit('phase:advanced', {
              buildingId: gateRow.building_id,
              from: gateRow.phase,
              to: resultData.nextPhase,
              gateId: parsed.gateId,
            });
            bus.emit('building:updated', { id: gateRow.building_id, activePhase: resultData.nextPhase });
          }
        } else {
          bus.emit('phase:conditions:resolved', { gateId: parsed.gateId, ...resultData });
        }
      }
      if (ack) ack(result);
    });

    handle(socket, 'phase:stale-gates', PhaseStaleGatesSchema, (parsed, ack) => {
      if (ack) ack(getStalePendingGates(parsed?.thresholdMs || 30 * 60 * 1000));
    });

    handle(socket, 'phase:order', EmptyPayloadSchema, (_data, ack) => {
      if (ack) ack({ ok: true, data: getPhaseOrder() });
    });

    // ─── RAID Events ───

    handle(socket, 'raid:search', RaidSearchSchema, (parsed, ack) => {
      if (ack) ack(searchRaid(parsed as Parameters<typeof searchRaid>[0]));
    });

    handle(socket, 'raid:list', RaidListSchema, (parsed, ack) => {
      if (ack) ack(searchRaid({ buildingId: parsed.buildingId }));
    });

    handle(socket, 'raid:add', RaidAddSchema, (parsed, ack) => {
      const result = addRaidEntry(parsed as unknown as Parameters<typeof addRaidEntry>[0]);
      if (result.ok) {
        bus.emit('raid:entry:added', { ...(result.data as Record<string, unknown>), ...parsed });
      }
      if (ack) ack(result);
    });

    handle(socket, 'raid:update', RaidUpdateSchema, (parsed, ack) => {
      const result = updateRaidStatus({ id: parsed.id, status: parsed.status });
      if (result.ok) {
        bus.emit('raid:entry:updated', { id: parsed.id, status: parsed.status, ...(result.data as Record<string, unknown>) });
      }
      if (ack) ack(result);
    });

    handle(socket, 'raid:edit', RaidEditSchema, (parsed, ack) => {
      const result = updateRaidEntry({
        id: parsed.id,
        summary: parsed.summary,
        rationale: parsed.rationale,
        decidedBy: parsed.decidedBy,
        affectedAreas: parsed.affectedAreas,
      });
      if (result.ok) {
        bus.emit('raid:entry:updated', { id: parsed.id, ...(result.data as Record<string, unknown>) });
      }
      if (ack) ack(result);
    });

    // ─── Task Events ───

    handle(socket, 'task:create', TaskCreateSchema, (parsed, ack) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();

      // Validate table_id references a real table if provided
      if (parsed.tableId) {
        const tableExists = db.prepare('SELECT id FROM tables_v2 WHERE id = ?').get(parsed.tableId);
        if (!tableExists) {
          if (ack) ack({ ok: false, error: { code: 'TABLE_NOT_FOUND', message: `Table ${parsed.tableId} does not exist`, retryable: false } });
          return;
        }
      }

      db.prepare(`
        INSERT INTO tasks (id, building_id, title, description, status, parent_id, milestone_id, assignee_id, room_id, table_id, phase, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?))
      `).run(
        id, parsed.buildingId, parsed.title, parsed.description || null,
        parsed.status, parsed.parentId || null, parsed.milestoneId || null,
        parsed.assigneeId || null, parsed.roomId || null, parsed.tableId || null,
        parsed.phase || null, parsed.priority, now, now,
      );

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      log.info({ id, buildingId: parsed.buildingId, title: parsed.title, tableId: parsed.tableId }, 'Task created');
      broadcastLog('info', `Task created: ${parsed.title}`, 'tasks');
      bus.emit('task:created', task as Record<string, unknown>);
      if (ack) ack({ ok: true, data: task });
    });

    handle(socket, 'task:update', TaskUpdateSchema, (parsed, ack) => {
      const db = getDb();
      const taskId = parsed.id;

      const existing = db.prepare('SELECT id, assignee_id FROM tasks WHERE id = ?').get(taskId) as { id: string; assignee_id: string | null } | undefined;
      if (!existing) {
        if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${taskId} does not exist`, retryable: false } });
        return;
      }
      const previousAssignee = existing.assignee_id;

      const fields: string[] = [];
      const values: unknown[] = [];
      const columnMap: Record<string, string> = {
        title: 'title', description: 'description', status: 'status',
        parentId: 'parent_id', milestoneId: 'milestone_id', assigneeId: 'assignee_id',
        roomId: 'room_id', tableId: 'table_id', phase: 'phase', priority: 'priority',
      };

      for (const key of Object.keys(columnMap)) {
        if (parsed[key as keyof typeof parsed] !== undefined) {
          fields.push(`${columnMap[key]} = ?`);
          values.push(parsed[key as keyof typeof parsed]);
        }
      }

      if (fields.length === 0) {
        if (ack) ack({ ok: true, data: { id: taskId, message: 'No fields to update' } });
        return;
      }

      // Per-issue dogfood enforcement (#610): block closure without pipeline completion
      const terminalStatuses = ['done', 'completed', 'finished', 'closed'];
      if (parsed.status && terminalStatuses.includes(parsed.status)) {
        const pipelineResult = getTaskPipelineStatus(taskId);
        if (pipelineResult.ok) {
          const pipelineData = pipelineResult.data as { allPassed: boolean; currentStage: number; stages: Array<{ stage: string; status: string }> };
          if (!pipelineData.allPassed) {
            const incomplete = pipelineData.stages.filter(s => s.status !== 'passed').map(s => s.stage);
            if (ack) ack({
              ok: false,
              error: {
                code: 'PIPELINE_INCOMPLETE',
                message: `Task cannot be closed — pipeline stages incomplete: ${incomplete.join(', ')}. Complete all 8 stages including dogfood.`,
                retryable: false,
              },
            });
            return;
          }
        }
        // If no pipeline exists, allow closure (task may not require pipeline)
      }

      fields.push("updated_at = datetime(?)");
      values.push(new Date().toISOString());
      values.push(taskId);

      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
      log.info({ taskId, updatedFields: fields.length }, 'Task updated');
      bus.emit('task:updated', task as Record<string, unknown>);

      // Track stats when task reaches a terminal status
      if (task && parsed.status && terminalStatuses.includes(parsed.status) && task.assignee_id) {
        onTaskComplete(task.assignee_id as string, taskId, (task.title as string) || '', (task.building_id as string) || undefined);
      }
      // Only record assignment when assignee actually changes
      if (task && parsed.assigneeId && parsed.assigneeId !== previousAssignee) {
        onTaskAssign(parsed.assigneeId, taskId, (task.title as string) || '', (task.building_id as string) || undefined);
      }

      if (ack) ack({ ok: true, data: task });
    });

    handle(socket, 'task:list', TaskListSchema, (parsed, ack) => {
      const db = getDb();
      let sql = `SELECT t.*,
        tb.type AS table_type,
        tb.description AS table_description,
        r.name AS room_name,
        r.type AS room_type
        FROM tasks t
        LEFT JOIN tables_v2 tb ON t.table_id = tb.id
        LEFT JOIN rooms r ON tb.room_id = r.id
        WHERE t.building_id = ?`;
      const params: unknown[] = [parsed.buildingId];

      if (parsed.status) { sql += ' AND t.status = ?'; params.push(parsed.status); }
      if (parsed.phase) { sql += ' AND t.phase = ?'; params.push(parsed.phase); }
      if (parsed.assigneeId) { sql += ' AND t.assignee_id = ?'; params.push(parsed.assigneeId); }
      if (parsed.tableId) { sql += ' AND t.table_id = ?'; params.push(parsed.tableId); }
      if (parsed.roomId) { sql += ' AND t.room_id = ?'; params.push(parsed.roomId); }
      sql += ' ORDER BY t.created_at DESC';

      if (ack) ack({ ok: true, data: db.prepare(sql).all(...params) });
    });

    handle(socket, 'task:get', TaskGetSchema, (parsed, ack) => {
      const db = getDb();
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parsed.id);
      if (!task) {
        if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${parsed.id} does not exist`, retryable: false } });
        return;
      }
      const todos = db.prepare('SELECT * FROM todos WHERE task_id = ? ORDER BY created_at').all(parsed.id);
      if (ack) ack({ ok: true, data: { ...(task as Record<string, unknown>), todos } });
    });

    // ─── Task Assignment Events ───

    handle(socket, 'task:assign-table', TaskAssignTableSchema, (parsed, ack) => {
      const db = getDb();

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parsed.taskId) as Record<string, unknown> | undefined;
      if (!task) {
        if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${parsed.taskId} does not exist`, retryable: false } });
        return;
      }

      const tableExists = db.prepare('SELECT id FROM tables_v2 WHERE id = ?').get(parsed.tableId);
      if (!tableExists) {
        if (ack) ack({ ok: false, error: { code: 'TABLE_NOT_FOUND', message: `Table ${parsed.tableId} does not exist`, retryable: false } });
        return;
      }

      const now = new Date().toISOString();
      db.prepare('UPDATE tasks SET table_id = ?, updated_at = datetime(?) WHERE id = ?')
        .run(parsed.tableId, now, parsed.taskId);

      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parsed.taskId);
      log.info({ taskId: parsed.taskId, tableId: parsed.tableId }, 'Task assigned to table');
      broadcastLog('info', `Task ${parsed.taskId} assigned to table ${parsed.tableId}`, 'tasks');
      bus.emit('task:assigned', { ...(updated as Record<string, unknown>), tableId: parsed.tableId });
      bus.emit('task:updated', updated as Record<string, unknown>);
      if (ack) ack({ ok: true, data: updated });
    });

    handle(socket, 'task:unassign-table', TaskUnassignTableSchema, (parsed, ack) => {
      const db = getDb();

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parsed.taskId) as Record<string, unknown> | undefined;
      if (!task) {
        if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${parsed.taskId} does not exist`, retryable: false } });
        return;
      }

      const previousTableId = task.table_id;
      const now = new Date().toISOString();
      db.prepare('UPDATE tasks SET table_id = NULL, updated_at = datetime(?) WHERE id = ?')
        .run(now, parsed.taskId);

      const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parsed.taskId);
      log.info({ taskId: parsed.taskId, previousTableId }, 'Task unassigned from table');
      broadcastLog('info', `Task ${parsed.taskId} unassigned from table`, 'tasks');
      bus.emit('task:updated', updated as Record<string, unknown>);
      if (ack) ack({ ok: true, data: updated });
    });

    // ─── Milestone Events ───

    handle(socket, 'milestone:create', MilestoneCreateSchema, (parsed, ack) => {
      const db = getDb();
      const msId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO milestones (id, building_id, title, description, status, due_date, phase, ordinal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?))
      `).run(
        msId, parsed.buildingId, parsed.title, parsed.description || null,
        parsed.status, parsed.dueDate || null, parsed.phase || null,
        parsed.ordinal, now, now,
      );

      const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(msId);
      log.info({ id: msId, buildingId: parsed.buildingId, title: parsed.title }, 'Milestone created');
      broadcastLog('info', `Milestone created: ${parsed.title}`, 'milestones');
      bus.emit('milestone:created', milestone as Record<string, unknown>);
      if (ack) ack({ ok: true, data: milestone });
    });

    handle(socket, 'milestone:update', MilestoneUpdateSchema, (parsed, ack) => {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM milestones WHERE id = ?').get(parsed.id);
      if (!existing) {
        if (ack) ack({ ok: false, error: { code: 'MILESTONE_NOT_FOUND', message: `Milestone ${parsed.id} does not exist`, retryable: false } });
        return;
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      const columnMap: Record<string, string> = {
        title: 'title', description: 'description', status: 'status',
        dueDate: 'due_date', phase: 'phase', ordinal: 'ordinal',
      };

      for (const key of Object.keys(columnMap)) {
        if (parsed[key as keyof typeof parsed] !== undefined) {
          fields.push(`${columnMap[key]} = ?`);
          values.push(parsed[key as keyof typeof parsed]);
        }
      }

      if (fields.length === 0) {
        if (ack) ack({ ok: true, data: { id: parsed.id, message: 'No fields to update' } });
        return;
      }

      fields.push("updated_at = datetime(?)");
      values.push(new Date().toISOString());
      values.push(parsed.id);

      db.prepare(`UPDATE milestones SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(parsed.id);
      log.info({ milestoneId: parsed.id, updatedFields: fields.length }, 'Milestone updated');
      bus.emit('milestone:updated', milestone as Record<string, unknown>);
      if (ack) ack({ ok: true, data: milestone });
    });

    handle(socket, 'milestone:delete', MilestoneDeleteSchema, (parsed, ack) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM milestones WHERE id = ?').get(parsed.id) as Record<string, unknown> | undefined;
      if (!existing) {
        if (ack) ack({ ok: false, error: { code: 'MILESTONE_NOT_FOUND', message: `Milestone ${parsed.id} does not exist`, retryable: false } });
        return;
      }

      // Atomically unlink tasks and delete milestone
      const deleteMilestone = db.transaction(() => {
        db.prepare('UPDATE tasks SET milestone_id = NULL WHERE milestone_id = ?').run(parsed.id);
        db.prepare('DELETE FROM milestones WHERE id = ?').run(parsed.id);
      });
      deleteMilestone();

      log.info({ milestoneId: parsed.id }, 'Milestone deleted');
      broadcastLog('info', `Milestone deleted: ${existing.title}`, 'milestones');
      bus.emit('milestone:deleted', { id: parsed.id, buildingId: existing.building_id });
      if (ack) ack({ ok: true, data: { id: parsed.id } });
    });

    handle(socket, 'milestone:list', MilestoneListSchema, (parsed, ack) => {
      const db = getDb();
      let sql = `SELECT m.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status = 'done') AS tasks_done
        FROM milestones m
        WHERE m.building_id = ?`;
      const params: unknown[] = [parsed.buildingId];

      if (parsed.status) { sql += ' AND m.status = ?'; params.push(parsed.status); }
      sql += ' ORDER BY m.ordinal ASC, m.created_at ASC';

      if (ack) ack({ ok: true, data: db.prepare(sql).all(...params) });
    });

    handle(socket, 'milestone:get', MilestoneGetSchema, (parsed, ack) => {
      const db = getDb();
      const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(parsed.id) as Record<string, unknown> | undefined;
      if (!milestone) {
        if (ack) ack({ ok: false, error: { code: 'MILESTONE_NOT_FOUND', message: `Milestone ${parsed.id} does not exist`, retryable: false } });
        return;
      }

      // Include task summary
      const tasks = db.prepare('SELECT id, title, status, priority FROM tasks WHERE milestone_id = ? ORDER BY created_at').all(parsed.id);
      if (ack) ack({ ok: true, data: { ...milestone, tasks } });
    });

    // ─── TODO Events ───

    handle(socket, 'todo:create', TodoCreateSchema, (parsed, ack) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();

      const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(parsed.taskId);
      if (!task) {
        if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Parent task ${parsed.taskId} does not exist`, retryable: false } });
        return;
      }

      db.prepare(`
        INSERT INTO todos (id, task_id, agent_id, room_id, description, status, exit_doc_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime(?))
      `).run(
        id, parsed.taskId, parsed.agentId || null, parsed.roomId || null,
        parsed.description, parsed.status, parsed.exitDocRef || null, now,
      );

      const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
      log.info({ id, taskId: parsed.taskId, description: parsed.description }, 'TODO created');
      bus.emit('todo:created', todo as Record<string, unknown>);
      if (ack) ack({ ok: true, data: todo });
    });

    handle(socket, 'todo:toggle', TodoToggleSchema, (parsed, ack) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(parsed.id) as Record<string, unknown> | undefined;
      if (!existing) {
        if (ack) ack({ ok: false, error: { code: 'TODO_NOT_FOUND', message: `TODO ${parsed.id} does not exist`, retryable: false } });
        return;
      }

      const currentStatus = existing.status as string;
      const newStatus = currentStatus === 'done' ? 'pending' : 'done';
      const completedAt = newStatus === 'done' ? new Date().toISOString() : null;

      db.prepare("UPDATE todos SET status = ?, completed_at = datetime(?) WHERE id = ?")
        .run(newStatus, completedAt, parsed.id);

      const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(parsed.id);
      log.info({ todoId: parsed.id, from: currentStatus, to: newStatus }, 'TODO toggled');
      bus.emit('todo:updated', todo as Record<string, unknown>);
      if (ack) ack({ ok: true, data: todo });
    });

    handle(socket, 'todo:list', TodoListSchema, (parsed, ack) => {
      const db = getDb();
      let sql = 'SELECT * FROM todos WHERE 1=1';
      const params: unknown[] = [];

      if (parsed.taskId) { sql += ' AND task_id = ?'; params.push(parsed.taskId); }
      if (parsed.agentId) { sql += ' AND agent_id = ?'; params.push(parsed.agentId); }
      sql += ' ORDER BY created_at';

      if (ack) ack({ ok: true, data: db.prepare(sql).all(...params) });
    });

    handle(socket, 'todo:delete', TodoDeleteSchema, (parsed, ack) => {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(parsed.id) as Record<string, unknown> | undefined;
      if (!existing) {
        if (ack) ack({ ok: false, error: { code: 'TODO_NOT_FOUND', message: `TODO ${parsed.id} does not exist`, retryable: false } });
        return;
      }

      db.prepare('DELETE FROM todos WHERE id = ?').run(parsed.id);
      log.info({ todoId: parsed.id, taskId: existing.task_id }, 'TODO deleted');
      bus.emit('todo:deleted', { id: parsed.id, taskId: existing.task_id });
      if (ack) ack({ ok: true, data: { id: parsed.id } });
    });

    // ─── TODO Assignment Events ───

    handle(socket, 'todo:assign-agent', TodoAssignAgentSchema, (parsed, ack) => {
      const db = getDb();

      const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(parsed.todoId) as Record<string, unknown> | undefined;
      if (!todo) {
        if (ack) ack({ ok: false, error: { code: 'TODO_NOT_FOUND', message: `TODO ${parsed.todoId} does not exist`, retryable: false } });
        return;
      }

      const agentExists = db.prepare('SELECT id FROM agents WHERE id = ?').get(parsed.agentId);
      if (!agentExists) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
        return;
      }

      db.prepare('UPDATE todos SET agent_id = ? WHERE id = ?')
        .run(parsed.agentId, parsed.todoId);

      const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(parsed.todoId);
      log.info({ todoId: parsed.todoId, agentId: parsed.agentId }, 'TODO assigned to agent');
      broadcastLog('info', `TODO ${parsed.todoId} assigned to agent ${parsed.agentId}`, 'todos');
      bus.emit('todo:assigned', { ...(updated as Record<string, unknown>), agentId: parsed.agentId });
      bus.emit('todo:updated', updated as Record<string, unknown>);
      if (ack) ack({ ok: true, data: updated });
    });

    handle(socket, 'todo:unassign-agent', TodoUnassignAgentSchema, (parsed, ack) => {
      const db = getDb();

      const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(parsed.todoId) as Record<string, unknown> | undefined;
      if (!todo) {
        if (ack) ack({ ok: false, error: { code: 'TODO_NOT_FOUND', message: `TODO ${parsed.todoId} does not exist`, retryable: false } });
        return;
      }

      const previousAgentId = todo.agent_id;
      db.prepare('UPDATE todos SET agent_id = NULL WHERE id = ?')
        .run(parsed.todoId);

      const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(parsed.todoId);
      log.info({ todoId: parsed.todoId, previousAgentId }, 'TODO unassigned from agent');
      broadcastLog('info', `TODO ${parsed.todoId} unassigned from agent`, 'todos');
      bus.emit('todo:updated', updated as Record<string, unknown>);
      if (ack) ack({ ok: true, data: updated });
    });

    // ─── Exit Document Events ───

    handle(socket, 'exit-doc:submit', ExitDocSubmitSchema, async (parsed, ack) => {
      const result = await submitExitDocument({
        roomId: parsed.roomId, agentId: parsed.agentId,
        document: parsed.document ?? {}, buildingId: parsed.buildingId, phase: parsed.phase,
      });

      if (result.ok) {
        const exitDocData = result.data as Record<string, unknown>;
        bus.emit('exit-doc:submitted', {
          roomId: parsed.roomId, roomType: parsed.roomType,
          buildingId: parsed.buildingId, agentId: parsed.agentId,
          document: parsed.document,
          ...exitDocData,
        });

        // Auto-create a pending phase gate when exit doc is submitted
        if (parsed.buildingId && parsed.phase) {
          const gateResult = createGate({ buildingId: parsed.buildingId, phase: parsed.phase });
          if (gateResult.ok) {
            const gateData = gateResult.data as { id: string; phase: string; status: string };
            // Link exit doc to the gate
            const exitDocId = exitDocData.id as string | undefined;
            if (exitDocId) {
              getDb().prepare('UPDATE phase_gates SET exit_doc_id = ? WHERE id = ?').run(exitDocId, gateData.id);
            }
            broadcastLog('info', `Phase gate created for ${parsed.phase} (exit doc submitted)`, 'phase');
            bus.emit('phase:gate:created', { buildingId: parsed.buildingId, ...gateData });
          }
        }

        // Auto-create tasks from exit document content (#582)
        if (parsed.buildingId && parsed.document) {
          const doc = parsed.document;
          const taskItems: string[] = [];

          // Extract requirements from discovery exit docs
          if (doc.acceptanceCriteria && Array.isArray(doc.acceptanceCriteria)) {
            taskItems.push(...doc.acceptanceCriteria);
          } else if (doc.acceptanceCriteria && typeof doc.acceptanceCriteria === 'string') {
            taskItems.push(...doc.acceptanceCriteria.split('\n').filter((l: string) => l.trim()));
          }
          // Extract tasks from architecture exit docs
          if (doc.tasks && Array.isArray(doc.tasks)) {
            taskItems.push(...doc.tasks.map((t: { title?: string; name?: string }) => t.title || t.name || ''));
          }
          if (doc.taskBreakdown && Array.isArray(doc.taskBreakdown)) {
            taskItems.push(...doc.taskBreakdown.map((t: { title?: string; name?: string }) => t.title || t.name || ''));
          }

          // Create tasks for each extracted item
          const db2 = getDb();
          let created = 0;
          for (const item of taskItems.filter(Boolean)) {
            const taskId = randomUUID();
            const now = new Date().toISOString();
            db2.prepare(`
              INSERT INTO tasks (id, building_id, title, status, phase, priority, created_at, updated_at)
              VALUES (?, ?, ?, 'pending', ?, 'normal', datetime(?), datetime(?))
            `).run(taskId, parsed.buildingId, item, parsed.phase || 'discovery', now, now);
            created++;
          }
          if (created > 0) {
            broadcastLog('info', `${created} tasks auto-created from exit document`, 'tasks');
            bus.emit('tasks:bulk-created', { buildingId: parsed.buildingId, count: created });
          }
        }
      }

      if (ack) ack(result);
    });

    handle(socket, 'exit-doc:get', ExitDocGetSchema, (parsed, ack) => {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM exit_documents WHERE room_id = ? ORDER BY created_at DESC').all(parsed.roomId) as Array<Record<string, unknown>>;
      if (ack) ack({ ok: true, data: rows.map(parseExitDocRow) });
    });

    handle(socket, 'exit-doc:list', ExitDocListSchema, (parsed, ack) => {
      const db = getDb();
      const rows = db.prepare(`
        SELECT ed.* FROM exit_documents ed
        JOIN rooms r ON ed.room_id = r.id
        JOIN floors f ON r.floor_id = f.id
        WHERE f.building_id = ?
        ORDER BY ed.created_at DESC
      `).all(parsed.buildingId) as Array<Record<string, unknown>>;
      if (ack) ack({ ok: true, data: rows.map(parseExitDocRow) });
    });

    // ─── Citation Events ───

    handle(socket, 'citations:list', CitationListSchema, (parsed, ack) => {
      if (ack) ack(getCitations(parsed.roomId));
    });

    handle(socket, 'citations:backlinks', CitationBacklinksSchema, (parsed, ack) => {
      if (ack) ack(getBacklinks(parsed.roomId, parsed.entryId));
    });

    // ─── Phase Gate Events ───

    handle(socket, 'phase:gate:create', PhaseGateCreateSchema, (parsed, ack) => {
      const result = createGate({ buildingId: parsed.buildingId, phase: parsed.phase, criteria: parsed.criteria });
      if (result.ok) {
        bus.emit('phase:gate:created', { buildingId: parsed.buildingId, ...(result.data as Record<string, unknown>) });
      }
      if (ack) ack(result);
    });

    handle(socket, 'phase:gate:signoff', PhaseGateSignoffSchema, async (parsed, ack) => {
      // Look up the gate to get buildingId and phase before signoff
      const gateRow = getDb().prepare('SELECT building_id, phase FROM phase_gates WHERE id = ?').get(parsed.gateId) as { building_id: string; phase: string } | undefined;

      const result = await signoffGate({
        gateId: parsed.gateId, reviewer: parsed.reviewer, verdict: parsed.verdict,
        conditions: parsed.conditions, criteria: parsed.criteria, exitDocId: parsed.exitDocId, nextPhaseInput: parsed.nextPhaseInput,
      });
      if (result.ok) {
        const signoffData = result.data as { gateId: string; verdict: string; phaseAdvanced?: boolean; nextPhase?: string };
        // Re-read full gate row so the broadcast includes all fields the UI needs
        // (id, phase, building_id, status, signoff_*, etc.)
        const fullGate = getDb().prepare('SELECT * FROM phase_gates WHERE id = ?').get(parsed.gateId) as Record<string, unknown> | undefined;
        const broadcastData = fullGate
          ? {
              ...fullGate,
              gateId: parsed.gateId,
              phaseAdvanced: signoffData.phaseAdvanced,
              nextPhase: signoffData.nextPhase,
              criteria: safeJsonParse(fullGate.criteria as string, []),
              signoff_conditions: safeJsonParse(fullGate.signoff_conditions as string, []),
              next_phase_input: safeJsonParse(fullGate.next_phase_input as string, {}),
            }
          : { ...(signoffData as unknown as Record<string, unknown>), gateId: parsed.gateId };
        bus.emit('phase:gate:signed-off', broadcastData as Record<string, unknown>);
        // If GO verdict advanced the phase, emit phase:advanced for auto-room provisioning
        if (signoffData.phaseAdvanced && signoffData.nextPhase && gateRow) {
          bus.emit('phase:advanced', {
            buildingId: gateRow.building_id,
            from: gateRow.phase,
            to: signoffData.nextPhase,
            gateId: signoffData.gateId,
          });
          bus.emit('building:updated', { id: gateRow.building_id, activePhase: signoffData.nextPhase });
        }
      }
      if (ack) ack(result);
    });

    handle(socket, 'phase:advance', PhaseAdvanceSchema, async (parsed, ack) => {
      const buildingId = parsed.buildingId;
      const phaseOrder = getPhaseOrder();

      // Look up the building to get current phase
      const building = getDb().prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string } | undefined;
      if (!building) {
        if (ack) ack({ ok: false, error: { code: 'BUILDING_NOT_FOUND', message: `Building ${buildingId} not found`, retryable: false } });
        return;
      }

      const currentPhase = building.active_phase;
      const idx = phaseOrder.indexOf(currentPhase);
      if (idx === -1 || idx >= phaseOrder.length - 1) {
        if (ack) ack({ ok: false, error: { code: 'CANNOT_ADVANCE', message: idx === -1 ? `Unknown phase: ${currentPhase}` : 'Already at final phase', retryable: false } });
        return;
      }
      const nextPhase = phaseOrder[idx + 1];

      // Create a gate for the current phase and immediately sign off as GO
      const gateResult = createGate({ buildingId, phase: currentPhase });
      if (!gateResult.ok) {
        if (ack) ack(gateResult);
        return;
      }

      const gateData = gateResult.data as { id: string };
      const signoffResult = await signoffGate({
        gateId: gateData.id, reviewer: parsed.reviewer || 'system',
        verdict: 'GO', conditions: [], nextPhaseInput: parsed.nextPhaseInput,
      });

      if (signoffResult.ok) {
        broadcastLog('info', `Phase advanced: ${currentPhase} → ${nextPhase}`, 'phase');
        bus.emit('phase:advanced', {
          buildingId, from: currentPhase, to: nextPhase, gateId: gateData.id,
        });
        bus.emit('building:updated', { id: buildingId, activePhase: nextPhase });
      }

      if (ack) ack(signoffResult);
    });

    // ─── Settings Events ───

    handle(socket, 'settings:get-config', EmptyPayloadSchema, (_data, ack) => {
      if (!ack) return;

      // Build provider config — NEVER expose API keys
      const providers: Record<string, { configured: boolean; model: string; baseUrl?: string }> = {
        anthropic: {
          configured: !!process.env.ANTHROPIC_API_KEY,
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
        },
        minimax: {
          configured: !!process.env.MINIMAX_API_KEY,
          model: process.env.MINIMAX_MODEL || 'MiniMax-M2.5',
          baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/anthropic',
        },
        openai: {
          configured: !!process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL || 'gpt-4o',
        },
        ollama: {
          configured: true, // Ollama is local, always "configured"
          model: process.env.OLLAMA_MODEL || 'llama3',
          baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        },
      };

      // Room → provider mapping (from env or defaults)
      const roomProviderMap: Record<string, string> = {
        strategist: process.env.PROVIDER_DISCOVERY || 'minimax',
        'building-architect': process.env.PROVIDER_ARCHITECTURE || 'minimax',
        discovery: process.env.PROVIDER_DISCOVERY || 'minimax',
        architecture: process.env.PROVIDER_ARCHITECTURE || 'minimax',
        'code-lab': process.env.PROVIDER_CODE_LAB || 'minimax',
        'testing-lab': process.env.PROVIDER_TESTING_LAB || 'minimax',
        review: process.env.PROVIDER_REVIEW || 'minimax',
        deploy: process.env.PROVIDER_DEPLOY || 'minimax',
        'war-room': process.env.PROVIDER_DISCOVERY || 'minimax',
        'data-exchange': process.env.PROVIDER_DISCOVERY || 'minimax',
        'provider-hub': process.env.PROVIDER_DISCOVERY || 'minimax',
        'plugin-bay': process.env.PROVIDER_DISCOVERY || 'minimax',
      };

      ack({
        ok: true,
        data: {
          providers,
          roomProviderMap,
          features: {
            plugins: process.env.ENABLE_PLUGINS === 'true',
            luaScripting: process.env.ENABLE_LUA_SCRIPTING === 'true',
          },
          server: {
            version: '0.1.0',
            environment: process.env.NODE_ENV || 'development',
            uptime: process.uptime(),
          },
        },
      });
    });

    // ─── Settings: Room Provider Override (#555) ───

    handle(socket, 'settings:room-provider', RoomProviderSetSchema, (parsed, ack) => {
      // Whitelist room types and providers to prevent arbitrary env var injection (SEC-1)
      const VALID_ROOM_TYPES = new Set([
        'strategist', 'building-architect', 'discovery', 'architecture',
        'code-lab', 'testing-lab', 'review', 'deploy', 'war-room',
        'data-exchange', 'provider-hub', 'plugin-bay', 'integration',
      ]);
      const VALID_PROVIDERS = new Set(['anthropic', 'minimax', 'openai', 'ollama']);

      if (!VALID_ROOM_TYPES.has(parsed.roomType)) {
        if (ack) ack({ ok: false, error: { code: 'INVALID_ROOM_TYPE', message: `Unknown room type: ${parsed.roomType}`, retryable: false } });
        return;
      }
      if (parsed.provider && !VALID_PROVIDERS.has(parsed.provider)) {
        if (ack) ack({ ok: false, error: { code: 'INVALID_PROVIDER', message: `Unknown provider: ${parsed.provider}`, retryable: false } });
        return;
      }

      const envKey = `PROVIDER_${parsed.roomType.toUpperCase().replace(/-/g, '_')}`;
      if (parsed.provider) {
        process.env[envKey] = parsed.provider;
      } else {
        delete process.env[envKey];
      }
      log.info({ roomType: parsed.roomType, provider: parsed.provider, envKey }, 'Room provider override saved');
      if (ack) ack({ ok: true, data: { roomType: parsed.roomType, provider: parsed.provider } });
    });

    // ─── Settings: Log Level (#602) ───

    handle(socket, 'settings:log-level', LogLevelSetSchema, (parsed, ack) => {
      process.env.LOG_LEVEL = parsed.level;
      log.info({ level: parsed.level }, 'Log level changed via settings');
      if (ack) ack({ ok: true, data: { level: parsed.level } });
    });

    // ─── Multi-Repo (#605) ───

    handle(socket, 'repo:add', RepoAddSchema, (parsed, ack) => {
      const db = getDb();
      const id = `repo_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      try {
        db.prepare(`
          INSERT INTO project_repos (id, building_id, repo_url, name, relationship, local_path, branch)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, parsed.buildingId, parsed.repoUrl, parsed.name, parsed.relationship, parsed.localPath ?? null, parsed.branch);
        io.emit('repo:added', { id, buildingId: parsed.buildingId, name: parsed.name, relationship: parsed.relationship });
        if (ack) ack({ ok: true, data: { id, name: parsed.name, relationship: parsed.relationship } });
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'REPO_ADD_FAILED', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    handle(socket, 'repo:remove', RepoRemoveSchema, (parsed, ack) => {
      const db = getDb();
      try {
        // Also clean up file origins
        db.prepare('DELETE FROM repo_file_origins WHERE source_repo_id = ?').run(parsed.repoId);
        const result = db.prepare('DELETE FROM project_repos WHERE id = ? AND building_id = ?').run(parsed.repoId, parsed.buildingId);
        if (result.changes === 0) {
          if (ack) ack({ ok: false, error: { code: 'NOT_FOUND', message: 'Repo not found', retryable: false } });
          return;
        }
        io.emit('repo:removed', { repoId: parsed.repoId, buildingId: parsed.buildingId });
        if (ack) ack({ ok: true, data: { repoId: parsed.repoId } });
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'REPO_REMOVE_FAILED', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    handle(socket, 'repo:list', RepoListSchema, (parsed, ack) => {
      const db = getDb();
      const repos = db.prepare('SELECT * FROM project_repos WHERE building_id = ? ORDER BY relationship, name').all(parsed.buildingId);
      if (ack) ack({ ok: true, data: { repos } });
    });

    handle(socket, 'repo:update', RepoUpdateSchema, (parsed, ack) => {
      const db = getDb();
      const fields: string[] = [];
      const values: unknown[] = [];
      if (parsed.relationship !== undefined) { fields.push('relationship = ?'); values.push(parsed.relationship); }
      if (parsed.branch !== undefined) { fields.push('branch = ?'); values.push(parsed.branch); }
      if (parsed.localPath !== undefined) { fields.push('local_path = ?'); values.push(parsed.localPath); }
      if (fields.length === 0) {
        if (ack) ack({ ok: false, error: { code: 'NO_FIELDS', message: 'No fields to update', retryable: false } });
        return;
      }
      fields.push("updated_at = datetime('now')");
      values.push(parsed.repoId);
      try {
        db.prepare(`UPDATE project_repos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        if (ack) ack({ ok: true, data: { repoId: parsed.repoId } });
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'REPO_UPDATE_FAILED', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    handle(socket, 'repo:analyze', RepoAnalyzeSchema, async (parsed, ack) => {
      try {
        const result = await analyzeRepos(
          ai,
          parsed.repos,
          parsed.projectName,
          parsed.projectGoals,
        );
        if (result.ok) {
          if (ack) ack({ ok: true, data: result.data });
        } else {
          if (ack) ack({ ok: false, error: { code: result.error.code, message: result.error.message, retryable: result.error.retryable ?? false } });
        }
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'ANALYZE_FAILED', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    // ─── Repo Sync Events (#649) ───

    handle(socket, 'repo:sync-status', RepoSyncStatusSchema, async (parsed, ack) => {
      try {
        const db = getDb();
        const repoRows = db.prepare(
          'SELECT id, name, repo_url, branch, last_commit, last_synced_at FROM project_repos WHERE building_id = ?',
        ).all(parsed.buildingId) as Array<{ id: string; name: string; repo_url: string; branch: string; last_commit: string | null; last_synced_at: string | null }>;

        const result = await checkSyncStatus(repoRows.map(r => ({
          id: r.id,
          name: r.name,
          repoUrl: r.repo_url,
          branch: r.branch || 'main',
          lastCommit: r.last_commit,
          lastSyncedAt: r.last_synced_at,
        })));

        if (result.ok) {
          // Also fetch file origin summary
          const originSummary = db.prepare(`
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN modified_locally = 1 THEN 1 ELSE 0 END) as modified
            FROM repo_file_origins WHERE building_id = ?
          `).get(parsed.buildingId) as { total: number; modified: number } | undefined;

          if (ack) ack({
            ok: true,
            data: {
              ...result.data,
              fileOrigins: {
                total: originSummary?.total ?? 0,
                modifiedLocally: originSummary?.modified ?? 0,
              },
            },
          });
        } else {
          if (ack) ack({ ok: false, error: { code: result.error.code, message: result.error.message, retryable: result.error.retryable ?? false } });
        }
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'SYNC_STATUS_FAILED', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    handle(socket, 'repo:sync-fetch', RepoSyncFetchSchema, async (parsed, ack) => {
      try {
        const db = getDb();
        const repo = db.prepare(
          'SELECT id, repo_url, branch FROM project_repos WHERE id = ? AND building_id = ?',
        ).get(parsed.repoId, parsed.buildingId) as { id: string; repo_url: string; branch: string } | undefined;

        if (!repo) {
          if (ack) ack({ ok: false, error: { code: 'REPO_NOT_FOUND', message: 'Repository not found in this building', retryable: false } });
          return;
        }

        const result = await fetchLatestCommit(repo.repo_url, repo.branch || 'main');
        if (result.ok) {
          // Update DB with latest commit and sync timestamp
          db.prepare(
            'UPDATE project_repos SET last_commit = ?, last_synced_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?',
          ).run(result.data.commit, repo.id);

          if (ack) ack({ ok: true, data: { repoId: repo.id, commit: result.data.commit, syncedAt: new Date().toISOString() } });
        } else {
          if (ack) ack({ ok: false, error: { code: result.error.code, message: result.error.message, retryable: result.error.retryable ?? false } });
        }
      } catch (e) {
        if (ack) ack({ ok: false, error: { code: 'SYNC_FETCH_FAILED', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    // ─── System Events ───

    handle(socket, 'system:health', EmptyPayloadSchema, (_data, ack) => {
      if (ack) ack({ ok: true, data: { uptime: process.uptime(), version: '0.1.0' } });
    });

    // ─── Disconnect Cleanup ───

    socket.on('disconnect', () => {
      try {
        const assoc = socketAssociations.get(socket.id);
        let cleanedRooms = 0;
        let cleanedAgents = 0;

        if (assoc) {
          for (const [agentId, roomId] of assoc.roomMemberships) {
            try {
              // End active session and record duration before exiting room
              const session = AgentSession.findActive(agentId, roomId);
              if (session) {
                session.end();
                session.save();
                const agent = agents.getAgent(agentId);
                const durationMs = (session.endedAt ?? Date.now()) - session.startedAt;
                onSessionEnd(agentId, roomId, durationMs, agent?.building_id ?? undefined);
              }
              rooms.exitRoom({ roomId, agentId, reason: 'disconnect' });
              bus.emit('room:agent:exited', { roomId, agentId, reason: 'disconnect' });
              cleanedRooms++;
            } catch (e) {
              log.warn({ agentId, roomId, err: e, socketId: socket.id }, 'Failed to exit room on disconnect');
            }
          }

          // Mark agents as idle on disconnect — do NOT delete them.
          // Agents are persistent entities stored in the database.
          // They should only be removed via explicit 'agent:remove' events.
          for (const agentId of assoc.agentIds) {
            try {
              // bus.emit triggers the bus listener that calls onStatusChange()
              bus.emit('agent:status-changed', { agentId, status: 'idle', reason: 'disconnect' });
              cleanedAgents++;
            } catch (e) {
              log.warn({ agentId, err: e, socketId: socket.id }, 'Failed to update agent status on disconnect');
            }
          }

          socketAssociations.delete(socket.id);
        }

        log.info({ id: socket.id, cleanedRooms, cleanedAgents }, 'Client disconnected');
        broadcastLog('info', `Client disconnected (${socket.id}) — cleaned ${cleanedRooms} rooms, ${cleanedAgents} agents`, 'transport');
        bus.emit('socket:disconnected', { socketId: socket.id, cleanedRooms, cleanedAgents });
      } catch (e) {
        log.error({ err: e, socketId: socket.id }, 'Disconnect handler threw');
        socketAssociations.delete(socket.id);
      }
    });
  });

  // ─── Bus → Socket broadcasts ───
  // Events are scoped to the building room when buildingId is present (#593).
  // This prevents chat messages, agent updates, and other events from leaking
  // between projects. Events without buildingId are broadcast globally (e.g., system:log).

  const forward = (event: string) => bus.on(event, (data: Record<string, unknown>) => {
    const buildingId = data.buildingId as string | undefined;
    if (buildingId) {
      // Scoped broadcast — only clients viewing this building receive the event
      io.to(`building:${buildingId}`).emit(event, data);
    } else {
      // Global broadcast — system-level events without building context
      io.emit(event, data);
    }
  });

  forward('room:agent:entered');
  forward('room:agent:exited');
  forward('chat:response');
  forward('chat:stream');
  forward('tool:executed');
  forward('phase:advanced');
  forward('raid:entry:added');
  forward('raid:entry:updated');
  forward('phase-zero:complete');
  forward('phase-zero:failed');
  forward('exit-doc:submitted');
  forward('scope-change:detected');
  forward('agent:mentioned');
  forward('agent:status-changed');
  forward('agent:profile-updated');
  forward('agent:profile-generated');
  forward('building:updated');
  forward('deploy:check');
  forward('task:created');
  forward('task:updated');
  forward('task:assigned');
  forward('phase:gate:created');
  forward('phase:gate:signed-off');
  forward('phase:conditions:resolved');
  forward('milestone:created');
  forward('milestone:updated');
  forward('milestone:deleted');
  forward('todo:created');
  forward('todo:updated');
  forward('todo:assigned');
  forward('todo:deleted');
  forward('escalation:stale-gate');
  forward('escalation:war-room');
  forward('escalation:failed');
  // scope-change:detected already forwarded above — removed duplicate
  forward('system:log');
  forward('building:created');
  forward('building:onboarded');
  forward('building:onboard-failed');
  forward('phase:room-provisioned');
  forward('citation:added');
  forward('table:created');
  forward('table:updated');
  forward('table:deleted');
  forward('table:context-updated');
  forward('table:work-divided');
  forward('floor:created');
  forward('floor:updated');
  forward('floor:deleted');
  forward('floor:sorted');
  forward('room:updated');
  forward('room:deleted');
  forward('room:escalated');
  forward('plan:submitted');
  forward('plan:reviewed');
  forward('email:dispatched');
  forward('plugin:status-changed');
  forward('plugin:config-changed');
  forward('plugin:source-changed');

  // ─── Exit Doc Auto-Submit (#524) ───
  // When the conversation loop detects an exit document in AI prose,
  // it emits exit-doc:auto-submit. We handle it here to call the real
  // submitExitDocument() flow and trigger the phase gate pipeline.
  bus.on('exit-doc:auto-submit', async (data: Record<string, unknown>) => {
    const roomId = data.roomId as string;
    const agentId = data.agentId as string;
    const document = data.document as Record<string, unknown>;
    const exitDocType = data.exitDocType as string;

    if (!roomId || !agentId || !document) {
      log.warn({ data }, 'exit-doc:auto-submit missing required fields');
      return;
    }

    // Look up buildingId and active phase from the room's floor
    let buildingId: string | undefined;
    let phase: string | undefined;
    try {
      const db = getDb();
      const roomRow = db.prepare('SELECT floor_id, type FROM rooms WHERE id = ?').get(roomId) as { floor_id: string; type: string } | undefined;
      if (roomRow) {
        const floorRow = db.prepare('SELECT building_id FROM floors WHERE id = ?').get(roomRow.floor_id) as { building_id: string } | undefined;
        if (floorRow) {
          buildingId = floorRow.building_id;
          const building = db.prepare('SELECT active_phase FROM buildings WHERE id = ?').get(buildingId) as { active_phase: string } | undefined;
          phase = building?.active_phase || undefined;
        }
      }
    } catch (e) {
      log.warn({ err: e, roomId }, 'Failed to look up building context for auto-submitted exit doc');
    }

    log.info(
      { roomId, agentId, exitDocType, buildingId, phase },
      'Processing auto-detected exit document',
    );

    const result = await submitExitDocument({
      roomId,
      agentId,
      document,
      buildingId,
      phase,
    });

    if (result.ok) {
      const exitDocData = result.data as Record<string, unknown>;
      bus.emit('exit-doc:submitted', {
        roomId,
        roomType: exitDocType,
        buildingId,
        agentId,
        document,
        ...exitDocData,
      });

      // RAID auto-populate: create a "decision" entry for phase completion (#508)
      if (buildingId && phase) {
        try {
          const raidId = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const phaseName = phase.charAt(0).toUpperCase() + phase.slice(1);
          getDb().prepare(`
            INSERT INTO raid_entries (id, building_id, type, phase, room_id, summary, rationale, decided_by, affected_areas)
            VALUES (?, ?, 'decision', ?, ?, ?, ?, ?, ?)
          `).run(
            raidId,
            buildingId,
            phase,
            roomId,
            `Phase ${phaseName} completed \u2014 exit document submitted`,
            `Agent ${agentId} auto-submitted exit document for ${exitDocType || 'room'} work. Phase deliverables captured.`,
            agentId,
            JSON.stringify([exitDocType || phase]),
          );
          bus.emit('raid:created', { id: raidId, buildingId, type: 'decision', phase });
          log.info({ raidId, buildingId, phase }, 'RAID decision auto-created for phase completion');
        } catch (raidErr) {
          log.warn({ err: raidErr, buildingId, phase }, 'Failed to auto-create RAID decision entry');
        }
      }

      // Auto-create a pending phase gate when exit doc is submitted
      if (buildingId && phase) {
        const gateResult = createGate({ buildingId, phase });
        if (gateResult.ok) {
          const gateData = gateResult.data as { id: string; phase: string; status: string };
          const exitDocId = exitDocData.id as string | undefined;
          if (exitDocId) {
            getDb().prepare('UPDATE phase_gates SET exit_doc_id = ? WHERE id = ?').run(exitDocId, gateData.id);
          }
          broadcastLog('info', `Phase gate created for ${phase} (exit doc auto-submitted)`, 'phase');
          bus.emit('phase:gate:created', { buildingId, ...gateData });

          // In EASY mode: auto-sign the gate with GO verdict and advance the phase
          const buildingRow = getDb().prepare('SELECT config FROM buildings WHERE id = ?').get(buildingId) as { config: string } | undefined;
          const buildingConfig = buildingRow?.config ? JSON.parse(buildingRow.config) : {};
          const effortLevel = buildingConfig.effortLevel || 'easy';

          if (effortLevel === 'easy') {
            const signResult = await signoffGate({
              gateId: gateData.id,
              reviewer: 'system-auto',
              verdict: 'GO',
              exitDocId: exitDocId || undefined,
            });
            if (signResult.ok) {
              const signData = signResult.data as { phaseAdvanced?: boolean; nextPhase?: string };
              broadcastLog('info', `Phase auto-advanced: ${phase} → ${signData.nextPhase || 'next'} (EASY mode)`, 'phase');
              if (signData.phaseAdvanced && signData.nextPhase) {
                bus.emit('phase:advanced', { buildingId, from: phase, to: signData.nextPhase, gateId: gateData.id });
                bus.emit('building:updated', { id: buildingId, activePhase: signData.nextPhase });
                io.emit('phase:gate:signed-off', { gateId: gateData.id, buildingId, verdict: 'GO', phaseAdvanced: true, nextPhase: signData.nextPhase });
              }
            }
          }
        }
      }

      broadcastLog('info', `Exit document auto-submitted for ${exitDocType} in room ${roomId}`, 'exit-doc');
    } else {
      log.warn({ roomId, agentId, error: result.error }, 'Auto-submitted exit document failed validation');
    }
  });

  // ─── Stats: record every agent status change ───
  bus.on('agent:status-changed', (data: Record<string, unknown>) => {
    const agentId = data.agentId as string;
    const newStatus = data.status as string;
    if (!agentId || !newStatus) return;
    // Look up previous status from DB for the activity log
    const agent = agents.getAgent(agentId);
    const oldStatus = agent?.status ?? 'unknown';
    if (oldStatus !== newStatus) {
      onStatusChange(agentId, oldStatus, newStatus);
    }
  });

  log.info('Transport layer initialized');
  broadcastLog('info', 'Transport layer initialized', 'transport');
}
