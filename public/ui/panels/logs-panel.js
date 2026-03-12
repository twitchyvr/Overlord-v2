/**
 * Overlord v2 — Logs Panel
 *
 * Shows system log messages from the server and client.
 * Filterable by level (info, warn, error).
 */

import { PanelComponent } from '../components/panel.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Tabs } from '../components/tabs.js';


const MAX_LOGS = 200;

const LEVEL_ICONS = {
  info:  '\u2139',
  warn:  '\u26A0',
  error: '\u274C',
  debug: '\u{1F41B}'
};

const LEVEL_COLORS = {
  info:  'var(--text-muted)',
  warn:  'var(--status-warning, #f59e0b)',
  error: 'var(--status-error, #ef4444)',
  debug: 'var(--text-muted)'
};

export class LogsPanel extends PanelComponent {

  constructor(el) {
    super(el, {
      id: 'panel-logs',
      label: 'Logs',
      icon: '\u{1F4DC}',
      defaultVisible: false
    });
    this._logs = [];
    this._filter = 'all';
    this._autoScroll = true;
    this._renderPending = false;
  }

  mount() {
    super.mount();

    // Listen for log events from the engine bus
    this._listeners.push(
      OverlordUI.subscribe('system:log', (data) => {
        this._addLog(data);
      })
    );

    // Also capture connection events as logs
    this._listeners.push(
      OverlordUI.subscribe('connection:lost', () => {
        this._addLog({ level: 'warn', message: 'Connection lost to server', source: 'system' });
      })
    );

    const store = OverlordUI.getStore();
    if (store) {
      store.subscribe('ui.connected', (connected) => {
        if (connected) {
          this._addLog({ level: 'info', message: 'Connected to server', source: 'system' });
        }
      });
    }

    // Capture console output as logs
    this._interceptConsole();

    this._renderContent();
  }

  _interceptConsole() {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    // Only intercept Overlord-prefixed messages
    const self = this;

    console.log = function(...args) {
      origLog.apply(console, args);
      const msg = args.join(' ');
      if (msg.startsWith('[Overlord') || msg.startsWith('[OverlordUI')) {
        self._addLog({ level: 'info', message: msg, source: 'client' });
      }
    };

    console.warn = function(...args) {
      origWarn.apply(console, args);
      const msg = args.join(' ');
      if (msg.startsWith('[Overlord') || msg.startsWith('[OverlordUI')) {
        self._addLog({ level: 'warn', message: msg, source: 'client' });
      }
    };

    console.error = function(...args) {
      origError.apply(console, args);
      const msg = args.join(' ');
      if (msg.startsWith('[Overlord') || msg.startsWith('[OverlordUI')) {
        self._addLog({ level: 'error', message: msg, source: 'client' });
      }
    };

    // Restore on destroy
    this._listeners.push(() => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    });
  }

  _addLog(data) {
    this._logs.push({
      level: data.level || 'info',
      message: data.message || String(data),
      source: data.source || 'server',
      module: data.module || '',
      timestamp: data.timestamp || Date.now()
    });

    if (this._logs.length > MAX_LOGS) {
      this._logs = this._logs.slice(-MAX_LOGS);
    }

    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      this._renderPending = false;
      this._renderContent();
    });
  }

  _renderContent() {
    const body = this.$('.panel-body');
    if (!body) return;
    body.textContent = '';

    // Filter tabs
    const tabContainer = h('div', null);
    const tabs = new Tabs(tabContainer, {
      items: [
        { id: 'all', label: 'All', badge: String(this._logs.length) },
        { id: 'warn', label: 'Warn', badge: String(this._countByLevel('warn')) },
        { id: 'error', label: 'Error', badge: String(this._countByLevel('error')) }
      ],
      activeId: this._filter,
      style: 'pills',
      onChange: (id) => {
        this._filter = id;
        this._renderContent();
      }
    });
    tabs.mount();
    body.appendChild(tabContainer);

    // Filtered logs
    const filtered = this._getFiltered();

    if (filtered.length === 0) {
      body.appendChild(h('div', { class: 'panel-empty' }, 'No log entries.'));
      return;
    }

    const list = h('div', { class: 'logs-list' });

    for (const log of filtered) {
      const icon = LEVEL_ICONS[log.level] || '\u2022';
      const color = LEVEL_COLORS[log.level] || 'var(--text-muted)';

      const entry = h('div', { class: `log-entry log-${log.level}` },
        h('span', { class: 'log-icon', style: { color } }, icon),
        h('span', { class: 'log-time' }, formatTime(log.timestamp)),
        h('span', { class: 'log-message' }, log.message)
      );

      list.appendChild(entry);
    }

    body.appendChild(list);

    // Auto-scroll to bottom
    if (this._autoScroll) {
      requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
    }
  }

  _getFiltered() {
    if (this._filter === 'all') return this._logs;
    return this._logs.filter(l => l.level === this._filter);
  }

  _countByLevel(level) {
    return this._logs.filter(l => l.level === level).length;
  }
}
