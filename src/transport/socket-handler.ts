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

import { randomUUID } from 'crypto';
import { logger, broadcastLog } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI, AIProviderAPI } from '../core/contracts.js';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { createBuilding, getBuilding, listBuildings, updateBuilding, listFloors, getFloor, createFloor, updateFloor, deleteFloor, sortFloors } from '../rooms/building-manager.js';
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
  BuildingCreateSchema, BuildingGetSchema, BuildingListSchema, BuildingApplyBlueprintSchema, BuildingUpdateSchema,
  FloorListSchema, FloorGetSchema, FloorCreateSchema, FloorUpdateSchema, FloorDeleteSchema, FloorSortSchema,
  RoomCreateSchema, RoomGetSchema, RoomEnterSchema, RoomExitSchema, RoomUpdateSchema, RoomDeleteSchema,
  TableCreateSchema, TableListSchema, TableUpdateSchema, TableDeleteSchema, AgentMoveSchema,
  AgentRegisterSchema, AgentGetSchema, AgentListSchema, AgentUpdateProfileSchema,
  AgentGenerateProfileSchema,
  AgentGeneratePhotoSchema,
  ChatMessageSchema,
  EmptyPayloadSchema, PhaseStatusSchema, PhaseGateSchema,
  PhaseGatesSchema, PhaseCanAdvanceSchema, PhasePendingGatesSchema,
  PhaseResolveConditionsSchema, PhaseStaleGatesSchema, PhaseGateSignoffSchema, PhaseAdvanceSchema,
  RaidSearchSchema, RaidListSchema, RaidAddSchema, RaidUpdateSchema, RaidEditSchema,
  TaskCreateSchema, TaskUpdateSchema, TaskListSchema, TaskGetSchema,
  TaskAssignTableSchema, TaskUnassignTableSchema,
  TodoCreateSchema, TodoToggleSchema, TodoListSchema, TodoDeleteSchema,
  TodoAssignAgentSchema, TodoUnassignAgentSchema,
  ExitDocSubmitSchema, ExitDocGetSchema, ExitDocListSchema,
  CitationListSchema, CitationBacklinksSchema,
} from './schemas.js';
import { generateFullProfile } from '../ai/agent-profile-service.js';
import type { FullProfileResult } from '../ai/agent-profile-service.js';
import { generateAgentProfilePhoto } from '../ai/profile-generator.js';
import { isImageGenerationAvailable } from '../ai/minimax-image.js';
import { writeAgentPhoto } from '../ai/agent-photo-store.js';

const log = logger.child({ module: 'transport' });

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

