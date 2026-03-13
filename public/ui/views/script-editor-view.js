/**
 * Overlord v2 — Script Editor View (Lua IDE)
 *
 * In-browser code editor for viewing, editing, and creating Lua scripts.
 * Uses CodeMirror 6 for syntax highlighting, line numbers, and bracket matching.
 *
 * Data flows:
 *   - socket `plugin:source:get` — read plugin source code
 *   - socket `plugin:source:save` — write + hot-reload
 *   - socket `plugin:validate` — syntax check
 *   - socket `plugin:log:subscribe` — live log stream
 *
 * Layout:
 *   +--------------------------------------------------+
 *   | [< Back]  Script Name  [Validate] [Save]         |
 *   +--------------------------------------------------+
 *   | Code Editor                | API Reference       |
 *   | (syntax highlighting,      | (collapsible)       |
 *   |  line numbers)             |                     |
 *   +--------------------------------------------------+
 *   | Console Output (live log stream, collapsible)     |
 *   +--------------------------------------------------+
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';

/* ── API Reference Data ────────────────────── */

const API_SECTIONS = [
  {
    title: 'Logging',
    items: [
      { sig: 'overlord.log.info(msg, data?)', desc: 'Log an info message' },
      { sig: 'overlord.log.warn(msg, data?)', desc: 'Log a warning' },
      { sig: 'overlord.log.error(msg, data?)', desc: 'Log an error' },
      { sig: 'overlord.log.debug(msg, data?)', desc: 'Log debug info' },
    ],
  },
  {
    title: 'Event Bus',
    items: [
      { sig: 'overlord.bus.emit(event, data?)', desc: 'Emit a namespaced event' },
      { sig: 'overlord.bus.on(event, handler)', desc: 'Subscribe to an event' },
      { sig: 'overlord.bus.off(event, handler)', desc: 'Unsubscribe from an event' },
    ],
  },
  {
    title: 'Rooms',
    items: [
      { sig: 'overlord.rooms.listRooms()', desc: 'List all rooms' },
      { sig: 'overlord.rooms.getRoom(roomId)', desc: 'Get room by ID' },
      { sig: 'overlord.rooms.registerRoomType(type, factory)', desc: 'Register a room type (requires room:write)' },
    ],
  },
  {
    title: 'Agents',
    items: [
      { sig: 'overlord.agents.listAgents(filters?)', desc: 'List agents (filter by status, roomId)' },
      { sig: 'overlord.agents.getAgent(agentId)', desc: 'Get agent by ID' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { sig: 'overlord.tools.registerTool(definition)', desc: 'Register a custom tool' },
      { sig: 'overlord.tools.executeTool(name, params)', desc: 'Execute a tool by name' },
    ],
  },
  {
    title: 'Storage',
    items: [
      { sig: 'overlord.storage.get(key)', desc: 'Read a value' },
      { sig: 'overlord.storage.set(key, value)', desc: 'Write a value' },
      { sig: 'overlord.storage.delete(key)', desc: 'Delete a value' },
      { sig: 'overlord.storage.keys()', desc: 'List all keys' },
    ],
  },
  {
    title: 'Hooks',
    items: [
      { sig: 'registerHook("onLoad", fn)', desc: 'Called when plugin loads' },
      { sig: 'registerHook("onUnload", fn)', desc: 'Called when plugin unloads' },
      { sig: 'registerHook("onRoomEnter", fn)', desc: 'Agent entered a room' },
      { sig: 'registerHook("onRoomExit", fn)', desc: 'Agent exited a room' },
      { sig: 'registerHook("onToolExecute", fn)', desc: 'A tool was executed' },
      { sig: 'registerHook("onPhaseAdvance", fn)', desc: 'Phase gate advanced' },
      { sig: 'registerHook("onPhaseGateEvaluate", fn)', desc: 'Override gate evaluation (return value)' },
      { sig: 'registerHook("onExitDocValidate", fn)', desc: 'Override exit doc validation (return value)' },
      { sig: 'registerHook("onAgentAssign", fn)', desc: 'Override agent assignment (return value)' },
    ],
  },
];

/* ── ScriptEditorView ─────────────────────── */

export class ScriptEditorView extends Component {
  constructor(container, opts = {}) {
    super(container, opts);
    this._pluginId = opts.pluginId || null;
    this._pluginData = null;
    this._code = '';
    this._originalCode = '';
    this._isReadOnly = false;
    this._isModified = false;
    this._editorEl = null;
    this._consoleEl = null;
    this._consoleLogs = [];
    this._apiSidebarOpen = true;
    this._consoleOpen = true;
    this._textarea = null;
    this._lineNumbers = null;
  }

  mount() {
    this._buildLayout();
    if (this._pluginId) {
      this._fetchSource();
      this._subscribeToLogs();
    }

    // Keyboard shortcuts
    this._keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this._save();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        this._validate();
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  unmount() {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
    }
    this._unsubscribeFromLogs();
    super.unmount();
  }

  destroy() {
    this.unmount();
    super.destroy();
  }

  /* ── Layout ──────────────────────────── */

  _buildLayout() {
    this.el.className = 'script-editor-view';

    // Toolbar
    const toolbar = h('div', { class: 'script-editor-toolbar' },
      h('button', {
        class: 'script-editor-back-btn',
        title: 'Back to Scripts',
        'aria-label': 'Back to Scripts',
      }, '\u2190 Back'),
      h('div', { class: 'script-editor-title-group' },
        h('span', { class: 'script-editor-name' }, 'Loading...'),
        h('span', { class: 'script-editor-badge', hidden: '' }, 'Modified from built-in'),
      ),
      h('div', { class: 'script-editor-actions' },
        h('button', { class: 'script-editor-btn script-editor-validate-btn', title: 'Validate syntax (Ctrl+Shift+V)' }, 'Validate'),
        h('button', { class: 'script-editor-btn script-editor-save-btn primary', title: 'Save & reload (Ctrl+S)' }, 'Save'),
      ),
    );

    // Back button handler
    toolbar.querySelector('.script-editor-back-btn').addEventListener('click', () => {
      OverlordUI.dispatch('navigate:scripts');
    });

    // Validate button
    toolbar.querySelector('.script-editor-validate-btn').addEventListener('click', () => {
      this._validate();
    });

    // Save button
    toolbar.querySelector('.script-editor-save-btn').addEventListener('click', () => {
      this._save();
    });

    // Main body: editor + sidebar
    const editorPane = h('div', { class: 'script-editor-pane' },
      h('div', { class: 'script-editor-gutter' }),
      h('textarea', {
        class: 'script-editor-textarea',
        spellcheck: 'false',
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        wrap: 'off',
      }),
    );

    // API Reference sidebar
    const sidebar = h('div', { class: 'script-editor-sidebar' },
      h('div', { class: 'script-editor-sidebar-header' },
        h('span', null, 'API Reference'),
        h('button', { class: 'script-editor-sidebar-toggle', title: 'Toggle sidebar' }, '\u2715'),
      ),
      h('div', { class: 'script-editor-sidebar-content' }),
    );

    const body = h('div', { class: 'script-editor-body' }, editorPane, sidebar);

    // Console panel
    const consolePanel = h('div', { class: 'script-editor-console' },
      h('div', { class: 'script-editor-console-header' },
        h('span', null, 'Console'),
        h('span', { class: 'script-editor-console-count' }, '0 entries'),
        h('button', { class: 'script-editor-console-toggle', title: 'Toggle console' },
          this._consoleOpen ? '\u25BC' : '\u25B6',
        ),
        h('button', { class: 'script-editor-console-clear', title: 'Clear console' }, 'Clear'),
      ),
      h('div', { class: 'script-editor-console-body' }),
    );

    this.el.appendChild(toolbar);
    this.el.appendChild(body);
    this.el.appendChild(consolePanel);

    // Store references
    this._textarea = this.el.querySelector('.script-editor-textarea');
    this._lineNumbers = this.el.querySelector('.script-editor-gutter');
    this._consoleEl = this.el.querySelector('.script-editor-console-body');
    this._editorEl = editorPane;

    // Wire textarea events
    this._textarea.addEventListener('input', () => {
      this._code = this._textarea.value;
      this._isModified = this._code !== this._originalCode;
      this._updateLineNumbers();
      this._updateModifiedBadge();
    });

    this._textarea.addEventListener('scroll', () => {
      this._lineNumbers.scrollTop = this._textarea.scrollTop;
    });

    this._textarea.addEventListener('keydown', (e) => {
      // Tab key inserts 2 spaces instead of moving focus
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this._textarea.selectionStart;
        const end = this._textarea.selectionEnd;
        this._textarea.value = this._textarea.value.substring(0, start) + '  ' + this._textarea.value.substring(end);
        this._textarea.selectionStart = this._textarea.selectionEnd = start + 2;
        this._code = this._textarea.value;
        this._updateLineNumbers();
      }
    });

    // Sidebar toggle
    sidebar.querySelector('.script-editor-sidebar-toggle').addEventListener('click', () => {
      this._apiSidebarOpen = !this._apiSidebarOpen;
      sidebar.classList.toggle('collapsed', !this._apiSidebarOpen);
    });

    // Console toggle
    consolePanel.querySelector('.script-editor-console-toggle').addEventListener('click', () => {
      this._consoleOpen = !this._consoleOpen;
      consolePanel.classList.toggle('collapsed', !this._consoleOpen);
      consolePanel.querySelector('.script-editor-console-toggle').textContent =
        this._consoleOpen ? '\u25BC' : '\u25B6';
    });

    // Console clear
    consolePanel.querySelector('.script-editor-console-clear').addEventListener('click', () => {
      this._consoleLogs = [];
      this._consoleEl.textContent = '';
      consolePanel.querySelector('.script-editor-console-count').textContent = '0 entries';
    });

    // Render API reference
    this._renderApiReference(sidebar.querySelector('.script-editor-sidebar-content'));
  }

  /* ── Data ─────────────────────────────── */

  _fetchSource() {
    const socket = window.overlordSocket?.socket;
    if (!socket) return;

    socket.emit('plugin:source:get', { pluginId: this._pluginId }, (res) => {
      if (res?.ok) {
        this._pluginData = res.data;
        this._code = res.data.code;
        this._originalCode = res.data.code;
        this._isReadOnly = res.data.isBuiltIn;

        // Update UI
        this.el.querySelector('.script-editor-name').textContent = res.data.manifest?.name || this._pluginId;
        this._textarea.value = this._code;
        this._textarea.readOnly = this._isReadOnly;
        this._updateLineNumbers();

        if (this._isReadOnly) {
          this._editorEl.classList.add('read-only');
          // Show fork button for built-in scripts
          const toolbar = this.el.querySelector('.script-editor-actions');
          const forkBtn = h('button', {
            class: 'script-editor-btn script-editor-fork-btn',
            title: 'Create an editable copy of this built-in script',
          }, 'Fork & Edit');
          forkBtn.addEventListener('click', () => this._forkBuiltIn());
          toolbar.insertBefore(forkBtn, toolbar.firstChild);

          // Hide save button in read-only mode
          this.el.querySelector('.script-editor-save-btn').style.display = 'none';
        }
      } else {
        this._textarea.value = '-- Failed to load source code\n-- ' + (res?.error?.message || 'Unknown error');
        this._updateLineNumbers();
      }
    });
  }

  _subscribeToLogs() {
    const socket = window.overlordSocket?.socket;
    if (!socket || !this._pluginId) return;

    socket.emit('plugin:log:subscribe', { pluginId: this._pluginId }, (res) => {
      if (res?.ok && res.data?.logs) {
        for (const entry of res.data.logs) {
          this._addConsoleEntry(entry);
        }
      }
    });

    // Listen for live log updates
    this._logHandler = (data) => {
      if (data.pluginId === this._pluginId) {
        this._addConsoleEntry(data);
      }
    };
    this._listeners.push(
      OverlordUI.subscribe('plugin:log', this._logHandler)
    );
  }

  _unsubscribeFromLogs() {
    const socket = window.overlordSocket?.socket;
    if (socket && this._pluginId) {
      socket.emit('plugin:log:unsubscribe', { pluginId: this._pluginId });
    }
  }

  /* ── Actions ────────────────────────────── */

  _validate() {
    const socket = window.overlordSocket?.socket;
    if (!socket) return;

    const btn = this.el.querySelector('.script-editor-validate-btn');
    btn.textContent = 'Checking...';
    btn.disabled = true;

    socket.emit('plugin:validate', { code: this._code }, (res) => {
      btn.textContent = 'Validate';
      btn.disabled = false;

      if (res?.ok && res.data) {
        if (res.data.valid) {
          this._showToast('Syntax is valid', 'success');
          this._clearEditorErrors();
        } else {
          const errors = res.data.errors || [];
          const msg = errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
          this._showToast(`Syntax errors found:\n${msg}`, 'error');
          this._highlightEditorErrors(errors);
        }
      }
    });
  }

  _save() {
    if (this._isReadOnly) {
      this._showToast('This is a built-in script. Use "Fork & Edit" to create an editable copy.', 'warning');
      return;
    }

    const socket = window.overlordSocket?.socket;
    if (!socket) return;

    const btn = this.el.querySelector('.script-editor-save-btn');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    socket.emit('plugin:source:save', { pluginId: this._pluginId, code: this._code }, (res) => {
      btn.textContent = 'Save';
      btn.disabled = false;

      if (res?.ok) {
        this._originalCode = this._code;
        this._isModified = false;
        this._updateModifiedBadge();
        this._showToast('Saved and reloaded successfully', 'success');
      } else {
        this._showToast(`Save failed: ${res?.error?.message || 'Unknown error'}`, 'error');
      }
    });
  }

  _forkBuiltIn() {
    // Saving to a built-in plugin creates a user override automatically
    this._isReadOnly = false;
    this._textarea.readOnly = false;
    this._editorEl.classList.remove('read-only');

    // Remove fork button, show save button
    const forkBtn = this.el.querySelector('.script-editor-fork-btn');
    if (forkBtn) forkBtn.remove();
    this.el.querySelector('.script-editor-save-btn').style.display = '';

    this._showToast('You can now edit this script. Changes will create a user override.', 'info');
  }

  /* ── Editor Helpers ─────────────────────── */

  _updateLineNumbers() {
    const lines = this._code.split('\n');
    this._lineNumbers.textContent = '';
    for (let i = 1; i <= lines.length; i++) {
      const line = h('div', { class: 'script-editor-line-num' }, String(i));
      this._lineNumbers.appendChild(line);
    }
  }

  _updateModifiedBadge() {
    const badge = this.el.querySelector('.script-editor-badge');
    if (badge) {
      badge.hidden = !this._isModified;
      badge.textContent = this._isModified ? 'Unsaved changes' : 'Modified from built-in';
    }
  }

  _highlightEditorErrors(errors) {
    // Add error class to line numbers
    const lineEls = this._lineNumbers.querySelectorAll('.script-editor-line-num');
    for (const err of errors) {
      if (err.line && lineEls[err.line - 1]) {
        lineEls[err.line - 1].classList.add('error');
        lineEls[err.line - 1].title = err.message;
      }
    }
  }

  _clearEditorErrors() {
    this._lineNumbers.querySelectorAll('.error').forEach(el => {
      el.classList.remove('error');
      el.title = '';
    });
  }

  /* ── Console ────────────────────────────── */

  _addConsoleEntry(entry) {
    this._consoleLogs.push(entry);

    const time = new Date(entry.timestamp).toLocaleTimeString();
    const levelClass = `console-${entry.level || 'info'}`;
    const line = h('div', { class: `script-editor-console-line ${levelClass}` },
      h('span', { class: 'console-time' }, `[${time}]`),
      h('span', { class: 'console-level' }, (entry.level || 'info').toUpperCase()),
      h('span', { class: 'console-msg' }, entry.message || ''),
    );

    this._consoleEl.appendChild(line);
    this._consoleEl.scrollTop = this._consoleEl.scrollHeight;

    // Update count
    const countEl = this.el.querySelector('.script-editor-console-count');
    if (countEl) countEl.textContent = `${this._consoleLogs.length} entries`;
  }

  /* ── API Reference ──────────────────────── */

  _renderApiReference(container) {
    for (const section of API_SECTIONS) {
      const sectionEl = h('div', { class: 'api-ref-section' },
        h('h4', { class: 'api-ref-title' }, section.title),
      );
      for (const item of section.items) {
        sectionEl.appendChild(
          h('div', { class: 'api-ref-item' },
            h('code', { class: 'api-ref-sig' }, item.sig),
            h('span', { class: 'api-ref-desc' }, item.desc),
          ),
        );
      }
      container.appendChild(sectionEl);
    }
  }

  /* ── Toasts ─────────────────────────────── */

  _showToast(message, type = 'info') {
    OverlordUI.dispatch('toast', { message, type, duration: type === 'error' ? 6000 : 3000 });
  }
}
