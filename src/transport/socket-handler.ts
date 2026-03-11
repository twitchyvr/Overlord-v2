/**
 * Transport Layer — Socket.IO Handler
 *
 * Maps socket events to bus events. Organized by domain.
 * Replaces v1's 137-handler hub.js with typed, domain-organized handlers.
 */

import { logger } from '../core/logger.js';

const log = logger.child({ module: 'transport' });

export function initTransport({ io, bus, rooms, agents, tools }) {
  io.on('connection', (socket) => {
    log.info({ id: socket.id }, 'Client connected');

    // ─── Building Events ───
    socket.on('building:get', (data, ack) => {
      bus.emit('building:get', { socketId: socket.id, ...data });
      // TODO: implement handler
      if (ack) ack({ ok: true, data: null });
    });

    // ─── Room Events ───
    socket.on('room:create', (data, ack) => {
      const result = rooms.createRoom(data);
      if (ack) ack(result);
    });

    socket.on('room:list', (data, ack) => {
      const result = rooms.listRooms();
      if (ack) ack({ ok: true, data: result });
    });

    socket.on('room:enter', (data, ack) => {
      const result = rooms.enterRoom(data);
      if (ack) ack(result);
    });

    socket.on('room:exit', (data, ack) => {
      const result = rooms.exitRoom(data);
      if (ack) ack(result);
    });

    // ─── Agent Events ───
    socket.on('agent:register', (data, ack) => {
      const result = agents.registerAgent(data);
      if (ack) ack(result);
    });

    socket.on('agent:list', (data, ack) => {
      const result = agents.listAgents(data);
      if (ack) ack({ ok: true, data: result });
    });

    // ─── Chat Events ───
    socket.on('chat:message', (data) => {
      bus.emit('chat:message', { socketId: socket.id, ...data });
    });

    // ─── Phase Events ───
    socket.on('phase:status', (data, ack) => {
      bus.emit('phase:status', { socketId: socket.id, ...data });
      if (ack) ack({ ok: true });
    });

    socket.on('phase:gate', (data, ack) => {
      bus.emit('phase:gate', { socketId: socket.id, ...data });
      if (ack) ack({ ok: true });
    });

    // ─── RAID Events ───
    socket.on('raid:search', (data, ack) => {
      bus.emit('raid:search', { socketId: socket.id, ...data });
      if (ack) ack({ ok: true });
    });

    // ─── System Events ───
    socket.on('system:health', (_data, ack) => {
      if (ack) ack({ ok: true, data: { uptime: process.uptime(), version: '0.1.0' } });
    });

    socket.on('disconnect', () => {
      log.info({ id: socket.id }, 'Client disconnected');
    });
  });

  // ─── Bus → Socket broadcasts ───
  bus.on('room:agent:entered', (data) => io.emit('room:agent:entered', data));
  bus.on('room:agent:exited', (data) => io.emit('room:agent:exited', data));
  bus.on('chat:response', (data) => io.emit('chat:response', data));
  bus.on('chat:stream', (data) => io.emit('chat:stream', data));
  bus.on('tool:executed', (data) => io.emit('tool:executed', data));
  bus.on('phase:advanced', (data) => io.emit('phase:advanced', data));
  bus.on('raid:entry:added', (data) => io.emit('raid:entry:added', data));

  log.info('Transport layer initialized');
}
