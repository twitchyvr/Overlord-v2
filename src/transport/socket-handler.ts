/**
 * Transport Layer — Socket.IO Handler
 *
 * Maps socket events to bus events. Organized by domain.
 * Replaces v1's 137-handler hub.js with typed, domain-organized handlers.
 *
 * CRITICAL: Every socket.on handler is wrapped in try/catch to prevent
 * unhandled exceptions from crashing the server. Errors are logged and
 * returned to the client via the ack callback when available.
 */

import { randomUUID } from 'crypto';
import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI } from '../core/contracts.js';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { createBuilding, getBuilding, listBuildings, listFloors, getFloor } from '../rooms/building-manager.js';
import { getGates, canAdvance, signoffGate, createGate, getPendingGates, resolveConditions, getStalePendingGates, getPhaseOrder } from '../rooms/phase-gate.js';
import { searchRaid, addRaidEntry, updateRaidStatus } from '../rooms/raid-log.js';
import { submitExitDocument } from '../rooms/room-manager.js';
import { getDb } from '../storage/db.js';
import { handleBlueprintSubmission } from '../rooms/phase-zero.js';
import { parseCommandText, dispatchCommand, handleMention, resolveReference, listCommands } from '../commands/index.js';
import type { ParsedToken, CommandContext } from '../commands/index.js';

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

    // ─── Building Events ───
    socket.on('building:create', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = createBuilding(data as unknown as Parameters<typeof createBuilding>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'building:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('building:create', e));
      }
    });

    socket.on('building:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = getBuilding(data.buildingId as string);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'building:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('building:get', e));
      }
    });

    socket.on('building:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = listBuildings(data.projectId as string | undefined);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'building:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('building:list', e));
      }
    });

    socket.on('building:apply-blueprint', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = handleBlueprintSubmission({
          buildingId: data.buildingId as string,
          blueprint: data.blueprint as Record<string, unknown>,
          agentId: data.agentId as string,
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
    socket.on('floor:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = listFloors(data.buildingId as string);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'floor:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('floor:list', e));
      }
    });

    socket.on('floor:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = getFloor(data.floorId as string);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'floor:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('floor:get', e));
      }
    });

    // ─── Room Events ───
    socket.on('room:create', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = rooms.createRoom(data as Parameters<typeof rooms.createRoom>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'room:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:create', e));
      }
    });

    socket.on('room:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const room = rooms.getRoom(data.roomId as string);
        if (!room) {
          if (ack) ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: `Room ${data.roomId} does not exist`, retryable: false } });
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

    socket.on('room:enter', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = rooms.enterRoom(data as Parameters<typeof rooms.enterRoom>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'room:enter', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:enter', e));
      }
    });

    socket.on('room:exit', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = rooms.exitRoom(data as Parameters<typeof rooms.exitRoom>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'room:exit', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('room:exit', e));
      }
    });

    // ─── Agent Events ───
    socket.on('agent:register', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = agents.registerAgent(data as Parameters<typeof agents.registerAgent>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'agent:register', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('agent:register', e));
      }
    });

    socket.on('agent:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const agent = agents.getAgent(data.agentId as string);
        if (!agent) {
          if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${data.agentId} does not exist`, retryable: false } });
          return;
        }
        if (ack) ack({ ok: true, data: agent });
      } catch (e) {
        log.error({ event: 'agent:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('agent:get', e));
      }
    });

    socket.on('agent:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = agents.listAgents(data as Parameters<typeof agents.listAgents>[0]);
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
    socket.on('chat:message', async (data: Record<string, unknown>) => {
      try {
        const text = (data.text as string) || '';
        const tokens = (data.tokens as ParsedToken[]) || [];

        // 1. Check if message starts with '/' → dispatch as command
        const parsed = parseCommandText(text);
        if (parsed) {
          const ctx: CommandContext = {
            command: parsed.command,
            args: parsed.args,
            rawText: text,
            socketId: socket.id,
            buildingId: data.buildingId as string | undefined,
            roomId: data.roomId as string | undefined,
            agentId: data.agentId as string | undefined,
            tokens,
            bus,
          };

          const result = await dispatchCommand(ctx);

          // Send command result back to the client
          if (!result.silent) {
            socket.emit('chat:response', {
              type: 'command',
              command: parsed.command,
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
              buildingId: data.buildingId as string | undefined,
              roomId: data.roomId as string | undefined,
              agentId: data.agentId as string | undefined,
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
              buildingId: data.buildingId as string | undefined,
              roomId: data.roomId as string | undefined,
              agentId: data.agentId as string | undefined,
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
        bus.emit('chat:message', { socketId: socket.id, ...data });
      } catch (e) {
        log.error({ event: 'chat:message', err: e, socketId: socket.id }, 'Handler threw');
      }
    });

    // ─── Phase Events ───
    socket.on('phase:status', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        bus.emit('phase:status', { socketId: socket.id, ...data });
        if (ack) ack({ ok: true });
      } catch (e) {
        log.error({ event: 'phase:status', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:status', e));
      }
    });

    socket.on('phase:gate', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        bus.emit('phase:gate', { socketId: socket.id, ...data });
        if (ack) ack({ ok: true });
      } catch (e) {
        log.error({ event: 'phase:gate', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:gate', e));
      }
    });

    socket.on('phase:gates', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = getGates(data.buildingId as string);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:gates', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:gates', e));
      }
    });

    socket.on('phase:can-advance', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = canAdvance(data.buildingId as string);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:can-advance', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:can-advance', e));
      }
    });

    socket.on('phase:pending-gates', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = getPendingGates(data.buildingId as string | undefined);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:pending-gates', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:pending-gates', e));
      }
    });

    socket.on('phase:resolve-conditions', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = resolveConditions({
          gateId: data.gateId as string,
          resolvedConditions: (data.resolvedConditions as string[]) || [],
          resolver: (data.resolver as string) || 'system',
        });
        if (result.ok) {
          const resultData = result.data as Record<string, unknown>;
          if (resultData.verdict === 'GO') {
            // All conditions resolved — gate advanced
            bus.emit('phase:gate:signed-off', resultData);
            bus.emit('phase:advanced', resultData);
          } else {
            bus.emit('phase:conditions:resolved', { gateId: data.gateId, ...resultData });
          }
        }
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'phase:resolve-conditions', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('phase:resolve-conditions', e));
      }
    });

    socket.on('phase:stale-gates', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const thresholdMs = (data.thresholdMs as number) || 30 * 60 * 1000;
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
    socket.on('raid:search', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = searchRaid(data as unknown as Parameters<typeof searchRaid>[0]);
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:search', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack({ ok: false, error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e), retryable: false } });
      }
    });

    socket.on('raid:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = searchRaid({ buildingId: data.buildingId as string });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('raid:list', e));
      }
    });

    socket.on('raid:add', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = addRaidEntry(data as unknown as Parameters<typeof addRaidEntry>[0]);
        bus.emit('raid:entry:added', { ...(result.ok ? result.data as Record<string, unknown> : {}), ...data });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:add', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('raid:add', e));
      }
    });

    socket.on('raid:update', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = updateRaidStatus({ id: data.id as string, status: data.status as string });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'raid:update', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('raid:update', e));
      }
    });

    // ─── Task Events ───
    socket.on('task:create', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const id = randomUUID();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO tasks (id, building_id, title, description, status, parent_id, milestone_id, assignee_id, room_id, phase, priority, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?))
        `).run(
          id,
          data.buildingId as string,
          data.title as string,
          (data.description as string) || null,
          (data.status as string) || 'pending',
          (data.parentId as string) || null,
          (data.milestoneId as string) || null,
          (data.assigneeId as string) || null,
          (data.roomId as string) || null,
          (data.phase as string) || null,
          (data.priority as string) || 'normal',
          now,
          now,
        );

        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        log.info({ id, buildingId: data.buildingId, title: data.title }, 'Task created');
        bus.emit('task:created', task as Record<string, unknown>);
        if (ack) ack({ ok: true, data: task });
      } catch (e) {
        log.error({ event: 'task:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('task:create', e));
      }
    });

    socket.on('task:update', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const taskId = data.id as string;

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
          if (key in data) {
            fields.push(`${columnMap[key]} = ?`);
            values.push(data[key] as unknown);
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

    socket.on('task:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const buildingId = data.buildingId as string;

        let sql = 'SELECT * FROM tasks WHERE building_id = ?';
        const params: unknown[] = [buildingId];

        if (data.status) { sql += ' AND status = ?'; params.push(data.status as string); }
        if (data.phase) { sql += ' AND phase = ?'; params.push(data.phase as string); }
        if (data.assigneeId) { sql += ' AND assignee_id = ?'; params.push(data.assigneeId as string); }

        sql += ' ORDER BY created_at DESC';

        const tasks = db.prepare(sql).all(...params);
        if (ack) ack({ ok: true, data: tasks });
      } catch (e) {
        log.error({ event: 'task:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('task:list', e));
      }
    });

    socket.on('task:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(data.id as string);
        if (!task) {
          if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task ${data.id} does not exist`, retryable: false } });
          return;
        }

        // Also fetch associated todos
        const todos = db.prepare('SELECT * FROM todos WHERE task_id = ? ORDER BY created_at').all(data.id as string);
        if (ack) ack({ ok: true, data: { ...(task as Record<string, unknown>), todos } });
      } catch (e) {
        log.error({ event: 'task:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('task:get', e));
      }
    });

    // ─── TODO Events ───
    socket.on('todo:create', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const id = randomUUID();
        const now = new Date().toISOString();

        // Verify parent task exists
        const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(data.taskId as string);
        if (!task) {
          if (ack) ack({ ok: false, error: { code: 'TASK_NOT_FOUND', message: `Parent task ${data.taskId} does not exist`, retryable: false } });
          return;
        }

        db.prepare(`
          INSERT INTO todos (id, task_id, agent_id, room_id, description, status, exit_doc_ref, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime(?))
        `).run(
          id,
          data.taskId as string,
          (data.agentId as string) || null,
          (data.roomId as string) || null,
          data.description as string,
          (data.status as string) || 'pending',
          (data.exitDocRef as string) || null,
          now,
        );

        const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
        log.info({ id, taskId: data.taskId, description: data.description }, 'TODO created');
        if (ack) ack({ ok: true, data: todo });
      } catch (e) {
        log.error({ event: 'todo:create', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('todo:create', e));
      }
    });

    socket.on('todo:toggle', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const todoId = data.id as string;

        const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as Record<string, unknown> | undefined;
        if (!existing) {
          if (ack) ack({ ok: false, error: { code: 'TODO_NOT_FOUND', message: `TODO ${todoId} does not exist`, retryable: false } });
          return;
        }

        const currentStatus = existing.status as string;
        const newStatus = currentStatus === 'done' ? 'pending' : 'done';
        const completedAt = newStatus === 'done' ? new Date().toISOString() : null;

        db.prepare("UPDATE todos SET status = ?, completed_at = datetime(?) WHERE id = ?")
          .run(newStatus, completedAt, todoId);

        const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId);
        log.info({ todoId, from: currentStatus, to: newStatus }, 'TODO toggled');
        if (ack) ack({ ok: true, data: todo });
      } catch (e) {
        log.error({ event: 'todo:toggle', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('todo:toggle', e));
      }
    });

    socket.on('todo:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const todos = db.prepare('SELECT * FROM todos WHERE task_id = ? ORDER BY created_at').all(data.taskId as string);
        if (ack) ack({ ok: true, data: todos });
      } catch (e) {
        log.error({ event: 'todo:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('todo:list', e));
      }
    });

    // ─── Exit Document Events ───
    socket.on('exit-doc:submit', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = submitExitDocument({
          roomId: data.roomId as string,
          agentId: data.agentId as string,
          document: (data.document as Record<string, unknown>) || {},
          buildingId: data.buildingId as string | undefined,
          phase: data.phase as string | undefined,
        });
        bus.emit('exit-doc:submitted', {
          roomId: data.roomId as string,
          roomType: data.roomType as string,
          buildingId: data.buildingId as string,
          agentId: data.agentId as string,
          document: data.document,
          ...(result.ok ? result.data as Record<string, unknown> : {}),
        });
        if (ack) ack(result);
      } catch (e) {
        log.error({ event: 'exit-doc:submit', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('exit-doc:submit', e));
      }
    });

    socket.on('exit-doc:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        const docs = db.prepare(
          'SELECT * FROM exit_documents WHERE room_id = ? ORDER BY created_at DESC'
        ).all(data.roomId as string);
        if (ack) ack({ ok: true, data: docs });
      } catch (e) {
        log.error({ event: 'exit-doc:get', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('exit-doc:get', e));
      }
    });

    socket.on('exit-doc:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const db = getDb();
        // Join through rooms → floors → building to get exit docs by building
        const docs = db.prepare(`
          SELECT ed.* FROM exit_documents ed
          JOIN rooms r ON ed.room_id = r.id
          JOIN floors f ON r.floor_id = f.id
          WHERE f.building_id = ?
          ORDER BY ed.created_at DESC
        `).all(data.buildingId as string);
        if (ack) ack({ ok: true, data: docs });
      } catch (e) {
        log.error({ event: 'exit-doc:list', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('exit-doc:list', e));
      }
    });

    // ─── Phase Gate Events ───
    socket.on('phase:gate:signoff', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const result = signoffGate({
          gateId: data.gateId as string,
          reviewer: data.reviewer as string,
          verdict: data.verdict as 'GO' | 'NO-GO' | 'CONDITIONAL',
          conditions: (data.conditions as string[]) || [],
          exitDocId: data.exitDocId as string | undefined,
          nextPhaseInput: (data.nextPhaseInput as Record<string, unknown>) || {},
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

    socket.on('phase:advance', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        const buildingId = data.buildingId as string;

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
          reviewer: (data.reviewer as string) || 'system',
          verdict: 'GO',
          conditions: [],
          nextPhaseInput: (data.nextPhaseInput as Record<string, unknown>) || {},
        });

        if (signoffResult.ok) {
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
      } catch (e) {
        // Last resort — disconnect handler should never crash the server
        console.error('[transport] disconnect handler threw:', e);
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

  log.info('Transport layer initialized');
}
