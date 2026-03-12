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

import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI } from '../core/contracts.js';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { createBuilding, getBuilding, listBuildings, listFloors, getFloor } from '../rooms/building-manager.js';
import { getGates, canAdvance } from '../rooms/phase-gate.js';
import { searchRaid } from '../rooms/raid-log.js';
import { handleBlueprintSubmission } from '../rooms/phase-zero.js';
import { initCommands, parseCommandText, dispatchCommand, handleMention, resolveReference } from '../commands/index.js';
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
  // Initialize the command system with all layer APIs
  initCommands({ bus, rooms, agents, tools });
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

    // ─── Exit Document Events ───
    socket.on('exit-doc:submit', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      try {
        bus.emit('exit-doc:submitted', {
          roomId: data.roomId as string,
          roomType: data.roomType as string,
          buildingId: data.buildingId as string,
          agentId: data.agentId as string,
          document: data.document,
        });
        if (ack) ack({ ok: true });
      } catch (e) {
        log.error({ event: 'exit-doc:submit', err: e, socketId: socket.id }, 'Handler threw');
        if (ack) ack(errorResponse('exit-doc:submit', e));
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
  bus.on('deploy:check', (data: Record<string, unknown>) => io.emit('deploy:check', data));

  log.info('Transport layer initialized');
}
