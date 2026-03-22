/**
 * Overlord v2 — Entity Navigation
 *
 * Centralized navigation coordinator. Any panel/view can dispatch
 * a `navigate:entity` event with { type, id } and this module
 * routes to the correct detail view.
 *
 * Supported entity types:
 *   - 'agent'    → opens agent detail drawer
 *   - 'room'     → opens room detail drawer (#980)
 *   - 'floor'    → opens floor detail drawer (#980)
 *   - 'building' → opens building detail drawer (#980)
 *   - 'task'     → opens task detail drawer
 *   - 'raid'     → opens RAID entry detail drawer
 */

import { OverlordUI } from './engine.js';
import { h, formatTime } from './helpers.js';
import { Drawer } from '../components/drawer.js';
import { Toast } from '../components/toast.js';
import { createLogger } from './logger.js';

const log = createLogger('EntityNav');

/** Agent lookup cache — avoids redundant fetches within the same render cycle. */
let _agentCache = new Map();
let _roomCache = new Map();

/**
 * Initialize entity navigation listeners.
 * Call once during app bootstrap (after engine + store are ready).
 */
export function initEntityNav() {
  OverlordUI.subscribe('navigate:entity', (data) => {
    if (!data || !data.type || !data.id) return;
    log.info('Navigate to entity:', data.type, data.id);

    switch (data.type) {
      case 'agent':
        _openAgentDetail(data.id);
        break;
      case 'room':
        _openRoomDetail(data.id);
        break;
      case 'floor':
        _openFloorDetail(data.id);
        break;
      case 'building':
        _openBuildingDetail(data.id);
        break;
      case 'task':
        _openTaskDetail(data.id);
        break;
      case 'raid':
        _openRaidDetail(data.id);
        break;
      default:
        log.warn('Unknown entity type:', data.type);
    }
  });

  // Invalidate caches when data changes
  const store = OverlordUI.getStore();
  if (store) {
    store.subscribe('agents.list', () => { _agentCache.clear(); });
    store.subscribe('rooms.list', () => { _roomCache.clear(); });
  }

  log.info('Entity navigation initialized');
}

/**
 * Resolve an agent ID to { id, name, role, status }.
 * Uses store data first, falls back to socket fetch.
 */
export function resolveAgent(agentId) {
  if (!agentId) return null;
  if (_agentCache.has(agentId)) return _agentCache.get(agentId);

  const store = OverlordUI.getStore();
  const agents = store?.get('agents.list') || [];
  const agent = agents.find(a => a.id === agentId);
  if (agent) {
    const resolved = { id: agent.id, name: agent.display_name || agent.name || _friendlyId(agentId), role: agent.role, status: agent.status };
    _agentCache.set(agentId, resolved);
    return resolved;
  }
  return { id: agentId, name: _friendlyId(agentId), role: null, status: null };
}

/**
 * Resolve an agent ID to a human-friendly display name (#673).
 * NEVER returns raw IDs — falls back to "Agent" or "You".
 */
export function resolveAgentName(agentId) {
  if (!agentId) return 'Unknown';
  if (agentId === '__user__') return 'You';
  const agent = resolveAgent(agentId);
  return agent?.name || 'Agent';
}

/** Convert a raw agent ID to something less ugly than the full UUID */
function _friendlyId(id) {
  if (!id) return 'Agent';
  if (id === '__user__') return 'You';
  // Extract any readable part: "agent_1234_abc" → "Agent"
  // Don't show raw IDs to non-technical users
  return 'Agent';
}

/**
 * Resolve a room ID to { id, name, type }.
 */
export function resolveRoom(roomId) {
  if (!roomId) return null;
  if (_roomCache.has(roomId)) return _roomCache.get(roomId);

  const store = OverlordUI.getStore();
  const rooms = store?.get('rooms.list') || [];
  const room = rooms.find(r => r.id === roomId);
  if (room) {
    const name = room.name || _formatRoomType(room.type);
    const resolved = { id: room.id, name, type: room.type };
    _roomCache.set(roomId, resolved);
    return resolved;
  }
  return { id: roomId, name: roomId, type: null };
}

// ── Agent Detail Drawer ───────────────────────────────────────

