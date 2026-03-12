/**
 * Overlord v2 — Tools Panel
 *
 * Shows available tools scoped to the currently selected room.
 * Displays tool execution history from activity feed.
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { DrillItem } from '../components/drill-item.js';
import { Tabs } from '../components/tabs.js';


const TOOL_ICONS = {
  bash:             '\u{1F4BB}',
  read_file:        '\u{1F4C4}',
  write_file:       '\u{1F4DD}',
  patch_file:       '\u{1F527}',
  list_dir:         '\u{1F4C1}',
  web_search:       '\u{1F50D}',
  fetch_webpage:    '\u{1F310}',
  qa_run_tests:     '\u2705',
  qa_check_lint:    '\u{1F9F9}',
  qa_check_types:   '\u{1F3AF}',
  qa_check_coverage:'\u{1F4CA}',
  qa_audit_deps:    '\u{1F6E1}',
  github:           '\u{1F419}',
  record_note:      '\u{1F4DD}',
  recall_notes:     '\u{1F50D}',
  ask_user:         '\u2753'
};

export class ToolsPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-tools',
      label: 'Tools',
      icon: '\u{1F527}',
      defaultVisible: false
    });
    this._roomTools = [];
    this._executions = [];
    this._tab = 'available';
  }

  mount() {
    super.mount();
    const store = OverlordUI.getStore();
    if (!store) return;

    // Track tool executions from activity
    this.subscribe(store, 'activity.items', (items) => {
      this._executions = (items || [])
        .filter(i => (i.event || i.type || '') === 'tool:executed')
        .slice(0, 50);
      if (this._tab === 'history') this._renderContent();
    });

    // Listen for room selection to update available tools
    this._listeners.push(
      OverlordUI.subscribe('building:room-selected', (data) => {
        this._roomTools = data.tools || [];
        this._renderContent();
      })
    );

    this._renderContent();
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    // Tabs
    const tabContainer = h('div', null);
    const tabs = new Tabs(tabContainer, {
      items: [
        { id: 'available', label: 'Available', badge: String(this._roomTools.length) },
        { id: 'history', label: 'History', badge: String(this._executions.length) }
      ],
      activeId: this._tab,
      style: 'pills',
      onChange: (id) => {
        this._tab = id;
        this._renderContent();
      }
    });
    tabs.mount();
    body.appendChild(tabContainer);

    if (this._tab === 'available') {
      this._renderAvailable(body);
    } else {
      this._renderHistory(body);
    }
  }

  _renderAvailable(body) {
    if (this._roomTools.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'Select a room to see available tools.'));
      return;
    }

    const list = h('div', { class: 'tools-list' });

    for (const toolName of this._roomTools) {
      const icon = TOOL_ICONS[toolName] || '\u{1F527}';
      const item = DrillItem.create('tool', { name: toolName }, {
        icon: () => icon,
        summary: (d) => d.name,
        badge: () => null,
        meta: () => '',
        detail: [
          { label: 'Tool', key: 'name' }
        ]
      });
      list.appendChild(item);
    }

    body.appendChild(list);
  }

  _renderHistory(body) {
    if (this._executions.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No tool executions recorded yet.'));
      return;
    }

    const list = h('div', { class: 'tools-history-list' });

    for (const exec of this._executions) {
      const toolName = exec.toolName || exec.tool || 'unknown';
      const icon = TOOL_ICONS[toolName] || '\u{1F527}';
      const status = exec.status || (exec.result?.ok ? 'ok' : exec.result?.ok === false ? 'error' : '');

      const item = DrillItem.create('tool-exec', exec, {
        icon: () => icon,
        summary: () => toolName,
        badge: () => {
          if (status === 'error' || status === 'failed') return { text: 'ERR', color: 'var(--status-error)' };
          if (status === 'ok' || status === 'success') return { text: 'OK', color: 'var(--status-success)' };
          if (exec.tier) return { text: `T${exec.tier}`, color: 'var(--text-muted)' };
          return null;
        },
        meta: (d) => d.timestamp ? formatTime(d.timestamp) : '',
        detail: [
          { label: 'Tool', key: 'toolName' },
          { label: 'Agent', key: 'agentId' },
          { label: 'Room', key: 'roomId' },
          { label: 'Duration', key: 'duration', format: 'duration' },
          { label: 'Tier', key: 'tier' }
        ]
      });

      list.appendChild(item);
    }

    body.appendChild(list);
  }
}
