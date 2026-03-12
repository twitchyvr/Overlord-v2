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
import type { z } from 'zod';

import {
  validate,
  BuildingCreateSchema, BuildingGetSchema, BuildingListSchema, BuildingApplyBlueprintSchema,
  FloorListSchema, FloorGetSchema,
  RoomCreateSchema, RoomGetSchema, RoomEnterSchema, RoomExitSchema,
  AgentRegisterSchema, AgentGetSchema, AgentListSchema,
  ChatMessageSchema,
  EmptyPayloadSchema, PhaseStatusSchema, PhaseGateSchema,
  PhaseGatesSchema, PhaseCanAdvanceSchema, PhasePendingGatesSchema,
  PhaseResolveConditionsSchema, PhaseStaleGatesSchema, PhaseGateSignoffSchema, PhaseAdvanceSchema,
  RaidSearchSchema, RaidListSchema, RaidAddSchema, RaidUpdateSchema, RaidEditSchema,
  TaskCreateSchema, TaskUpdateSchema, TaskListSchema, TaskGetSchema,
  TodoCreateSchema, TodoToggleSchema, TodoListSchema, TodoDeleteSchema,
  ExitDocSubmitSchema, ExitDocGetSchema, ExitDocListSchema,
} from './schemas.js';

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
 */
function handle<T>(
  socket: Socket,
  event: string,
  schema: z.ZodSchema<T> | null,
  handler: (parsed: T, ack?: Ack) => void | Promise<void>,
): void {
  socket.on(event, async (data: unknown, ack?: Ack) => {
    try {
      if (schema) {
        const parsed = validate(schema, data, event, ack);
        if (!parsed) return;
        await handler(parsed, ack);
      } else {
        await handler(data as T, ack);
      }
    } catch (e) {
      log.error({ event, err: e, socketId: socket.id }, 'Handler threw');
      if (ack) ack(errorResponse(event, e));
    }
  });
}

// ─── Main transport initialization ───

export function initTransport({ io, bus, rooms, agents, tools }: InitTransportParams): void {
  io.on('connection', (socket: Socket) => {
    log.info({ id: socket.id }, 'Client connected');
    broadcastLog('info', `Client connected (${socket.id})`, 'transport');

    // ─── Building Events ───

    handle(socket, 'building:create', BuildingCreateSchema, (parsed, ack) => {
      const result = createBuilding(parsed as Parameters<typeof createBuilding>[0]);
      if (result.ok) broadcastLog('info', `Building created: ${(result as { ok: true; data: { name: string } }).data.name}`, 'building');
      if (ack) ack(result);
    });

    handle(socket, 'building:get', BuildingGetSchema, (parsed, ack) => {
      if (ack) ack(getBuilding(parsed.buildingId));
    });

    handle(socket, 'building:list', BuildingListSchema, (parsed, ack) => {
      if (ack) ack(listBuildings(parsed.projectId));
    });

    handle(socket, 'building:apply-blueprint', BuildingApplyBlueprintSchema, (parsed, ack) => {
      const result = handleBlueprintSubmission({
        buildingId: parsed.buildingId,
        blueprint: parsed.blueprint,
        agentId: parsed.agentId,
      });
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

    // ─── Agent Events ───

    handle(socket, 'agent:register', AgentRegisterSchema, (parsed, ack) => {
      const result = agents.registerAgent(parsed as Parameters<typeof agents.registerAgent>[0]);
      if (result.ok) {
        const agentId = (result.data as { id: string }).id;
        getAssociations(socket.id).agentIds.add(agentId);
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
      const { text, tokens, buildingId, roomId, agentId } = parsed;

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

      // 3. Process #reference tokens
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
      if (ack) ack(getPendingGates(parsed.buildingId));
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
      if (ack) ack(getStalePendingGates(parsed.thresholdMs || 30 * 60 * 1000));
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
      const result = addRaidEntry(parsed as Parameters<typeof addRaidEntry>[0]);
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

      db.prepare(`
        INSERT INTO tasks (id, building_id, title, description, status, parent_id, milestone_id, assignee_id, room_id, phase, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?))
      `).run(
        id, parsed.buildingId, parsed.title, parsed.description || null,
        parsed.status, parsed.parentId || null, parsed.milestoneId || null,
        parsed.assigneeId || null, parsed.roomId || null, parsed.phase || null,
        parsed.priority, now, now,
      );

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      log.info({ id, buildingId: parsed.buildingId, title: parsed.title }, 'Task created');
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
        roomId: 'room_id', phase: 'phase', priority: 'priority',
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
      bus.emit('todo:created', todo);
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
      bus.emit('todo:updated', todo);
      if (ack) ack({ ok: true, data: todo });
    });

    handle(socket, 'todo:list', TodoListSchema, (parsed, ack) => {
      const db = getDb();
      if (ack) ack({ ok: true, data: db.prepare('SELECT * FROM todos WHERE task_id = ? ORDER BY created_at').all(parsed.taskId) });
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

    // ─── Exit Document Events ───

    handle(socket, 'exit-doc:submit', ExitDocSubmitSchema, (parsed, ack) => {
      const result = submitExitDocument({
        roomId: parsed.roomId, agentId: parsed.agentId,
        document: parsed.document, buildingId: parsed.buildingId, phase: parsed.phase,
      });
      bus.emit('exit-doc:submitted', {
        roomId: parsed.roomId, roomType: parsed.roomType,
        buildingId: parsed.buildingId, agentId: parsed.agentId,
        document: parsed.document,
        ...(result.ok ? result.data as Record<string, unknown> : {}),
      });
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

    // ─── Phase Gate Events ───

    handle(socket, 'phase:gate:signoff', PhaseGateSignoffSchema, (parsed, ack) => {
      const result = signoffGate({
        gateId: parsed.gateId, reviewer: parsed.reviewer, verdict: parsed.verdict,
        conditions: parsed.conditions, exitDocId: parsed.exitDocId, nextPhaseInput: parsed.nextPhaseInput,
      });
      if (result.ok) {
        bus.emit('phase:gate:signed-off', result.data as Record<string, unknown>);
      }
      if (ack) ack(result);
    });

    handle(socket, 'phase:advance', PhaseAdvanceSchema, (parsed, ack) => {
      const buildingId = parsed.buildingId;

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

      const gateResult = createGate({ buildingId, phase: advanceData.currentPhase as string });
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
        broadcastLog('info', `Phase advanced: ${advanceData.currentPhase} → ${advanceData.nextPhase}`, 'phase');
        bus.emit('phase:advanced', {
          buildingId, from: advanceData.currentPhase, to: advanceData.nextPhase, gateId: gateData.id,
        });
        bus.emit('building:updated', { id: buildingId, activePhase: advanceData.nextPhase });
      }

      if (ack) ack(signoffResult);
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
  forward('building:updated');
  forward('deploy:check');
  forward('task:created');
  forward('task:updated');
  forward('phase:gate:signed-off');
  forward('phase:conditions:resolved');
  forward('todo:created');
  forward('todo:updated');
  forward('todo:deleted');
  forward('system:log');

  log.info('Transport layer initialized');
  broadcastLog('info', 'Transport layer initialized', 'transport');
}