async function _openAgentDetail(agentId) {
  if (!window.overlordSocket) {
    Toast.error('Not connected');
    return;
  }

  // Fetch full agent data
  const result = await window.overlordSocket.fetchAgent(agentId);
  if (!result || !result.ok) {
    Toast.error('Failed to load agent');
    return;
  }

  const agent = result.data;
  const store = OverlordUI.getStore();
  const tasks = (store?.get('tasks.list') || []).filter(t => t.assignee_id === agentId);
  const roomData = agent.current_room_id ? resolveRoom(agent.current_room_id) : null;

  const container = h('div', { class: 'entity-detail agent-detail-view' });

  // ── Header ──
  const displayName = agent.display_name || agent.name || 'Agent';
  const avatarEl = h('div', { class: 'agent-detail-avatar' });
  if (agent.photo_url) {
    const img = h('img', {
      src: agent.photo_url,
      alt: displayName,
      class: 'agent-detail-avatar-img'
    });
    img.onerror = () => { img.style.display = 'none'; avatarEl.textContent = (displayName)[0].toUpperCase(); };
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = (displayName)[0].toUpperCase();
  }

  const titleGroup = h('div', { class: 'agent-detail-title' });
  titleGroup.appendChild(h('h3', null, displayName));

  if (agent.specialization) {
    titleGroup.appendChild(h('div', { class: 'agent-detail-specialization' }, agent.specialization));
  }

  titleGroup.appendChild(h('div', { class: 'agent-detail-meta' },
    h('span', { class: 'badge agent-role-badge' }, agent.role || 'agent'),
    h('span', {
      class: `agent-status-indicator agent-status-${agent.status || 'idle'}`
    }, agent.status || 'idle')
  ));

  const header = h('div', { class: 'agent-detail-header' }, avatarEl, titleGroup);
  container.appendChild(header);

  // ── Current Assignment ──
  const assignmentSection = h('div', { class: 'agent-detail-section' });
  assignmentSection.appendChild(h('h4', { class: 'agent-detail-section-title' }, 'Current Assignment'));

  if (roomData) {
    const roomLink = h('div', { class: 'agent-detail-assignment' },
      h('span', { class: 'agent-detail-label' }, 'Room:'),
      _createEntityLink('room', roomData.id, roomData.name),
      roomData.type ? h('span', { class: 'badge text-muted' }, roomData.type) : null
    );
    assignmentSection.appendChild(roomLink);

    if (agent.current_table_id) {
      const tableName = agent.current_table_name || agent.current_table_type || 'Assigned';
      assignmentSection.appendChild(h('div', { class: 'agent-detail-row' },
        h('span', { class: 'agent-detail-label' }, 'Table:'),
        h('span', null, tableName)
      ));
    }
  } else {
    assignmentSection.appendChild(h('div', { class: 'agent-detail-unassigned' },
      h('span', null, 'Not assigned to any room'),
      h('span', { class: 'text-muted' }, ' — assign from the Agents view or Building view')
    ));
  }
  container.appendChild(assignmentSection);

  // ── Capabilities ──
  const caps = agent.capabilities;
  if (caps && (Array.isArray(caps) ? caps.length > 0 : true)) {
    const capSection = h('div', { class: 'agent-detail-section' });
    capSection.appendChild(h('h4', { class: 'agent-detail-section-title' }, 'Capabilities'));
    const capList = Array.isArray(caps) ? caps : (typeof caps === 'string' ? JSON.parse(caps) : []);
    const capGrid = h('div', { class: 'agent-detail-cap-grid' });
    for (const cap of capList) {
      capGrid.appendChild(h('span', { class: 'agent-detail-cap-tag' }, cap));
    }
    capSection.appendChild(capGrid);
    container.appendChild(capSection);
  }

  // ── Room Access ──
  const access = agent.room_access;
  if (access) {
    const accessSection = h('div', { class: 'agent-detail-section' });
    accessSection.appendChild(h('h4', { class: 'agent-detail-section-title' }, 'Room Access'));
    const accessList = Array.isArray(access) ? access : (typeof access === 'string' ? JSON.parse(access) : []);
    const accessGrid = h('div', { class: 'agent-detail-cap-grid' });
    for (const a of accessList) {
      accessGrid.appendChild(h('span', { class: 'agent-detail-cap-tag' }, a === '*' ? 'All rooms' : _formatRoomType(a)));
    }
    accessSection.appendChild(accessGrid);
    container.appendChild(accessSection);
  }

  // ── Assigned Tasks ──
  const taskSection = h('div', { class: 'agent-detail-section' });
  taskSection.appendChild(h('h4', { class: 'agent-detail-section-title' },
    `Assigned Tasks (${tasks.length})`
  ));

  if (tasks.length === 0) {
    taskSection.appendChild(h('div', { class: 'agent-detail-empty' }, 'No tasks assigned.'));
  } else {
    const taskList = h('div', { class: 'agent-detail-task-list' });
    for (const task of tasks.slice(0, 10)) {
      const statusIcon = task.status === 'done' ? '\u2714' :
        task.status === 'in-progress' ? '\u25D4' :
        task.status === 'blocked' ? '\u26D4' : '\u25CB';

      const taskRow = h('div', { class: 'agent-detail-task-row' },
        h('span', { class: 'agent-detail-task-icon' }, statusIcon),
        _createEntityLink('task', task.id, task.title || 'Untitled'),
        h('span', { class: `badge agent-task-status-${task.status || 'pending'}` }, task.status || 'pending')
      );
      taskList.appendChild(taskRow);
    }
    if (tasks.length > 10) {
      taskList.appendChild(h('div', { class: 'text-muted' }, `+ ${tasks.length - 10} more`));
    }
    taskSection.appendChild(taskList);
  }
  container.appendChild(taskSection);

  // ── Recent Activity ──
  const activityItems = (store?.get('activity.items') || [])
    .filter(item => item.agentId === agentId || item.agentName === agent.name)
    .slice(0, 15);

  const activitySection = h('div', { class: 'agent-detail-section' });
  activitySection.appendChild(h('h4', { class: 'agent-detail-section-title' },
    `Recent Activity (${activityItems.length})`
  ));

  if (activityItems.length === 0) {
    activitySection.appendChild(h('div', { class: 'agent-detail-empty' }, 'No recent activity.'));
  } else {
    const actList = h('div', { class: 'agent-detail-activity-list' });
    for (const item of activityItems) {
      actList.appendChild(h('div', { class: 'agent-detail-activity-row' },
        h('span', { class: 'agent-detail-activity-time' },
          item.ts ? formatTime(item.ts) : item.timestamp ? formatTime(item.timestamp) : ''),
        h('span', { class: 'agent-detail-activity-event' }, item.event || item.type || ''),
        item.roomId ? _createEntityLink('room', item.roomId, resolveRoom(item.roomId)?.name || item.roomId) : null
      ));
    }
    activitySection.appendChild(actList);
  }
  container.appendChild(activitySection);

  // ── Quick Actions Bar ──
  const actionsBar = h('div', { class: 'agent-detail-quick-actions' });

  const quickActions = [
    { icon: '\uD83D\uDCAC', label: 'Chat', action: () => {
      Drawer.close();
      OverlordUI.dispatch('navigate:chat', { agentId: agent.id, agentName: agent.name });
    }},
    { icon: '\uD83D\uDCE7', label: 'Email', action: () => {
      Drawer.close();
      OverlordUI.dispatch('navigate:email', { compose: true, to: agent.id });
    }},
  ];

  if (agent.current_room_id) {
    quickActions.push({ icon: '\uD83D\uDCCD', label: 'Go to Room', action: () => {
      Drawer.close();
      OverlordUI.dispatch('navigate:entity', { type: 'room', id: agent.current_room_id });
    }});
  }

  quickActions.push({ icon: '\uD83D\uDCCB', label: 'Tasks', action: () => {
    Drawer.close();
    OverlordUI.dispatch('navigate:tasks', { assignee: agent.id });
  }});

  const isPaused = agent.status === 'paused';
  quickActions.push({
    icon: isPaused ? '\u25B6' : '\u23F8',
    label: isPaused ? 'Resume' : 'Pause',
    action: () => {
      if (window.overlordSocket) {
        const newStatus = isPaused ? 'active' : 'paused';
        window.overlordSocket.updateAgentStatus(agent.id, newStatus).then((res) => {
          if (res && res.ok) {
            Toast.success(`Agent ${isPaused ? 'resumed' : 'paused'}`);
            _openAgentDetail(agentId); // refresh drawer
          } else {
            Toast.error('Failed to update status');
          }
        });
      }
    }
  });

  for (const qa of quickActions) {
    const btn = h('button', {
      class: 'agent-quick-action-btn',
      title: qa.label,
      'aria-label': qa.label
    },
      h('span', { class: 'agent-quick-action-icon' }, qa.icon),
      h('span', { class: 'agent-quick-action-label' }, qa.label)
    );
    btn.addEventListener('click', qa.action);
    actionsBar.appendChild(btn);
  }
  container.appendChild(actionsBar);

  // ── Info ──
  const infoSection = h('div', { class: 'agent-detail-section' });
  infoSection.appendChild(h('h4', { class: 'agent-detail-section-title' }, 'Details'));
  const infoRows = [
    ['Created', agent.created_at ? new Date(agent.created_at).toLocaleString() : '\u2014'],
  ];
  for (const [label, value] of infoRows) {
    infoSection.appendChild(h('div', { class: 'agent-detail-row' },
      h('span', { class: 'agent-detail-label' }, label),
      h('span', null, value)
    ));
  }
  container.appendChild(infoSection);

  Drawer.open(`agent-detail-${agentId}`, {
    title: agent.name || 'Agent',
    content: container,
    width: '480px',
  });
}

