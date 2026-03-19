/**
 * Chat Orchestrator
 *
 * THE critical missing piece: wires chat:message bus events to the AI layer.
 *
 * Flow:
 *   1. Transport emits bus.emit('chat:message', { socketId, text, roomId, agentId, ... })
 *   2. This module picks it up, resolves room + agent + provider
 *   3. Calls runConversationLoop() which sends to AI, executes tools, loops
 *   4. Conversation loop emits chat:stream (incremental) and we emit chat:response (final)
 *   5. Transport layer forwards chat:response + chat:stream to the frontend via Socket.IO
 *
 * Without this module, chat:message goes into the void and the frontend just echoes user input.
 */

import { logger } from '../core/logger.js';
import { config } from '../core/config.js';
import { runConversationLoop } from '../agents/conversation-loop.js';
import { getDb } from '../storage/db.js';
import type { Bus, BusEventData } from '../core/bus.js';
import type {
  RoomManagerAPI,
  AgentRegistryAPI,
  ToolRegistryAPI,
  AIProviderAPI,
  BaseRoomLike,
  BuildingRow,
  ParsedAgent,
  RepoContextEntry,
  FileOriginEntry,
} from '../core/contracts.js';

const log = logger.child({ module: 'chat-orchestrator' });

/** Track active conversations to prevent duplicate processing */
const activeConversations = new Set<string>();

/** Save a message to the messages table. */
function persistMessage(
  roomId: string,
  agentId: string | null,
  role: string,
  content: string,
  threadId: string,
  toolCalls?: Array<{ name: string; input: unknown }>,
  attachments?: Array<{ id: string; fileName: string; mimeType: string; size: number; url?: string | null }>,
): string {
  const db = getDb();
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO messages (id, room_id, agent_id, role, content, tool_calls, attachments, thread_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, roomId, agentId, role, content,
    toolCalls ? JSON.stringify(toolCalls) : null,
    attachments && attachments.length > 0 ? JSON.stringify(attachments) : '[]',
    threadId,
  );
  return id;
}

/** Load conversation history for a thread. */
function loadConversationHistory(threadId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT role, content FROM messages WHERE thread_id = ? ORDER BY created_at ASC',
  ).all(threadId) as Array<{ role: string; content: string }>;
  return rows
    .filter((r) => r.content && (r.role === 'user' || r.role === 'assistant'))
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
}

interface ChatOrchestratorDeps {
  bus: Bus;
  rooms: RoomManagerAPI;
  agents: AgentRegistryAPI;
  tools: ToolRegistryAPI;
  ai: AIProviderAPI;
}

/**
 * Initialize the chat orchestrator.
 *
 * Listens for 'chat:message' on the bus and drives the full
 * message → AI → tool → response cycle.
 */
export function initChatOrchestrator({ bus, rooms, agents, tools, ai }: ChatOrchestratorDeps): void {
  bus.on('chat:message', (data: BusEventData) => {
    // Don't await — fire and handle errors internally
    handleChatMessage({ bus, rooms, agents, tools, ai }, data).catch((err) => {
      log.error({ err, socketId: data.socketId }, 'Unhandled error in chat orchestrator');
      bus.emit('chat:response', {
        socketId: data.socketId as string,
        type: 'error',
        error: { code: 'ORCHESTRATOR_ERROR', message: err instanceof Error ? err.message : String(err) },
      });
    });
  });

  log.info('Chat orchestrator initialized — chat:message → AI pipeline active');
}

/**
 * Handle a single chat message end-to-end.
 */