export function initTransport({ io, bus, rooms, agents, tools, ai }: InitTransportParams): void {
  io.on('connection', (socket: Socket) => {
    log.info({ id: socket.id }, 'Client connected');
    broadcastLog('info', `Client connected (${socket.id})`, 'transport');

    // ─── Building Events ───

    handle(socket, 'building:create', BuildingCreateSchema, (parsed, ack) => {
      const result = createBuilding(parsed as Parameters<typeof createBuilding>[0]);
      if (result.ok) {
        const buildingData = result.data as { id: string; name: string; floorIds: string[] };
        broadcastLog('info', `Building created: ${buildingData.name}`, 'building');
        // Emit building:created so onboarding can auto-provision Strategist room + agent
        bus.emit('building:created', {
          buildingId: buildingData.id,
          name: buildingData.name,
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
      const result = updateBuilding(parsed.buildingId, { name: parsed.name, config: parsed.config });
      if (result.ok) {
        broadcastLog('info', `Building updated: ${parsed.buildingId}`, 'building');
        bus.emit('building:updated', { id: parsed.buildingId, name: parsed.name });
      }
      if (ack) ack(result);
    });

    handle(socket, 'building:apply-blueprint', BuildingApplyBlueprintSchema, (parsed, ack) => {
      const result = handleBlueprintSubmission({
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
      const buildings = result.ok ? (result.data as Array<{ id: string; name: string; active_phase: string }>) : [];
      if (ack) ack({
        ok: true,
        data: {
          isNewUser: buildings.length === 0,
          buildings: buildings.map((b) => ({ id: b.id, name: b.name, activePhase: b.active_phase })),
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
      }
      if (ack) ack(result);
    });

    handle(socket, 'room:exit', RoomExitSchema, (parsed, ack) => {
      const result = rooms.exitRoom(parsed as Parameters<typeof rooms.exitRoom>[0]);
      if (result.ok) {
        getAssociations(socket.id).roomMemberships.delete(parsed.agentId);
      }
      if (ack) ack(result);
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

    // ─── Agent Move (convenience: exit old room + enter new room in one step) ───

    handle(socket, 'agent:move', AgentMoveSchema, (parsed, ack) => {
      const db = getDb();
      const agent = db.prepare('SELECT id, current_room_id FROM agents WHERE id = ?').get(parsed.agentId) as { id: string; current_room_id: string | null } | undefined;

      if (!agent) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
        return;
      }

      // Exit current room if any
      if (agent.current_room_id) {
        const exitResult = rooms.exitRoom({ roomId: agent.current_room_id, agentId: parsed.agentId });
        if (!exitResult.ok) {
          // If exit fails due to exit doc requirement, tell the user
          if (ack) ack(exitResult);
          return;
        }
        getAssociations(socket.id).roomMemberships.delete(parsed.agentId);
        bus.emit('room:agent:exited', { roomId: agent.current_room_id, agentId: parsed.agentId, reason: 'move' });
      }

      // Enter new room
      const enterResult = rooms.enterRoom({ roomId: parsed.roomId, agentId: parsed.agentId, tableType: parsed.tableType });
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
          // Fire-and-forget: don't block registration
          generateFullProfile(ai, parsed.role, undefined, {
            provider: 'anthropic',
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

    handle(socket, 'agent:generate-profile', AgentGenerateProfileSchema, async (parsed, ack) => {
      const agent = agents.getAgent(parsed.agentId);
      if (!agent) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
        return;
      }

      const role = parsed.role || agent.role || 'General Agent';
      const capabilities = parsed.capabilities || agent.capabilities || [];

      broadcastLog('info', `Generating AI profile for agent ${agent.name} (${role})...`, 'agents');

      const result = await generateFullProfile(ai, role, capabilities, {
        skipBio: parsed.skipBio,
        skipPhoto: parsed.skipPhoto,
        gender: parsed.gender,
        provider: parsed.provider,
        existing: {
          firstName: agent.first_name,
          lastName: agent.last_name,
          displayName: agent.display_name,
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

      // 4. Regular message — forward to bus
      bus.emit('chat:message', { socketId: socket.id, ...parsed });
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

    handle(socket, 'phase:resolve-conditions', PhaseResolveConditionsSchema, (parsed, ack) => {
      const result = resolveConditions({
        gateId: parsed.gateId,
        resolvedConditions: parsed.resolvedConditions,
        resolver: parsed.resolver,
      });
      if (result.ok) {
        const resultData = result.data as Record<string, unknown>;
        if (resultData.verdict === 'GO') {
          bus.emit('phase:gate:signed-off', resultData);
          bus.emit('phase:advanced', resultData);
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
      bus.emit('raid:entry:added', { ...(result.ok ? result.data as Record<string, unknown> : {}), ...parsed });
      if (ack) ack(result);
    });

    handle(socket, 'raid:update', RaidUpdateSchema, (parsed, ack) => {
      if (ack) ack(updateRaidStatus({ id: parsed.id, status: parsed.status }));
    });

    handle(socket, 'raid:edit', RaidEditSchema, (parsed, ack) => {
      if (ack) ack(updateRaidEntry({
        id: parsed.id,
        summary: parsed.summary,
        rationale: parsed.rationale,
        decidedBy: parsed.decidedBy,
        affectedAreas: parsed.affectedAreas,
      }));
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

      const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
      if (!existing) {
        if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${taskId} does not exist`, retryable: false } });
        return;
      }

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

      fields.push("updated_at = datetime(?)");
      values.push(new Date().toISOString());
      values.push(taskId);

      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      log.info({ taskId, updatedFields: fields.length }, 'Task updated');
      bus.emit('task:updated', task as Record<string, unknown>);
      if (ack) ack({ ok: true, data: task });
    });

    handle(socket, 'task:list', TaskListSchema, (parsed, ack) => {
      const db = getDb();
      let sql = 'SELECT * FROM tasks WHERE building_id = ?';
      const params: unknown[] = [parsed.buildingId];

      if (parsed.status) { sql += ' AND status = ?'; params.push(parsed.status); }
      if (parsed.phase) { sql += ' AND phase = ?'; params.push(parsed.phase); }
      if (parsed.assigneeId) { sql += ' AND assignee_id = ?'; params.push(parsed.assigneeId); }
      if (parsed.tableId) { sql += ' AND table_id = ?'; params.push(parsed.tableId); }
      if (parsed.roomId) { sql += ' AND room_id = ?'; params.push(parsed.roomId); }
      sql += ' ORDER BY created_at DESC';

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

    handle(socket, 'exit-doc:submit', ExitDocSubmitSchema, (parsed, ack) => {
      const result = submitExitDocument({
        roomId: parsed.roomId, agentId: parsed.agentId,
        document: parsed.document ?? {}, buildingId: parsed.buildingId, phase: parsed.phase,
      });
      bus.emit('exit-doc:submitted', {
        roomId: parsed.roomId, roomType: parsed.roomType,
        buildingId: parsed.buildingId, agentId: parsed.agentId,
        document: parsed.document,
        ...(result.ok ? result.data as Record<string, unknown> : {}),
      });

      // Auto-create a pending phase gate when exit doc is submitted
      if (result.ok && parsed.buildingId && parsed.phase) {
        const gateResult = createGate({ buildingId: parsed.buildingId, phase: parsed.phase });
        if (gateResult.ok) {
          const gateData = gateResult.data as { id: string; phase: string; status: string };
          broadcastLog('info', `Phase gate created for ${parsed.phase} (exit doc submitted)`, 'phase');
          bus.emit('phase:gate:created', { buildingId: parsed.buildingId, ...gateData });
        }
      }

      if (ack) ack(result);
    });

    handle(socket, 'exit-doc:get', ExitDocGetSchema, (parsed, ack) => {
      const db = getDb();
      if (ack) ack({ ok: true, data: db.prepare('SELECT * FROM exit_documents WHERE room_id = ? ORDER BY created_at DESC').all(parsed.roomId) });
    });

    handle(socket, 'exit-doc:list', ExitDocListSchema, (parsed, ack) => {
      const db = getDb();
      if (ack) ack({
        ok: true,
        data: db.prepare(`
          SELECT ed.* FROM exit_documents ed
          JOIN rooms r ON ed.room_id = r.id
          JOIN floors f ON r.floor_id = f.id
          WHERE f.building_id = ?
          ORDER BY ed.created_at DESC
        `).all(parsed.buildingId),
      });
    });

    // ─── Citation Events ───

    handle(socket, 'citations:list', CitationListSchema, (parsed, ack) => {
      if (ack) ack(getCitations(parsed.roomId));
    });

    handle(socket, 'citations:backlinks', CitationBacklinksSchema, (parsed, ack) => {
      if (ack) ack(getBacklinks(parsed.roomId, parsed.entryId));
    });

    // ─── Phase Gate Events ───

    handle(socket, 'phase:gate:create', PhaseGateSchema, (parsed, ack) => {
      if (!parsed.buildingId || !parsed.phase) {
        if (ack) ack({ ok: false, error: { code: 'MISSING_PARAMS', message: 'buildingId and phase are required', retryable: false } });
        return;
      }
      const result = createGate({ buildingId: parsed.buildingId, phase: parsed.phase });
      if (result.ok) {
        bus.emit('phase:gate:created', { buildingId: parsed.buildingId, ...(result.data as Record<string, unknown>) });
      }
      if (ack) ack(result);
    });

    handle(socket, 'phase:gate:signoff', PhaseGateSignoffSchema, (parsed, ack) => {
      // Look up the gate to get buildingId and phase before signoff
      const gateRow = getDb().prepare('SELECT building_id, phase FROM phase_gates WHERE id = ?').get(parsed.gateId) as { building_id: string; phase: string } | undefined;

      const result = signoffGate({
        gateId: parsed.gateId, reviewer: parsed.reviewer, verdict: parsed.verdict,
        conditions: parsed.conditions, exitDocId: parsed.exitDocId, nextPhaseInput: parsed.nextPhaseInput,
      });
      if (result.ok) {
        const signoffData = result.data as { gateId: string; verdict: string; phaseAdvanced?: boolean; nextPhase?: string };
        bus.emit('phase:gate:signed-off', signoffData as unknown as Record<string, unknown>);
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

    handle(socket, 'phase:advance', PhaseAdvanceSchema, (parsed, ack) => {
      const buildingId = parsed.buildingId;
      const phaseOrder = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

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
      const signoffResult = signoffGate({
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
        strategist: 'anthropic',
        'building-architect': 'anthropic',
        discovery: process.env.PROVIDER_DISCOVERY || 'anthropic',
        architecture: process.env.PROVIDER_ARCHITECTURE || 'anthropic',
        'code-lab': process.env.PROVIDER_CODE_LAB || 'minimax',
        'testing-lab': process.env.PROVIDER_TESTING_LAB || 'minimax',
        review: process.env.PROVIDER_REVIEW || 'anthropic',
        deploy: process.env.PROVIDER_DEPLOY || 'anthropic',
        'war-room': 'anthropic',
        'data-exchange': 'anthropic',
        'provider-hub': 'anthropic',
        'plugin-bay': 'anthropic',
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
              rooms.exitRoom({ roomId, agentId });
              bus.emit('room:agent:exited', { roomId, agentId, reason: 'disconnect' });
              cleanedRooms++;
            } catch (e) {
              log.warn({ agentId, roomId, err: e, socketId: socket.id }, 'Failed to exit room on disconnect');
            }
          }

          for (const agentId of assoc.agentIds) {
            try {
              agents.removeAgent(agentId);
              bus.emit('agent:status-changed', { agentId, status: 'removed', reason: 'disconnect' });
              cleanedAgents++;
            } catch (e) {
              log.warn({ agentId, err: e, socketId: socket.id }, 'Failed to remove agent on disconnect');
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

  const forward = (event: string) => bus.on(event, (data: Record<string, unknown>) => io.emit(event, data));

  forward('room:agent:entered');
  forward('room:agent:exited');
  forward('chat:response');
  forward('chat:stream');
  forward('tool:executed');
  forward('phase:advanced');
  forward('raid:entry:added');
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
  forward('todo:created');
  forward('todo:updated');
  forward('todo:assigned');
  forward('todo:deleted');
  forward('escalation:stale-gate');
  forward('escalation:war-room');
  forward('escalation:failed');
  forward('scope-change:detected');
  forward('system:log');
  forward('building:created');
  forward('building:onboarded');
  forward('building:onboard-failed');
  forward('phase:room-provisioned');
  forward('citation:added');
  forward('table:created');
  forward('table:updated');
  forward('table:deleted');
  forward('floor:created');
  forward('floor:updated');
  forward('floor:deleted');
  forward('floor:sorted');
  forward('room:updated');
  forward('room:deleted');

  log.info('Transport layer initialized');
  broadcastLog('info', 'Transport layer initialized', 'transport');
}