// ── Task Detail Drawer ───────────────────────────────────────

async function _openTaskDetail(taskId) {
  if (!window.overlordSocket) {
    Toast.error('Not connected');
    return;
  }

  const result = await window.overlordSocket.getTask(taskId);
  if (!result || !result.ok) {
    Toast.error('Failed to load task');
    return;
  }

  const task = result.data;
  const assignee = task.assignee_id ? resolveAgent(task.assignee_id) : null;
  const room = task.room_id ? resolveRoom(task.room_id) : null;

  const container = h('div', { class: 'entity-detail task-detail-view' });

  // Status + priority header
  const statusIcon = task.status === 'done' ? '\u2714' :
    task.status === 'in-progress' ? '\u25D4' :
    task.status === 'blocked' ? '\u26D4' : '\u25CB';

  container.appendChild(h('div', { class: 'task-detail-header' },
    h('span', { class: 'task-detail-status-icon' }, statusIcon),
    h('h3', null, task.title || 'Untitled Task'),
    h('div', { class: 'task-detail-badges' },
      h('span', { class: `badge task-status-badge-${task.status || 'pending'}` }, task.status || 'pending'),
      task.priority ? h('span', { class: `badge task-priority-badge-${task.priority}` }, task.priority) : null,
      task.phase ? h('span', { class: 'badge' }, task.phase) : null
    )
  ));

  // Description
  if (task.description) {
    container.appendChild(h('div', { class: 'task-detail-section' },
      h('h4', { class: 'task-detail-section-title' }, 'Description'),
      h('p', { class: 'task-detail-description' }, task.description)
    ));
  }

  // Assignee + Room
  const contextSection = h('div', { class: 'task-detail-section' });
  contextSection.appendChild(h('h4', { class: 'task-detail-section-title' }, 'Context'));

  if (assignee) {
    contextSection.appendChild(h('div', { class: 'task-detail-row' },
      h('span', { class: 'task-detail-label' }, 'Assignee:'),
      _createEntityLink('agent', assignee.id, assignee.name),
      assignee.role ? h('span', { class: 'badge text-muted' }, assignee.role) : null
    ));
  } else {
    contextSection.appendChild(h('div', { class: 'task-detail-row' },
      h('span', { class: 'task-detail-label' }, 'Assignee:'),
      h('span', { class: 'text-muted' }, 'Unassigned')
    ));
  }

  if (room) {
    contextSection.appendChild(h('div', { class: 'task-detail-row' },
      h('span', { class: 'task-detail-label' }, 'Room:'),
      _createEntityLink('room', room.id, room.name)
    ));
  }

  container.appendChild(contextSection);

  // Timestamps
  const timeSection = h('div', { class: 'task-detail-section' });
  timeSection.appendChild(h('h4', { class: 'task-detail-section-title' }, 'Timeline'));
  if (task.created_at) {
    timeSection.appendChild(h('div', { class: 'task-detail-row' },
      h('span', { class: 'task-detail-label' }, 'Created:'),
      h('span', null, new Date(task.created_at).toLocaleString())
    ));
  }
  if (task.updated_at) {
    timeSection.appendChild(h('div', { class: 'task-detail-row' },
      h('span', { class: 'task-detail-label' }, 'Updated:'),
      h('span', null, new Date(task.updated_at).toLocaleString())
    ));
  }
  container.appendChild(timeSection);

  Drawer.open(`task-detail-${taskId}`, {
    title: task.title || 'Task Detail',
    content: container,
    width: '440px',
  });
}