async function handleChatMessage(
  deps: ChatOrchestratorDeps,
  data: BusEventData,
): Promise<void> {
  const { bus, rooms, agents, tools, ai } = deps;

  const socketId = data.socketId as string;
  const text = (data.text as string || '').trim();
  const roomId = data.roomId as string || '';
  const agentId = data.agentId as string || '';
  const buildingId = data.buildingId as string || '';
  const threadId = (data.threadId as string) || `thread_${roomId || 'default'}_${socketId}`;
  const attachments = (data.attachments as Array<{ id: string; fileName: string; mimeType: string; size: number; url?: string | null }>) || [];

  // Skip truly empty messages (no text AND no attachments)
  if (!text && attachments.length === 0) {
    log.debug({ socketId }, 'Empty chat message (no text, no attachments) — ignoring');
    return;
  }

  // Build a conversation key to prevent duplicate processing
  const conversationKey = `${socketId}:${roomId}`;
  if (activeConversations.has(conversationKey)) {
    log.warn({ conversationKey }, 'Duplicate conversation in progress — skipping');
    return;
  }

  // Safety cap: prevent unbounded growth if cleanup fails
  if (activeConversations.size > 500) {
    log.warn({ size: activeConversations.size }, 'Active conversations set exceeded cap — clearing stale entries');
    activeConversations.clear();
  }

  activeConversations.add(conversationKey);

  try {
    // 1. Resolve the room — find the active room instance
    let room: BaseRoomLike | null = null;
    let resolvedAgentId = agentId;
    let provider = ''; // Resolved below from room config or API key detection

    if (roomId) {
      room = rooms.getRoom(roomId);
      if (!room) {
        log.warn({ roomId, socketId }, 'Room not found — attempting fallback');
      }
    }

    // 2. If no room specified or not found, find default room for the building
    if (!room && buildingId) {
      // Get floors belonging to this building, then find rooms on those floors
      try {
        const db = getDb();
        const buildingFloors = db.prepare('SELECT id FROM floors WHERE building_id = ?').all(buildingId) as { id: string }[];
        const floorIds = new Set(buildingFloors.map(f => f.id));

        const allRooms = rooms.listRooms();
        // Prefer strategist room, then any room on this building's floors
        let firstBuildingRoom: BaseRoomLike | null = null;
        for (const r of allRooms) {
          if (!floorIds.has(r.floor_id)) continue; // Skip rooms not in this building
          const candidate = rooms.getRoom(r.id);
          if (!candidate) continue;

          if (r.type === 'strategist') {
            room = candidate; // Strategist is the preferred default
            break;
          }
          if (!firstBuildingRoom) firstBuildingRoom = candidate;
        }
        if (!room) room = firstBuildingRoom;
      } catch {
        // DB not ready — fall through to global fallback
      }
    }

    // 3. If still no room (no building or building has no rooms), try ANY active room
    if (!room) {
      const allRooms = rooms.listRooms();
      for (const r of allRooms) {
        const candidate = rooms.getRoom(r.id);
        if (candidate) {
          room = candidate;
          break;
        }
      }
    }

    // 4. If absolutely no room exists, send a helpful error
    if (!room) {
      log.warn({ socketId, buildingId, roomId }, 'No active room found for chat message');
      bus.emit('chat:response', {
        socketId,
        type: 'error',
        error: {
          code: 'NO_ROOM',
          message: 'No active room found. Please create a project first — this will set up the Strategist room where you can begin planning.',
        },
      });
      return;
    }

    // 5. Resolve agent — find agent in this room or use a default
    let agent: ParsedAgent | null = null;
    if (resolvedAgentId) {
      agent = agents.getAgent(resolvedAgentId);
    }

    if (!agent) {
      // Find any agent assigned to this room
      const roomAgents = agents.listAgents({ roomId: room.id });
      if (roomAgents.length > 0) {
        agent = roomAgents[0];
        resolvedAgentId = agent.id;
      }
    }

    if (!agent) {
      // Find any agent with access to this room type
      const allAgents = agents.listAgents({});
      for (const a of allAgents) {
        if (a.room_access.includes(room.type) || a.room_access.includes('*')) {
          agent = a;
          resolvedAgentId = a.id;
          break;
        }
      }
    }

    if (!agent) {
      // Last resort: use a system-generated ID
      resolvedAgentId = `system_${Date.now()}`;
      log.warn({ socketId, roomId: room.id }, 'No agent found — using system agent');
    }

    // 6. Determine AI provider: agent override > room config > default (#679)
    const agentProvider = agent?.provider as string | undefined;
    if (agentProvider && agentProvider !== 'configurable') {
      provider = agentProvider;
    } else if (room.config && room.config.provider && room.config.provider !== 'configurable') {
      provider = room.config.provider;
    } else {
      provider = resolveDefaultProvider();
    }

    log.info(
      { socketId, roomId: room.id, roomType: room.type, agentId: resolvedAgentId, provider, textLength: text.length },
      'Processing chat message',
    );

    // Resolve display name for the agent (used in chat UI)
    const agentName = agent?.name || resolvedAgentId;

    // 7. Emit a "thinking" indicator so the frontend shows the AI is working
    bus.emit('chat:stream', {
      socketId,
      buildingId,
      agentId: resolvedAgentId,
      agentName,
      roomId: room.id,
      content: [{ type: 'text', text: '' }],
      iteration: 0,
      status: 'thinking',
    });

    // 8. Resolve building working directory, allowed paths, and repo context for tool scoping
    let workingDirectory: string | undefined;
    let allowedPaths: string[] = [];
    let repoContext: { repos: RepoContextEntry[]; fileOrigins: FileOriginEntry[]; truncatedOrigins?: boolean } | undefined;
    if (buildingId) {
      try {
        const db = getDb();
        const building = db.prepare('SELECT working_directory, allowed_paths FROM buildings WHERE id = ?').get(buildingId) as Pick<BuildingRow, 'working_directory' | 'allowed_paths'> | undefined;
        if (building?.working_directory) {
          workingDirectory = building.working_directory;
        }
        if (building?.allowed_paths) {
          try {
            const parsed = JSON.parse(building.allowed_paths);
            if (Array.isArray(parsed)) allowedPaths = parsed;
          } catch { /* malformed JSON — use empty array */ }
        }

        // Fetch linked repos for context injection (#644)
        const repoRows = db.prepare(
          'SELECT name, repo_url, relationship, local_path, branch FROM project_repos WHERE building_id = ?',
        ).all(buildingId) as Array<{ name: string; repo_url: string; relationship: string; local_path: string | null; branch: string | null }>;

        const VALID_RELATIONSHIPS = new Set(['main', 'dependency', 'fork', 'reference', 'submodule']);

        if (repoRows.length > 0) {
          const repos: RepoContextEntry[] = repoRows.map((r) => ({
            name: r.name,
            url: r.repo_url,
            relationship: VALID_RELATIONSHIPS.has(r.relationship)
              ? r.relationship as RepoContextEntry['relationship']
              : 'reference',
            localPath: r.local_path || undefined,
            branch: r.branch || undefined,
          }));

          // Fetch file origins — join with project_repos for repo name (capped at 100 for prompt size)
          const originRows = db.prepare(`
            SELECT rfo.file_path, pr.name AS repo_name, rfo.source_file_path, rfo.modified_locally
            FROM repo_file_origins rfo
            JOIN project_repos pr ON rfo.source_repo_id = pr.id
            WHERE rfo.building_id = ?
            ORDER BY rfo.file_path
            LIMIT 101
          `).all(buildingId) as Array<{ file_path: string; repo_name: string; source_file_path: string | null; modified_locally: number }>;

          const truncated = originRows.length > 100;
          const cappedRows = truncated ? originRows.slice(0, 100) : originRows;
          if (truncated) {
            log.warn({ buildingId, total: '100+' }, 'File origins truncated to 100 for prompt size');
          }

          const fileOrigins: FileOriginEntry[] = cappedRows.map((o) => ({
            filePath: o.file_path,
            repoName: o.repo_name,
            sourceFilePath: o.source_file_path || undefined,
            modifiedLocally: o.modified_locally === 1,
          }));

          repoContext = { repos, fileOrigins, truncatedOrigins: truncated };
        }
      } catch {
        // DB not ready — not fatal, tools will use process.cwd()
      }
    }

    // 9. Build effective content — for attachment-only messages, synthesize a description
    const userContent = text || (attachments.length > 0
      ? `[Attached ${attachments.length} file(s): ${attachments.map(a => a.fileName).join(', ')}]`
      : '');

    // 9b. Persist user message (with attachments if any) and load conversation history
    try {
      persistMessage(room.id, null, 'user', userContent, threadId, undefined, attachments);
    } catch (persistErr) {
      log.warn({ persistErr }, 'Failed to persist user message — continuing without history');
    }

    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    try {
      historyMessages = loadConversationHistory(threadId);
    } catch (histErr) {
      log.warn({ histErr }, 'Failed to load conversation history — using single message');
      historyMessages = [{ role: 'user' as const, content: userContent }];
    }

    // 10. Run the conversation loop with full history
    const result = await runConversationLoop({
      provider,
      room,
      agentId: resolvedAgentId,
      messages: historyMessages.length > 0 ? historyMessages : [{ role: 'user' as const, content: userContent }],
      ai,
      tools,
      bus,
      workingDirectory,
      allowedPaths,
      repoContext,
      options: {
        buildingId,
        socketId,
      },
    });

    // 11. Emit the final response and persist assistant message
    if (result.ok) {
      const data = result.data;
      log.info(
        {
          socketId, roomId: room.id, agentId: resolvedAgentId,
          iterations: data.iterations, tokens: data.totalTokens,
          toolCalls: data.toolCalls.length,
          maxIterationsReached: data.maxIterationsReached,
        },
        'Chat message processed successfully',
      );

      const content = data.maxIterationsReached
        ? `${data.finalText}\n\n[Warning: maximum tool iterations reached. Response may be incomplete.]`
        : data.finalText;

      bus.emit('chat:response', {
        socketId,
        buildingId,
        type: 'message',
        agentId: resolvedAgentId,
        agentName,
        roomId: room.id,
        content,
        thinking: data.thinking,
        toolCalls: data.toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
        tokens: data.totalTokens,
        usageAlreadyTracked: true, // #851 — per-iteration tracking in conversation loop
        iterations: data.iterations,
        sessionId: data.sessionId,
        maxIterationsReached: data.maxIterationsReached,
        threadId,
      });

      // Persist assistant response
      try {
        persistMessage(
          room.id, resolvedAgentId, 'assistant', content, threadId,
          data.toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
        );
      } catch (persistErr) {
        log.warn({ persistErr }, 'Failed to persist assistant message');
      }
    } else {
      log.error({ socketId, error: result.error }, 'Conversation loop failed');
      bus.emit('chat:response', {
        socketId,
        buildingId,
        type: 'error',
        agentId: resolvedAgentId,
        agentName,
        roomId: room.id,
        error: result.error,
      });
    }
  } finally {
    activeConversations.delete(conversationKey);
  }
}

/**
 * Resolve which AI provider to use based on configured API keys.
 * Priority: minimax > anthropic > openai > ollama
 */
function resolveDefaultProvider(): string {
  if (config.get('MINIMAX_API_KEY')) return 'minimax';
  if (config.get('ANTHROPIC_API_KEY')) return 'anthropic';
  if (config.get('OPENAI_API_KEY')) return 'openai';
  // Ollama doesn't need an API key — it's the fallback
  return 'ollama';
}
