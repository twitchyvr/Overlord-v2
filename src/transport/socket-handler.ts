/**
 * Transport Layer — Socket.IO Handler
 *
 * Maps socket events to bus events. Organized by domain.
 * Replaces v1's 137-handler hub.js with typed, domain-organized handlers.
 *
 * CRITICAL: Every socket.on handler is wrapped in try/catch to prevent
 * unhandled exceptions from crashing the server. Errors are logged and
 * returned to the client via the ack callback when available.
 *
 * All incoming payloads are validated with Zod schemas before processing.
 */

import { randomUUID } from 'crypto';
import { logger, broadcastLog } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI } from '../core/contracts.js';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { createBuilding, getBuilding, listBuildings, listFloors, getFloor } from '../rooms/building-manager.js';
import { getGates, canAdvance, signoffGate, createGate, getPendingGates, resolveConditions, getStalePendingGates, getPhaseOrder } from '../rooms/phase-gate.js';
import { searchRaid, addRaidEntry, updateRaidEntry, updateRaidStatus } from '../rooms/raid-log.js';
import { submitExitDocument } from '../rooms/room-manager.js';
import { getDb } from '../storage/db.js';
import { handleBlueprintSubmission } from '../rooms/phase-zero.js';
import { parseCommandText, dispatchCommand, handleMention, resolveReference, listCommands } from '../commands/index.js';
import type { CommandContext } from '../commands/index.js';

import {
  validate,
  BuildingCreateSchema, BuildingGetSchema, BuildingListSchema, BuildingApplyBlueprintSchema,
  FloorListSchema, FloorGetSchema,
  RoomCreateSchema, RoomGetSchema, RoomEnterSchema, RoomExitSchema,
  AgentRegisterSchema, AgentGetSchema, AgentListSchema,
  ChatMessageSchema,
  PhaseGatesSchema, PhaseCanAdvanceSchema, PhasePendingGatesSchema,
  PhaseResolveConditionsSchema, PhaseStaleGatesSchema, PhaseGateSignoffSchema, PhaseAdvanceSchema,
  RaidSearchSchema, RaidListSchema, RaidAddSchema, RaidUpdateSchema, RaidEditSchema,
  TaskCreateSchema, TaskUpdateSchema, TaskListSchema, TaskGetSchema,
  TodoCreateSchema, TodoToggleSchema, TodoListSchema, TodoDeleteSchema,
  ExitDocSubmitSchema, ExitDocGetSchema, ExitDocListSchema,
} from './schemas.js';

const log = logger.child({ module: 'transport' });

interface InitTransportParams {
  io: SocketIOServer;
  bus: Bus;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
}