// ── RAID Detail Drawer ───────────────────────────────────────

function _openRaidDetail(entryId) {
  const store = OverlordUI.getStore();
  const entries = store?.get('raid.entries') || [];
  const entry = entries.find(e => e.id === entryId);

  if (!entry) {
    Toast.error('RAID entry not found');
    return;
  }

  const owner = entry.owner ? resolveAgent(entry.owner) : null;
  const decidedBy = entry.decided_by ? resolveAgent(entry.decided_by) : null;
  const room = entry.room_id ? resolveRoom(entry.room_id) : null;

  const container = h('div', { class: 'entity-detail raid-detail-view' });

  const typeIcons = { risk: '\u{1F534}', assumption: '\u{1F7E1}', issue: '\u{1F7E0}', dependency: '\u{1F535}' };

  container.appendChild(h('div', { class: 'raid-detail-header' },
    h('span', { class: 'raid-detail-icon' }, typeIcons[entry.type] || '\u26A0'),
    h('h3', null, entry.title || entry.summary || 'RAID Entry'),
    h('div', { class: 'raid-detail-badges' },
      h('span', { class: 'badge' }, entry.type || 'unknown'),
      entry.severity ? h('span', { class: `badge raid-severity-${entry.severity}` }, entry.severity) : null,
      entry.status ? h('span', { class: 'badge' }, entry.status) : null
    )
  ));

  // Description / Summary
  if (entry.description || entry.summary) {
    container.appendChild(h('div', { class: 'raid-detail-section' },
      h('h4', null, 'Description'),
      h('p', null, entry.description || entry.summary)
    ));
  }

  if (entry.mitigation) {
    container.appendChild(h('div', { class: 'raid-detail-section' },
      h('h4', null, 'Mitigation'),
      h('p', null, entry.mitigation)
    ));
  }

  // Context with entity links
  const ctxSection = h('div', { class: 'raid-detail-section' });
  ctxSection.appendChild(h('h4', null, 'Context'));

  if (owner) {
    ctxSection.appendChild(h('div', { class: 'raid-detail-row' },
      h('span', { class: 'raid-detail-label' }, 'Owner:'),
      _createEntityLink('agent', owner.id, owner.name)
    ));
  }

  if (decidedBy) {
    ctxSection.appendChild(h('div', { class: 'raid-detail-row' },
      h('span', { class: 'raid-detail-label' }, 'Decided By:'),
      _createEntityLink('agent', decidedBy.id, decidedBy.name)
    ));
  }

  if (room) {
    ctxSection.appendChild(h('div', { class: 'raid-detail-row' },
      h('span', { class: 'raid-detail-label' }, 'Room:'),
      _createEntityLink('room', room.id, room.name)
    ));
  }

  if (entry.phase) {
    ctxSection.appendChild(h('div', { class: 'raid-detail-row' },
      h('span', { class: 'raid-detail-label' }, 'Phase:'),
      h('span', null, entry.phase)
    ));
  }

  if (entry.created_at) {
    ctxSection.appendChild(h('div', { class: 'raid-detail-row' },
      h('span', { class: 'raid-detail-label' }, 'Created:'),
      h('span', null, new Date(entry.created_at).toLocaleString())
    ));
  }

  container.appendChild(ctxSection);

  Drawer.open(`raid-detail-${entryId}`, {
    title: entry.title || entry.summary || 'RAID Entry',
    content: container,
    width: '440px',
  });
}

