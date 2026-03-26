/**
 * Overlord v2 — Socket Bridge
 *
 * Maps v2 Socket.IO events to store updates and engine dispatches.
 * Completely new — v2 events are different from v1.
 */

import { OverlordUI } from './engine.js';
import { createLogger } from './logger.js';

const log = createLogger('SocketBridge');

/**
 * Initialize the socket bridge.
 * @param {object} socket — Socket.IO client instance
 * @param {object} store  — v2 Store instance
 * @param {object} engine — OverlordUI engine (for dispatching)
 */
export function initSocketBridge(socket, store, engine) {

  // ── Connection lifecycle ──

  socket.on('connect', () => {
    log.info('Connected:', socket.id);
    store.set('ui.connected', true);
    store.set('ui.connectionState', 'connected');

    // Hydrate initial state
    _emitWithTimeout('system:status', {}).then((res) => {
      if (res && res.ok) {
        store.batch(() => {
          store.set('system.isNewUser', res.data.isNewUser);
          store.set('building.list', res.data.buildings || []);
        });
        engine.dispatch('system:status', res.data);
      }
    });

    _emitWithTimeout('system:health', {}).then((res) => {
      if (res && res.ok) {
        store.set('system.health', res.data);
      }
    });

    // Re-fetch active building data on reconnect
    const activeBuildingId = store.get('building.active');
    if (activeBuildingId) {
      log.info('Reconnected — re-fetching active building data');
      // Use setTimeout to avoid race with system:status hydration
      setTimeout(() => {
        if (window.overlordSocket && window.overlordSocket.selectBuilding) {
          window.overlordSocket.selectBuilding(activeBuildingId);
        }
      }, 100);
    }
  });

  socket.on('disconnect', (reason) => {
    log.info('Disconnected:', reason);
    store.set('ui.connected', false);
    store.set('ui.connectionState', 'disconnected');
    engine.dispatch('connection:lost', { reason });
  });

  socket.on('connect_error', (error) => {
    log.error('Connection error:', error.message);
    store.set('ui.connectionState', 'reconnecting');
    engine.dispatch('connection:error', { message: error.message });
  });

  // ── Reconnection events (Socket.IO Manager) ──

  if (socket.io) {
    socket.io.on('reconnect_attempt', (attempt) => {
      log.info('Reconnection attempt:', attempt);
      store.set('ui.connectionState', 'reconnecting');
      engine.dispatch('connection:reconnecting', { attempt });
    });

    socket.io.on('reconnect', (attempt) => {
      log.info('Reconnected after', attempt, 'attempts');
      engine.dispatch('connection:reconnected', { attempt });
    });

    socket.io.on('reconnect_failed', () => {
      log.error('Reconnection failed permanently');
      store.set('ui.connectionState', 'failed');
      engine.dispatch('connection:failed', {});
    });
  }

  // ── Building isolation guard (#666) ──
  // Events from the server include buildingId. Only process events that match
  // the currently active building, preventing cross-project data bleed.
  function isActiveBuilding(data) {
    if (!data || !data.buildingId) return true; // No buildingId = global event, always process
    const active = store.get('building.active');
    if (!active) return true; // No building selected = show everything
    return data.buildingId === active;
  }

  /** Resolve agentName from the agents list for any event with agentId (#1286) */
  function enrichAgentName(data) {
    if (data.agentName) return data;
    if (!data.agentId) return data;
    const agents = store.get('agents.list') || [];
    const agent = agents.find((a) => a.id === data.agentId);
    if (agent) return { ...data, agentName: agent.display_name || agent.name || data.agentId };
    return data;
  }

  /** Push an enriched activity item to the store (#1286) */
  function pushActivity(event, data) {
    const enriched = enrichAgentName({ event, ...data, timestamp: data.timestamp || Date.now() });
    store.update('activity.items', (items) => [enriched, ...(items || []).slice(0, 99)]);
    engine.dispatch('activity:new', enriched);
  }

  // ── Server → Client broadcasts ──

  socket.on('room:agent:entered', (data) => {
    if (!isActiveBuilding(data)) return;
    // Update agent positions map
    store.update('building.agentPositions', (positions) => {
      return { ...(positions || {}), [data.agentId]: { roomId: data.roomId, roomType: data.roomType, tableType: data.tableType, status: 'active', name: data.agentName, agentId: data.agentId } };
    });
    pushActivity('room:agent:entered', data);
    engine.dispatch('room:agent:entered', data);
    engine.dispatch('agent:moved', data); // #850 — notify agents-view of room changes
  });

  socket.on('room:agent:exited', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('building.agentPositions', (positions) => {
      const next = { ...(positions || {}) };
      delete next[data.agentId];
      return next;
    });
    pushActivity('room:agent:exited', data);
    engine.dispatch('room:agent:exited', data);
    engine.dispatch('agent:moved', data); // #850 — notify agents-view of room changes
  });

  socket.on('chat:response', (data) => {
    // If we were streaming, finalize it first
    if (store.peek('ui.streaming')) {
      engine.dispatch('chat:stream-end', data);
    }
    store.set('ui.processing', false);
    store.set('ui.streaming', false);
    // Only add to messages for non-error, non-mention final responses (#1173)
    // Mention notifications are system messages, not chat messages
    if (data.type !== 'error' && data.type !== 'mention') {
      store.update('chat.messages', (msgs) => [...(msgs || []), {
        id: data.sessionId || Date.now().toString(),
        role: 'assistant',
        content: data.content || data.response || '',  // Commands use 'response', chat uses 'content'
        agentId: data.agentId,
        agentName: data.agentName || (data.type === 'command' ? 'Overlord' : data.agentId),
        thinking: data.thinking,
        toolCalls: data.toolCalls,
        type: 'response',
        timestamp: Date.now(),
      }]);
    }
    engine.dispatch('chat:response', data);
  });

  socket.on('chat:stream', (data) => {
    // Translate backend chat:stream into frontend stream-start/chunk events
    if (data.status === 'thinking') {
      // First event — AI is starting to think
      store.set('ui.streaming', true);
      engine.dispatch('chat:stream-start', {
        agentId: data.agentId,
        agentName: data.agentName || data.agentId,
        roomId: data.roomId,
        messageId: `stream-${Date.now()}`,
      });
      return;
    }
    // Tool execution progress — show what tool is running
    if (data.status === 'tool' && data.toolName) {
      engine.dispatch('chat:stream-chunk', {
        text: `\n*Using ${data.toolName}...*\n`,
        agentId: data.agentId,
        roomId: data.roomId,
        iteration: data.iteration,
        isTool: true,
      });
      return;
    }
    // Content arrived — extract text from content blocks
    const textParts = (data.content || [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text);
    if (textParts.length > 0) {
      engine.dispatch('chat:stream-chunk', {
        text: textParts.join('\n'),
        agentId: data.agentId,
        roomId: data.roomId,
        iteration: data.iteration,
      });
    }
  });

  // Plan events
  socket.on('plan:submitted', (data) => {
    store.update('plans.list', (plans) => [data, ...(plans || [])]);
    store.update('activity.items', (items) => [{ event: 'plan:submitted', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('plan:submitted', data);
    engine.dispatch('activity:new', { event: 'plan:submitted', ...data });
  });

  socket.on('plan:reviewed', (data) => {
    store.update('plans.list', (plans) => (plans || []).map((p) => p.id === data.id ? data : p));
    store.update('activity.items', (items) => [{ event: 'plan:reviewed', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('plan:reviewed', data);
    engine.dispatch('activity:new', { event: 'plan:reviewed', ...data });
  });

  // Attachment broadcast (other clients)
  socket.on('chat:attachments', (data) => {
    engine.dispatch('chat:attachments', data);
  });

  // #929 — Tool executing (start) — shows what agent is calling + params
  socket.on('tool:executing', (data) => {
    if (!isActiveBuilding(data)) return;
    const agents = store.get('agents.list') || [];
    const agent = agents.find((a) => a.id === data.agentId);
    const enriched = { ...data, agentName: agent?.name || data.agentId, timestamp: Date.now() };
    store.update('activity.items', (items) => [{ event: 'tool:executing', ...enriched }, ...(items || []).slice(0, 99)]);
    engine.dispatch('tool:executing', enriched);
    engine.dispatch('activity:new', { event: 'tool:executing', ...enriched });
  });

  socket.on('tool:executed', (data) => {
    if (!isActiveBuilding(data)) return;
    const agents = store.get('agents.list') || [];
    const agent = agents.find((a) => a.id === data.agentId);
    const enriched = { ...data, agentName: agent?.name || data.agentId, timestamp: Date.now() };
    store.update('activity.items', (items) => [{ event: 'tool:executed', ...enriched }, ...(items || []).slice(0, 99)]);
    engine.dispatch('tool:executed', enriched);
    engine.dispatch('activity:new', { event: 'tool:executed', ...enriched });
  });

  socket.on('phase:advanced', (data) => {
    const newPhase = data.to || data.nextPhase || data.phase;
    store.set('building.activePhase', newPhase);
    pushActivity('phase:advanced', data);
    engine.dispatch('phase:advanced', data);

    // Auto-switch chat to a room matching the new phase
    // #1129 — Don't auto-open room modal on phase advancement.
    // Previously dispatched building:room-selected which opened a Room Config
    // modal — confusing for users who didn't click anything.
    // Just update the store so other components know the active room changed.
    const PHASE_TO_ROOM_TYPE = {
      discovery: 'discovery', architecture: 'architecture',
      execution: 'code-lab', review: 'review', deploy: 'deploy',
    };
    const targetRoomType = PHASE_TO_ROOM_TYPE[newPhase];
    if (targetRoomType) {
      const rooms = store.get('rooms.list') || [];
      const targetRoom = rooms.find(r => r.type === targetRoomType);
      if (targetRoom) {
        store.set('rooms.active', targetRoom.id);
        // Don't dispatch building:room-selected — that opens a modal
      }
    }
  });

  socket.on('raid:entry:added', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('raid.entries', (entries) => [data, ...(entries || [])]);
    pushActivity('raid:entry:added', data);
    engine.dispatch('raid:entry:added', data);
  });

  socket.on('raid:entry:updated', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('raid.entries', (entries) => {
      const list = entries || [];
      const idx = list.findIndex((e) => e.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], ...data };
        return next;
      }
      return list;
    });
    engine.dispatch('raid:entry:updated', data);
  });

  socket.on('phase-zero:complete', (data) => {
    store.update('activity.items', (items) => [{ event: 'phase-zero:complete', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('phase-zero:complete', data);
    engine.dispatch('activity:new', { event: 'phase-zero:complete', ...data });
  });

  socket.on('phase-zero:failed', (data) => {
    engine.dispatch('phase-zero:failed', data);
  });

  socket.on('scope-change:detected', (data) => {
    // Don't inject into raid.entries — scope-change data lacks RAID entry shape
    // (no id, phase, room_id, summary, etc.) and corrupts the store
    store.update('activity.items', (items) => [{ event: 'scope-change', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('scope-change:detected', data);
    engine.dispatch('activity:new', { event: 'scope-change', ...data });
  });

  socket.on('exit-doc:submitted', (data) => {
    if (!isActiveBuilding(data)) return;
    pushActivity('exit-doc:submitted', data);
    engine.dispatch('exit-doc:submitted', data);
  });

  socket.on('task:created', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('tasks.list', (tasks) => {
      const list = tasks || [];
      // Deduplicate — createTask() callback may have already added this
      if (data.id && list.some((t) => t.id === data.id)) return list;
      return [data, ...list];
    });
    pushActivity('task:created', data);
    engine.dispatch('task:created', data);
  });

  socket.on('task:updated', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('tasks.list', (tasks) => {
      const list = tasks || [];
      const idx = list.findIndex((t) => t.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        // Merge update with existing task — don't replace with partial data (#1123)
        next[idx] = { ...list[idx], ...data };
        return next;
      }
      return [data, ...list];
    });
    pushActivity('task:updated', data);
    engine.dispatch('task:updated', data);
  });

  socket.on('todo:created', (data) => {
    store.update('todos.list', (todos) => [...(todos || []), data]);
    engine.dispatch('todo:created', data);
  });

  socket.on('todo:updated', (data) => {
    store.update('todos.list', (todos) => {
      const list = todos || [];
      const idx = list.findIndex((t) => t.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = data;
        return next;
      }
      return list;
    });
    engine.dispatch('todo:updated', data);
  });

  socket.on('todo:deleted', (data) => {
    store.update('todos.list', (todos) => {
      const list = todos || [];
      return list.filter((t) => t.id !== data.id);
    });
    engine.dispatch('todo:deleted', data);
  });

  // ─── Milestone Events ───

  socket.on('milestone:created', (data) => {
    store.update('milestones.list', (milestones) => {
      const list = milestones || [];
      if (data.id && list.some((m) => m.id === data.id)) return list;
      return [data, ...list];
    });
    store.update('activity.items', (items) => [{ event: 'milestone:created', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('milestone:created', data);
    engine.dispatch('activity:new', { event: 'milestone:created', ...data });
  });

  socket.on('milestone:updated', (data) => {
    store.update('milestones.list', (milestones) => {
      const list = milestones || [];
      const idx = list.findIndex((m) => m.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = data;
        return next;
      }
      return [data, ...list];
    });
    store.update('activity.items', (items) => [{ event: 'milestone:updated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('milestone:updated', data);
    engine.dispatch('activity:new', { event: 'milestone:updated', ...data });
  });

  socket.on('milestone:deleted', (data) => {
    store.update('milestones.list', (milestones) => {
      const list = milestones || [];
      return list.filter((m) => m.id !== data.id);
    });
    engine.dispatch('milestone:deleted', data);
  });

  socket.on('system:log', (data) => {
    engine.dispatch('system:log', data);
  });

  socket.on('agent:mentioned', (data) => {
    store.update('activity.items', (items) => [{ event: 'agent:mentioned', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('agent:mentioned', data);
    engine.dispatch('activity:new', { event: 'agent:mentioned', ...data });
  });

  // #802 — Agent activity badges (thinking, coding, reading, etc.)
  // #923 — ALSO pipe to activity.items so Activity Feed shows agent events
  socket.on('agent:activity', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('agents.activities', (activities) => {
      return { ...(activities || {}), [data.agentId]: { activity: data.activity, toolName: data.toolName, timestamp: Date.now() } };
    });
    // Resolve agent name for display in Activity Feed
    const agents = store.get('agents.list') || [];
    const agent = agents.find((a) => a.id === data.agentId);
    const enriched = { ...data, agentName: agent?.name || data.agentId, timestamp: Date.now() };
    store.update('activity.items', (items) => [{ event: 'agent:activity', ...enriched }, ...(items || []).slice(0, 99)]);
    engine.dispatch('agent:activity', data);
    engine.dispatch('activity:new', { event: 'agent:activity', ...enriched });
  });

  // #931 — AI request audit log: track every API call with token counts
  socket.on('ai:request', (data) => {
    if (!isActiveBuilding(data)) return;
    // Resolve agent name
    const agents = store.get('agents.list') || [];
    const agent = agents.find((a) => a.id === data.agentId);
    const agentName = agent?.name || data.agentId;
    const enriched = { ...data, agentName, timestamp: data.timestamp || Date.now() };
    // Track in token usage store (cumulative per agent)
    store.update('ai.usage', (usage) => {
      const u = usage || { total: { input: 0, output: 0, calls: 0 }, byAgent: {} };
      u.total.input += data.inputTokens || 0;
      u.total.output += data.outputTokens || 0;
      u.total.calls += 1;
      const agentUsage = u.byAgent[data.agentId] || { name: agentName, input: 0, output: 0, calls: 0 };
      agentUsage.input += data.inputTokens || 0;
      agentUsage.output += data.outputTokens || 0;
      agentUsage.calls += 1;
      agentUsage.name = agentName;
      u.byAgent[data.agentId] = agentUsage;
      return u;
    });
    // Track in API call log (chronological)
    store.update('ai.callLog', (log) => [enriched, ...(log || []).slice(0, 199)]);
    // Add to activity feed
    store.update('activity.items', (items) => [{ event: 'ai:request', ...enriched }, ...(items || []).slice(0, 99)]);
    engine.dispatch('ai:request', enriched);
    engine.dispatch('activity:new', { event: 'ai:request', ...enriched });
  });

  // #850 — Agent created broadcast (new agents appear in other clients)
  socket.on('agent:created', (data) => {
    if (!isActiveBuilding(data)) return;
    if (data.agent) {
      store.update('agents.list', (agents) => {
        const list = agents || [];
        // Avoid duplicate if agent was already added via ACK
        if (list.some((a) => a.id === data.agentId)) return list;
        return [...list, data.agent];
      });
    }
    store.update('activity.items', (items) => [{ event: 'agent:created', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('agent:registered', data);
    engine.dispatch('activity:new', { event: 'agent:created', ...data });
  });

  // #850 — Agent updated broadcast (field changes propagate to other clients)
  socket.on('agent:updated', (data) => {
    if (!isActiveBuilding(data)) return;
    if (data.agent) {
      store.update('agents.list', (agents) => {
        const list = agents || [];
        const idx = list.findIndex((a) => a.id === data.agentId);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = { ...next[idx], ...data.agent };
          return next;
        }
        return list;
      });
    }
    engine.dispatch('agent:updated', data);
  });

  socket.on('agent:status-changed', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('agents.list', (agents) => {
      const list = agents || [];
      const idx = list.findIndex((a) => a.id === data.agentId);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], status: data.status };
        return next;
      }
      return list;
    });
    pushActivity('agent:status-changed', data);
    engine.dispatch('agent:status-changed', data);
  });

  socket.on('building:updated', (data) => {
    store.update('building.list', (buildings) => {
      const list = buildings || [];
      const idx = list.findIndex((b) => b.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], ...data };
        return next;
      }
      return list;
    });
    if (data.id === store.get('building.active')) {
      const existing = store.get('building.data') || {};
      const merged = { ...existing, ...data };
      // Normalize camelCase field from server to snake_case used by UI
      if (data.activePhase && !data.active_phase) {
        merged.active_phase = data.activePhase;
      }
      store.set('building.data', merged);
    }
    engine.dispatch('building:updated', data);
  });

  // ── Building Execution Control (#965, #969, #983) ──
  socket.on('building:execution-changed', (data) => {
    store.update('building.list', (buildings) => {
      const list = buildings || [];
      const idx = list.findIndex((b) => b.id === data.buildingId);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], execution_state: data.executionState, executionState: data.executionState };
        return next;
      }
      return list;
    });
    // Push to activity feed (#983)
    store.update('activity.items', (items) => [{ event: 'building:execution-changed', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('activity:new', { event: 'building:execution-changed', ...data });
    engine.dispatch('building:execution-changed', data);
  });

  socket.on('deploy:check', (data) => {
    store.update('activity.items', (items) => [{ event: 'deploy:check', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('deploy:check', data);
    engine.dispatch('activity:new', { event: 'deploy:check', ...data });
  });

  // ── Building onboarding events ──

  socket.on('building:created', (data) => {
    log.info('Building created:', data.buildingId, data.name);
    store.update('building.list', (list) => {
      const existing = (list || []).find((b) => b.id === data.buildingId);
      if (existing) return list;
      return [...(list || []), { id: data.buildingId, name: data.name }];
    });
    engine.dispatch('building:created', data);
  });

  socket.on('building:onboarded', (data) => {
    log.info('Building onboarded — Strategist ready:', data.roomId);
    // Auto-select the new building and its room
    store.batch(() => {
      store.set('building.active', data.buildingId);
      store.set('rooms.active', data.roomId);
      store.set('building.activePhase', 'strategy');
    });
    // Fetch full building data
    if (window.overlordSocket && window.overlordSocket.selectBuilding) {
      window.overlordSocket.selectBuilding(data.buildingId);
    }
    engine.dispatch('building:onboarded', data);
    store.update('activity.items', (items) => [{ event: 'building:onboarded', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('activity:new', { event: 'building:onboarded', ...data });
  });

  socket.on('phase:room-provisioned', (data) => {
    log.info('Phase room provisioned:', data.phase, data.roomType);
    store.set('rooms.active', data.roomId);
    // Refresh rooms list
    if (window.overlordSocket && window.overlordSocket.fetchRooms) {
      window.overlordSocket.fetchRooms();
    }
    engine.dispatch('phase:room-provisioned', data);
    store.update('activity.items', (items) => [{ event: 'phase:room-provisioned', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('activity:new', { event: 'phase:room-provisioned', ...data });
  });

  socket.on('phase:gate:created', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('phase.gates', (gates) => [...(gates || []), data]);
    store.update('activity.items', (items) => [{ event: 'phase:gate:created', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('phase:gate:created', data);
    engine.dispatch('activity:new', { event: 'phase:gate:created', ...data });
  });

  socket.on('phase:gate:signed-off', (data) => {
    if (!isActiveBuilding(data)) return;
    // Update gates list in store
    store.update('phase.gates', (gates) => {
      const list = gates || [];
      const idx = list.findIndex((g) => g.id === data.id || g.id === data.gateId);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], ...data };
        return next;
      }
      return [...list, data];
    });
    store.update('activity.items', (items) => [{ event: 'phase:gate:signed-off', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('phase:gate:signed-off', data);
    engine.dispatch('activity:new', { event: 'phase:gate:signed-off', ...data });
  });

  socket.on('phase:conditions:resolved', (data) => {
    // Update gates list in store with remaining conditions
    store.update('phase.gates', (gates) => {
      const list = gates || [];
      const idx = list.findIndex((g) => g.id === data.gateId);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], signoff_conditions: JSON.stringify(data.remainingConditions || []) };
        return next;
      }
      return list;
    });
    store.update('activity.items', (items) => [{ event: 'phase:conditions:resolved', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('phase:conditions:resolved', data);
    engine.dispatch('activity:new', { event: 'phase:conditions:resolved', ...data });
  });

  socket.on('escalation:stale-gate', (data) => {
    log.warn('Escalation: stale gate', data);
    store.update('escalation.staleGates', (gates) => {
      const list = gates || [];
      // Deduplicate by gateId
      if (list.some((g) => g.gateId === data.gateId)) return list;
      return [data, ...list].slice(0, 50);
    });
    store.update('activity.items', (items) => [{ event: 'escalation:stale-gate', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('escalation:stale-gate', data);
    engine.dispatch('activity:new', { event: 'escalation:stale-gate', ...data });
  });

  socket.on('escalation:war-room', (data) => {
    log.warn('Escalation: War Room activated', data);
    store.update('escalation.warRooms', (rooms) => {
      const list = rooms || [];
      if (list.some((r) => r.warRoomId === data.warRoomId)) return list;
      return [{ ...data, timestamp: Date.now() }, ...list].slice(0, 20);
    });
    store.update('activity.items', (items) => [{ event: 'escalation:war-room', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('escalation:war-room', data);
    engine.dispatch('activity:new', { event: 'escalation:war-room', ...data });
  });

  // ── Dev Loop Pipeline ──

  socket.on('dev-loop:stage-transition', (data) => {
    log.info('Dev loop transition:', data.from, '→', data.to);
    store.update('devLoop.transitions', (items) => [{ ...data, timestamp: Date.now() }, ...(items || []).slice(0, 50)]);
    store.update('activity.items', (items) => [{ event: 'dev-loop:stage-transition', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('dev-loop:stage-transition', data);
    engine.dispatch('activity:new', { event: 'dev-loop:stage-transition', ...data });
  });

  // ── Floor events ──

  socket.on('floor:created', (data) => {
    const buildingId = store.get('building.active');
    if (buildingId && window.overlordSocket) window.overlordSocket.fetchFloors(buildingId);
    store.update('activity.items', (items) => [{ event: 'floor:created', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('floor:created', data);
    engine.dispatch('activity:new', { event: 'floor:created', ...data });
  });

  socket.on('floor:updated', (data) => {
    const buildingId = store.get('building.active');
    if (buildingId && window.overlordSocket) window.overlordSocket.fetchFloors(buildingId);
    store.update('activity.items', (items) => [{ event: 'floor:updated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('floor:updated', data);
    engine.dispatch('activity:new', { event: 'floor:updated', ...data });
  });

  socket.on('floor:deleted', (data) => {
    const buildingId = store.get('building.active');
    if (buildingId && window.overlordSocket) window.overlordSocket.fetchFloors(buildingId);
    store.update('activity.items', (items) => [{ event: 'floor:deleted', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('floor:deleted', data);
    engine.dispatch('activity:new', { event: 'floor:deleted', ...data });
  });

  socket.on('floor:sorted', (data) => {
    const buildingId = store.get('building.active');
    if (buildingId && window.overlordSocket) window.overlordSocket.fetchFloors(buildingId);
    engine.dispatch('floor:sorted', data);
  });

  // ── Room events ──

  socket.on('room:updated', (data) => {
    store.update('rooms.list', (rooms) => {
      const list = rooms || [];
      const idx = list.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], ...data };
        return next;
      }
      return list;
    });
    store.update('activity.items', (items) => [{ event: 'room:updated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('room:updated', data);
    engine.dispatch('activity:new', { event: 'room:updated', ...data });
  });

  socket.on('room:deleted', (data) => {
    store.update('rooms.list', (rooms) => (rooms || []).filter((r) => r.id !== data.id && r.id !== data.roomId));
    const buildingId = store.get('building.active');
    if (buildingId && window.overlordSocket) window.overlordSocket.fetchFloors(buildingId);
    store.update('activity.items', (items) => [{ event: 'room:deleted', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('room:deleted', data);
    engine.dispatch('activity:new', { event: 'room:deleted', ...data });
  });

  // ── Room escalation (#589) ──
  socket.on('room:escalated', (data) => {
    store.update('activity.items', (items) => [{ event: 'room:escalated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('room:escalated', data);
    engine.dispatch('activity:new', { event: 'room:escalated', ...data });
    // Auto-switch chat to the target room (only if same building)
    if (data.toRoomId && data.buildingId === store.get('building.active')) {
      store.set('rooms.active', data.toRoomId);
    }
  });

  // ── Table events ──

  socket.on('table:created', (data) => {
    store.update('activity.items', (items) => [{ event: 'table:created', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('table:created', data);
    engine.dispatch('activity:new', { event: 'table:created', ...data });
  });

  socket.on('table:updated', (data) => {
    store.update('activity.items', (items) => [{ event: 'table:updated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('table:updated', data);
    engine.dispatch('activity:new', { event: 'table:updated', ...data });
  });

  socket.on('table:deleted', (data) => {
    store.update('activity.items', (items) => [{ event: 'table:deleted', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('table:deleted', data);
    engine.dispatch('activity:new', { event: 'table:deleted', ...data });
  });

  socket.on('table:context-updated', (data) => {
    engine.dispatch('table:context-updated', data);
  });

  socket.on('table:work-divided', (data) => {
    store.update('activity.items', (items) => [{ event: 'table:work-divided', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('table:work-divided', data);
    engine.dispatch('activity:new', { event: 'table:work-divided', ...data });
  });

  // ── Table presence events (#1255) ──

  socket.on('table:presence-changed', (data) => {
    if (data && data.tableId) {
      // Update presence map in store
      store.update('tables.presence', (pres) => {
        const map = { ...(pres || {}) };
        map[data.tableId] = data.occupants || [];
        return map;
      });
      engine.dispatch('table:presence-changed', data);
    }
  });

  // ── Agent profile events ──

  socket.on('agent:profile-updated', (data) => {
    if (!isActiveBuilding(data)) return; // #850 — building isolation
    store.update('agents.list', (agents) => {
      const list = agents || [];
      const idx = list.findIndex((a) => a.id === data.agentId || a.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        // Spread the profile object (actual agent fields), not the event wrapper
        next[idx] = { ...next[idx], ...(data.profile || {}) };
        return next;
      }
      return list;
    });
    store.update('activity.items', (items) => [{ event: 'agent:profile-updated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('agent:profile-updated', data);
    engine.dispatch('activity:new', { event: 'agent:profile-updated', ...data });
  });

  socket.on('agent:profile-generated', (data) => {
    if (!isActiveBuilding(data)) return; // #850 — building isolation
    // profile-generated carries generation metadata, not agent fields —
    // the actual profile update is handled by agent:profile-updated above.
    // Only update activity feed, do not spread metadata onto agent object.
    store.update('activity.items', (items) => [{ event: 'agent:profile-generated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('agent:profile-generated', data);
    engine.dispatch('activity:new', { event: 'agent:profile-generated', ...data });
  });

  // ── Task/Todo assignment events ──

  socket.on('task:assigned', (data) => {
    if (!isActiveBuilding(data)) return;
    store.update('tasks.list', (tasks) => {
      const list = tasks || [];
      const idx = list.findIndex((t) => t.id === data.taskId || t.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], ...data };
        return next;
      }
      return list;
    });
    pushActivity('task:assigned', data);
    engine.dispatch('task:assigned', data);
  });

  socket.on('todo:assigned', (data) => {
    store.update('todos.list', (todos) => {
      const list = todos || [];
      const idx = list.findIndex((t) => t.id === data.todoId || t.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = { ...next[idx], agent_id: data.agentId };
        return next;
      }
      return list;
    });
    engine.dispatch('todo:assigned', data);
  });

  // ── Error/failure events ──

  socket.on('building:onboard-failed', (data) => {
    log.error('Building onboard failed:', data);
    store.update('activity.items', (items) => [{ event: 'building:onboard-failed', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('building:onboard-failed', data);
    engine.dispatch('activity:new', { event: 'building:onboard-failed', ...data });
  });

  socket.on('escalation:failed', (data) => {
    log.error('Escalation failed:', data);
    store.update('activity.items', (items) => [{ event: 'escalation:failed', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('escalation:failed', data);
    engine.dispatch('activity:new', { event: 'escalation:failed', ...data });
  });

  // ── Citation events ──

  socket.on('citation:added', (data) => {
    store.update('activity.items', (items) => [{ event: 'citation:added', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('citation:added', data);
    engine.dispatch('activity:new', { event: 'citation:added', ...data });
  });

  // ── Client emit wrappers (convenience for components) ──

  /** Default timeout (ms) for socket ack responses */
  const ACK_TIMEOUT = 15000;

  /**
   * Wrap a socket.emit with a timeout so the promise always settles.
   * Returns { ok: false, error: { code: 'TIMEOUT', ... } } on timeout.
   */
  function _emitWithTimeout(event, data, timeoutMs = ACK_TIMEOUT) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          log.warn(`${event} timed out after ${timeoutMs}ms`);
          resolve({ ok: false, error: { code: 'TIMEOUT', message: `Server did not respond within ${timeoutMs / 1000}s`, retryable: true } });
        }
      }, timeoutMs);

      socket.emit(event, data, (res) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(res);
        }
      });
    });
  }

  /**
   * Emit a socket event with error feedback.
   * On error responses (res.ok === false), dispatches an engine event
   * so the UI can show error feedback (toast, banner, etc).
   */
  function _emitWithFeedback(event, data, timeoutMs) {
    return _emitWithTimeout(event, data, timeoutMs).then((res) => {
      if (res && !res.ok) {
        const errorMsg = res.error?.message || res.error || 'Operation failed';
        const errorCode = res.error?.code || 'UNKNOWN';
        log.warn(`${event} failed:`, errorMsg);
        engine.dispatch('operation:error', { event, code: errorCode, message: errorMsg });
      }
      return res;
    });
  }

  /** Fetch a building with floors */
  window.overlordSocket = {
    socket,

    /** Get the currently active building ID from the store. */
    _getActiveBuildingId() {
      return store.get('building.active') || null;
    },

    emit(event, data) {
      return _emitWithFeedback(event, data);
    },

    /**
     * Emit a socket event and return the raw ack response.
     * Unlike emit(), this does NOT dispatch operation:error on failure.
     * Used when callers want to handle errors themselves (e.g., citations).
     */
    emitWithAck(event, data) {
      return _emitWithTimeout(event, data);
    },

    fetchBuilding(buildingId) {
      return _emitWithTimeout('building:get', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('building.data', res.data);
        }
        return res;
      });
    },

    fetchHealthScore(buildingId) {
      return _emitWithTimeout('building:health-score', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('building.healthScore', res.data);
        }
        return res;
      });
    },

    fetchFloors(buildingId) {
      return _emitWithTimeout('floor:list', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('building.floors', res.data);
        }
        return res;
      });
    },

    fetchFloor(floorId) {
      return _emitWithTimeout('floor:get', { floorId });
    },

    fetchRoom(roomId) {
      return _emitWithTimeout('room:get', { roomId });
    },

    fetchRooms() {
      return _emitWithTimeout('room:list', {}).then((res) => {
        if (res && res.ok) {
          store.set('rooms.list', res.data);
        }
        return res;
      });
    },

    fetchAgents(filters = {}) {
      return _emitWithTimeout('agent:list', filters).then((res) => {
        if (res && res.ok) {
          store.set('agents.list', res.data);
          // Build agent positions map from current_room_id data
          const positions = {};
          for (const agent of res.data) {
            if (agent.current_room_id) {
              positions[agent.id] = {
                agentId: agent.id,
                name: agent.name,
                roomId: agent.current_room_id,
                tableId: agent.current_table_id,
                status: agent.status || 'idle',
                floorId: null, // Not available from agent data alone
              };
            }
          }
          store.set('building.agentPositions', positions);
        }
        return res;
      });
    },

    fetchAgent(agentId) {
      return _emitWithTimeout('agent:get', { agentId });
    },

    fetchGates(buildingId) {
      return _emitWithTimeout('phase:gates', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('phase.gates', res.data);
        }
        return res;
      });
    },

    fetchCanAdvance(buildingId) {
      return _emitWithTimeout('phase:can-advance', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('phase.canAdvance', res.data.canAdvance);
        }
        return res;
      });
    },

    fetchPendingGates(buildingId) {
      return _emitWithTimeout('phase:pending-gates', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('phase.pendingGates', res.data);
        }
        return res;
      });
    },

    resolveConditions(gateId, resolvedConditions, resolver) {
      return _emitWithTimeout('phase:resolve-conditions', { gateId, resolvedConditions, resolver });
    },

    fetchStaleGates(thresholdMs) {
      return _emitWithTimeout('phase:stale-gates', { thresholdMs }).then((res) => {
        if (res && res.ok) {
          store.set('phase.staleGates', res.data);
        }
        return res;
      });
    },

    fetchPhaseOrder() {
      return _emitWithTimeout('phase:order', {}).then((res) => {
        if (res && res.ok) {
          store.set('phase.order', res.data);
        }
        return res;
      });
    },

    searchRaid(params) {
      return _emitWithTimeout('raid:search', params).then((res) => {
        if (res && res.ok) {
          store.set('raid.searchResults', res.data);
        }
        return res;
      });
    },

    fetchActivityHistory(buildingId, opts = {}) {
      return _emitWithTimeout('activity:history', {
        buildingId,
        limit: opts.limit || 100,
        offset: opts.offset || 0,
        eventType: opts.eventType,
      }).then((res) => {
        if (res && res.ok) {
          // Normalize DB field names to match the activity view's expected format (#721)
          const normalized = (res.data || []).map(item => {
            const eventData = typeof item.event_data === 'string' ? JSON.parse(item.event_data || '{}') : (item.event_data || {});
            return {
              ...eventData,
              event: item.event_type || item.event || eventData.event || '',
              type: item.event_type || item.type || '',
              agentId: item.agent_id || item.agentId || eventData.agentId || '',
              agentName: item.agent_display_name || eventData.agentName || '',
              roomId: item.room_id || item.roomId || eventData.roomId || '',
              ts: item.created_at || item.ts || '',
              buildingId: item.building_id || item.buildingId || '',
              id: item.id,
            };
          });
          store.set('activity.items', normalized);
        }
        return res;
      });
    },

    fetchRaidEntries(buildingId) {
      return _emitWithTimeout('raid:list', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('raid.entries', res.data);
        }
        return res;
      });
    },

    async createBuilding(params) {
      const res = await _emitWithFeedback('building:create', params);
      if (res && res.ok) {
        store.update('building.list', (list) => [...(list || []), res.data]);
      }
      return res;
    },

    applyBlueprint(params) {
      return _emitWithFeedback('building:apply-blueprint', params, 60000);
    },

    // ── Repo operations (#640) ──

    addRepo(params) {
      return _emitWithFeedback('repo:add', params);
    },

    removeRepo(params) {
      return _emitWithFeedback('repo:remove', params);
    },

    listRepos(buildingId) {
      return _emitWithFeedback('repo:list', { buildingId });
    },

    analyzeRepos(params) {
      return _emitWithFeedback('repo:analyze', params, 30000);
    },

    /** Analyze a local codebase directory (#872) */
    analyzeCodebase(directoryPath, enhanceWithAI = false) {
      return _emitWithFeedback('codebase:analyze', { directoryPath, enhanceWithAI }, 30000);
    },

    repoSyncStatus(buildingId) {
      return _emitWithFeedback('repo:sync-status', { buildingId }, 30000);
    },

    repoSyncFetch(buildingId, repoId) {
      return _emitWithFeedback('repo:sync-fetch', { buildingId, repoId }, 20000);
    },

    async registerAgent(params) {
      const res = await _emitWithFeedback('agent:register', params);
      if (res && res.ok) {
        store.update('agents.list', (list) => [...(list || []), res.data]);
      }
      return res;
    },

    createRoom(params) {
      return _emitWithFeedback('room:create', params);
    },

    async updateRoom(roomId, updates) {
      const res = await _emitWithFeedback('room:update', { roomId, ...updates });
      if (res && res.ok) {
        this.fetchRooms();
        const buildingId = store.get('building.active');
        if (buildingId) this.fetchFloors(buildingId);
      }
      return res;
    },

    async deleteRoom(roomId) {
      const res = await _emitWithFeedback('room:delete', { roomId });
      if (res && res.ok) {
        store.update('rooms.list', (rooms) => (rooms || []).filter((r) => r.id !== roomId));
        const buildingId = store.get('building.active');
        if (buildingId) this.fetchFloors(buildingId);
      }
      return res;
    },

    escalateToRoom(fromRoomId, toRoomType, buildingId, reason, contextSummary) {
      return _emitWithFeedback('room:escalate', { fromRoomId, toRoomType, buildingId, reason, contextSummary });
    },

    enterRoom(roomId, agentId, tableType) {
      return _emitWithFeedback('room:enter', { roomId, agentId, tableType });
    },

    exitRoom(roomId, agentId) {
      return _emitWithFeedback('room:exit', { roomId, agentId });
    },

    async moveAgent(agentId, roomId, tableType = null) {
      const res = await _emitWithFeedback('agent:move', { agentId, roomId, tableType });
      if (res && res.ok) {
        this.fetchAgents({ buildingId: store.get('building.active') || '' });
      }
      return res;
    },

    // ── Floor methods ──

    async createFloor(buildingId, type, name, opts = {}) {
      const res = await _emitWithFeedback('floor:create', { buildingId, type, name, ...opts });
      if (res && res.ok) {
        this.fetchFloors(buildingId);
      }
      return res;
    },

    async updateFloor(floorId, updates) {
      const res = await _emitWithFeedback('floor:update', { floorId, ...updates });
      if (res && res.ok) {
        const buildingId = store.get('building.active');
        if (buildingId) this.fetchFloors(buildingId);
      }
      return res;
    },

    async deleteFloor(floorId) {
      const res = await _emitWithFeedback('floor:delete', { floorId });
      if (res && res.ok) {
        const buildingId = store.get('building.active');
        if (buildingId) this.fetchFloors(buildingId);
      }
      return res;
    },

    async sortFloors(buildingId, floorIds) {
      const res = await _emitWithFeedback('floor:sort', { buildingId, floorIds });
      if (res && res.ok) {
        this.fetchFloors(buildingId);
      }
      return res;
    },

    // ── Building update ──

    async updateBuilding(buildingId, updates) {
      const res = await _emitWithFeedback('building:update', { buildingId, ...updates });
      if (res && res.ok) {
        store.update('building.data', (data) => data ? { ...data, ...updates } : data);
        store.update('building.list', (list) => {
          const arr = list || [];
          const idx = arr.findIndex((b) => b.id === buildingId);
          if (idx >= 0) {
            const next = [...arr];
            next[idx] = { ...next[idx], ...updates };
            return next;
          }
          return arr;
        });
      }
      return res;
    },

    async deleteBuilding(buildingId) {
      const res = await _emitWithFeedback('building:delete', { buildingId });
      if (res && res.ok) {
        store.update('building.list', (list) => (list || []).filter((b) => b.id !== buildingId));
        if (store.get('building.active') === buildingId) {
          store.set('building.active', null);
        }
      }
      return res;
    },

    // ── Building Execution Controls (#1125) ──

    async startBuilding(buildingId) {
      return _emitWithFeedback('building:start', { buildingId });
    },

    async pauseBuilding(buildingId) {
      return _emitWithFeedback('building:pause', { buildingId });
    },

    async stopBuilding(buildingId) {
      return _emitWithFeedback('building:stop', { buildingId });
    },

    // ── Table methods ──

    async createTable(roomId, type, chairs = 1, description) {
      return _emitWithFeedback('table:create', { roomId, type, chairs, description });
    },

    async updateTable(tableId, updates) {
      return _emitWithFeedback('table:update', { tableId, ...updates });
    },

    async deleteTable(tableId) {
      return _emitWithFeedback('table:delete', { tableId });
    },

    fetchTables(roomId) {
      return _emitWithTimeout('table:list', { roomId });
    },

    // ── Agent profile methods ──

    async updateAgentProfile(agentId, profile) {
      const res = await _emitWithFeedback('agent:update-profile', { agentId, ...profile });
      if (res && res.ok) {
        this.fetchAgents({ buildingId: store.get('building.active') || '' });
      }
      return res;
    },

    async generateAgentPhoto(agentId) {
      return _emitWithFeedback('agent:generate-photo', { agentId }, 45000);
    },

    async generateAgentProfile(agentId) {
      return _emitWithFeedback('agent:generate-profile', { agentId }, 45000);
    },

    sendMessage(params) {
      const { content, text, agentId, tokens, buildingId, roomId, attachments, recipients, messageMode } = params;
      const messageText = text || content || '';
      const activeRoom = roomId || store.get('rooms.active') || '';
      const activeBuilding = buildingId || store.get('building.active') || '';
      const activeTable = store.get('tables.activeChat') || ''; // Table-scoped chat (#1255)
      const threadId = store.get('conversations.active') || '';
      const attachMeta = (attachments || []).map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, size: a.size }));
      store.update('chat.messages', (msgs) => [...(msgs || []), {
        id: Date.now().toString(), role: 'user', content: messageText, agentId,
        tableId: activeTable || undefined,
        attachments: attachMeta, type: 'user', timestamp: Date.now(),
        recipients: recipients || [], messageMode: messageMode || 'broadcast',
      }]);
      store.set('ui.processing', true);
      socket.emit('chat:message', {
        text: messageText, agentId: agentId || '', tokens: tokens || [],
        attachments: attachments || [], buildingId: activeBuilding,
        roomId: activeRoom, tableId: activeTable, threadId,
        recipients: recipients || [], messageMode: messageMode || 'broadcast',
      });
    },

    // ── Conversation methods ──

    fetchConversations(buildingId) {
      return _emitWithTimeout('conversation:list', { buildingId: buildingId || store.get('building.active') || '' }).then((res) => {
        if (res && res.ok) {
          store.set('conversations.list', res.data);
        }
        return res;
      });
    },

    loadConversation(threadId) {
      return _emitWithTimeout('conversation:load', { threadId }).then((res) => {
        if (res && res.ok) {
          store.set('conversations.active', threadId);
          const messages = (res.data || []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentId: m.agentId,
            toolCalls: m.toolCalls,
            attachments: m.attachments || [],
            type: m.role === 'user' ? 'user' : 'response',
            timestamp: m.timestamp,
          }));
          store.set('chat.messages', messages);
        }
        return res;
      });
    },

    createConversation(title) {
      const roomId = store.get('rooms.active') || '';
      const buildingId = store.get('building.active') || '';
      return _emitWithTimeout('conversation:create', { title, roomId, buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('conversations.active', res.data.threadId);
          store.set('chat.messages', []);
          this.fetchConversations(buildingId);
        }
        return res;
      });
    },

    deleteConversation(threadId) {
      return _emitWithTimeout('conversation:delete', { threadId }).then((res) => {
        if (res && res.ok) {
          if (store.get('conversations.active') === threadId) {
            store.set('conversations.active', '');
            store.set('chat.messages', []);
          }
          const buildingId = store.get('building.active') || '';
          this.fetchConversations(buildingId);
        }
        return res;
      });
    },

    // ── Plan methods ──

    submitPlan(params) {
      return _emitWithFeedback('plan:submit', params);
    },

    reviewPlan(planId, verdict, comment, reviewer) {
      return _emitWithFeedback('plan:review', { planId, verdict, comment: comment || '', reviewer: reviewer || 'user' });
    },

    fetchPlan(planId) {
      return _emitWithTimeout('plan:get', { planId });
    },

    fetchPlans(filters) {
      return _emitWithTimeout('plan:list', filters || {}).then((res) => {
        if (res && res.ok) {
          store.set('plans.list', res.data);
        }
        return res;
      });
    },

    submitExitDoc(params) {
      return _emitWithFeedback('exit-doc:submit', params);
    },

    fetchExitDocs(roomId) {
      return _emitWithTimeout('exit-doc:get', { roomId }).then((res) => {
        if (res && res.ok) {
          store.set('exitDocs.byRoom', res.data);
        }
        return res;
      });
    },

    fetchExitDocsByBuilding(buildingId) {
      return _emitWithTimeout('exit-doc:list', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('exitDocs.list', res.data);
        }
        return res;
      });
    },

    submitGate(data) {
      return _emitWithFeedback('phase:gate', data);
    },

    // ── Task methods ──

    fetchTasks(buildingId, filters = {}) {
      return _emitWithTimeout('task:list', { buildingId, ...filters }).then((res) => {
        if (res && res.ok) {
          store.set('tasks.list', res.data);
        }
        return res;
      });
    },

    async createTask(params) {
      const res = await _emitWithFeedback('task:create', params);
      if (res && res.ok) {
        store.update('tasks.list', (tasks) => {
          const list = tasks || [];
          // Dedup — real-time task:created event may have already added this (#787)
          if (res.data?.id && list.some((t) => t.id === res.data.id)) return list;
          return [res.data, ...list];
        });
      }
      return res;
    },

    async updateTask(params) {
      const res = await _emitWithFeedback('task:update', params);
      if (res && res.ok) {
        store.update('tasks.list', (tasks) => {
          const list = tasks || [];
          const idx = list.findIndex((t) => t.id === (res.data.id || params.id));
          if (idx >= 0) {
            const next = [...list];
            // Merge response with existing task (#1123) — don't replace with partial data
            next[idx] = { ...list[idx], ...res.data };
            return next;
          }
          return list;
        });
      }
      return res;
    },

    getTask(taskId) {
      return _emitWithTimeout('task:get', { id: taskId });
    },

    async deleteTask(taskId) {
      const res = await _emitWithTimeout('task:delete', { id: taskId });
      if (res && res.ok) {
        store.update('tasks.list', (tasks) => (tasks || []).filter(t => t.id !== taskId));
      }
      return res;
    },

    // ── Milestone methods ──

    fetchMilestones(buildingId, filters = {}) {
      return _emitWithTimeout('milestone:list', { buildingId, ...filters }).then((res) => {
        if (res && res.ok) {
          store.set('milestones.list', res.data);
        }
        return res;
      });
    },

    async createMilestone(params) {
      const res = await _emitWithFeedback('milestone:create', params);
      if (res && res.ok) {
        store.update('milestones.list', (milestones) => [res.data, ...(milestones || [])]);
      }
      return res;
    },

    async updateMilestone(params) {
      const res = await _emitWithFeedback('milestone:update', params);
      if (res && res.ok) {
        store.update('milestones.list', (milestones) => {
          const list = milestones || [];
          const idx = list.findIndex((m) => m.id === res.data.id);
          if (idx >= 0) {
            const next = [...list];
            next[idx] = res.data;
            return next;
          }
          return list;
        });
      }
      return res;
    },

    async deleteMilestone(milestoneId) {
      const res = await _emitWithFeedback('milestone:delete', { id: milestoneId });
      if (res && res.ok) {
        store.update('milestones.list', (milestones) => {
          const list = milestones || [];
          return list.filter((m) => m.id !== milestoneId);
        });
      }
      return res;
    },

    getMilestone(milestoneId) {
      return _emitWithTimeout('milestone:get', { id: milestoneId });
    },

    // ── TODO methods ──

    fetchTodos(taskId) {
      return _emitWithTimeout('todo:list', { taskId }).then((res) => {
        if (res && res.ok) {
          store.set('todos.list', res.data);
        }
        return res;
      });
    },

    async createTodo(params) {
      const res = await _emitWithFeedback('todo:create', params);
      if (res && res.ok) {
        store.update('todos.list', (todos) => [...(todos || []), res.data]);
      }
      return res;
    },

    async toggleTodo(todoId) {
      const res = await _emitWithFeedback('todo:toggle', { id: todoId });
      if (res && res.ok) {
        store.update('todos.list', (todos) => {
          const list = todos || [];
          const idx = list.findIndex((t) => t.id === res.data.id);
          if (idx >= 0) {
            const next = [...list];
            next[idx] = res.data;
            return next;
          }
          return list;
        });
      }
      return res;
    },

    async deleteTodo(todoId) {
      const res = await _emitWithFeedback('todo:delete', { id: todoId });
      if (res && res.ok) {
        store.update('todos.list', (todos) => {
          const list = todos || [];
          return list.filter((t) => t.id !== todoId);
        });
      }
      return res;
    },

    async assignTaskToTable(taskId, tableId) {
      const res = await _emitWithFeedback('task:assign-table', { taskId, tableId });
      if (res && res.ok) {
        store.update('tasks.list', (tasks) => {
          const list = tasks || [];
          return list.map((t) => t.id === taskId ? { ...t, table_id: tableId } : t);
        });
      }
      return res;
    },

    async unassignTaskFromTable(taskId) {
      const res = await _emitWithFeedback('task:unassign-table', { taskId });
      if (res && res.ok) {
        store.update('tasks.list', (tasks) => {
          const list = tasks || [];
          return list.map((t) => t.id === taskId ? { ...t, table_id: null } : t);
        });
      }
      return res;
    },

    /**
     * Fetch tasks filtered by table ID.
     * Returns tasks assigned to a specific table without overwriting
     * the global tasks.list store key.
     */
    listTasksByTable(tableId) {
      return _emitWithTimeout('task:list', { tableId });
    },

    async assignTodoToAgent(todoId, agentId) {
      const res = await _emitWithFeedback('todo:assign-agent', { todoId, agentId });
      if (res && res.ok) {
        store.update('todos.list', (todos) => {
          const list = todos || [];
          return list.map((t) => t.id === todoId ? { ...t, agent_id: agentId } : t);
        });
      }
      return res;
    },

    async unassignTodoFromAgent(todoId) {
      const res = await _emitWithFeedback('todo:unassign-agent', { todoId });
      if (res && res.ok) {
        store.update('todos.list', (todos) => {
          const list = todos || [];
          return list.map((t) => t.id === todoId ? { ...t, agent_id: null } : t);
        });
      }
      return res;
    },

    async listTodosByAgent(agentId) {
      const res = await _emitWithFeedback('todo:list', { agentId });
      if (res && res.ok) {
        store.set('todos.byAgent.' + agentId, res.data);
      }
      return res;
    },

    // ── Command methods ──

    fetchCommands() {
      return _emitWithTimeout('command:list', {}).then((res) => {
        if (res && res.ok) {
          store.set('commands.list', res.data);
        }
        return res;
      });
    },

    // ── RAID methods ──

    async addRaidEntry(params) {
      // Don't update store here — the 'raid:entry:added' broadcast listener handles it
      // to avoid duplicate entries in the store
      return _emitWithFeedback('raid:add', params);
    },

    async updateRaidStatus(params) {
      // Don't update store here — the 'raid:entry:updated' broadcast listener handles it
      return _emitWithFeedback('raid:update', params);
    },

    async editRaidEntry(params) {
      // Don't update store here — the 'raid:entry:updated' broadcast listener handles it
      return _emitWithFeedback('raid:edit', params);
    },

    async deleteRaidEntry(id) {
      const res = await _emitWithTimeout('raid:delete', { id });
      if (res && res.ok) {
        store.update('raid.entries', (entries) => (entries || []).filter(e => e.id !== id));
      }
      return res;
    },

    // ── Phase Gate methods ──

    createGate(buildingId, phase, criteria) {
      return _emitWithFeedback('phase:gate:create', { buildingId, phase, ...(criteria ? { criteria } : {}) });
    },

    signoffGate(params) {
      return _emitWithFeedback('phase:gate:signoff', params);
    },

    // Alias for signoffGate — some callers use capital-O spelling
    signOffGate(params) {
      return this.signoffGate(params);
    },

    async advancePhase(buildingId, reviewer) {
      const res = await _emitWithFeedback('phase:advance', { buildingId, reviewer });
      if (res && res.ok) {
        // Refresh phase state after advancement
        this.fetchGates(buildingId);
        this.fetchCanAdvance(buildingId);
      }
      return res;
    },

    async selectBuilding(buildingId) {
      // Join the building's Socket.IO room for scoped event delivery (#593)
      socket.emit('building:select', { buildingId });

      // Clear stale data from the previous building so views don't
      // show cached lists while the new building's data loads.
      store.batch(() => {
        store.set('building.active', buildingId);
        store.set('building.floors', []);
        store.set('rooms.list', []);
        store.set('rooms.active', null);
        store.set('agents.list', []);
        store.set('building.agentPositions', {});
        store.set('tasks.list', []);
        store.set('raid.entries', []);
        store.set('chat.messages', []);
        store.set('building.activePhase', 'strategy');
      });
      const results = await Promise.all([
        this.fetchBuilding(buildingId),
        this.fetchFloors(buildingId),
        this.fetchAgents({ buildingId }),
        this.fetchGates(buildingId),
        this.fetchCanAdvance(buildingId),
        this.fetchRaidEntries(buildingId),
        this.fetchRooms(),
        this.fetchTasks(buildingId),
        this.fetchConversations(buildingId),
      ]);
      // Set active phase from building data
      const buildingRes = results[0];
      if (buildingRes && buildingRes.ok && buildingRes.data) {
        store.set('building.activePhase', buildingRes.data.active_phase || 'strategy');
      }
      // Auto-select a room on the floor matching the current phase
      if (!store.get('rooms.active')) {
        const PHASE_TO_FLOOR = {
          strategy: 'strategy', discovery: 'collaboration',
          architecture: 'collaboration', execution: 'execution',
          review: 'governance', deploy: 'operations',
        };
        const activePhase = store.get('building.activePhase') || 'strategy';
        const floors = store.get('building.floors') || [];
        const floorType = PHASE_TO_FLOOR[activePhase] || activePhase;
        const matchingFloor = floors.find(f => f.type === floorType);

        if (matchingFloor && matchingFloor.rooms && matchingFloor.rooms.length > 0) {
          const room = matchingFloor.rooms.find(r => r.status === 'active') || matchingFloor.rooms[0];
          store.set('rooms.active', room.id);
        } else {
          // Fallback: first room in the building
          const rooms = store.get('rooms.list') || [];
          if (rooms.length > 0) store.set('rooms.active', rooms[0].id);
        }
      }
    },

    /** Fetch server configuration for settings display. */
    async getServerConfig() {
      return _emitWithFeedback('settings:get-config', {});
    },

    // ── Chat History (#764) ──

    fetchChatHistory(roomId, opts = {}) {
      return _emitWithTimeout('chat:history', {
        roomId: roomId || '',
        tableId: opts.tableId || '', // Table-scoped chat (#1255)
        limit: opts.limit || 50,
        before: opts.before,
      }).then((res) => {
        if (res && res.ok) {
          // Merge into chat.messages store
          const existing = store.get('chat.messages') || [];
          const existingIds = new Set(existing.map(m => m.id));
          const newMsgs = (res.data || []).filter(m => !existingIds.has(m.id));
          if (newMsgs.length > 0) {
            store.set('chat.messages', [...newMsgs, ...existing]);
          }
        }
        return res;
      });
    },

    // ── Table Chat methods (#1255) ──

    fetchTableChatList(buildingId) {
      return _emitWithTimeout('table:chat-list', { buildingId }).then((res) => {
        if (res && res.ok) {
          store.set('tables.chatList', res.data || []);
        }
        return res;
      });
    },

    sendTablePresence(tableId, action) {
      return _emitWithTimeout('table:presence', { tableId, action });
    },

    // ── Agent Stats methods ──

    fetchAgentStats(agentId) {
      return _emitWithTimeout('agent:stats', { agentId }).then((res) => {
        if (res && res.ok) {
          store.set(`agentStats.${agentId}`, res.data);
        }
        return res;
      });
    },

    fetchAgentActivityLog(agentId, opts = {}) {
      return _emitWithTimeout('agent:activity-log', { agentId, ...opts });
    },

    // Building activity history — loads on page mount (#1035)
    async fetchActivityHistory(buildingId, opts = {}) {
      const res = await _emitWithTimeout('building:activity-log', { buildingId, ...opts });
      if (res && res.ok && Array.isArray(res.data)) {
        // Merge into activity.items store, converting DB format to UI format
        const items = res.data.map(entry => ({
          event: entry.event_type,
          agentId: entry.agent_id,
          agentName: entry.agent_display_name || entry.agent_name || entry.agent_id,
          roomId: entry.room_id,
          buildingId: entry.building_id,
          timestamp: new Date(entry.created_at).getTime(),
          ...((() => { try { return typeof entry.event_data === 'string' ? JSON.parse(entry.event_data) : (entry.event_data || {}); } catch { return {}; } })()),
        }));
        store.update('activity.items', (existing) => {
          const merged = [...items, ...(existing || [])];
          // Deduplicate by id if available, otherwise keep all
          const seen = new Set();
          return merged.filter(i => { const key = i.id || `${i.event}-${i.timestamp}`; if (seen.has(key)) return false; seen.add(key); return true; });
        });
      }
      return res;
    },

    // Room/Floor activity (#980)
    fetchRoomActivityLog(roomId, opts = {}) {
      return _emitWithTimeout('room:activity-log', { roomId, ...opts });
    },

    fetchFloorActivityLog(floorId, opts = {}) {
      return _emitWithTimeout('floor:activity-log', { floorId, ...opts });
    },

    fetchBuildingActivityLog(buildingId, opts = {}) {
      return _emitWithTimeout('building:activity-log', { buildingId, ...opts });
    },

    // Telemetry rates (#804) — project-level or global
    fetchTelemetryRates(buildingId) {
      return _emitWithTimeout('telemetry:rates', { buildingId: buildingId || undefined });
    },

    fetchLeaderboard(metric, opts = {}) {
      return _emitWithTimeout('agent:leaderboard', { metric, ...opts });
    },

    // ── Global Search ──

    globalSearch(buildingId, query, filters = [], limit = 10) {
      return _emitWithTimeout('search:global', { buildingId, query, filters, limit }).then((res) => {
        if (res && res.ok) {
          store.set('search.results', res.data);
        }
        return res;
      });
    },

    // ── Email methods ──

    async sendAgentEmail(params) {
      const res = await _emitWithFeedback('email:send', params);
      if (res && res.ok) {
        store.update('email.sent', (list) => [res.data, ...(list || [])]);
      }
      return res;
    },

    async replyToEmail(emailId, fromId, body, opts = {}) {
      return _emitWithFeedback('email:reply', { emailId, fromId, body, ...opts });
    },

    async forwardEmail(emailId, fromId, to, body) {
      return _emitWithFeedback('email:forward', { emailId, fromId, to, body });
    },

    fetchInbox(agentId, opts = {}) {
      return _emitWithTimeout('email:inbox', { agentId, ...opts }).then((res) => {
        if (res && res.ok) {
          store.set('email.inbox', res.data);
        }
        return res;
      });
    },

    fetchSentEmails(agentId, opts = {}) {
      return _emitWithTimeout('email:sent', { agentId, ...opts }).then((res) => {
        if (res && res.ok) {
          store.set('email.sent', res.data);
        }
        return res;
      });
    },

    fetchEmail(emailId) {
      return _emitWithTimeout('email:get', { emailId });
    },

    fetchEmailThread(threadId) {
      return _emitWithTimeout('email:thread', { threadId }).then((res) => {
        if (res && res.ok) {
          store.set('email.thread', res.data);
        }
        return res;
      });
    },

    markEmailRead(emailId, agentId) {
      return _emitWithFeedback('email:mark-read', { emailId, agentId });
    },

    fetchUnreadCount(agentId, opts = {}) {
      return _emitWithTimeout('email:unread-count', { agentId, ...opts }).then((res) => {
        if (res && res.ok) {
          store.set('email.unreadCount', res.data?.count ?? 0);
        }
        return res;
      });
    },
  };

  // ── Email event listeners ──

  socket.on('email:received', (data) => {
    log.info('Email received:', data);
    store.update('email.inbox', (inbox) => {
      const list = inbox || [];
      if (data.email && !list.find((e) => e.id === data.email.id)) {
        return [data.email, ...list];
      }
      return list;
    });
    store.update('email.unreadCount', (count) => (count || 0) + 1);
    engine.dispatch('email:received', data);
  });

  socket.on('email:dispatched', (data) => {
    log.info('Email dispatched broadcast:', data);
    engine.dispatch('email:dispatched', data);
  });

  socket.on('email:read', (data) => {
    log.info('Email read:', data);
    store.update('email.inbox', (inbox) => (inbox || []).map((e) =>
      e.id === data.emailId ? { ...e, status: 'read', read_at: new Date().toISOString() } : e
    ));
    store.update('email.unreadCount', (c) => Math.max(0, (c || 0) - 1));
    engine.dispatch('email:read', data);
  });

  // ─── Security Events (#890) ───

  // Add security fetch methods to the bridge
  Object.assign(window.overlordSocket, {
    fetchSecurityStats() {
      return _emitWithTimeout('security:stats', {}).then((res) => {
        if (res && res.ok) store.set('security.stats', res.data);
        return res;
      });
    },
    fetchSecurityEvents(filter = {}) {
      return _emitWithTimeout('security:events', filter).then((res) => {
        if (res && res.ok) store.set('security.events', res.data);
        return res;
      });
    },
  });

  // Real-time security event listener
  socket.on('security:event-logged', (data) => {
    const action = data?.action ?? '';
    store.update('security.stats', (stats) => {
      const s = stats || { total: 0, blocked: 0, warned: 0, allowed: 0 };
      return {
        total: s.total + 1,
        blocked: s.blocked + (action === 'block' ? 1 : 0),
        warned: s.warned + (action === 'warn' ? 1 : 0),
        allowed: s.allowed + (action === 'allow' ? 1 : 0),
      };
    });
    store.update('security.events', (events) => [data, ...(events || []).slice(0, 99)]);
    store.update('activity.items', (items) => [
      { event: 'security:event-logged', ...data, timestamp: Date.now() },
      ...(items || []).slice(0, 99),
    ]);
    engine.dispatch('security:event-logged', data);
    engine.dispatch('activity:new', { event: 'security:event-logged', ...data });
  });

  log.info('v2 bridge initialized');
  return window.overlordSocket;
}