/**
 * Build a safe error response envelope for ack callbacks.
 * Extracts a useful message from any thrown value without leaking stack traces.
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

export function initTransport({ io, bus, rooms, agents, tools }: InitTransportParams): void {
  io.on('connection', (socket: Socket) => {
    log.info({ id: socket.id }, 'Client connected');
    broadcastLog('info', `Client connected (${socket.id})`, 'transport');

    // ─── Building Events ───
    socket.on('building:create', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(BuildingCreateSchema, data, 'building:create', ack);
        if (!parsed) return;
        const result = createBuilding(parsed as Parameters<typeof createBuilding>[0]);
        if (result.ok) broadcastLog('info', `Building created: ${(result as { ok: true; data: { name: string } }).data.name}`, 'building');
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'building:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('building:create', e));
      }
    });

    socket.on('building:get', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(BuildingGetSchema, data, 'building:get', ack);
        if (!parsed) return;
        const result = getBuilding(parsed.buildingId);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'building:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('building:get', e));
      }
    });

    socket.on('building:list', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(BuildingListSchema, data, 'building:list', ack);
        if (!parsed) return;
        const result = listBuildings(parsed.projectId);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'building:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('building:list', e));
      }
    });

    socket.on('building:apply-blueprint', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(BuildingApplyBlueprintSchema, data, 'building:apply-blueprint', ack);
        if (!parsed) return;
        const result = handleBlueprintSubmission({
          buildingId: parsed.buildingId,
          blueprint: parsed.blueprint,
          agentId: parsed.agentId,
        });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'building:apply-blueprint', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('building:apply-blueprint', e));
      }
    });

    // Returning-user check: hasBuildings → dashboard, else → Strategist
    socket.on('system:status', (_data: unknown, ack?: (res: unknown) => void) => {
      try {
        const result = listBuildings();
        const buildings = result.ok ? (result.data as Array<{ id: string; name: string; active_phase: string }>) : [];
        if (ack) ack({
          ok: true,
          data: {
            isNewUser: buildings.length === 0,
            buildings: buildings.map((b) => ({ id: b.id, name: b.name, activePhase: b.active_phase })),
          },
        });
      } catch (e) {
        log.error({ event: 'system:status', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('system:status', e));
      }
    });

    // ─── Floor Events ───
    socket.on('floor:list', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(FloorListSchema, data, 'floor:list', ack);
        if (!parsed) return;
        const result = listFloors(parsed.buildingId);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'floor:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('floor:list', e));
      }
    });

    socket.on('floor:get', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(FloorGetSchema, data, 'floor:get', ack);
        if (!parsed) return;
        const result = getFloor(parsed.floorId);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'floor:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('floor:get', e));
      }
    });

    // ─── Room Events ───
    socket.on('room:create', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RoomCreateSchema, data, 'room:create', ack);
        if (!parsed) return;
        const result = rooms.createRoom(parsed as Parameters<typeof rooms.createRoom>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'room:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:create', e));
      }
    });

    socket.on('room:get', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RoomGetSchema, data, 'room:get', ack);
        if (!parsed) return;
        const room = rooms.getRoom(parsed.roomId);
        if (!room) {
          if (ack) ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: `Room ${parsed.roomId} does not exist`, retryable: false } });
          return;
        }
        if (ack) ack({
          ok: true,
          data: {
            id: room.id,
            type: room.type,
            tools: room.getAllowedTools(),
            fileScope: room.fileScope,
            exitRequired: room.exitRequired,
            escalation: room.escalation,
            tables: room.config.tables,
          },
        });
      } catch (e) {
        log.error({ event: 'room:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:get', e));
      }
    });

    socket.on('room:list', (_data: unknown, ack?: (res: unknown) => void) => {
      try {
        const result = rooms.listRooms();
        if (ack) ack({ ok: true, data: result });
      } catch (e) {
        log.error({ event: 'room:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:list', e));
      }
    });

    socket.on('room:enter', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RoomEnterSchema, data, 'room:enter', ack);
        if (!parsed) return;
        const result = rooms.enterRoom(parsed as Parameters<typeof rooms.enterRoom>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'room:enter', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:enter', e));
      }
    });

    socket.on('room:exit', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RoomExitSchema, data, 'room:exit', ack);
        if (!parsed) return;
        const result = rooms.exitRoom(parsed as Parameters<typeof rooms.exitRoom>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'room:exit', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:exit', e));
      }
    });

    // ─── Agent Events ───
    socket.on('agent:register', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(AgentRegisterSchema, data, 'agent:register', ack);
        if (!parsed) return;
        const result = agents.registerAgent(parsed as Parameters<typeof agents.registerAgent>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'agent:register', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('agent:register', e));
      }
    });

    socket.on('agent:get', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(AgentGetSchema, data, 'agent:get', ack);
        if (!parsed) return;
        const agent = agents.getAgent(parsed.agentId);
        if (!agent) {
          if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${parsed.agentId} does not exist`, retryable: false } });
          return;
        }
        if (ack) ack({ ok: true, data: agent });
      } catch (e) {
        log.error({ event: 'agent:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('agent:get', e));
      }
    });

    socket.on('agent:list', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(AgentListSchema, data, 'agent:list', ack);
        if (!parsed) return;
        const result = agents.listAgents(parsed as Parameters<typeof agents.listAgents>[0]);
        if (ack) ack({ ok: true, data: result });
      } catch (e) {
        log.error({ event: 'agent:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('agent:list', e));
      }
    });

    // ─── Command List (for frontend token input suggestions) ───
    socket.on('command:list', (_data: unknown, ack?: (res: unknown) => void) => {
      try {
        const commands = listCommands().map(cmd => ({
          id: cmd.name,
          name: cmd.name,
          description: cmd.description,
          usage: cmd.usage,
          aliases: cmd.aliases || [],
          scope: cmd.scope,
        }));
        if (ack) ack({ ok: true, data: commands });
      } catch (e) {
        log.error({ event: 'command:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('command:list', e));
      }
    });

    // ─── Chat Events (with command/mention/reference parsing) ───
    socket.on('chat:message', async (data: unknown) => {
      try {
        const parsed = validate(ChatMessageSchema, data, 'chat:message');
        if (!parsed) return;

        const { text, tokens, buildingId, roomId, agentId } = parsed;

        // 1. Check if message starts with '/' → dispatch as command
        const cmdParsed = parseCommandText(text);
        if (cmdParsed) {
          const ctx: CommandContext = {
            command: cmdParsed.command,
            args: cmdParsed.args,
            rawText: text,
            socketId: socket.id,
            buildingId,
            roomId,
            agentId,
            tokens,
            bus,
          };

          const result = await dispatchCommand(ctx);

          // Send command result back to the client
          if (!result.silent) {
            socket.emit('chat:response', {
              type: 'command',
              command: cmdParsed.command,
              ok: result.ok,
              response: result.response,
              data: result.data,
            });
          }

          // Commands are fully handled — don't forward to bus as a chat message
          return;
        }

        // 2. Process @mention tokens
        const mentionTokens = tokens.filter(t => t.type === 'agent' || t.char === '@');
        for (const token of mentionTokens) {
          try {
            const mentionCtx: CommandContext = {
              command: '',
              args: [],
              rawText: text,
              socketId: socket.id,
              buildingId,
              roomId,
              agentId,
              tokens,
              bus,
            };
            const mentionResult = await handleMention(token, mentionCtx);
            if (mentionResult.notified) {
              socket.emit('chat:response', {
                type: 'mention',
                agentId: mentionResult.agentId,
                response: mentionResult.response,
              });
            }
          } catch (mentionErr) {
            log.error({ event: 'chat:message', mentionErr, tokenId: token.id }, 'Mention processing failed');
          }
        }

        // 3. Process #reference tokens
        const refTokens = tokens.filter(t => t.type === 'reference' || t.char === '#');
        for (const token of refTokens) {
          try {
            const refCtx: CommandContext = {
              command: '',
              args: [],
              rawText: text,
              socketId: socket.id,
              buildingId,
              roomId,
              agentId,
              tokens,
              bus,
            };
            const refResult = await resolveReference(token, refCtx);
            if (refResult.resolved) {
              socket.emit('chat:response', {
                type: 'reference',
                target: refResult.target,
                content: refResult.content,
              });
            }
          } catch (refErr) {
            log.error({ event: 'chat:message', refErr, tokenId: token.id }, 'Reference resolution failed');
          }
        }

        // 4. Regular message — forward to bus as before
        bus.emit('chat:message', { socketId: socket.id, ...parsed });
      } catch (e) {
        log.error({ event: 'chat:message', err: e, socketId: socket.id }, 'Handler threw');
      }
    });

    // ─── Phase Events ───
    socket.on('phase:status', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        bus.emit('phase:status', { socketId: socket.id, ...(data as Record<string, unknown>) });
        if (ack) ack({ ok: true });
      } catch (e) {
        log.error({ event: 'phase:status', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:status', e));
      }
    });

    socket.on('phase:gate', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        bus.emit('phase:gate', { socketId: socket.id, ...(data as Record<string, unknown>) });
        if (ack) ack({ ok: true });
      } catch (e) {
        log.error({ event: 'phase:gate', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:gate', e));
      }
    });

    socket.on('phase:gates', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(PhaseGatesSchema, data, 'phase:gates', ack);
        if (!parsed) return;
        const result = getGates(parsed.buildingId);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:gates', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:gates', e));
      }
    });

    socket.on('phase:can-advance', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(PhaseCanAdvanceSchema, data, 'phase:can-advance', ack);
        if (!parsed) return;
        const result = canAdvance(parsed.buildingId);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:can-advance', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:can-advance', e));
      }
    });

    socket.on('phase:pending-gates', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(PhasePendingGatesSchema, data, 'phase:pending-gates', ack);
        if (!parsed) return;
        const result = getPendingGates(parsed.buildingId);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:pending-gates', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:pending-gates', e));
      }
    });

    socket.on('phase:resolve-conditions', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(PhaseResolveConditionsSchema, data, 'phase:resolve-conditions', ack);
        if (!parsed) return;
        const result = resolveConditions({
          gateId: parsed.gateId,
          resolvedConditions: parsed.resolvedConditions,
          resolver: parsed.resolver,
        });
        if (result.ok) {
          const resultData = result.data as Record<string, unknown>;
          if (resultData.verdict === 'GO') {
            // All conditions resolved — gate advanced
            bus.emit('phase:gate:signed-off', resultData);
            bus.emit('phase:advanced', resultData);
          } else {
            bus.emit('phase:conditions:resolved', { gateId: parsed.gateId, ...resultData });
          }
        }
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:resolve-conditions', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:resolve-conditions', e));
      }
    });

    socket.on('phase:stale-gates', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(PhaseStaleGatesSchema, data, 'phase:stale-gates', ack);
        if (!parsed) return;
        const thresholdMs = parsed.thresholdMs || 30 * 60 * 1000;
        const result = getStalePendingGates(thresholdMs);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:stale-gates', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:stale-gates', e));
      }
    });

    socket.on('phase:order', (_data: unknown, ack?: (res: unknown) => void) => {
      try {
        if (ack) ack({ ok: true, data: getPhaseOrder() });
      } catch (e) {
        log.error({ event: 'phase:order', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:order', e));
      }
    });

    // ─── RAID Events ───
    socket.on('raid:search', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RaidSearchSchema, data, 'raid:search', ack);
        if (!parsed) return;
        const result = searchRaid(parsed as Parameters<typeof searchRaid>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:search', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack({ ok: false, error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    socket.on('raid:list', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RaidListSchema, data, 'raid:list', ack);
        if (!parsed) return;
        const result = searchRaid({ buildingId: parsed.buildingId });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('raid:list', e));
      }
    });

    socket.on('raid:add', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RaidAddSchema, data, 'raid:add', ack);
        if (!parsed) return;
        const result = addRaidEntry(parsed as Parameters<typeof addRaidEntry>[0]);
        bus.emit('raid:entry:added', { ...(result.ok ? result.data as Record<string, unknown> : {}), ...parsed });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:add', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('raid:add', e));
      }
    });

    socket.on('raid:update', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RaidUpdateSchema, data, 'raid:update', ack);
        if (!parsed) return;
        const result = updateRaidStatus({ id: parsed.id, status: parsed.status });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:update', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('raid:update', e));
      }
    });

    socket.on('raid:edit', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(RaidEditSchema, data, 'raid:edit', ack);
        if (!parsed) return;
        const result = updateRaidEntry({
          id: parsed.id,
          summary: parsed.summary,
          rationale: parsed.rationale,
          decidedBy: parsed.decidedBy,
          affectedAreas: parsed.affectedAreas,
        });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:edit', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('raid:edit', e));
      }
    });

    // ─── Task Events ───
    socket.on('task:create', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TaskCreateSchema, data, 'task:create', ack);
        if (!parsed) return;

        const db = getDb();
        const id = randomUUID();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO tasks (id, building_id, title, description, status, parent_id, milestone_id, assignee_id, room_id, phase, priority, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?))
        `).run(
          id,
          parsed.buildingId,
          parsed.title,
          parsed.description || null,
          parsed.status,
          parsed.parentId || null,
          parsed.milestoneId || null,
          parsed.assigneeId || null,
          parsed.roomId || null,
          parsed.phase || null,
          parsed.priority,
          now,
          now,
        );

        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        log.info({ id, buildingId: parsed.buildingId, title: parsed.title }, 'Task created');
        broadcastLog('info', `Task created: ${parsed.title}`, 'tasks');
        bus.emit('task:created', task as Record<string, unknown>);
        if (ack) ack({ ok: true, data: task });
      } catch (e) {
        log.error({ event: 'task:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('task:create', e));
      }
    });

    socket.on('task:update', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TaskUpdateSchema, data, 'task:update', ack);
        if (!parsed) return;

        const db = getDb();
        const taskId = parsed.id;

        const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
        if (!existing) {
          if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${taskId} does not exist`, retryable: false } });
          return;
        }

        const fields: string[] = [];
        const values: unknown[] = [];

        const updatable = ['title', 'description', 'status', 'parentId', 'milestoneId', 'assigneeId', 'roomId', 'phase', 'priority'] as const;
        const columnMap: Record<string, string> = {
          title: 'title', description: 'description', status: 'status',
          parentId: 'parent_id', milestoneId: 'milestone_id', assigneeId: 'assignee_id',
          roomId: 'room_id', phase: 'phase', priority: 'priority',
        };

        for (const key of updatable) {
          if (parsed[key] !== undefined) {
            fields.push(`${columnMap[key]} = ?`);
            values.push(parsed[key]);
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
      } catch (e) {
        log.error({ event: 'task:update', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('task:update', e));
      }
    });

    socket.on('task:list', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TaskListSchema, data, 'task:list', ack);
        if (!parsed) return;

        const db = getDb();
        let sql = 'SELECT * FROM tasks WHERE building_id = ?';
        const params: unknown[] = [parsed.buildingId];

        if (parsed.status) { sql += ' AND status = ?'; params.push(parsed.status); }
        if (parsed.phase) { sql += ' AND phase = ?'; params.push(parsed.phase); }
        if (parsed.assigneeId) { sql += ' AND assignee_id = ?'; params.push(parsed.assigneeId); }

        sql += ' ORDER BY created_at DESC';

        const tasks = db.prepare(sql).all(...params);
        if (ack) ack({ ok: true, data: tasks });
      } catch (e) {
        log.error({ event: 'task:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('task:list', e));
      }
    });

    socket.on('task:get', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TaskGetSchema, data, 'task:get', ack);
        if (!parsed) return;

        const db = getDb();
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parsed.id);
        if (!task) {
          if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${parsed.id} does not exist`, retryable: false } });
          return;
        }

        // Also fetch associated todos
        const todos = db.prepare('SELECT * FROM todos WHERE task_id = ? ORDER BY created_at').all(parsed.id);
        if (ack) ack({ ok: true, data: { ...(task as Record<string, unknown>), todos } });
      } catch (e) {
        log.error({ event: 'task:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('task:get', e));
      }
    });

    // ─── TODO Events ───
    socket.on('todo:create', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TodoCreateSchema, data, 'todo:create', ack);
        if (!parsed) return;

        const db = getDb();
        const id = randomUUID();
        const now = new Date().toISOString();

        // Verify parent task exists
        const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(parsed.taskId);
        if (!task) {
          if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Parent task ${parsed.taskId} does not exist`, retryable: false } });
          return;
        }

        db.prepare(`
          INSERT INTO todos (id, task_id, agent_id, room_id, description, status, exit_doc_ref, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime(?))
        `).run(
          id,
          parsed.taskId,
          parsed.agentId || null,
          parsed.roomId || null,
          parsed.description,
          parsed.status,
          parsed.exitDocRef || null,
          now,
        );

        const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
        log.info({ id, taskId: parsed.taskId, description: parsed.description }, 'TODO created');
        bus.emit('todo:created', todo);
        if (ack) ack({ ok: true, data: todo });
      } catch (e) {
        log.error({ event: 'todo:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('todo:create', e));
      }
    });

    socket.on('todo:toggle', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TodoToggleSchema, data, 'todo:toggle', ack);
        if (!parsed) return;

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
        bus.emit('todo:updated', todo);
        if (ack) ack({ ok: true, data: todo });
      } catch (e) {
        log.error({ event: 'todo:toggle', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('todo:toggle', e));
      }
    });

    socket.on('todo:list', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TodoListSchema, data, 'todo:list', ack);
        if (!parsed) return;

        const db = getDb();
        const todos = db.prepare('SELECT * FROM todos WHERE task_id = ? ORDER BY created_at').all(parsed.taskId);
        if (ack) ack({ ok: true, data: todos });
      } catch (e) {
        log.error({ event: 'todo:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('todo:list', e));
      }
    });

    socket.on('todo:delete', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(TodoDeleteSchema, data, 'todo:delete', ack);
        if (!parsed) return;

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
      } catch (e) {
        log.error({ event: 'todo:delete', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('todo:delete', e));
      }
    });

    // ─── Exit Document Events ───
    socket.on('exit-doc:submit', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(ExitDocSubmitSchema, data, 'exit-doc:submit', ack);
        if (!parsed) return;
        const result = submitExitDocument({
          roomId: parsed.roomId,
          agentId: parsed.agentId,
          document: parsed.document,
          buildingId: parsed.buildingId,
          phase: parsed.phase,
        });
        bus.emit('exit-doc:submitted', {
          roomId: parsed.roomId,
          roomType: parsed.roomType,
          buildingId: parsed.buildingId,
          agentId: parsed.agentId,
          document: parsed.document,
          ...(result.ok ? result.data as Record<string, unknown> : {}),
        });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'exit-doc:submit', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('exit-doc:submit', e));
      }
    });

    socket.on('exit-doc:get', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(ExitDocGetSchema, data, 'exit-doc:get', ack);
        if (!parsed) return;
        const db = getDb();
        const docs = db.prepare(
          'SELECT * FROM exit_documents WHERE room_id = ? ORDER BY created_at DESC'
        ).all(parsed.roomId);
        if (ack) ack({ ok: true, data: docs });
      } catch (e) {
        log.error({ event: 'exit-doc:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('exit-doc:get', e));
      }
    });

    socket.on('exit-doc:list', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(ExitDocListSchema, data, 'exit-doc:list', ack);
        if (!parsed) return;
        const db = getDb();
        // Join through rooms → floors → building to get exit docs by building
        const docs = db.prepare(`
          SELECT ed.* FROM exit_documents ed
          JOIN rooms r ON ed.room_id = r.id
          JOIN floors f ON r.floor_id = f.id
          WHERE f.building_id = ?
          ORDER BY ed.created_at DESC
        `).all(parsed.buildingId);
        if (ack) ack({ ok: true, data: docs });
      } catch (e) {
        log.error({ event: 'exit-doc:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('exit-doc:list', e));
      }
    });

    // ─── Phase Gate Events ───
    socket.on('phase:gate:signoff', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(PhaseGateSignoffSchema, data, 'phase:gate:signoff', ack);
        if (!parsed) return;
        const result = signoffGate({
          gateId: parsed.gateId,
          reviewer: parsed.reviewer,
          verdict: parsed.verdict,
          conditions: parsed.conditions,
          exitDocId: parsed.exitDocId,
          nextPhaseInput: parsed.nextPhaseInput,
        });
        if (result.ok) {
          bus.emit('phase:gate:signed-off', result.data as Record<string, unknown>);
        }
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:gate:signoff', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:gate:signoff', e));
      }
    });

    socket.on('phase:advance', (data: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = validate(PhaseAdvanceSchema, data, 'phase:advance', ack);
        if (!parsed) return;
        const buildingId = parsed.buildingId;

        // Check if advancement is allowed
        const advanceCheck = canAdvance(buildingId);
        if (!advanceCheck.ok) {
          if (ack) ack(advanceCheck);
          return;
        }

        const advanceData = advanceCheck.data as { canAdvance: boolean; currentPhase?: string; nextPhase?: string; reason?: string };
        if (!advanceData.canAdvance) {
          if (ack) ack({ ok: false, error: { code: 'CANNOT_ADVANCE', message: advanceData.reason || 'Phase advancement not allowed', retryable: false } });
          return;
        }

        // Create a new gate for the current phase and immediately sign it off as GO
        const gateResult = createGate({ buildingId, phase: advanceData.currentPhase as string });
        if (!gateResult.ok) {
          if (ack) ack(gateResult);
          return;
        }

        const gateData = gateResult.data as { id: string };
        const signoffResult = signoffGate({
          gateId: gateData.id,
          reviewer: parsed.reviewer || 'system',
          verdict: 'GO',
          conditions: [],
          nextPhaseInput: parsed.nextPhaseInput,
        });

        if (signoffResult.ok) {
          broadcastLog('info', `Phase advanced: ${advanceData.currentPhase} → ${advanceData.nextPhase}`, 'phase');
          bus.emit('phase:advanced', {
            buildingId,
            from: advanceData.currentPhase,
            to: advanceData.nextPhase,
            gateId: gateData.id,
          });
          bus.emit('building:updated', {
            id: buildingId,
            activePhase: advanceData.nextPhase,
          });
        }

        if (ack) ack(signoffResult);
      } catch (e) {
        log.error({ event: 'phase:advance', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:advance', e));
      }
    });

    // ─── System Events ───
    socket.on('system:health', (_data: unknown, ack?: (res: unknown) => void) => {
      try {
        if (ack) ack({ ok: true, data: { uptime: process.uptime(), version: '0.1.0' } });
      } catch (e) {
        log.error({ event: 'system:health', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('system:health', e));
      }
    });

    socket.on('disconnect', () => {
      try {
        log.info({ id: socket.id }, 'Client disconnected');
        broadcastLog('info', `Client disconnected (${socket.id})`, 'transport');
      } catch (e) {
        // Last resort — disconnect handler should never crash the server
        log.error({ err: e, socketId: socket.id }, 'Disconnect handler threw');
      }
    });
  });

  // ─── Bus → Socket broadcasts ───
  bus.on('room:agent:entered', (data: Record<string, unknown>) => io.emit('room:agent:entered', data));
  bus.on('room:agent:exited', (data: Record<string, unknown>) => io.emit('room:agent:exited', data));
  bus.on('chat:response', (data: Record<string, unknown>) => io.emit('chat:response', data));
  bus.on('chat:stream', (data: Record<string, unknown>) => io.emit('chat:stream', data));
  bus.on('tool:executed', (data: Record<string, unknown>) => io.emit('tool:executed', data));
  bus.on('phase:advanced', (data: Record<string, unknown>) => io.emit('phase:advanced', data));
  bus.on('raid:entry:added', (data: Record<string, unknown>) => io.emit('raid:entry:added', data));
  bus.on('phase-zero:complete', (data: Record<string, unknown>) => io.emit('phase-zero:complete', data));
  bus.on('phase-zero:failed', (data: Record<string, unknown>) => io.emit('phase-zero:failed', data));
  bus.on('exit-doc:submitted', (data: Record<string, unknown>) => io.emit('exit-doc:submitted', data));
  bus.on('scope-change:detected', (data: Record<string, unknown>) => io.emit('scope-change:detected', data));
  bus.on('agent:mentioned', (data: Record<string, unknown>) => io.emit('agent:mentioned', data));
  bus.on('agent:status-changed', (data: Record<string, unknown>) => io.emit('agent:status-changed', data));
  bus.on('building:updated', (data: Record<string, unknown>) => io.emit('building:updated', data));
  bus.on('deploy:check', (data: Record<string, unknown>) => io.emit('deploy:check', data));
  bus.on('task:created', (data: Record<string, unknown>) => io.emit('task:created', data));
  bus.on('task:updated', (data: Record<string, unknown>) => io.emit('task:updated', data));
  bus.on('phase:gate:signed-off', (data: Record<string, unknown>) => io.emit('phase:gate:signed-off', data));
  bus.on('phase:conditions:resolved', (data: Record<string, unknown>) => io.emit('phase:conditions:resolved', data));
  bus.on('todo:created', (data: Record<string, unknown>) => io.emit('todo:created', data));
  bus.on('todo:updated', (data: Record<string, unknown>) => io.emit('todo:updated', data));
  bus.on('todo:deleted', (data: Record<string, unknown>) => io.emit('todo:deleted', data));
  bus.on('system:log', (data: Record<string, unknown>) => io.emit('system:log', data));

  log.info('Transport layer initialized');
  broadcastLog('info', 'Transport layer initialized', 'transport');
}