// ── Entity Tooltip ────────────────────────────────────────────

let _tooltipEl = null;
let _tooltipTimer = null;

// ── Activity Timeline Helper (#980) ──

const _activityIcons = {
  'tool:executed': '\u{1F527}', 'tool:executing': '\u{1F527}', 'ai:request': '\u{1F916}',
  'room:agent:entered': '\u{1F6AA}', 'room:agent:exited': '\u{1F6B6}',
  'phase:advanced': '\u{1F6A7}', 'exit-doc:submitted': '\u{1F4C4}',
  'task:created': '\u{1F4CB}', 'task:assigned': '\u{1F4CC}',
  'agent:status-changed': '\u{1F504}', 'agent:activity': '\u{1F527}',
  'building:execution-changed': '\u26A1',
};

function _renderActivityTimeline(entries, opts = {}) {
  const maxItems = opts.limit || 30;
  const section = h('div', { class: 'entity-detail-section' });
  section.appendChild(h('h4', { class: 'entity-detail-section-title' },
    `Recent Activity (${entries.length}${entries.length >= maxItems ? '+' : ''})`
  ));

  if (entries.length === 0) {
    section.appendChild(h('div', { class: 'entity-detail-empty' }, 'No activity yet.'));
    return section;
  }

  const list = h('div', { class: 'entity-detail-activity-list' });
  for (const entry of entries.slice(0, maxItems)) {
    const icon = _activityIcons[entry.event_type] || '\u2022';
    const agentName = resolveAgentName(entry.agent_id);
    list.appendChild(h('div', { class: 'entity-detail-activity-row' },
      h('span', { class: 'entity-detail-activity-icon' }, icon),
      h('span', { class: 'entity-detail-activity-event' }, entry.event_type),
      agentName ? _createEntityLink('agent', entry.agent_id, agentName) : null,
      h('span', { class: 'entity-detail-activity-time' }, formatTime(entry.created_at)),
    ));
  }
  section.appendChild(list);
  return section;
}

// ── Room Detail Drawer (#980) ──

async function _openRoomDetail(roomId) {
  if (!window.overlordSocket) { Toast.error('Not connected'); return; }

  const store = OverlordUI.getStore();
  const room = resolveRoom(roomId);
  if (!room) { Toast.error('Room not found'); return; }

  const container = h('div', { class: 'entity-detail room-detail-view' });

  // Header
  const roomType = _formatRoomType(room.type);
  container.appendChild(h('div', { class: 'entity-detail-header' },
    h('div', { class: 'entity-detail-icon' }, '\u{1F3E0}'),
    h('div', { class: 'entity-detail-title' },
      h('h3', null, room.name || roomType),
      h('div', { class: 'entity-detail-subtitle' }, roomType),
    ),
  ));

  // Agents in room
  const allAgents = store?.get('agents.list') || [];
  const roomAgents = allAgents.filter(a => a.current_room_id === roomId);
  const agentSection = h('div', { class: 'entity-detail-section' });
  agentSection.appendChild(h('h4', { class: 'entity-detail-section-title' },
    `Agents (${roomAgents.length})`
  ));
  if (roomAgents.length === 0) {
    agentSection.appendChild(h('div', { class: 'entity-detail-empty' }, 'No agents in this room.'));
  } else {
    for (const a of roomAgents) {
      agentSection.appendChild(h('div', { class: 'entity-detail-row' },
        _createEntityLink('agent', a.id, a.display_name || a.name),
        h('span', { class: `entity-detail-status entity-detail-status-${a.status || 'idle'}` }, a.status || 'idle'),
      ));
    }
  }
  container.appendChild(agentSection);

  // Room info
  const infoSection = h('div', { class: 'entity-detail-section' });
  infoSection.appendChild(h('h4', { class: 'entity-detail-section-title' }, 'Details'));
  const details = [
    ['Type', roomType],
    ['Floor', room.floor_id || '—'],
  ];
  if (room.allowed_tools) {
    const toolCount = typeof room.allowed_tools === 'string' ? JSON.parse(room.allowed_tools || '[]').length : 0;
    details.push(['Tools', `${toolCount} allowed`]);
  }
  for (const [label, value] of details) {
    infoSection.appendChild(h('div', { class: 'entity-detail-row' },
      h('span', { class: 'entity-detail-label' }, label),
      h('span', { class: 'entity-detail-value' }, value),
    ));
  }
  container.appendChild(infoSection);

  // Activity timeline (async)
  const activityPlaceholder = h('div', { class: 'entity-detail-section' },
    h('h4', { class: 'entity-detail-section-title' }, 'Recent Activity'),
    h('div', { class: 'entity-detail-loading' }, 'Loading activity...')
  );
  container.appendChild(activityPlaceholder);

  Drawer.open('room-detail', {
    title: `Room: ${room.name || roomType}`,
    width: '480px',
    content: container,
  });

  // Fetch activity async
  try {
    const res = await window.overlordSocket.fetchRoomActivityLog(roomId, { limit: 30 });
    const entries = res?.ok ? (res.data || []) : [];
    const timeline = _renderActivityTimeline(entries, { limit: 30 });
    activityPlaceholder.replaceWith(timeline);
  } catch (e) {
    activityPlaceholder.querySelector('.entity-detail-loading').textContent = 'Failed to load activity.';
  }
}

