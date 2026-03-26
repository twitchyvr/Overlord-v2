/**
 * Overlord v2 — Dashboard View
 *
 * Project overview with KPI cards, building list, active phase status,
 * and quick-action buttons. Shown when a returning user connects.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Card } from '../components/card.js';
import { ProgressBar } from '../components/progress-bar.js';
import { Button } from '../components/button.js';


const PHASE_ORDER = ['strategy', 'discovery', 'architecture', 'execution', 'review', 'deploy'];

export class DashboardView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._buildings = [];
    this._agents = [];
    this._raidEntries = [];
    this._activeBuilding = null;
    this._devLoopTransitions = [];
    this._activityItems = [];
    this._securityStats = { total: 0, blocked: 0, warned: 0, allowed: 0 };
  }

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    this.subscribe(store, 'building.list', (buildings) => {
      this._buildings = buildings || [];
      this.render();
    });

    this.subscribe(store, 'agents.list', (agents) => {
      this._agents = agents || [];
      this._updateKPIs();
    });

    this.subscribe(store, 'rooms.list', () => {
      this._updateKPIs();
    });

    this.subscribe(store, 'raid.entries', (entries) => {
      this._raidEntries = entries || [];
      this._updateKPIs();
    });

    this.subscribe(store, 'building.active', (id) => {
      this._activeBuilding = id;
      if (id && window.overlordSocket) {
        window.overlordSocket.fetchAgents({ buildingId: id });
        window.overlordSocket.fetchRaidEntries(id);
      }
      this.render();
    });

    this.subscribe(store, 'devLoop.transitions', (transitions) => {
      this._devLoopTransitions = transitions || [];
      this._updateDevLoopPipeline();
    });

    this.subscribe(store, 'activity.items', (items) => {
      this._activityItems = items || [];
      this._updateRecentActivity();
      this._updateToolActivity();
    });

    this.subscribe(store, 'security.stats', (stats) => {
      this._securityStats = stats || { total: 0, blocked: 0, warned: 0, allowed: 0 };
      this._updateKPIs();
    });

    // Hydrate from store — data may have arrived before this view mounted
    // (navigateTo is async, so store updates can land before subscriptions)
    this._buildings = store.get('building.list') || [];
    this._agents = store.get('agents.list') || [];
    this._raidEntries = store.get('raid.entries') || [];
    this._activeBuilding = store.get('building.active');
    this._devLoopTransitions = store.get('devLoop.transitions') || [];
    this._activityItems = store.get('activity.items') || [];
    this._securityStats = store.get('security.stats') || { total: 0, blocked: 0, warned: 0, allowed: 0 };

    // Fetch agents — scoped to active building when one is selected
    if (window.overlordSocket && this._agents.length === 0) {
      const agentFilter = this._activeBuilding ? { buildingId: this._activeBuilding } : {};
      window.overlordSocket.fetchAgents(agentFilter);
    }
    // RAID entries are building-specific — fetch only when a building is active
    if (this._activeBuilding && window.overlordSocket && this._raidEntries.length === 0) {
      window.overlordSocket.fetchRaidEntries(this._activeBuilding);
    }
    // Fetch security stats
    if (window.overlordSocket) {
      window.overlordSocket.fetchSecurityStats();
    }

    // Load recent activity from DB so dashboard isn't empty on page load (#1201)
    if (window.overlordSocket && this._activityItems.length === 0) {
      this._loadRecentActivity();
    }

    this.render();
  }

  destroy() {
    // Clear telemetry refresh interval to prevent memory leak (#1205)
    if (this._telemetryInterval) {
      clearInterval(this._telemetryInterval);
      this._telemetryInterval = null;
    }
    super.destroy();
  }

  render() {
    this.el.textContent = '';
    this.el.className = 'dashboard-view';

    // Header with project switcher
    const header = h('div', { class: 'dashboard-header' },
      h('h2', { class: 'dashboard-title' }, 'Dashboard'),
      h('div', { class: 'dashboard-actions' },
        Button.create('New Project', {
          variant: 'primary',
          icon: '+',
          onClick: () => OverlordUI.dispatch('navigate:onboarding')
        })
      )
    );
    this.el.appendChild(header);

    // Live Telemetry (#804) — most important, show first
    this.el.appendChild(this._buildTelemetryPanel());

    // Recent Activity Mini-Feed (#661)
    this.el.appendChild(this._buildRecentActivity());

    // Building List
    this.el.appendChild(this._buildBuildingList());
  }

  // Project switcher pills removed per user feedback (#1006)

  _buildCrossProjectKPIs() {
    const section = h('div', { class: 'cross-project-kpis' });

    const totalBuildings = this._buildings.length;
    const totalRooms = this._buildings.reduce((sum, b) => sum + (b.floorCount ?? b.floor_count ?? 0), 0);
    // Use totalAgentCount (all agents) not agentCount (only in-room agents)
    const liveAgentCount = this._agents.length || this._buildings.reduce((sum, b) => sum + (b.totalAgentCount ?? b.agentCount ?? b.agent_count ?? 0), 0);

    const kpis = [
      { label: 'Total Projects', value: totalBuildings, icon: '\u{1F4C1}', color: 'var(--accent-cyan)' },
      { label: 'Total Floors', value: totalRooms, icon: '\u{1F3E2}', color: 'var(--accent-purple, #a855f7)' },
      { label: 'Total Agents', value: liveAgentCount, icon: '\u{1F916}', color: 'var(--accent-green)' }
    ];

    for (const kpi of kpis) {
      section.appendChild(h('div', { class: 'cross-kpi-card glass-card' },
        h('div', { class: 'cross-kpi-icon', style: { color: kpi.color } }, kpi.icon),
        h('div', { class: 'cross-kpi-value' }, String(kpi.value)),
        h('div', { class: 'cross-kpi-label' }, kpi.label)
      ));
    }

    return section;
  }

  _buildKPISection() {
    const section = h('div', { class: 'dashboard-kpi-section' });

    const kpis = [
      {
        label: 'Buildings',
        value: this._buildings.length,
        icon: '\u{1F3D7}',
        color: 'var(--accent-cyan)'
      },
      {
        label: 'Avg Health',
        value: this._getAvgHealth(),
        icon: '\u{1F4CA}',
        color: this._getAvgHealthColor()
      },
      {
        label: 'Rooms',
        value: this._getRoomCount(),
        icon: '\u{1F3E0}',
        color: 'var(--accent-green)'
      },
      {
        label: 'RAID Entries',
        value: this._raidEntries.length,
        icon: '\u26A0',
        color: 'var(--accent-amber)',
        tooltip: 'Risks, Assumptions, Issues, and Decisions tracked for this project'
      },
      {
        label: 'Security',
        value: this._securityStats.blocked > 0
          ? `${this._securityStats.blocked} blocked`
          : this._securityStats.total > 0
            ? `${this._securityStats.total} events`
            : '0',
        icon: '\u{1F6E1}',
        color: this._securityStats.blocked > 0 ? 'var(--accent-red, #ef4444)' : 'var(--accent-green)',
        tooltip: `Security hooks: ${this._securityStats.blocked} blocked, ${this._securityStats.warned} warned, ${this._securityStats.allowed} allowed`
      }
    ];

    const kpiRow = h('div', { class: 'kpi-card-row' });
    for (const kpi of kpis) {
      const card = h('div', { class: 'kpi-card glass-card', title: kpi.tooltip || '' },
        h('div', { class: 'kpi-card-icon', style: { color: kpi.color } }, kpi.icon),
        h('div', { class: 'kpi-card-value' }, String(kpi.value)),
        h('div', { class: 'kpi-card-label' }, kpi.label)
      );
      kpiRow.appendChild(card);
    }

    section.appendChild(kpiRow);
    return section;
  }

  _buildPhaseProgress(building) {
    const section = h('div', { class: 'dashboard-phase-section' },
      h('h3', null, 'Phase Progress')
    );

    const phaseIdx = PHASE_ORDER.indexOf(building.activePhase || building.active_phase || 'strategy');
    const progress = phaseIdx >= 0 ? Math.round(((phaseIdx + 1) / PHASE_ORDER.length) * 100) : 0;

    // Phase progress bar
    const segments = PHASE_ORDER.map((phase, i) => ({
      value: 100 / PHASE_ORDER.length,
      color: i <= phaseIdx ? `var(--floor-${phase})` : 'var(--bg-tertiary)',
      label: phase
    }));

    section.appendChild(ProgressBar.createMulti(segments, { size: 'lg' }));

    // Phase labels
    const labels = h('div', { class: 'phase-label-row' });
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i];
      const isCurrent = i === phaseIdx;
      const isComplete = i < phaseIdx;
      labels.appendChild(h('span', {
        class: `phase-label-item${isCurrent ? ' current' : ''}${isComplete ? ' complete' : ''}`
      }, phase));
    }
    section.appendChild(labels);

    return section;
  }

  _buildBuildingList() {
    const section = h('div', { class: 'dashboard-buildings-section' },
      h('h3', null, 'Buildings')
    );

    if (this._buildings.length === 0) {
      section.appendChild(h('div', { class: 'empty-state' },
        h('p', { class: 'empty-state-text' }, 'No buildings yet. Create a new project to get started.')
      ));
      return section;
    }

    const grid = h('div', { class: 'building-card-grid' });

    for (const building of this._buildings) {
      const isActive = building.id === this._activeBuilding;
      const isArchived = (building.name || '').includes('(Archived');
      const cardActions = {
        'Open': () => {
          const bid = building.id;
          // Load building data then navigate — use navigate:chat directly
          // because building:selected dispatch gets swallowed by re-renders (#1006)
          if (window.overlordSocket) {
            window.overlordSocket.selectBuilding(bid).then(() => {
              OverlordUI.dispatch('navigate:chat');
            });
          }
        }
      };

      // Remove button with confirmation
      cardActions['Remove'] = async () => {
        if (!window.overlordSocket) return;
        const confirmed = confirm(`Remove "${building.name}" from Overlord?\n\nThis removes the project from the dashboard. Your git repository is NOT deleted.`);
        if (!confirmed) return;
        await window.overlordSocket.deleteBuilding(building.id);
        // Remove from local array before re-render to prevent flash-back
        this._buildings = this._buildings.filter(b => b.id !== building.id);
        this.render();
      };

      const card = Card.create('building', {
        id: building.id,
        name: building.name,
        activePhase: building.activePhase || building.active_phase,
        description: building.description || building.project_description || '',
        floorCount: building.floorCount ?? building.floor_count,
        agentCount: building.agentCount ?? building.agent_count ?? 0,
        totalAgentCount: building.totalAgentCount ?? 0,
        taskCount: building.taskCount ?? 0,
        activeTaskCount: building.activeTaskCount ?? 0,
        repoUrl: building.repoUrl || building.repo_url || '',
        healthScore: building.healthScore || null,
        executionState: building.executionState || building.execution_state || 'stopped',
        activeAgentCount: building.activeAgentCount ?? 0,
        tokensUsed: building.tokensUsed ?? 0,
        estimatedCost: building.estimatedCost ?? 0,
      }, {
        variant: isActive ? 'solid' : 'glass',
        className: isActive ? 'building-card-active' : '',
        actions: cardActions,
        // Card body click selects building in sidebar without navigating (#1006)
        onClick: () => {
          this._activeBuilding = building.id;
          if (window.overlordSocket) {
            window.overlordSocket.selectBuilding(building.id);
          }
          // Don't dispatch building:selected — that navigates to chat.
          // Just re-render to highlight the active card.
          this.render();
        },
      });

      grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
  }

  _getActivePhase() {
    if (this._activeBuilding) {
      const b = this._buildings.find(b => b.id === this._activeBuilding);
      if (b) return b.activePhase || b.active_phase || 'strategy';
    }
    if (this._buildings.length > 0) {
      return this._buildings[0].activePhase || this._buildings[0].active_phase || 'strategy';
    }
    return 'None';
  }

  _getAgentCount() {
    // When a building is selected, show agents for that building only
    if (this._activeBuilding) {
      // Use the fetched (building-filtered) agent list when available
      if (this._agents.length > 0) return this._agents.length;
      // Fall back to building-level metadata
      const b = this._buildings.find(b => b.id === this._activeBuilding);
      return b ? (b.agentCount ?? b.agent_count ?? 0) : 0;
    }
    // No building selected — aggregate across all buildings
    if (this._agents.length > 0) return this._agents.length;
    return this._buildings.reduce((sum, b) => sum + (b.agentCount ?? b.agent_count ?? 0), 0);
  }

  _getRoomCount() {
    const store = OverlordUI.getStore();
    const rooms = store?.get('rooms.list') || [];
    if (rooms.length > 0) return rooms.length;
    // Fallback: sum from building metadata
    return this._buildings.reduce((sum, b) => sum + (b.roomCount ?? 0), 0);
  }

  _getAvgHealth() {
    const scores = this._buildings
      .filter(b => b.healthScore && b.healthScore.total !== undefined)
      .map(b => b.healthScore.total);
    if (scores.length === 0) return '--';
    return Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  }

  _getAvgHealthColor() {
    const avg = this._getAvgHealth();
    if (avg === '--') return 'var(--text-muted)';
    if (avg >= 75) return 'var(--accent-green)';
    if (avg >= 50) return 'var(--accent-amber)';
    if (avg >= 25) return 'var(--accent-orange, #f97316)';
    return 'var(--accent-red, #ef4444)';
  }

  _updateKPIs() {
    // Lightweight KPI update without full re-render
    const kpiValues = this.el.querySelectorAll('.kpi-card-value');
    if (kpiValues.length >= 5) {
      kpiValues[0].textContent = String(this._buildings.length);
      kpiValues[1].textContent = String(this._getAvgHealth());
      kpiValues[2].textContent = String(this._getRoomCount());
      kpiValues[3].textContent = String(this._raidEntries.length);
      const s = this._securityStats;
      kpiValues[4].textContent = s.blocked > 0
        ? `${s.blocked} blocked`
        : s.total > 0
          ? `${s.total} events`
          : '0';
    }
  }

  // ─── Dev Loop Pipeline (#661) ───

  _buildDevLoopPipeline() {
    const section = h('div', { class: 'dashboard-section', id: 'dev-loop-pipeline' });
    section.appendChild(h('h3', { class: 'dashboard-section-title' }, 'Dev Loop Pipeline'));
    section.appendChild(h('p', { class: 'dashboard-section-desc' },
      'Code \u2192 Review \u2192 E2E \u2192 Visual \u2192 UAT \u2192 Dogfood'));

    const stages = [
      { id: 'code-lab', label: 'Code Lab', icon: '\u{1F4BB}' },
      { id: 'review', label: 'Review', icon: '\u{1F50D}' },
      { id: 'testing-lab', label: 'Testing', icon: '\u{1F9EA}' },
      { id: 'dogfood', label: 'Dogfood', icon: '\u{1F436}' },
    ];

    const pipeline = h('div', { class: 'dev-loop-pipeline' });

    // Determine current stage from most recent transition
    const lastTransition = this._devLoopTransitions[0];
    const currentStage = lastTransition ? lastTransition.to : null;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const isComplete = this._isStageComplete(stage.id);
      const isCurrent = stage.id === currentStage;

      const stageEl = h('div', {
        class: `dev-loop-stage${isCurrent ? ' current' : ''}${isComplete ? ' complete' : ''}`,
      },
        h('div', { class: 'dev-loop-stage-icon' }, stage.icon),
        h('div', { class: 'dev-loop-stage-label' }, stage.label),
      );
      pipeline.appendChild(stageEl);

      // Connector between stages
      if (i < stages.length - 1) {
        pipeline.appendChild(h('div', {
          class: `dev-loop-connector${isComplete ? ' complete' : ''}`,
        }));
      }
    }

    section.appendChild(pipeline);

    // Show latest transition message
    if (lastTransition && lastTransition.message) {
      section.appendChild(h('div', { class: 'dev-loop-message' }, lastTransition.message));
    }

    return section;
  }

  _isStageComplete(stageId) {
    // A stage is complete if there's a transition FROM it
    return this._devLoopTransitions.some(t => t.from === stageId);
  }

  _updateDevLoopPipeline() {
    const existing = this.el.querySelector('#dev-loop-pipeline');
    if (existing) {
      const newPipeline = this._buildDevLoopPipeline();
      existing.replaceWith(newPipeline);
    }
  }

  // ─── Live Telemetry (#804) ───

  _buildTelemetryPanel() {
    const panel = h('div', { class: 'telemetry-panel' });
    const header = h('div', { class: 'telemetry-header' },
      h('h3', null, 'Live Telemetry'),
      h('span', { class: 'telemetry-scope' }, this._activeBuilding ? 'Project' : 'Global')
    );
    panel.appendChild(header);

    // Rate cards row
    const rateRow = h('div', { class: 'telemetry-rate-row' });
    this._rateCards = {};
    const rates = [
      { key: 'executionRate', label: 'Executions', unit: '/24h', icon: '\u26A1', color: '#22d3ee' },
      { key: 'toolUseRate', label: 'Tool Calls', unit: '/24h', icon: '\u{1F527}', color: '#4ade80' },
      { key: 'agentChatRate', label: 'Messages', unit: '/24h', icon: '\u{1F4AC}', color: '#8b5cf6' },
      { key: 'aiRequestRate', label: 'AI Requests', unit: '/24h', icon: '\u{1F916}', color: '#f59e0b' },
      { key: 'activeAgents', label: 'Active', unit: '', icon: '\u{1F7E2}', color: '#4ade80' },
      { key: 'totalTokens', label: 'Tokens', unit: ' total', icon: '\u{1F4B0}', color: '#ec4899' },
    ];
    for (const r of rates) {
      const card = h('div', { class: 'telem-rate-card' });
      const valueEl = h('div', { class: 'telem-rate-value', style: { color: r.color } }, '--');
      const unitEl = h('span', { class: 'telem-rate-unit' }, r.unit);
      card.appendChild(h('div', { class: 'telem-rate-icon' }, r.icon));
      const valRow = h('div', { class: 'telem-rate-val-row' });
      valRow.appendChild(valueEl);
      valRow.appendChild(unitEl);
      card.appendChild(valRow);
      card.appendChild(h('div', { class: 'telem-rate-label' }, r.label));
      rateRow.appendChild(card);
      this._rateCards[r.key] = valueEl;
    }
    panel.appendChild(rateRow);

    // Bottom row: top tools + top agents
    const bottomRow = h('div', { class: 'telemetry-bottom-row' });
    this._topToolsEl = h('div', { class: 'telem-list-card glass-card' });
    this._topToolsEl.appendChild(h('div', { class: 'telemetry-card-header' }, 'Top Tools'));
    this._topToolsEl.appendChild(h('div', { class: 'telem-list-body' }, 'Loading...'));
    bottomRow.appendChild(this._topToolsEl);

    this._topAgentsEl = h('div', { class: 'telem-list-card glass-card' });
    this._topAgentsEl.appendChild(h('div', { class: 'telemetry-card-header' }, 'Most Active Agents (24h)'));
    this._topAgentsEl.appendChild(h('div', { class: 'telem-list-body' }, 'Loading...'));
    bottomRow.appendChild(this._topAgentsEl);
    panel.appendChild(bottomRow);

    this._telemetryPanel = panel;

    // Fetch from DB on mount
    this._fetchTelemetryRates();

    // Auto-refresh every 30s
    this._telemetryInterval = setInterval(() => this._fetchTelemetryRates(), 30000);

    // Also refresh on live socket events (use this.subscribe for proper cleanup #1205)
    const store = OverlordUI.getStore();
    if (store) {
      this.subscribe(store, 'activity.items', () => this._fetchTelemetryRates());
    }

    return panel;
  }

  async _fetchTelemetryRates() {
    if (!window.overlordSocket) return;
    try {
      const res = await window.overlordSocket.fetchTelemetryRates(this._activeBuilding);
      if (!res?.ok) return;
      const d = res.data;

      // Update rate cards
      if (this._rateCards) {
        this._rateCards.executionRate.textContent = String(d.executionRate || 0);
        this._rateCards.toolUseRate.textContent = String(d.toolUseRate || 0);
        this._rateCards.agentChatRate.textContent = String(d.agentChatRate || 0);
        this._rateCards.aiRequestRate.textContent = String(d.aiRequestRate || 0);
        this._rateCards.activeAgents.textContent = String(d.activeAgents || 0);
        this._rateCards.totalTokens.textContent = d.totalTokens > 1000
          ? `${(d.totalTokens / 1000).toFixed(1)}k`
          : String(d.totalTokens || 0);
      }

      // Update top tools
      if (this._topToolsEl) {
        const body = this._topToolsEl.querySelector('.telem-list-body');
        if (body) {
          body.textContent = '';
          if (!d.topTools || d.topTools.length === 0) {
            body.textContent = 'No tool calls recorded';
          } else {
            const maxCount = Math.max(...d.topTools.map(t => t.count), 1);
            for (const tool of d.topTools) {
              const row = h('div', { class: 'telem-bar-row' });
              row.appendChild(h('span', { class: 'telem-bar-label' }, tool.name));
              const barOuter = h('div', { class: 'telem-bar-outer' });
              const barInner = h('div', { class: 'telem-bar-inner' });
              barInner.style.width = `${(tool.count / maxCount) * 100}%`;
              barOuter.appendChild(barInner);
              row.appendChild(barOuter);
              row.appendChild(h('span', { class: 'telem-bar-count' }, String(tool.count)));
              body.appendChild(row);
            }
          }
        }
      }

      // Update top agents
      if (this._topAgentsEl) {
        const body = this._topAgentsEl.querySelector('.telem-list-body');
        if (body) {
          body.textContent = '';
          if (!d.topAgents || d.topAgents.length === 0) {
            body.textContent = 'No agent activity recorded';
          } else {
            for (const agent of d.topAgents) {
              const row = h('div', { class: 'telem-agent-row' });
              row.appendChild(h('span', { class: 'telem-agent-name' }, agent.name || 'Agent'));
              row.appendChild(h('span', { class: 'telem-agent-events' }, `${agent.events} events`));
              body.appendChild(row);
            }
          }
        }
      }

      // Update scope label
      const scopeEl = this._telemetryPanel?.querySelector('.telemetry-scope');
      if (scopeEl) scopeEl.textContent = this._activeBuilding ? 'Project' : 'Global';
    } catch (e) {
      // Silently ignore — will retry in 30s
    }
  }

  // Old SVG chart methods removed — telemetry now uses DB-backed rates (#804)

  // ─── DEPRECATED SVG METHODS REMOVED ───
  // _createSvg, _svgEl, _createTokenChart, _createApiSparkline,
  // _createToolBarChart, _createAgentStatusChart — all replaced by
  // _fetchTelemetryRates() which queries the DB for real data.

  // Old SVG chart methods removed — telemetry now uses DB-backed rates (#804)

  // ─── Tool Activity Summary (#661) ───

  _buildToolActivity() {
    const section = h('div', { class: 'dashboard-section', id: 'tool-activity' });
    section.appendChild(h('h3', { class: 'dashboard-section-title' }, 'Tool Activity'));

    const toolEvents = this._activityItems.filter(i => i.event === 'tool:executed');
    if (toolEvents.length === 0) {
      section.appendChild(h('p', { class: 'dashboard-empty' }, 'No tool calls yet.'));
      return section;
    }

    // Aggregate by tool name
    const toolCounts = {};
    for (const evt of toolEvents) {
      const name = evt.toolName || 'unknown';
      if (!toolCounts[name]) toolCounts[name] = { calls: 0, success: 0, failed: 0 };
      toolCounts[name].calls++;
      if (evt.status === 'error' || evt.status === 'failed') toolCounts[name].failed++;
      else toolCounts[name].success++;
    }

    const grid = h('div', { class: 'tool-activity-grid' });
    const sorted = Object.entries(toolCounts).sort((a, b) => b[1].calls - a[1].calls).slice(0, 8);

    for (const [name, counts] of sorted) {
      const pct = counts.calls > 0 ? Math.round((counts.success / counts.calls) * 100) : 0;
      const barColor = counts.failed > 0 ? 'var(--accent-amber)' : 'var(--accent-green)';

      const card = h('div', { class: 'tool-activity-card glass-card' },
        h('div', { class: 'tool-activity-name' }, name),
        h('div', { class: 'tool-activity-stats' },
          h('span', { class: 'tool-activity-count' }, String(counts.calls)),
          counts.failed > 0
            ? h('span', { class: 'tool-activity-failed' }, `${counts.failed} failed`)
            : null,
        ),
        h('div', { class: 'tool-activity-bar' },
          h('div', { class: 'tool-activity-bar-fill', style: { width: `${pct}%`, background: barColor } }),
        ),
      );
      grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
  }

  _updateToolActivity() {
    const existing = this.el.querySelector('#tool-activity');
    if (existing) {
      const newSection = this._buildToolActivity();
      existing.replaceWith(newSection);
    }
  }

  // Load recent activity from DB across all buildings (#1201)
  async _loadRecentActivity() {
    if (!window.overlordSocket) return;
    const buildings = this._buildings || [];
    // Fetch last 10 events from each building, merge, sort by timestamp
    const allEvents = [];
    for (const b of buildings.slice(0, 5)) { // Limit to 5 buildings to avoid flooding
      try {
        const res = await window.overlordSocket.fetchActivityHistory(b.id, { limit: 10 });
        if (res && res.ok && res.data) {
          allEvents.push(...res.data);
        }
      } catch { /* skip failed buildings */ }
    }
    if (allEvents.length > 0) {
      // Sort by timestamp descending and take top 10
      allEvents.sort((a, b) => {
        const ta = a.ts || a.created_at || '';
        const tb = b.ts || b.created_at || '';
        return tb.localeCompare(ta);
      });
      const store = OverlordUI.getStore();
      const existing = store?.get('activity.items') || [];
      // Merge DB events with any real-time events, dedup by event+timestamp
      const merged = [...existing];
      for (const ev of allEvents.slice(0, 20)) {
        if (!merged.some(m => m.event === ev.event && m.ts === ev.ts && m.agentId === ev.agentId)) {
          merged.push(ev);
        }
      }
      merged.sort((a, b) => {
        const ta = a.ts || a.timestamp || '';
        const tb = b.ts || b.timestamp || '';
        return String(tb).localeCompare(String(ta));
      });
      store?.set('activity.items', merged.slice(0, 100));
    }
  }

  // ─── Recent Activity Mini-Feed (#661) ───

  _buildRecentActivity() {
    const section = h('div', { class: 'dashboard-section', id: 'recent-activity' });
    section.appendChild(h('h3', { class: 'dashboard-section-title' }, 'Recent Activity'));

    const recent = this._activityItems.slice(0, 6);
    if (recent.length === 0) {
      section.appendChild(h('p', { class: 'dashboard-empty' }, 'No activity yet. Start a project to see agent activity here.'));
      return section;
    }

    const feed = h('div', { class: 'recent-activity-feed' });

    const eventIcons = {
      'tool:executed': '\u{1F527}',
      'phase:advanced': '\u{1F6A7}',
      'phase:gate:created': '\u{1F3C1}',
      'phase:gate:signed-off': '\u{1F3C6}',
      'room:agent:entered': '\u{1F6AA}',
      'room:agent:exited': '\u{1F6AA}',
      'task:created': '\u{1F4CB}',
      'task:updated': '\u{1F4CB}',
      'exit-doc:submitted': '\u{1F4C4}',
      'dev-loop:stage-transition': '\u{1F504}',
      'raid:entry:added': '\u26A0\uFE0F',
      'escalation:stale-gate': '\u23F0',
    };

    for (const item of recent) {
      const icon = eventIcons[item.event] || '\u{1F4E1}';
      const isError = item.status === 'error' || item.status === 'failed';
      const dotClass = isError ? 'error' : 'success';

      // Build human-readable summary (#1247)
      const EVENT_LABELS = {
        'tool:executed': 'Used tool',
        'tool_executed': 'Used tool',
        'ai_request': 'AI request',
        'ai:request': 'AI request',
        'task:created': 'Task created',
        'task:updated': 'Task updated',
        'phase:advanced': 'Phase advanced',
        'phase:gate:created': 'Gate created',
        'phase:gate:signed-off': 'Gate signed off',
        'room:agent:entered': 'Entered room',
        'room:agent:exited': 'Left room',
        'exit-doc:submitted': 'Exit doc submitted',
        'dev-loop:stage-transition': 'Dev loop stage',
        'raid:entry:added': 'RAID entry added',
        'building:started': 'Project started',
        'building:stopped': 'Project stopped',
      };
      let summary = EVENT_LABELS[item.event] || item.event?.replace(/[_:]/g, ' ') || 'Activity';
      if ((item.event === 'tool:executed' || item.event === 'tool_executed') && item.toolName) {
        summary = item.toolName.replace(/_/g, ' ');
      } else if (item.event === 'dev-loop:stage-transition') {
        summary = `${item.from || '?'} \u2192 ${item.to || '?'}`;
      } else if (item.event === 'phase:gate:signed-off' && item.verdict) {
        summary = `Gate: ${item.verdict}`;
      }

      // Resolve agent name from ID (#1247)
      let agentLabel = item.agentName || '';
      if (!agentLabel && item.agentId) {
        const agents = this._agents || [];
        const agent = agents.find(a => a.id === item.agentId);
        agentLabel = agent?.display_name || agent?.name || '';
      }

      const ts = item.timestamp || item.ts ? formatTime(item.timestamp || item.ts) : '';

      const row = h('div', { class: 'recent-activity-row' },
        h('div', { class: `recent-activity-dot recent-activity-dot--${dotClass}` }),
        h('span', { class: 'recent-activity-icon' }, icon),
        h('span', { class: 'recent-activity-summary' }, summary),
        h('span', { class: 'recent-activity-agent' }, agentLabel),
        h('span', { class: 'recent-activity-time' }, ts),
      );
      feed.appendChild(row);
    }

    // "View all" link
    const viewAll = h('button', { class: 'btn btn-ghost btn-sm' }, 'View All Activity');
    viewAll.addEventListener('click', () => OverlordUI.navigateTo('activity'));

    section.appendChild(feed);
    section.appendChild(viewAll);
    return section;
  }

  _updateRecentActivity() {
    const existing = this.el.querySelector('#recent-activity');
    if (existing) {
      const newSection = this._buildRecentActivity();
      existing.replaceWith(newSection);
    }
  }
}
