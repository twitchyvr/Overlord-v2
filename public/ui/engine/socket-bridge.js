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
  });

  socket.on('disconnect', (reason) => {
    console.log('[SocketBridge] Disconnected:', reason);
    store.set('ui.connected', false);
    engine.dispatch('connection:lost', { reason });
  });

  socket.on('connect_error', (error) => {
    console.error('[SocketBridge] Connection error:', error.message);
    engine.dispatch('connection:error', { message: error.message });
  });

  // ── Server → Client broadcasts ──

  socket.on('room:agent:entered', (data) => {
    // Update agent positions map
    store.update('building.agentPositions', (positions) => {
      return { ...(positions || {}), [data.agentId]: { roomId: data.roomId, roomType: data.roomType, tableType: data.tableType } };
    });
    engine.dispatch('room:agent:entered', data);
  });

  socket.on('room:agent:exited', (data) => {
    store.update('building.agentPositions', (positions) => {
      const next = { ...(positions || {}) };
      delete next[data.agentId];
      return next;
    });
    engine.dispatch('room:agent:exited', data);
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
    store.update('activity.items', (items) => [{ type: 'tool', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('tool:executed', data);
  });

  socket.on('phase:advanced', (data) => {
    store.set('building.activePhase', data.phase || data.nextPhase);
    store.update('activity.items', (items) => [{ type: 'phase', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('phase:advanced', data);
  });

  socket.on('raid:entry:added', (data) => {
    store.update('raid.entries', (entries) => [data, ...(entries || [])]);
    store.update('activity.items', (items) => [{ type: 'raid', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('raid:entry:added', data);
  });

  socket.on('phase-zero:complete', (data) => {
    store.update('activity.items', (items) => [{ type: 'phase-zero', ...data, timestamp: Date.now() }, ...(items || []).slice(0, 99)]);
    engine.dispatch('phase-zero:complete', data);
  });

  socket.on('phase-zero:failed', (data) => {
    engine.dispatch('phase-zero:failed', data);
  });

  socket.on('scope-change:detected', (data) => {
    store.update('raid.entries', (entries) => [{ ...data, type: 'scope-change' }, ...(entries || [])]);
    engine.dispatch('scope-change:detected', data);
  });

  socket.on('exit-doc:submitted', (data) => {
    engine.dispatch('exit-doc:submitted', data);
  });

  // ── Client emit wrappers (convenience for components) ──

  /** Fetch a building with floors */
  window.overlordSocket = {
    socket,

    emit(event, data) {
      return new Promise((resolve) => {
        socket.emit(event, data, (res) => resolve(res));
      });
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

    createBuilding(params) {
      return new Promise((resolve) => {
        socket.emit('building:create', params, (res) => {
          if (res && res.ok) {
            store.update('building.list', (list) => [...(list || []), res.data]);
          }
          resolve(res);
        });
      });
    },

    applyBlueprint(params) {
      return new Promise((resolve) => {
        socket.emit('building:apply-blueprint', params, (res) => resolve(res));
      });
    },

    registerAgent(params) {
      return new Promise((resolve) => {
        socket.emit('agent:register', params, (res) => {
          if (res && res.ok) {
            store.update('agents.list', (list) => [...(list || []), res.data]);
          }
          resolve(res);
        });
      });
    },

    createRoom(params) {
      return new Promise((resolve) => {
        socket.emit('room:create', params, (res) => resolve(res));
      });
    },

    enterRoom(roomId, agentId, tableType) {
      return new Promise((resolve) => {
        socket.emit('room:enter', { roomId, agentId, tableType }, (res) => resolve(res));
      });
    },

    exitRoom(roomId, agentId) {
      return new Promise((resolve) => {
        socket.emit('room:exit', { roomId, agentId }, (res) => resolve(res));
      });
    },

    sendMessage(params) {
      const { content, agentId, tokens, buildingId } = params;
      store.update('chat.messages', (msgs) => [...(msgs || []), { content, agentId, type: 'user', timestamp: Date.now() }]);
      store.set('ui.processing', true);
      socket.emit('chat:message', { content, agentId, tokens, buildingId });
    },

    submitExitDoc(roomId, agentId, document) {
      return new Promise((resolve) => {
        socket.emit('exit-doc:submit', { roomId, agentId, document }, (res) => resolve(res));
      });
    },

    submitGate(data) {
      return new Promise((resolve) => {
        socket.emit('phase:gate', data, (res) => resolve(res));
      });
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
      ]);
    },
  };

  console.log('[SocketBridge] v2 bridge initialized');
  return window.overlordSocket;
}
