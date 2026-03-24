/**
 * Overlord v2 — Card Component
 *
 * Factory for standardized cards. Used by agent cards, task cards,
 * recommendation cards, milestone cards, kanban cards.
 *
 * Variants: glass (default), solid, outlined
 * Structure: .card > .card-header + .card-body + .card-footer + .card-actions
 *
 * Adapted for v2 building/room metaphor: adds 'room', 'floor', and
 * 'building' card types alongside the standard v1 types.
 *
 * Ported from v1 card.js with v2 import paths.
 */

import { h } from '../engine/helpers.js';


export class Card {

  /**
   * Create a card element.
   *
   * @param {string} type — 'agent' | 'task' | 'recommendation' | 'milestone' | 'kanban' |
   *                         'room' | 'floor' | 'building' | 'raid' | 'generic'
   * @param {object} data — type-specific data
   * @param {object} [options]
   * @param {string} [options.variant='glass'] — 'glass' | 'solid' | 'outlined'
   * @param {string} [options.className]       — additional CSS class
   * @param {object} [options.actions]          — { label: handler } for action buttons
   * @param {function} [options.onClick]         — card body click handler (not action buttons)
   * @returns {HTMLElement}
   */
  static create(type, data, options = {}) {
    const { variant = 'glass', className = '', actions = {}, onClick } = options;

    const card = h('div', {
      class: `card card-${type} card-${variant} ${className}`.trim(),
      'data-card-type': type
    });

    switch (type) {
      case 'agent':          Card._buildAgent(card, data);          break;
      case 'task':           Card._buildTask(card, data);           break;
      case 'recommendation': Card._buildRecommendation(card, data); break;
      case 'milestone':      Card._buildMilestone(card, data);      break;
      case 'kanban':         Card._buildKanban(card, data);         break;
      case 'room':           Card._buildRoom(card, data);           break;
      case 'floor':          Card._buildFloor(card, data);          break;
      case 'building':       Card._buildBuilding(card, data);       break;
      case 'raid':           Card._buildRaid(card, data);           break;
      default:               Card._buildGeneric(card, data);        break;
    }

    // Action buttons
    if (Object.keys(actions).length > 0) {
      const actionsEl = h('div', { class: 'card-actions' });
      for (const [label, handler] of Object.entries(actions)) {
        const btn = h('button', { class: 'card-action-btn' }, label);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          handler(data, card);
        });
        actionsEl.appendChild(btn);
      }
      card.appendChild(actionsEl);
    }

    // Card body click handler — distinct from action buttons (#1006)
    if (typeof onClick === 'function') {
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        // Don't trigger on button/link clicks inside the card
        if (e.target.closest('button, a, .card-actions')) return;
        onClick(data, card);
      });
    }

    return card;
  }

  // ── Type-Specific Builders ───────────────────────────────────

  /** @private */
  static _buildAgent(card, data) {
    const header = h('div', { class: 'card-header' },
      h('div', { class: `agent-status-dot ${data.status || 'idle'}` }),
      h('span', { class: 'agent-card-name' }, data.name || 'Agent'),
      data.badge ? h('span', { class: 'agent-badge' }, data.badge) : null
    );
    card.appendChild(header);

    const body = h('div', { class: 'card-body' });
    if (data.role) body.appendChild(h('div', { class: 'agent-card-role' }, data.role));
    if (data.currentTask) body.appendChild(h('div', { class: 'agent-current-task' }, data.currentTask));
    if (data.capabilities && data.capabilities.length) {
      const caps = h('div', { class: 'agent-caps' });
      data.capabilities.forEach(c => caps.appendChild(h('span', { class: 'agent-cap' }, c)));
      body.appendChild(caps);
    }
    card.appendChild(body);

    if (data.status) card.classList.add(`agent-${data.status}`);
  }

  /** @private */
  static _buildTask(card, data) {
    const header = h('div', { class: 'card-header' },
      h('div', {
        class: `task-checkbox ${data.completed ? 'checked' : ''}`,
        'data-task-id': data.id
      }),
      h('span', { class: 'task-title' }, data.title || 'Untitled Task'),
      data.priority ? h('span', { class: `task-priority priority-${data.priority}` }, data.priority) : null,
      data.id ? h('span', { class: 'task-id', title: data.id }, `T-${data.id.slice(-4).toUpperCase()}`) : null
    );
    card.appendChild(header);

    if (data.description) {
      card.appendChild(h('div', { class: 'card-body task-description' }, data.description));
    }

    if (data.assignee || data.created) {
      const meta = h('div', { class: 'card-footer task-meta' });
      if (data.assignee) meta.appendChild(h('span', null, data.assignee));
      if (data.created) meta.appendChild(h('span', { class: 'task-created' }, data.created));
      card.appendChild(meta);
    }

    if (data.completed) card.classList.add('task-done');
    if (data.status) card.classList.add(`task-${data.status}`);
  }

  /** @private */
  static _buildRecommendation(card, data) {
    card.appendChild(h('div', { class: 'card-header rec-card-title' }, data.title || 'Recommendation'));
    if (data.description) {
      card.appendChild(h('div', { class: 'card-body' }, data.description));
    }
  }

  /** @private */
  static _buildMilestone(card, data) {
    const header = h('div', { class: 'card-header' },
      h('span', null, data.title || 'Milestone'),
      data.status ? h('span', { class: `ms-status-badge ms-${data.status}` }, data.status) : null
    );
    card.appendChild(header);
    if (data.description) {
      card.appendChild(h('div', { class: 'card-body' }, data.description));
    }
    if (data.progress !== undefined) {
      const bar = h('div', { class: 'card-footer' },
        h('div', { class: 'progress-bar' },
          h('div', {
            class: 'progress-bar-fill',
            style: { width: `${data.progress}%`, background: 'var(--accent-cyan)' }
          })
        )
      );
      card.appendChild(bar);
    }
  }

  /** @private */
  static _buildKanban(card, data) {
    card.appendChild(h('div', { class: 'card-header kb-title' }, data.title || 'Task'));
    if (data.assignee) {
      card.appendChild(h('div', { class: 'card-body' },
        h('span', { class: 'kb-chip' }, data.assignee)
      ));
    }
    if (data.priority) card.classList.add(`priority-${data.priority}`);
  }

  /** @private — v2: Room card for room grid display */
  static _buildRoom(card, data) {
    const header = h('div', { class: 'card-header' },
      h('span', { class: `status-dot status-${data.occupied ? 'active' : 'idle'}` }),
      h('span', { class: 'room-card-name' }, data.name || data.type || 'Room')
    );
    card.appendChild(header);

    const body = h('div', { class: 'card-body' });
    if (data.type) body.appendChild(h('div', { class: 'room-type-label' }, data.type));
    if (data.agents && data.agents.length) {
      const agentList = h('div', { class: 'room-agents' });
      data.agents.forEach(a => {
        agentList.appendChild(h('span', { class: 'room-agent-chip' }, a.name || a));
      });
      body.appendChild(agentList);
    }
    if (data.tools && data.tools.length) {
      const toolList = h('div', { class: 'room-tools' });
      data.tools.slice(0, 4).forEach(t => {
        toolList.appendChild(h('span', { class: 'tool-tag' }, t));
      });
      if (data.tools.length > 4) {
        toolList.appendChild(h('span', { class: 'tool-tag tool-tag-more' }, `+${data.tools.length - 4}`));
      }
      body.appendChild(toolList);
    }
    card.appendChild(body);

    if (data.occupied) card.classList.add('room-occupied');
  }

  /** @private — v2: Floor card for building view */
  static _buildFloor(card, data) {
    const header = h('div', { class: 'card-header' },
      h('span', { class: 'floor-type-indicator', style: { background: `var(--floor-${data.type || 'default'})` } }),
      h('span', null, data.name || `Floor ${data.number || '?'}`),
      data.type ? h('span', { class: 'floor-type-badge' }, data.type) : null
    );
    card.appendChild(header);

    if (data.rooms && data.rooms.length) {
      const body = h('div', { class: 'card-body' });
      body.appendChild(h('span', { class: 'floor-room-count' }, `${data.rooms.length} room${data.rooms.length !== 1 ? 's' : ''}`));
      card.appendChild(body);
    }
  }

  /** @private — v2: Building card for dashboard */
  static _buildBuilding(card, data) {
    // Archived building visual distinction (#528)
    const isArchived = (data.name || '').includes('(Archived');
    if (isArchived) {
      card.style.opacity = '0.6';
      card.classList.add('card-archived');
    }

    // Execution state (#965, #969)
    const execState = data.executionState || 'stopped';
    card.dataset.executionState = execState;
    card.dataset.buildingId = data.id || '';

    const header = h('div', { class: 'card-header' },
      // Execution state indicator dot
      h('span', { class: `exec-state-dot exec-state-${execState}`, title: execState }),
      h('span', { title: data.name || 'Building' }, data.name || 'Building'),
      isArchived
        ? h('span', { class: 'card-archived-badge' }, 'ARCHIVED')
        : null,
      data.activePhase ? h('span', { class: `phase-badge phase-${data.activePhase}` }, data.activePhase) : null
    );
    card.appendChild(header);

    // Project info subtitle (#1127) — description + task progress
    const subtitle = [];
    if (data.description) subtitle.push(data.description.slice(0, 80));
    if (data.taskCount > 0) {
      const active = data.activeTaskCount || 0;
      subtitle.push(`${data.taskCount} tasks${active ? ` (${active} active)` : ''}`);
    }
    if (subtitle.length > 0) {
      card.appendChild(h('div', {
        class: 'card-subtitle',
        style: 'font-size:0.75rem; color:var(--text-muted); padding:0 var(--sp-2); margin-bottom:var(--sp-1); line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;',
      }, subtitle.join(' \u2022 ')));
    }

    // ── Execution Controls (#965, #969) ──
    if (!isArchived) {
      const controls = h('div', { class: 'exec-controls' });
      const buildingId = data.id;

      if (execState === 'stopped' || execState === 'paused') {
        const playBtn = h('button', {
          class: 'exec-btn exec-btn-play',
          title: execState === 'paused' ? 'Resume agents' : 'Start agents',
          'aria-label': execState === 'paused' ? 'Resume' : 'Start',
        }, '\u25B6'); // ▶
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.overlordSocket?.socket) {
            window.overlordSocket.socket.emit('building:start', { buildingId }, () => {});
          }
        });
        controls.appendChild(playBtn);
      }

      if (execState === 'running') {
        const pauseBtn = h('button', {
          class: 'exec-btn exec-btn-pause',
          title: 'Pause agents',
          'aria-label': 'Pause',
        }, '\u23F8'); // ⏸
        pauseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.overlordSocket?.socket) {
            window.overlordSocket.socket.emit('building:pause', { buildingId }, () => {});
          }
        });
        controls.appendChild(pauseBtn);
      }

      if (execState === 'running' || execState === 'paused') {
        const stopBtn = h('button', {
          class: 'exec-btn exec-btn-stop',
          title: 'Stop all agents',
          'aria-label': 'Stop',
        }, '\u23F9'); // ⏹
        stopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.overlordSocket?.socket) {
            window.overlordSocket.socket.emit('building:stop', { buildingId }, () => {});
          }
        });
        controls.appendChild(stopBtn);
      }

      // Live stats row (#967)
      const liveStats = h('div', { class: 'exec-live-stats', 'data-building-live-stats': buildingId });
      if (data.activeAgentCount !== undefined && data.totalAgentCount !== undefined) {
        liveStats.appendChild(h('span', { class: 'exec-stat' },
          `${data.activeAgentCount}/${data.totalAgentCount} agents`
        ));
      }
      if (data.tokensUsed !== undefined && data.tokensUsed > 0) {
        const formatted = data.tokensUsed >= 1000
          ? `${(data.tokensUsed / 1000).toFixed(1)}K`
          : String(data.tokensUsed);
        liveStats.appendChild(h('span', { class: 'exec-stat exec-stat-tokens' },
          `${formatted} tokens`
        ));
      }
      if (data.estimatedCost !== undefined && data.estimatedCost > 0) {
        liveStats.appendChild(h('span', { class: 'exec-stat exec-stat-cost' },
          `$${data.estimatedCost.toFixed(2)}`
        ));
      }

      controls.appendChild(liveStats);
      card.appendChild(controls);
    }

    // Health score badge (if available)
    if (data.healthScore) {
      const score = data.healthScore.total;
      const color = score >= 75 ? 'green' : score >= 50 ? 'yellow' : score >= 25 ? 'orange' : 'red';
      const badge = h('div', { class: `health-badge health-badge-${color}` },
        h('span', { class: 'health-badge-score' }, String(score)),
      );

      // Tooltip with user-friendly breakdown
      const breakdown = [
        `Project progress: ${data.healthScore.phaseProgress}/25`,
        `Tasks completed: ${data.healthScore.taskCompletion}/25`,
        `Risks tracked: ${data.healthScore.raidHealth}/25`,
        `Team activity: ${data.healthScore.agentActivity}/25`,
      ].join('\n');
      const advice = score >= 75 ? 'Great shape!' : score >= 50 ? 'Making progress' : score >= 25 ? 'Needs attention' : 'Just getting started';
      badge.title = `Health Score: ${score}/100 — ${advice}\n\n${breakdown}\n\nClick the building card for details.`;

      header.appendChild(badge);
    }

    const body = h('div', { class: 'card-body' });
    if (data.description) {
      body.appendChild(h('div', { class: 'building-desc text-muted' }, data.description));
    }

    // Stats row: floors, agents, repo
    const stats = h('div', { class: 'building-stats' });
    if (data.floorCount !== undefined) {
      stats.appendChild(h('span', { class: 'building-stat' }, `${data.floorCount} ${data.floorCount === 1 ? 'floor' : 'floors'}`));
    }
    if (data.totalAgentCount > 0) {
      const activeCount = data.agentCount || 0;
      const totalCount = data.totalAgentCount;
      stats.appendChild(h('span', { class: 'building-stat' },
        activeCount > 0 ? `${activeCount} active / ${totalCount} agents` : `${totalCount} agents`
      ));
    } else if (data.agentCount !== undefined && data.agentCount > 0) {
      stats.appendChild(h('span', { class: 'building-stat' }, `${data.agentCount} ${data.agentCount === 1 ? 'agent' : 'agents'}`));
    }
    if (data.taskCount > 0) {
      const taskLabel = data.activeTaskCount > 0
        ? `${data.activeTaskCount} active / ${data.taskCount} tasks`
        : `${data.taskCount} tasks`;
      stats.appendChild(h('span', { class: 'building-stat' }, taskLabel));
    }
    if (data.repoUrl) {
      const repoName = data.repoUrl.split('/').slice(-2).join('/');
      stats.appendChild(h('span', { class: 'building-stat building-repo' }, repoName));
    }
    if (stats.childNodes.length > 0) body.appendChild(stats);

    card.appendChild(body);
  }

  /** @private — v2: RAID entry card */
  static _buildRaid(card, data) {
    const typeColors = {
      risk: 'var(--raid-risk, #e74c3c)',
      assumption: 'var(--raid-assumption, #f39c12)',
      issue: 'var(--raid-issue, #e67e22)',
      dependency: 'var(--raid-dependency, #3498db)',
      decision: 'var(--raid-decision, #27ae60)'
    };
    const typeIcons = {
      risk: '\u{1F534}',
      assumption: '\u{1F7E1}',
      issue: '\u{1F7E0}',
      dependency: '\u{1F535}',
      decision: '\u{1F7E2}'
    };

    // Header with type icon + badge + severity
    const header = h('div', { class: 'card-header', style: 'display:flex; align-items:center; gap:var(--sp-1);' },
      h('span', { style: 'font-size:1rem;' }, typeIcons[data.type] || '\u2022'),
      h('span', { class: `badge badge-${data.type}`, style: `background:${typeColors[data.type]}; color:white; padding:2px 8px; border-radius:4px; font-size:0.7rem; text-transform:capitalize;` }, data.type || 'entry'),
      h('span', { style: 'margin-left:auto; font-size:0.7rem; color:var(--text-muted);' }, data.status || 'active')
    );
    card.appendChild(header);

    // Title / Summary
    const title = data.title || data.description || 'RAID Entry';
    card.appendChild(h('div', { class: 'card-body', style: 'font-weight:500; margin:var(--sp-1) 0;' }, title));

    // Rationale / Description (if different from title)
    if (data.description && data.title && data.description !== data.title) {
      card.appendChild(h('div', { style: 'font-size:0.8rem; color:var(--text-muted); margin-bottom:var(--sp-1);' }, data.description));
    }

    // Footer with owner
    if (data.owner) {
      card.appendChild(h('div', { class: 'card-footer', style: 'font-size:0.75rem; color:var(--text-muted); text-align:right;' }, data.owner));
    }
  }

  /** @private */
  static _buildGeneric(card, data) {
    if (data.title) {
      card.appendChild(h('div', { class: 'card-header' }, data.title));
    }
    if (data.body) {
      const body = h('div', { class: 'card-body' });
      if (data.body instanceof Node) body.appendChild(data.body);
      else body.textContent = data.body;
      card.appendChild(body);
    }
    if (data.footer) {
      card.appendChild(h('div', { class: 'card-footer' }, data.footer));
    }
  }
}
