/**
 * Transport Layer — Socket.IO Handler
 *
 * Maps socket events to bus events. Organized by domain.
 * Replaces v1's 137-handler hub.js with typed, domain-organized handlers.
 */

import { logger } from '../core/logger.js';
import type { Bus } from '../core/bus.js';
import type { RoomManagerAPI, AgentRegistryAPI, ToolRegistryAPI } from '../core/contracts.js';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { createBuilding, getBuilding, listBuildings, listFloors, getFloor } from '../rooms/building-manager.js';
import { getGates, canAdvance } from '../rooms/phase-gate.js';
import { searchRaid } from '../rooms/raid-log.js';
import { handleBlueprintSubmission } from '../rooms/phase-zero.js';

const log = logger.child({ module: 'transport' });

interface InitTransportParams {
  io: SocketIOServer;
  bus: Bus;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
}

export function initTransport({ io, bus, rooms, agents, tools: _tools }: InitTransportParams): void {
  io.on('connection', (socket: Socket) => {
    log.info({ id: socket.id }, 'Client connected');

    // ─── Building Events ───
    socket.on('building:create', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = createBuilding(data as unknown as Parameters<typeof createBuilding>[0]);
      if (ack) ack(result);
    });

    socket.on('building:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = getBuilding(data.buildingId as string);
      if (ack) ack(result);
    });

    socket.on('building:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = listBuildings(data.projectId as string | undefined);
      if (ack) ack(result);
    });

    socket.on('building:apply-blueprint', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = handleBlueprintSubmission({
        buildingId: data.buildingId as string,
        blueprint: data.blueprint as Record<string, unknown>,
        agentId: data.agentId as string,
      });
      if (ack) ack(result);
    });

    // Returning-user check: hasBuildings → dashboard, else → Strategist
    socket.on('system:status', (_data: unknown, ack?: (res: unknown) => void) => {
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
    socket.on('floor:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = listFloors(data.buildingId as string);
      if (ack) ack(result);
    });

    socket.on('floor:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = getFloor(data.floorId as string);
      if (ack) ack(result);
    });

    // ─── Room Events ───
    socket.on('room:create', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = rooms.createRoom(data as Parameters<typeof rooms.createRoom>[0]);
      if (ack) ack(result);
    });

    socket.on('room:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
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
    });

    socket.on('room:list', (_data: unknown, ack?: (res: unknown) => void) => {
      const result = rooms.listRooms();
      if (ack) ack({ ok: true, data: result });
    });

    socket.on('room:enter', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = rooms.enterRoom(data as Parameters<typeof rooms.enterRoom>[0]);
      if (ack) ack(result);
    });

    socket.on('room:exit', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = rooms.exitRoom(data as Parameters<typeof rooms.exitRoom>[0]);
      if (ack) ack(result);
    });

    // ─── Agent Events ───
    socket.on('agent:register', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = agents.registerAgent(data as Parameters<typeof agents.registerAgent>[0]);
      if (ack) ack(result);
    });

    socket.on('agent:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const agent = agents.getAgent(data.agentId as string);
      if (!agent) {
        if (ack) ack({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: `Agent ${data.agentId} does not exist`, retryable: false } });
        return;
      }
      if (ack) ack({ ok: true, data: agent });
    });

    socket.on('agent:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = agents.listAgents(data as Parameters<typeof agents.listAgents>[0]);
      if (ack) ack({ ok: true, data: result });
    });

    // ─── Chat Events ───
    socket.on('chat:message', (data: Record<string, unknown>) => {
      bus.emit('chat:message', { socketId: socket.id, ...data });
    });

    // ─── Phase Events ───
    socket.on('phase:status', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      bus.emit('phase:status', { socketId: socket.id, ...data });
      if (ack) ack({ ok: true });
    });

    socket.on('phase:gate', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      bus.emit('phase:gate', { socketId: socket.id, ...data });
      if (ack) ack({ ok: true });
    });

    socket.on('phase:gates', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = getGates(data.buildingId as string);
      if (ack) ack(result);
    });

    socket.on('phase:can-advance', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = canAdvance(data.buildingId as string);
      if (ack) ack(result);
    });

    // ─── RAID Events ───
    socket.on('raid:search', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      bus.emit('raid:search', { socketId: socket.id, ...data });
      if (ack) ack({ ok: true });
    });

    socket.on('raid:list', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = searchRaid({ buildingId: data.buildingId as string });
      if (ack) ack(result);
    });

    // ─── Exit Document Events ───
    socket.on('exit-doc:submit', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      bus.emit('exit-doc:submitted', {
        roomId: data.roomId as string,
        agentId: data.agentId as string,
        document: data.document,
      });
      if (ack) ack({ ok: true });
    });

    // ─── System Events ───
    socket.on('system:health', (_data: unknown, ack?: (res: unknown) => void) => {
      if (ack) ack({ ok: true, data: { uptime: process.uptime(), version: '0.1.0' } });
    });

    socket.on('disconnect', () => {
      log.info({ id: socket.id }, 'Client disconnected');
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

  log.info('Transport layer initialized');
}
