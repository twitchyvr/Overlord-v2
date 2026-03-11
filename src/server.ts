/**
 * Overlord v2 — Server Entry Point
 *
 * Thin bootstrap: load config, init bus, wire layers, start listening.
 * No business logic here — just wiring.
 *
 * Layer order (strict — each layer only depends on layers below):
 *   Transport → Rooms → Agents → Tools → AI → Storage → Core
 */

import { createServer } from 'node:http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { config } from './core/config.js';
import { bus } from './core/bus.js';
import { logger } from './core/logger.js';
import { initStorage } from './storage/db.js';
import { initAI } from './ai/ai-provider.js';
import { initTools } from './tools/tool-registry.js';
import { initAgents } from './agents/agent-registry.js';
import { initRooms } from './rooms/room-manager.js';
import { registerBuiltInRoomTypes } from './rooms/room-types/index.js';
import { initTransport } from './transport/socket-handler.js';

import type { Request, Response } from 'express';

const log = logger.child({ module: 'server' });

async function start(): Promise<void> {
  log.info('Overlord v2 starting...');

  // 1. Validate config
  config.validate();
  log.info({ port: config.get('PORT'), env: config.get('NODE_ENV') }, 'Config loaded');

  // 2. Init layers bottom-up
  await initStorage(config);
  log.info('Storage initialized');

  const ai = initAI(config);
  log.info('AI layer initialized');

  const tools = initTools(config);
  log.info('Tool registry initialized');

  const agents = initAgents({ bus, tools, ai });
  log.info('Agent registry initialized');

  const rooms = initRooms({ bus, agents, tools, ai });
  registerBuiltInRoomTypes(rooms.registerRoomType);
  log.info('Room manager initialized (8 built-in room types registered)');

  // 3. HTTP + Socket.IO
  const app = express();
  app.use(express.json());
  app.use(express.static('public'));

  const http = createServer(app);
  const io = new SocketServer(http, {
    cors: { origin: config.get('CORS_ORIGIN') },
  });

  // 4. Wire transport
  initTransport({ io, bus, rooms, agents, tools });
  log.info('Transport layer initialized');

  // 5. Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
  });

  // 6. Start listening
  const port = config.get('PORT');
  http.listen(port, () => {
    log.info({ port }, 'Overlord v2 listening');
    bus.emit('server:ready', { port });
  });

  // 7. Graceful shutdown
  const shutdown = (signal: string): void => {
    log.info({ signal }, 'Shutting down...');
    bus.emit('server:shutdown');
    http.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  log.fatal(error, 'Failed to start Overlord v2');
  process.exit(1);
});
