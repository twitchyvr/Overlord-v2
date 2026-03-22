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

    this.render();
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

    // Project Switcher (multi-building selector)
    if (this._buildings.length > 0) {
      this.el.appendChild(this._buildProjectSwitcher());
    }

    // Cross-project KPIs (aggregate stats)
    if (this._buildings.length > 1) {
      this.el.appendChild(this._buildCrossProjectKPIs());
    }

    // Per-building KPI Cards
    this.el.appendChild(this._buildKPISection());

    // Phase Progress (if active building)
    if (this._activeBuilding) {
      const building = this._buildings.find(b => b.id === this._activeBuilding);
      if (building) {
        this.el.appendChild(this._buildPhaseProgress(building));
      }
    }

    // Dev Loop Pipeline (#661)
    if (this._activeBuilding) {
      this.el.appendChild(this._buildDevLoopPipeline());
    }

    // Live Telemetry (#804)
    this.el.appendChild(this._buildTelemetryPanel());

    // Tool Activity Summary (#661)
    this.el.appendChild(this._buildToolActivity());

    // Recent Activity Mini-Feed (#661)
    this.el.appendChild(this._buildRecentActivity());

    // Building List
    this.el.appendChild(this._buildBuildingList());
  }

  _buildProjectSwitcher() {
    const switcher = h('div', { class: 'project-switcher' });

    for (const building of this._buildings) {
      const isActive = building.id === this._activeBuilding;
      const pill = h('button', {
        class: `project-pill${isActive ? ' active' : ''}`
      },
        h('span', { class: 'project-pill-icon' }, '\u{1F3D7}\uFE0F'),
        h('span', { class: 'project-pill-name', title: building.name || 'Untitled' }, building.name || 'Untitled')
      );

      pill.addEventListener('click', () => {
        if (window.overlordSocket) {
          window.overlordSocket.selectBuilding(building.id);
        }
        OverlordUI.dispatch('building:selected', { buildingId: building.id });
      });

      switcher.appendChild(pill);
    }

    // "New Project" mini-button at end of switcher
    const addPill = h('button', { class: 'project-pill project-pill-add' },
      h('span', { class: 'project-pill-icon' }, '+'),
      h('span', { class: 'project-pill-name' }, 'New')
    );
    addPill.addEventListener('click', () => OverlordUI.dispatch('navigate:onboarding'));
    switcher.appendChild(addPill);

    return switcher;
  }

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
          if (window.overlordSocket) {
            window.overlordSocket.selectBuilding(building.id);
          }
          OverlordUI.dispatch('building:selected', { buildingId: building.id });
        }
      };

      // Archive / Restore button (#515)
      if (isArchived) {
        cardActions['Restore'] = async () => {
          if (!window.overlordSocket) return;
          const newName = building.name.replace(/\s*\(Archived\)/, '');
          await window.overlordSocket.updateBuilding(building.id, { name: newName });
        };
      } else {
        cardActions['Archive'] = async () => {
          if (!window.overlordSocket) return;
          const newName = `${building.name} (Archived)`;
          await window.overlordSocket.updateBuilding(building.id, { name: newName });
        };
      }

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
    panel.appendChild(h('h3', null, 'Live Telemetry'));

    const grid = h('div', { class: 'telemetry-grid' });

    // Token Usage Chart
    const tokenChart = h('div', { class: 'telemetry-card glass-card' });
    tokenChart.appendChild(h('div', { class: 'telemetry-card-header' }, 'Token Usage'));
    const tokenSvg = this._createTokenChart();
    tokenChart.appendChild(tokenSvg);
    grid.appendChild(tokenChart);

    // API Calls / Minute Sparkline
    const apiChart = h('div', { class: 'telemetry-card glass-card' });
    apiChart.appendChild(h('div', { class: 'telemetry-card-header' }, 'API Calls'));
    const apiSvg = this._createApiSparkline();
    apiChart.appendChild(apiSvg);
    grid.appendChild(apiChart);

    // Tool Breakdown Bar Chart
    const toolChart = h('div', { class: 'telemetry-card glass-card' });
    toolChart.appendChild(h('div', { class: 'telemetry-card-header' }, 'Tool Usage'));
    const toolSvg = this._createToolBarChart();
    toolChart.appendChild(toolSvg);
    grid.appendChild(toolChart);

    // Agent Status Overview
    const agentChart = h('div', { class: 'telemetry-card glass-card' });
    agentChart.appendChild(h('div', { class: 'telemetry-card-header' }, 'Agent Status'));
    const agentSvg = this._createAgentStatusChart();
    agentChart.appendChild(agentSvg);
    grid.appendChild(agentChart);

    panel.appendChild(grid);

    // Subscribe to live updates
    const store = OverlordUI.getStore();
    if (store) {
      store.subscribe('ai.callLog', () => this._updateTelemetry());
      store.subscribe('activity.items', () => this._updateTelemetry());
      store.subscribe('ai.usage', () => this._updateTelemetry());
    }

    this._telemetryPanel = panel;
    return panel;
  }

  _updateTelemetry() {
    if (!this._telemetryPanel) return;
    const cards = this._telemetryPanel.querySelectorAll('.telemetry-card');
    if (cards[0]) { const svg = this._createTokenChart(); cards[0].querySelector('svg')?.replaceWith(svg); }
    if (cards[1]) { const svg = this._createApiSparkline(); cards[1].querySelector('svg')?.replaceWith(svg); }
    if (cards[2]) { const svg = this._createToolBarChart(); cards[2].querySelector('svg')?.replaceWith(svg); }
    if (cards[3]) { const svg = this._createAgentStatusChart(); cards[3].querySelector('svg')?.replaceWith(svg); }
  }

  _createSvg(w, h, viewBox) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', viewBox || `0 0 ${w} ${h}`);
    svg.style.display = 'block';
    return svg;
  }

  _svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    }
    return el;
  }

  _createTokenChart() {
    const store = OverlordUI.getStore();
    const callLog = store?.get('ai.callLog') || [];
    const usage = store?.get('ai.usage') || { total: { input: 0, output: 0, calls: 0 } };

    const W = 320, H = 120, PAD = 30;
    const svg = this._createSvg('100%', H, `0 0 ${W} ${H}`);

    // Background
    svg.appendChild(this._svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }));

    if (callLog.length === 0) {
      const txt = this._svgEl('text', { x: W / 2, y: H / 2, fill: '#64748b', 'font-size': '12', 'text-anchor': 'middle' });
      txt.textContent = 'No API calls yet';
      svg.appendChild(txt);

      // Show totals
      const totalTxt = this._svgEl('text', { x: W / 2, y: H / 2 + 18, fill: '#475569', 'font-size': '10', 'text-anchor': 'middle' });
      totalTxt.textContent = `Total: ${(usage.total.input + usage.total.output).toLocaleString()} tokens`;
      svg.appendChild(totalTxt);
      return svg;
    }

    // Build time series (last 20 calls, newest first → reverse for left-to-right)
    const points = callLog.slice(0, 20).reverse();
    const maxTokens = Math.max(...points.map(p => (p.inputTokens || 0) + (p.outputTokens || 0)), 1);

    // Grid lines
    for (let i = 0; i <= 3; i++) {
      const y = PAD + ((H - PAD * 2) * i) / 3;
      svg.appendChild(this._svgEl('line', { x1: PAD, y1: y, x2: W - 10, y2: y, stroke: '#334155', 'stroke-width': '0.5', 'stroke-dasharray': '3,3' }));
    }

    // Input tokens line (cyan)
    const inputPath = points.map((p, i) => {
      const x = PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD - 10);
      const y = PAD + (1 - (p.inputTokens || 0) / maxTokens) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg.appendChild(this._svgEl('path', { d: inputPath, fill: 'none', stroke: '#22d3ee', 'stroke-width': '2', 'stroke-linejoin': 'round' }));

    // Output tokens line (green)
    const outputPath = points.map((p, i) => {
      const x = PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD - 10);
      const y = PAD + (1 - (p.outputTokens || 0) / maxTokens) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg.appendChild(this._svgEl('path', { d: outputPath, fill: 'none', stroke: '#4ade80', 'stroke-width': '2', 'stroke-linejoin': 'round' }));

    // Legend
    svg.appendChild(this._svgEl('circle', { cx: PAD, cy: H - 8, r: 3, fill: '#22d3ee' }));
    const inLabel = this._svgEl('text', { x: PAD + 8, y: H - 5, fill: '#94a3b8', 'font-size': '9' });
    inLabel.textContent = `In: ${usage.total.input.toLocaleString()}`;
    svg.appendChild(inLabel);

    svg.appendChild(this._svgEl('circle', { cx: PAD + 100, cy: H - 8, r: 3, fill: '#4ade80' }));
    const outLabel = this._svgEl('text', { x: PAD + 108, y: H - 5, fill: '#94a3b8', 'font-size': '9' });
    outLabel.textContent = `Out: ${usage.total.output.toLocaleString()}`;
    svg.appendChild(outLabel);

    // Calls count
    const callsLabel = this._svgEl('text', { x: W - 10, y: H - 5, fill: '#64748b', 'font-size': '9', 'text-anchor': 'end' });
    callsLabel.textContent = `${usage.total.calls} calls`;
    svg.appendChild(callsLabel);

    return svg;
  }

  _createApiSparkline() {
    const store = OverlordUI.getStore();
    const callLog = store?.get('ai.callLog') || [];

    const W = 320, H = 120;
    const svg = this._createSvg('100%', H, `0 0 ${W} ${H}`);

    if (callLog.length === 0) {
      const txt = this._svgEl('text', { x: W / 2, y: H / 2, fill: '#64748b', 'font-size': '12', 'text-anchor': 'middle' });
      txt.textContent = 'No API activity';
      svg.appendChild(txt);
      return svg;
    }

    // Bucket calls into 1-minute windows (last 10 minutes)
    const now = Date.now();
    const buckets = new Array(10).fill(0);
    for (const call of callLog) {
      const ts = call.timestamp || call.ts || 0;
      const age = (now - ts) / 60000; // minutes ago
      const bucket = Math.floor(age);
      if (bucket >= 0 && bucket < 10) buckets[9 - bucket]++;
    }

    const maxCalls = Math.max(...buckets, 1);
    const barW = (W - 40) / buckets.length;

    // Bars
    buckets.forEach((count, i) => {
      const barH = (count / maxCalls) * (H - 40);
      const x = 20 + i * barW + 2;
      const y = H - 20 - barH;
      svg.appendChild(this._svgEl('rect', {
        x, y, width: barW - 4, height: Math.max(barH, 1),
        rx: 2, fill: count > 0 ? '#8b5cf6' : '#1e293b',
        opacity: count > 0 ? 0.8 : 0.3,
      }));
      if (count > 0) {
        const label = this._svgEl('text', { x: x + (barW - 4) / 2, y: y - 4, fill: '#a78bfa', 'font-size': '9', 'text-anchor': 'middle' });
        label.textContent = String(count);
        svg.appendChild(label);
      }
    });

    // X-axis labels
    const timeLabels = ['10m', '', '', '', '', '5m', '', '', '', 'now'];
    timeLabels.forEach((label, i) => {
      if (!label) return;
      const txt = this._svgEl('text', { x: 20 + i * barW + barW / 2, y: H - 5, fill: '#475569', 'font-size': '8', 'text-anchor': 'middle' });
      txt.textContent = label;
      svg.appendChild(txt);
    });

    return svg;
  }

  _createToolBarChart() {
    const store = OverlordUI.getStore();
    const items = store?.get('activity.items') || [];

    const W = 320, H = 120;
    const svg = this._createSvg('100%', H, `0 0 ${W} ${H}`);

    // Count tool executions
    const toolCounts = {};
    for (const item of items) {
      if (item.event === 'tool:executed' || item.type === 'tool:executed') {
        const name = item.toolName || item.tool || 'unknown';
        toolCounts[name] = (toolCounts[name] || 0) + 1;
      }
    }

    const entries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

    if (entries.length === 0) {
      const txt = this._svgEl('text', { x: W / 2, y: H / 2, fill: '#64748b', 'font-size': '12', 'text-anchor': 'middle' });
      txt.textContent = 'No tool calls yet';
      svg.appendChild(txt);
      return svg;
    }

    const maxCount = Math.max(...entries.map(e => e[1]), 1);
    const barH = Math.min(16, (H - 20) / entries.length - 4);
    const colors = ['#22d3ee', '#4ade80', '#f59e0b', '#8b5cf6', '#ec4899', '#f97316'];

    entries.forEach(([name, count], i) => {
      const y = 10 + i * (barH + 4);
      const barW = (count / maxCount) * (W - 120);

      // Bar
      svg.appendChild(this._svgEl('rect', { x: 100, y, width: Math.max(barW, 2), height: barH, rx: 3, fill: colors[i % colors.length], opacity: 0.7 }));

      // Label
      const label = this._svgEl('text', { x: 95, y: y + barH / 2 + 4, fill: '#94a3b8', 'font-size': '10', 'text-anchor': 'end' });
      label.textContent = name.length > 12 ? name.slice(0, 12) + '...' : name;
      svg.appendChild(label);

      // Count
      const countLabel = this._svgEl('text', { x: 105 + barW, y: y + barH / 2 + 4, fill: '#e2e8f0', 'font-size': '10' });
      countLabel.textContent = String(count);
      svg.appendChild(countLabel);
    });

    return svg;
  }

  _createAgentStatusChart() {
    const W = 320, H = 120;
    const svg = this._createSvg('100%', H, `0 0 ${W} ${H}`);

    const agents = this._agents.length > 0 ? this._agents : [];
    if (agents.length === 0) {
      // Use building-level agent counts
      const total = this._buildings.reduce((sum, b) => sum + (b.totalAgentCount ?? b.agentCount ?? 0), 0);
      const txt = this._svgEl('text', { x: W / 2, y: H / 2, fill: '#64748b', 'font-size': '12', 'text-anchor': 'middle' });
      txt.textContent = total > 0 ? `${total} agents across ${this._buildings.length} projects` : 'No agents';
      svg.appendChild(txt);
      return svg;
    }

    // Count by status
    const statusCounts = { active: 0, idle: 0, paused: 0, error: 0 };
    for (const a of agents) {
      const s = a.status || 'idle';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }

    // Donut chart
    const cx = 60, cy = 60, r = 40;
    const total = agents.length;
    const slices = [
      { label: 'Active', count: statusCounts.active, color: '#4ade80' },
      { label: 'Idle', count: statusCounts.idle, color: '#64748b' },
      { label: 'Paused', count: statusCounts.paused, color: '#f59e0b' },
      { label: 'Error', count: statusCounts.error, color: '#ef4444' },
    ].filter(s => s.count > 0);

    let angle = -Math.PI / 2;
    for (const slice of slices) {
      const sliceAngle = (slice.count / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sliceAngle);
      const y2 = cy + r * Math.sin(angle + sliceAngle);
      const largeArc = sliceAngle > Math.PI ? 1 : 0;

      const path = `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
      svg.appendChild(this._svgEl('path', { d: path, fill: slice.color, opacity: 0.8 }));
      angle += sliceAngle;
    }

    // Center hole (donut)
    svg.appendChild(this._svgEl('circle', { cx, cy, r: r * 0.55, fill: 'var(--bg-primary, #0f172a)' }));
    const centerTxt = this._svgEl('text', { x: cx, y: cy + 4, fill: '#e2e8f0', 'font-size': '16', 'font-weight': 'bold', 'text-anchor': 'middle' });
    centerTxt.textContent = String(total);
    svg.appendChild(centerTxt);

    // Legend (right side)
    slices.forEach((slice, i) => {
      const ly = 20 + i * 22;
      svg.appendChild(this._svgEl('circle', { cx: 140, cy: ly, r: 5, fill: slice.color }));
      const label = this._svgEl('text', { x: 150, y: ly + 4, fill: '#94a3b8', 'font-size': '11' });
      label.textContent = `${slice.label}: ${slice.count}`;
      svg.appendChild(label);
    });

    return svg;
  }

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

  // ─── Recent Activity Mini-Feed (#661) ───

  _buildRecentActivity() {
    const section = h('div', { class: 'dashboard-section', id: 'recent-activity' });
    section.appendChild(h('h3', { class: 'dashboard-section-title' }, 'Recent Activity'));

    const recent = this._activityItems.slice(0, 6);
    if (recent.length === 0) {
      section.appendChild(h('p', { class: 'dashboard-empty' }, 'No activity yet.'));
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

      // Build summary text
      let summary = item.event;
      if (item.event === 'tool:executed') {
        summary = `${item.toolName || 'tool'} ${isError ? 'failed' : 'executed'}`;
      } else if (item.event === 'dev-loop:stage-transition') {
        summary = `${item.from || '?'} \u2192 ${item.to || '?'}`;
      } else if (item.event === 'exit-doc:submitted') {
        summary = `Exit doc submitted`;
      } else if (item.event === 'phase:gate:signed-off') {
        summary = `Gate: ${item.verdict || 'signed off'}`;
      }

      const ts = item.timestamp ? formatTime(item.timestamp) : '';

      const row = h('div', { class: 'recent-activity-row' },
        h('div', { class: `recent-activity-dot recent-activity-dot--${dotClass}` }),
        h('span', { class: 'recent-activity-icon' }, icon),
        h('span', { class: 'recent-activity-summary' }, summary),
        h('span', { class: 'recent-activity-agent' }, item.agentName || ''),
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
