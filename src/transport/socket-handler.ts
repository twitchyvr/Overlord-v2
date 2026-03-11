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

const log = logger.child({ module: 'transport' });

interface InitTransportParams {
  io: SocketIOServer;
  bus: Bus;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
}

export function initTransport({ io, bus, rooms, agents }: InitTransportParams): void {
  io.on('connection', (socket: Socket) => {
    log.info({ id: socket.id }, 'Client connected');

    // ─── Building Events ───
    socket.on('building:get', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      bus.emit('building:get', { socketId: socket.id, ...data });
      if (ack) ack({ ok: true, data: null });
    });

    // ─── Room Events ───
    socket.on('room:create', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      const result = rooms.createRoom(data as Parameters<typeof rooms.createRoom>[0]);
      if (ack) ack(result);
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

    // ─── RAID Events ───
    socket.on('raid:search', (data: Record<string, unknown>, ack?: (res: unknown) => void) => {
      bus.emit('raid:search', { socketId: socket.id, ...data });
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

  log.info('Transport layer initialized');
}