// ── Floor Detail Drawer (#980) ──

async function _openFloorDetail(floorId) {
  if (!window.overlordSocket) { Toast.error('Not connected'); return; }

  const store = OverlordUI.getStore();
  // Resolve floor from rooms list (rooms have floor_id)
  const allRooms = store?.get('rooms.list') || [];
  const floorRooms = allRooms.filter(r => r.floor_id === floorId);
  const floors = store?.get('floors.list') || [];
  const floor = floors.find(f => f.id === floorId);
  const floorName = floor?.name || `Floor ${floorId.slice(-4)}`;

  const container = h('div', { class: 'entity-detail floor-detail-view' });

  // Header
  container.appendChild(h('div', { class: 'entity-detail-header' },
    h('div', { class: 'entity-detail-icon' }, '\u{1F3E2}'),
    h('div', { class: 'entity-detail-title' },
      h('h3', null, floorName),
      h('div', { class: 'entity-detail-subtitle' }, `${floorRooms.length} rooms`),
    ),
  ));

  // Rooms on this floor
  const roomSection = h('div', { class: 'entity-detail-section' });
  roomSection.appendChild(h('h4', { class: 'entity-detail-section-title' },
    `Rooms (${floorRooms.length})`
  ));
  if (floorRooms.length === 0) {
    roomSection.appendChild(h('div', { class: 'entity-detail-empty' }, 'No rooms on this floor.'));
  } else {
    for (const r of floorRooms) {
      const agentCount = (store?.get('agents.list') || []).filter(a => a.current_room_id === r.id).length;
      roomSection.appendChild(h('div', { class: 'entity-detail-row' },
        _createEntityLink('room', r.id, r.name || _formatRoomType(r.type)),
        h('span', { class: 'entity-detail-meta' }, `${agentCount} agents`),
      ));
    }
  }
  container.appendChild(roomSection);

  // Activity timeline (async)
  const activityPlaceholder = h('div', { class: 'entity-detail-section' },
    h('h4', { class: 'entity-detail-section-title' }, 'Recent Activity'),
    h('div', { class: 'entity-detail-loading' }, 'Loading activity...')
  );
  container.appendChild(activityPlaceholder);

  Drawer.open('floor-detail', {
    title: `Floor: ${floorName}`,
    width: '480px',
    content: container,
  });

  // Fetch activity async
  try {
    const res = await window.overlordSocket.fetchFloorActivityLog(floorId, { limit: 30 });
    const entries = res?.ok ? (res.data || []) : [];
    const timeline = _renderActivityTimeline(entries, { limit: 30 });
    activityPlaceholder.replaceWith(timeline);
  } catch (e) {
    activityPlaceholder.querySelector('.entity-detail-loading').textContent = 'Failed to load activity.';
  }
}

// ── Building Detail Drawer (#980) ──

