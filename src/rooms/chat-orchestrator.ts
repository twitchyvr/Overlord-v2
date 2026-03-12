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
import { runConversationLoop } from '../agents/conversation-loop.js';
import type { Bus, BusEventData } from '../core/bus.js';
import type {
  RoomManagerAPI,
  AgentRegistryAPI,
  ToolRegistryAPI,
  AIProviderAPI,
  BaseRoomLike,
  ParsedAgent,
} from '../core/contracts.js';

const log = logger.child({ module: 'chat-orchestrator' });

/** Track active conversations to prevent duplicate processing */
const activeConversations = new Set<string>();

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

  // Skip empty messages
  if (!text) {
    log.debug({ socketId }, 'Empty chat message — ignoring');
    return;
  }

  // Build a conversation key to prevent duplicate processing
  const conversationKey = `${socketId}:${roomId}:${Date.now()}`;
  if (activeConversations.has(conversationKey)) {
    log.warn({ conversationKey }, 'Duplicate conversation — skipping');
    return;
  }
  activeConversations.add(conversationKey);

  try {
    // 1. Resolve the room — find the active room instance
    let room: BaseRoomLike | null = null;
    let resolvedAgentId = agentId;
    let provider = 'minimax'; // Default provider

    if (roomId) {
      room = rooms.getRoom(roomId);
      if (!room) {
        log.warn({ roomId, socketId }, 'Room not found — attempting fallback');
      }
    }

    // 2. If no room specified or not found, find default room for the building
    if (!room && buildingId) {
      const allRooms = rooms.listRooms();
      // Find any room associated with this building's floors
      // Look for a strategist room first, then any active room
      for (const r of allRooms) {
        const candidate = rooms.getRoom(r.id);
        if (candidate) {
          room = candidate;
          break;
        }
      }
    }

    // 3. If still no room, try to find ANY active room
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

    // 6. Determine AI provider from room config
    if (room.config && room.config.provider && room.config.provider !== 'configurable') {
      provider = room.config.provider;
    }

    log.info(
      { socketId, roomId: room.id, roomType: room.type, agentId: resolvedAgentId, provider, textLength: text.length },
      'Processing chat message',
    );

    // 7. Emit a "thinking" indicator so the frontend shows the AI is working
    bus.emit('chat:stream', {
      socketId,
      agentId: resolvedAgentId,
      roomId: room.id,
      content: [{ type: 'text', text: '' }],
      iteration: 0,
      status: 'thinking',
    });

    // 8. Run the conversation loop — this is where the AI magic happens
    const result = await runConversationLoop({
      provider,
      room,
      agentId: resolvedAgentId,
      messages: [{ role: 'user', content: text }],
      ai,
      tools,
      bus,
      options: {
        buildingId,
        socketId,
      },
    });

    // 9. Emit the final response
    if (result.ok) {
      const data = result.data;
      log.info(
        {
          socketId, roomId: room.id, agentId: resolvedAgentId,
          iterations: data.iterations, tokens: data.totalTokens,
          toolCalls: data.toolCalls.length,
        },
        'Chat message processed successfully',
      );

      bus.emit('chat:response', {
        socketId,
        type: 'message',
        agentId: resolvedAgentId,
        roomId: room.id,
        content: data.finalText,
        thinking: data.thinking,
        toolCalls: data.toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
        tokens: data.totalTokens,
        iterations: data.iterations,
        sessionId: data.sessionId,
      });
    } else {
      log.error({ socketId, error: result.error }, 'Conversation loop failed');
      bus.emit('chat:response', {
        socketId,
        type: 'error',
        agentId: resolvedAgentId,
        roomId: room.id,
        error: result.error,
      });
    }
  } finally {
    activeConversations.delete(conversationKey);
  }
}
