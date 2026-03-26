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
import { initEscalationHandler } from './rooms/escalation-handler.js';
import { initDevLoopEnforcer } from './rooms/dev-loop-enforcer.js';
import { initEmailOrchestrator } from './rooms/email-orchestrator.js';
import { initBudgetTracker } from './agents/budget-tracker.js';
import { listBuildings } from './rooms/building-manager.js';
import { recordActivity } from './agents/agent-stats.js';
import { initCommands } from './commands/index.js';
import { initPlugins } from './plugins/index.js';
import type { InitPluginsParams } from './plugins/index.js';
import { initMcp } from './tools/mcp-manager.js';
import { getPhotosDirectory, getPhotosUrlPrefix } from './ai/agent-photo-store.js';

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

  // Reset agent status but preserve building execution state (#1257)
  // Agent conversation loops die with the process, so agents must be reset to idle.
  // But building execution_state should persist so the UI shows the correct controls
  // (Pause/Stop for running buildings, Play for stopped).
  const resetDb = (await import('./storage/db.js')).getDb();
  const resetAgents = resetDb.prepare("UPDATE agents SET status = 'idle' WHERE status = 'active'").run();
  if (resetAgents.changes > 0) {
    log.info({ agents: resetAgents.changes }, 'Reset agent status from previous session');
  }
  // Log which buildings are still marked as running (user can resume via Play)
  const runningBuildings = resetDb.prepare("SELECT id, name FROM buildings WHERE execution_state = 'running'").all() as Array<{ id: string; name: string }>;
  if (runningBuildings.length > 0) {
    log.info({ count: runningBuildings.length, names: runningBuildings.map(b => b.name) }, 'Buildings with persisted running state — agents idle, user can resume');
  }

  // Clean orphaned data from previously deleted buildings (#1198)
  const orphanTables = [
    'tasks', 'todos', 'milestones', 'raid_entries', 'phase_gates', 'plans',
    'agent_activity_log', 'agent_sessions', 'agent_stats', 'agent_emails',
    'visual_tests', 'pipeline_evidence', 'merge_queue', 'repo_file_origins',
  ];
  let totalOrphaned = 0;
  for (const table of orphanTables) {
    try {
      const r = resetDb.prepare(`DELETE FROM ${table} WHERE building_id IS NOT NULL AND building_id NOT IN (SELECT id FROM buildings)`).run();
      totalOrphaned += r.changes;
    } catch { /* table may not have building_id column */ }
  }
  // Also clean agent-scoped orphans
  try {
    const agentOrphans = resetDb.prepare(`DELETE FROM agent_email_recipients WHERE agent_id NOT IN (SELECT id FROM agents)`).run();
    totalOrphaned += agentOrphans.changes;
  } catch { /* ignore */ }
  if (totalOrphaned > 0) {
    log.info({ rows: totalOrphaned }, 'Cleaned orphaned data from deleted buildings');
  }

  // Null out any hallucinated due dates on milestones (#1195)
  resetDb.prepare("UPDATE milestones SET due_date = NULL WHERE due_date IS NOT NULL").run();

  const ai = initAI(config, bus);
  log.info('AI layer initialized');

  const tools = initTools(config);
  log.info('Tool registry initialized');

  const agents = initAgents({ bus, tools, ai });
  log.info('Agent registry initialized');

  const rooms = initRooms({ bus, agents, tools, ai });
  registerBuiltInRoomTypes(rooms.registerRoomType);
  log.info('Room manager initialized (12 built-in room types registered)');

  // Hydrate any rooms that already exist in the database from previous sessions.
  // This turns DB records (from blueprint apply, custom plans, or prior runs)
  // into active BaseRoom instances so getRoom() works and room details are available.
  const hydration = rooms.hydrateRoomsFromDb();
  log.info(hydration, 'Room hydration from database complete');

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

  // Escalation handler — periodic check for stale pending gates
  initEscalationHandler({ bus });
  log.info('Escalation handler initialized');

  // Dev loop enforcer — auto-route: Code Lab → Review → Testing Lab → Dogfood
  initDevLoopEnforcer(bus);
  log.info('Dev loop enforcer initialized');

  // Email orchestrator — agents process received emails and auto-reply (#670)
  initEmailOrchestrator({ bus });
  log.info('Email orchestrator initialized');

  // Budget tracker — per-agent token usage and limits (#680)
  initBudgetTracker(bus);
  log.info('Budget tracker initialized');

  // #1011 — Record tool calls and AI requests to activity log for persistent telemetry
  bus.on('tool:executed', (data: Record<string, unknown>) => {
    const agentId = (data.agentId || data.agent_id || '__system__') as string;
    const buildingId = data.buildingId as string | undefined;
    const roomId = data.roomId as string | undefined;
    recordActivity(agentId, 'tool_executed', {
      tool: data.toolName || data.name,
      success: data.success !== false,
    }, buildingId, roomId);
  });
  bus.on('ai:request', (data: Record<string, unknown>) => {
    const agentId = (data.agentId || '__system__') as string;
    const buildingId = data.buildingId as string | undefined;
    const roomId = data.roomId as string | undefined;
    recordActivity(agentId, 'ai_request', {
      provider: data.provider,
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
    }, buildingId, roomId);
  });

  // 2b. Init commands + plugins (after rooms/agents/tools, before transport)
  initCommands({ bus, rooms, agents, tools });
  log.info('Command system initialized');

  await initPlugins({ bus, rooms, agents, tools } as InitPluginsParams);
  log.info('Plugin system initialized');

  await initMcp({ bus, tools });
  log.info('MCP system initialized');

  // 3. HTTP + Socket.IO
  const app = express();
  app.use(express.json());
  // Disable caching in development so code changes are picked up immediately
  const isDev = config.get('NODE_ENV') !== 'production';
  app.use(express.static('public', isDev ? {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  } : {}));

  // Serve agent profile photos from data/agent-photos/
  app.use(getPhotosUrlPrefix(), express.static(getPhotosDirectory()));

  const http = createServer(app);
  const io = new SocketServer(http, {
    cors: { origin: config.get('CORS_ORIGIN') },
  });

  // 4. Wire transport
  initTransport({ io, bus, rooms, agents, tools, ai });
  log.info('Transport layer initialized');

  // 5. Health check + system status
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0-rc.2', uptime: process.uptime() });
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