async function _openBuildingDetail(buildingId) {
  if (!window.overlordSocket) { Toast.error('Not connected'); return; }

  const store = OverlordUI.getStore();
  const buildings = store?.get('buildings.list') || [];
  const building = buildings.find(b => b.id === buildingId);
  const buildingName = building?.name || 'Building';

  const floors = store?.get('floors.list') || [];
  const buildingFloors = floors.filter(f => f.building_id === buildingId);

  const allAgents = store?.get('agents.list') || [];
  const buildingAgents = allAgents.filter(a => a.building_id === buildingId);

  const container = h('div', { class: 'entity-detail building-detail-view' });

  // Header
  container.appendChild(h('div', { class: 'entity-detail-header' },
    h('div', { class: 'entity-detail-icon' }, '\u{1F3D7}'),
    h('div', { class: 'entity-detail-title' },
      h('h3', null, buildingName),
      h('div', { class: 'entity-detail-subtitle' },
        `${buildingFloors.length} floors \u00B7 ${buildingAgents.length} agents`
      ),
    ),
  ));

  // Floors
  const floorSection = h('div', { class: 'entity-detail-section' });
  floorSection.appendChild(h('h4', { class: 'entity-detail-section-title' },
    `Floors (${buildingFloors.length})`
  ));
  for (const f of buildingFloors) {
    const roomCount = (store?.get('rooms.list') || []).filter(r => r.floor_id === f.id).length;
    floorSection.appendChild(h('div', { class: 'entity-detail-row' },
      _createEntityLink('floor', f.id, f.name || 'Floor'),
      h('span', { class: 'entity-detail-meta' }, `${roomCount} rooms`),
    ));
  }
  container.appendChild(floorSection);

  // Key metrics
  const metricsSection = h('div', { class: 'entity-detail-section' });
  metricsSection.appendChild(h('h4', { class: 'entity-detail-section-title' }, 'Metrics'));
  const execState = building?.executionState || building?.execution_state || 'stopped';
  const metrics = [
    ['Status', execState],
    ['Phase', building?.activePhase || building?.active_phase || 'strategy'],
    ['Agents', `${buildingAgents.length}`],
    ['Floors', `${buildingFloors.length}`],
  ];
  for (const [label, value] of metrics) {
    metricsSection.appendChild(h('div', { class: 'entity-detail-row' },
      h('span', { class: 'entity-detail-label' }, label),
      h('span', { class: 'entity-detail-value' }, value),
    ));
  }
  container.appendChild(metricsSection);

  // Activity timeline (async from building activity log)
  const activityPlaceholder = h('div', { class: 'entity-detail-section' },
    h('h4', { class: 'entity-detail-section-title' }, 'Recent Activity'),
    h('div', { class: 'entity-detail-loading' }, 'Loading activity...')
  );
  container.appendChild(activityPlaceholder);

  Drawer.open('building-detail', {
    title: `Building: ${buildingName}`,
    width: '480px',
    content: container,
  });

  // Fetch building activity async via dedicated socket call (#991)
  try {
    const res = await window.overlordSocket.fetchBuildingActivityLog(buildingId, { limit: 30 });
    const entries = res?.ok ? (res.data || []) : [];
    const timeline = _renderActivityTimeline(entries, { limit: 30 });
    activityPlaceholder.replaceWith(timeline);
  } catch (e) {
    activityPlaceholder.querySelector('.entity-detail-loading').textContent = 'Failed to load activity.';
  }
}

// ── EntityLink additions (#980) ──

function _initTooltip() {
  if (_tooltipEl) return;
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'entity-tooltip';
  _tooltipEl.setAttribute('role', 'tooltip');
  _tooltipEl.hidden = true;
  document.body.appendChild(_tooltipEl);
}

function _showTooltip(targetEl, type, id) {
  _initTooltip();
  clearTimeout(_tooltipTimer);

  _tooltipTimer = setTimeout(() => {
    const content = _getTooltipContent(type, id);
    if (!content) return;

    _tooltipEl.textContent = '';
    _tooltipEl.appendChild(content);
    _tooltipEl.hidden = false;

    // Position after content is visible so we can measure
    requestAnimationFrame(() => _positionTooltip(targetEl));
  }, 300);
}

function _hideTooltip() {
  clearTimeout(_tooltipTimer);
  if (_tooltipEl) {
    _tooltipEl.hidden = true;
  }
}

function _positionTooltip(targetEl) {
  if (!_tooltipEl || _tooltipEl.hidden) return;

  const rect = targetEl.getBoundingClientRect();
  const tipRect = _tooltipEl.getBoundingClientRect();

  // Default: above the element
  let top = rect.top - tipRect.height - 8;
  let left = rect.left + (rect.width / 2) - (tipRect.width / 2);

  // If above would go off screen, show below
  if (top < 8) {
    top = rect.bottom + 8;
    _tooltipEl.classList.add('entity-tooltip-below');
    _tooltipEl.classList.remove('entity-tooltip-above');
  } else {
    _tooltipEl.classList.add('entity-tooltip-above');
    _tooltipEl.classList.remove('entity-tooltip-below');
  }

  // Keep within viewport horizontally
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

  _tooltipEl.style.top = `${top}px`;
  _tooltipEl.style.left = `${left}px`;
}

