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
import { initPhaseZeroHandler } from './rooms/phase-zero.js';
import { initScopeChangeHandler } from './rooms/scope-change.js';
import { initChatOrchestrator } from './rooms/chat-orchestrator.js';
import { initBuildingOnboarding } from './rooms/building-onboarding.js';
import { listBuildings } from './rooms/building-manager.js';
import { initCommands } from './commands/index.js';
import { initPlugins } from './plugins/index.js';
import type { InitPluginsParams } from './plugins/index.js';

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

  const ai = initAI(config, bus);
  log.info('AI layer initialized');

  const tools = initTools(config);
  log.info('Tool registry initialized');

  const agents = initAgents({ bus, tools, ai });
  log.info('Agent registry initialized');

  const rooms = initRooms({ bus, agents, tools, ai });
  registerBuiltInRoomTypes(rooms.registerRoomType);
  log.info('Room manager initialized (9 built-in room types registered)');

  // Wire bus handlers for Phase Zero and Scope Change protocols
  initPhaseZeroHandler(bus);
  initScopeChangeHandler(bus);
  log.info('Phase Zero + Scope Change bus handlers initialized');

  // Chat orchestrator — THE critical bridge: chat:message → AI → chat:response
  initChatOrchestrator({ bus, rooms, agents, tools, ai });
  log.info('Chat orchestrator initialized');

  // Building onboarding — auto-provisions Strategist room + agent on building creation
  initBuildingOnboarding({ bus, rooms, agents });
  log.info('Building onboarding initialized');

  // 2b. Init commands + plugins (after rooms/agents/tools, before transport)
  initCommands({ bus, rooms, agents, tools });
  log.info('Command system initialized');

  await initPlugins({ bus, rooms, agents, tools } as InitPluginsParams);
  log.info('Plugin system initialized');

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

  // 5. Health check + system status
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
  });

  // Returning-user check: if buildings exist → dashboard, else → Strategist
  app.get('/api/status', (_req: Request, res: Response) => {
    const result = listBuildings();
    const buildings = result.ok ? (result.data as Array<{ id: string; name: string; active_phase: string }>) : [];
    res.json({
      isNewUser: buildings.length === 0,
      buildings: buildings.map((b) => ({ id: b.id, name: b.name, activePhase: b.active_phase })),
    });
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
