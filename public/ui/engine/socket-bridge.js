/**
 * Overlord v2 — Socket Bridge
 *
 * Maps v2 Socket.IO events to store updates and engine dispatches.
 * Completely new — v2 events are different from v1.
 */

import { OverlordUI } from './engine.js';

/**
 * Initialize the socket bridge.
 * @param {object} socket — Socket.IO client instance
 * @param {object} store  — v2 Store instance
 * @param {object} engine — OverlordUI engine (for dispatching)
 */
export function initSocketBridge(socket, store, engine) {

  // ── Connection lifecycle ──

  socket.on('connect', () => {
    console.log('[SocketBridge] Connected:', socket.id);
    store.set('ui.connected', true);
    store.set('ui.connectionState', 'connected');

    // Hydrate initial state
    socket.emit('system:status', {}, (res) => {
      if (res && res.ok) {
        store.batch(() => {
          store.set('system.isNewUser', res.data.isNewUser);
          store.set('building.list', res.data.buildings || []);
        });
        engine.dispatch('system:status', res.data);
      }
    });

    socket.emit('system:health', {}, (res) => {
      if (res && res.ok) {
        store.set('system.health', res.data);
      }
    });

    // Re-fetch active building data on reconnect
    const activeBuildingId = store.get('building.active');
    if (activeBuildingId) {
      console.log('[SocketBridge] Reconnected — re-fetching active building data');
      // Use setTimeout to avoid race with system:status hydration
      setTimeout(() => {
        if (window.overlordSocket && window.overlordSocket.selectBuilding) {
          window.overlordSocket.selectBuilding(activeBuildingId);
        }
      }, 100);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('[SocketBridge] Disconnected:', reason);
    store.set('ui.connected', false);
    store.set('ui.connectionState', 'disconnected');
    engine.dispatch('connection:lost', { reason });
  });

  socket.on('connect_error', (error) => {
    console.error('[SocketBridge] Connection error:', error.message);
    store.set('ui.connectionState', 'reconnecting');
    engine.dispatch('connection:error', { message: error.message });
  });

  // ── Reconnection events (Socket.IO Manager) ──

  if (socket.io) {
    socket.io.on('reconnect_attempt', (attempt) => {
      console.log('[SocketBridge] Reconnection attempt:', attempt);
      store.set('ui.connectionState', 'reconnecting');
      engine.dispatch('connection:reconnecting', { attempt });
    });

    socket.io.on('reconnect', (attempt) => {
      console.log('[SocketBridge] Reconnected after', attempt, 'attempts');
      engine.dispatch('connection:reconnected', { attempt });
    });

    socket.io.on('reconnect_failed', () => {
      console.error('[SocketBridge] Reconnection failed permanently');
      store.set('ui.connectionState', 'failed');
      engine.dispatch('connection:failed', {});
    });
  }

  // ── Server → Client broadcasts ──

  socket.on('room:agent:entered', (data) => {
    // Update agent positions map
    store.update('building.agentPositions', (positions) => {
      return { ...(positions || {}), [data.agentId]: { roomId: data.roomId, roomType: data.roomType, tableType: data.tableType, status: 'active', name: data.agentName, agentId: data.agentId } };
    });
    store.update('activity.items', (items) => [{ event: 'room:agent:entered', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('room:agent:entered', data);
    engine.dispatch('activity:new', { event: 'room:agent:entered', ...data });
  });

  socket.on('room:agent:exited', (data) => {
    store.update('building.agentPositions', (positions) => {
      const next = { ...(positions || {}) };
      delete next[data.agentId];
      return next;
    });
    store.update('activity.items', (items) => [{ event: 'room:agent:exited', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('room:agent:exited', data);
    engine.dispatch('activity:new', { event: 'room:agent:exited', ...data });
  });

  socket.on('chat:response', (data) => {
    store.update('chat.messages', (msgs) => [...(msgs || []), { ...data, type: 'response', timestamp: Date.now() }]);
    store.set('ui.processing', false);
    store.set('ui.streaming', false);
    engine.dispatch('chat:response', data);
  });

  socket.on('chat:stream', (data) => {
    store.set('ui.streaming', true);
    engine.dispatch('chat:stream', data);
  });

  socket.on('tool:executed', (data) => {
    store.update('activity.items', (items) => [{ event: 'tool:executed', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('tool:executed', data);
    engine.dispatch('activity:new', { event: 'tool:executed', ...data });
  });

  socket.on('phase:advanced', (data) => {
    store.set('building.activePhase', data.phase || data.nextPhase);
    store.update('activity.items', (items) => [{ event: 'phase:advanced', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('phase:advanced', data);
    engine.dispatch('activity:new', { event: 'phase:advanced', ...data });
  });

  socket.on('raid:entry:added', (data) => {
    store.update('raid.entries', (entries) => [data, ...(entries || [])]);
    store.update('activity.items', (items) => [{ event: 'raid:entry:added', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('raid:entry:added', data);
    engine.dispatch('activity:new', { event: 'raid:entry:added', ...data });
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
    store.update('raid.entries', (entries) => [{ ...data, type: 'scope-change' }, ...(entries || [])]);
    store.update('activity.items', (items) => [{ event: 'scope-change', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('scope-change:detected', data);
    engine.dispatch('activity:new', { event: 'scope-change', ...data });
  });

  socket.on('exit-doc:submitted', (data) => {
    store.update('activity.items', (items) => [{ event: 'exit-doc:submitted', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('exit-doc:submitted', data);
    engine.dispatch('activity:new', { event: 'exit-doc:submitted', ...data });
  });

  socket.on('task:created', (data) => {
    store.update('tasks.list', (tasks) => [data, ...(tasks || [])]);
    store.update('activity.items', (items) => [{ event: 'task:created', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('task:created', data);
    engine.dispatch('activity:new', { event: 'task:created', ...data });
  });

  socket.on('task:updated', (data) => {
    store.update('tasks.list', (tasks) => {
      const list = tasks || [];
      const idx = list.findIndex((t) => t.id === data.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = data;
        return next;
      }
      return [data, ...list];
    });
    store.update('activity.items', (items) => [{ event: 'task:updated', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('task:updated', data);
    engine.dispatch('activity:new', { event: 'task:updated', ...data });
  });

  socket.on('agent:mentioned', (data) => {
    store.update('activity.items', (items) => [{ event: 'agent:mentioned', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('agent:mentioned', data);
    engine.dispatch('activity:new', { event: 'agent:mentioned', ...data });
  });

  socket.on('agent:status-changed', (data) => {
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
      store.set('building.data', data);
    }
    engine.dispatch('building:updated', data);
  });

  socket.on('deploy:check', (data) => {
    store.update('activity.items', (items) => [{ event: 'deploy:check', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('deploy:check', data);
    engine.dispatch('activity:new', { event: 'deploy:check', ...data });
  });

  socket.on('phase:gate:signed-off', (data) => {
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

  // ── Client emit wrappers (convenience for components) ──

  /**
   * Emit a socket event with error feedback.
   * On error responses (res.ok === false), dispatches an engine event
   * so the UI can show error feedback (toast, banner, etc).
   */
  function _emitWithFeedback(event, data) {
    return new Promise((resolve) => {
      socket.emit(event, data, (res) => {
        if (res && !res.ok) {
          const errorMsg = res.error?.message || res.error || 'Operation failed';
          const errorCode = res.error?.code || 'UNKNOWN';
          console.warn(`[SocketBridge] ${event} failed:`, errorMsg);
          engine.dispatch('operation:error', { event, code: errorCode, message: errorMsg });
        }
        resolve(res);
      });
    });
  }

  /** Fetch a building with floors */
  window.overlordSocket = {
    socket,

    emit(event, data) {
      return _emitWithFeedback(event, data);
    },

    fetchBuilding(buildingId) {
      return new Promise((resolve) => {
        socket.emit('building:get', { buildingId }, (res) => {
          if (res && res.ok) {
            store.set('building.data', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchFloors(buildingId) {
      return new Promise((resolve) => {
        socket.emit('floor:list', { buildingId }, (res) => {
          if (res && res.ok) {
            store.set('building.floors', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchFloor(floorId) {
      return new Promise((resolve) => {
        socket.emit('floor:get', { floorId }, (res) => resolve(res));
      });
    },

    fetchRoom(roomId) {
      return new Promise((resolve) => {
        socket.emit('room:get', { roomId }, (res) => resolve(res));
      });
    },

    fetchRooms() {
      return new Promise((resolve) => {
        socket.emit('room:list', {}, (res) => {
          if (res && res.ok) {
            store.set('rooms.list', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchAgents(filters = {}) {
      return new Promise((resolve) => {
        socket.emit('agent:list', filters, (res) => {
          if (res && res.ok) {
            store.set('agents.list', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchAgent(agentId) {
      return new Promise((resolve) => {
        socket.emit('agent:get', { agentId }, (res) => resolve(res));
      });
    },

    fetchGates(buildingId) {
      return new Promise((resolve) => {
        socket.emit('phase:gates', { buildingId }, (res) => {
          if (res && res.ok) {
            store.set('phase.gates', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchCanAdvance(buildingId) {
      return new Promise((resolve) => {
        socket.emit('phase:can-advance', { buildingId }, (res) => {
          if (res && res.ok) {
            store.set('phase.canAdvance', res.data.canAdvance);
          }
          resolve(res);
        });
      });
    },

    fetchPendingGates(buildingId) {
      return new Promise((resolve) => {
        socket.emit('phase:pending-gates', { buildingId }, (res) => {
          if (res && res.ok) {
            store.set('phase.pendingGates', res.data);
          }
          resolve(res);
        });
      });
    },

    resolveConditions(gateId, resolvedConditions, resolver) {
      return new Promise((resolve) => {
        socket.emit('phase:resolve-conditions', { gateId, resolvedConditions, resolver }, (res) => {
          resolve(res);
        });
      });
    },

    fetchStaleGates(thresholdMs) {
      return new Promise((resolve) => {
        socket.emit('phase:stale-gates', { thresholdMs }, (res) => {
          if (res && res.ok) {
            store.set('phase.staleGates', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchPhaseOrder() {
      return new Promise((resolve) => {
        socket.emit('phase:order', {}, (res) => {
          if (res && res.ok) {
            store.set('phase.order', res.data);
          }
          resolve(res);
        });
      });
    },

    searchRaid(params) {
      return new Promise((resolve) => {
        socket.emit('raid:search', params, (res) => {
          if (res && res.ok) {
            store.set('raid.searchResults', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchRaidEntries(buildingId) {
      return new Promise((resolve) => {
        socket.emit('raid:list', { buildingId }, (res) => {
          if (res && res.ok) {
            store.set('raid.entries', res.data);
          }
          resolve(res);
        });
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
      return _emitWithFeedback('building:apply-blueprint', params);
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

    enterRoom(roomId, agentId, tableType) {
      return _emitWithFeedback('room:enter', { roomId, agentId, tableType });
    },

    exitRoom(roomId, agentId) {
      return _emitWithFeedback('room:exit', { roomId, agentId });
    },

    sendMessage(params) {
      const { content, agentId, tokens, buildingId } = params;
      store.update('chat.messages', (msgs) => [...(msgs || []), { content, agentId, type: 'user', timestamp: Date.now() }]);
      store.set('ui.processing', true);
      socket.emit('chat:message', { content, agentId, tokens, buildingId });
    },

    submitExitDoc(params) {
      return _emitWithFeedback('exit-doc:submit', params);
    },

    fetchExitDocs(roomId) {
      return new Promise((resolve) => {
        socket.emit('exit-doc:get', { roomId }, (res) => {
          if (res && res.ok) {
            store.set('exitDocs.byRoom', res.data);
          }
          resolve(res);
        });
      });
    },

    fetchExitDocsByBuilding(buildingId) {
      return new Promise((resolve) => {
        socket.emit('exit-doc:list', { buildingId }, (res) => {
          if (res && res.ok) {
            store.set('exitDocs.list', res.data);
          }
          resolve(res);
        });
      });
    },

    submitGate(data) {
      return _emitWithFeedback('phase:gate', data);
    },

    // ── Task methods ──

    fetchTasks(buildingId, filters = {}) {
      return new Promise((resolve) => {
        socket.emit('task:list', { buildingId, ...filters }, (res) => {
          if (res && res.ok) {
            store.set('tasks.list', res.data);
          }
          resolve(res);
        });
      });
    },

    async createTask(params) {
      const res = await _emitWithFeedback('task:create', params);
      if (res && res.ok) {
        store.update('tasks.list', (tasks) => [res.data, ...(tasks || [])]);
      }
      return res;
    },

    async updateTask(params) {
      const res = await _emitWithFeedback('task:update', params);
      if (res && res.ok) {
        store.update('tasks.list', (tasks) => {
          const list = tasks || [];
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

    getTask(taskId) {
      return new Promise((resolve) => {
        socket.emit('task:get', { id: taskId }, (res) => resolve(res));
      });
    },

    // ── TODO methods ──

    fetchTodos(taskId) {
      return new Promise((resolve) => {
        socket.emit('todo:list', { taskId }, (res) => {
          if (res && res.ok) {
            store.set('todos.list', res.data);
          }
          resolve(res);
        });
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

    // ── Command methods ──

    fetchCommands() {
      return new Promise((resolve) => {
        socket.emit('command:list', {}, (res) => {
          if (res && res.ok) {
            store.set('commands.list', res.data);
          }
          resolve(res);
        });
      });
    },

    // ── RAID methods ──

    async addRaidEntry(params) {
      const res = await _emitWithFeedback('raid:add', params);
      if (res && res.ok) {
        store.update('raid.entries', (entries) => [res.data, ...(entries || [])]);
      }
      return res;
    },

    async updateRaidStatus(params) {
      const res = await _emitWithFeedback('raid:update', params);
      if (res && res.ok) {
        store.update('raid.entries', (entries) => {
          const list = entries || [];
          const idx = list.findIndex((e) => e.id === params.id);
          if (idx >= 0) {
            const next = [...list];
            next[idx] = { ...next[idx], status: params.status };
            return next;
          }
          return list;
        });
      }
      return res;
    },

    // ── Phase Gate methods ──

    signoffGate(params) {
      return _emitWithFeedback('phase:gate:signoff', params);
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
      store.set('building.active', buildingId);
      await Promise.all([
        this.fetchBuilding(buildingId),
        this.fetchFloors(buildingId),
        this.fetchAgents({}),
        this.fetchGates(buildingId),
        this.fetchCanAdvance(buildingId),
        this.fetchRaidEntries(buildingId),
        this.fetchRooms(),
        this.fetchTasks(buildingId),
      ]);
    },
  };

  console.log('[SocketBridge] v2 bridge initialized');
  return window.overlordSocket;
}