function _getTooltipContent(type, id) {
  const container = h('div', { class: 'entity-tooltip-content' });

  switch (type) {
    case 'agent': {
      const agent = resolveAgent(id);
      if (!agent || agent.name === id) return null; // No extra info to show
      container.appendChild(h('div', { class: 'entity-tooltip-name' }, agent.name));
      if (agent.role) container.appendChild(h('div', { class: 'entity-tooltip-meta' }, agent.role));
      if (agent.status) {
        container.appendChild(h('span', {
          class: `entity-tooltip-badge entity-tooltip-status-${agent.status}`
        }, agent.status));
      }
      return container;
    }
    case 'room': {
      const room = resolveRoom(id);
      if (!room) return null;
      // Only show tooltip if it adds info beyond the link text
      const roomType = _formatRoomType(room.type);
      if (room.name === roomType) return null; // tooltip would just repeat the link
      if (roomType) container.appendChild(h('div', { class: 'entity-tooltip-meta' }, roomType));
      else return null;
      return container;
    }
    case 'task': {
      const store = OverlordUI.getStore();
      const tasks = store?.get('tasks.list') || [];
      const task = tasks.find(t => t.id === id);
      if (!task) return null;
      container.appendChild(h('div', { class: 'entity-tooltip-name' }, task.title || id));
      if (task.status) {
        container.appendChild(h('span', {
          class: `entity-tooltip-badge entity-tooltip-task-${task.status}`
        }, task.status));
      }
      if (task.assignee_id) {
        const agent = resolveAgent(task.assignee_id);
        container.appendChild(h('div', { class: 'entity-tooltip-meta' }, `Assigned to ${agent?.name || task.assignee_id}`));
      }
      return container;
    }
    case 'raid': {
      const store = OverlordUI.getStore();
      const entries = store?.get('raid.entries') || [];
      const entry = entries.find(e => e.id === id);
      if (!entry) return null;
      container.appendChild(h('div', { class: 'entity-tooltip-name' }, entry.title || entry.summary || id));
      if (entry.type) container.appendChild(h('div', { class: 'entity-tooltip-meta' }, entry.type));
      if (entry.severity) {
        container.appendChild(h('span', {
          class: `entity-tooltip-badge entity-tooltip-severity-${entry.severity}`
        }, entry.severity));
      }
      return container;
    }
    default:
      return null;
  }
}

// ── Shared Helpers ────────────────────────────────────────────

/**
 * Create a clickable entity link element with hover tooltip.
 * @param {'agent'|'room'|'task'|'raid'} type
 * @param {string} id
 * @param {string} displayName
 * @returns {HTMLElement}
 */
function _createEntityLink(type, id, displayName) {
  const link = h('span', {
    class: `entity-link entity-link-${type}`,
    'data-entity-type': type,
    'data-entity-id': id,
    // No title attr — custom tooltip handles hover info (#1001)
    role: 'button',
    tabindex: '0',
  }, displayName || id);

  link.addEventListener('click', (e) => {
    e.stopPropagation();
    _hideTooltip();
    OverlordUI.dispatch('navigate:entity', { type, id });
  });

  link.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      _hideTooltip();
      OverlordUI.dispatch('navigate:entity', { type, id });
    }
  });

  // Hover tooltip
  link.addEventListener('mouseenter', () => _showTooltip(link, type, id));
  link.addEventListener('mouseleave', () => _hideTooltip());
  link.addEventListener('focus', () => _showTooltip(link, type, id));
  link.addEventListener('blur', () => _hideTooltip());

  return link;
}

function _formatRoomType(type) {
  if (!type) return 'Room';
  return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Public API ────────────────────────────────────────────────

/**
 * Create a clickable entity link for use in any panel.
 * Import this in views to render cross-navigable references.
 */
export const EntityLink = {
  /**
   * Create a clickable agent reference.
   * @param {string} agentId
   * @param {string} [displayName] — if omitted, resolves from store
   */
  agent(agentId, displayName) {
    if (!agentId) return h('span', { class: 'text-muted' }, 'Unassigned');
    const resolved = resolveAgent(agentId);
    return _createEntityLink('agent', agentId, displayName || resolved?.name || 'Agent');
  },

  /**
   * Create a clickable room reference.
   */
  room(roomId, displayName) {
    if (!roomId) return h('span', { class: 'text-muted' }, 'No room');
    const resolved = resolveRoom(roomId);
    return _createEntityLink('room', roomId, displayName || resolved?.name || roomId);
  },

  /**
   * Create a clickable task reference.
   */
  task(taskId, displayName) {
    if (!taskId) return h('span', { class: 'text-muted' }, 'No task');
    return _createEntityLink('task', taskId, displayName || taskId);
  },

  /**
   * Create a clickable RAID entry reference.
   */
  raid(entryId, displayName) {
    if (!entryId) return h('span', { class: 'text-muted' }, 'No entry');
    return _createEntityLink('raid', entryId, displayName || entryId);
  },

  /** Create a clickable floor reference (#980). */
  floor(floorId, displayName) {
    if (!floorId) return h('span', { class: 'text-muted' }, 'No floor');
    return _createEntityLink('floor', floorId, displayName || 'Floor');
  },

  /** Create a clickable building reference (#980). */
  building(buildingId, displayName) {
    if (!buildingId) return h('span', { class: 'text-muted' }, 'No building');
    return _createEntityLink('building', buildingId, displayName || 'Building');
  },
};
