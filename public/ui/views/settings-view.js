/**
 * Overlord v2 — Settings View
 *
 * Modal-based settings interface with tabbed sections:
 *   General   — Theme toggle, log level
 *   AI        — Read-only provider display, model info
 *   Display   — Layout and UI preferences
 *
 * Opens as a modal when triggered from toolbar gear icon.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h } from '../engine/helpers.js';
import { Modal } from '../components/modal.js';
import { Toast } from '../components/toast.js';


const TABS = [
  { id: 'general',  label: 'General',  icon: '\u2699\uFE0F' },
  { id: 'folders',  label: 'Folders',  icon: '\u{1F4C2}' },
  { id: 'quality',  label: 'Quality',  icon: '\u2705' },
  { id: 'ai',       label: 'AI',       icon: '\u{1F916}' },
  { id: 'display',  label: 'Display',  icon: '\u{1F5A5}\uFE0F' },
];

/** Known AI providers with display metadata. */
const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', icon: '\u{1F7E3}', envKey: 'ANTHROPIC_API_KEY' },
  minimax:   { name: 'MiniMax',            icon: '\u{1F7E2}', envKey: 'MINIMAX_API_KEY' },
  openai:    { name: 'OpenAI',             icon: '\u{1F7E1}', envKey: 'OPENAI_API_KEY' },
  ollama:    { name: 'Ollama (Local)',      icon: '\u{1F535}', envKey: 'OLLAMA_BASE_URL' },
};

/** All room types with default provider assignments. */
const ROOM_PROVIDERS = {
  strategist:    'anthropic',
  discovery:     'anthropic',
  architecture:  'anthropic',
  'code-lab':    'minimax',
  'testing-lab': 'minimax',
  review:        'anthropic',
  deploy:        'anthropic',
  'war-room':    'anthropic',
};


export class SettingsView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._activeTab = 'general';
    this._serverConfig = null;
  }

  mount() {
    this._mounted = true;

    // Listen for settings open events
    this._listeners.push(
      OverlordUI.subscribe('settings:open', () => {
        this._openSettings();
      })
    );
  }

  _openSettings() {
    this._activeTab = 'general';
    this._fetchServerConfig();
    this._showModal();
  }

  async _fetchServerConfig() {
    if (!window.overlordSocket) return;
    try {
      const result = await window.overlordSocket.getServerConfig();
      if (result && result.ok) {
        this._serverConfig = result.data;
        // Re-render AI tab if it's active
        if (this._activeTab === 'ai') {
          this._updateModalContent();
        }
      }
    } catch {
      // Server config not available — show defaults
    }
  }

  _showModal() {
    const content = this._buildContent();
    Modal.open('settings', {
      title: '\u2699\uFE0F Settings',
      content,
      size: 'lg',
      position: window.innerWidth < 768 ? 'fullscreen' : 'center',
    });
  }

  _updateModalContent() {
    const body = Modal.getBody('settings');
    if (!body) return;
    body.textContent = '';
    body.appendChild(this._buildContent());
  }

  _buildContent() {
    const container = h('div', { class: 'settings-view' });

    // Tab bar
    const tabBar = h('div', { class: 'settings-tab-bar' });
    for (const tab of TABS) {
      const isActive = tab.id === this._activeTab;
      const tabBtn = h('button', {
        class: `settings-tab${isActive ? ' settings-tab-active' : ''}`,
        'data-tab': tab.id
      },
        h('span', { class: 'settings-tab-icon' }, tab.icon),
        h('span', { class: 'settings-tab-label' }, tab.label)
      );
      tabBtn.addEventListener('click', () => {
        this._activeTab = tab.id;
        this._updateModalContent();
      });
      tabBar.appendChild(tabBtn);
    }
    container.appendChild(tabBar);

    // Tab content
    const tabContent = h('div', { class: 'settings-tab-content' });
    switch (this._activeTab) {
      case 'general':
        tabContent.appendChild(this._buildGeneralTab());
        break;
      case 'folders':
        tabContent.appendChild(this._buildFoldersTab());
        break;
      case 'quality':
        tabContent.appendChild(this._buildQualityTab());
        break;
      case 'ai':
        tabContent.appendChild(this._buildAITab());
        break;
      case 'display':
        tabContent.appendChild(this._buildDisplayTab());
        break;
    }
    container.appendChild(tabContent);

    return container;
  }

  // ── General Tab ─────────────────────────────────────────

  _buildGeneralTab() {
    const section = h('div', { class: 'settings-section' });

    // Theme
    section.appendChild(this._buildSettingRow({
      label: 'Theme',
      description: 'Switch between dark and light mode',
      control: () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const toggle = h('div', { class: 'settings-toggle-group' });

        const darkBtn = h('button', {
          class: `settings-toggle-btn${current === 'dark' ? ' active' : ''}`,
        }, '\u{1F319} Dark');
        const lightBtn = h('button', {
          class: `settings-toggle-btn${current === 'light' ? ' active' : ''}`,
        }, '\u2600\uFE0F Light');

        darkBtn.addEventListener('click', () => {
          this._applyTheme('dark');
          darkBtn.classList.add('active');
          lightBtn.classList.remove('active');
        });
        lightBtn.addEventListener('click', () => {
          this._applyTheme('light');
          lightBtn.classList.add('active');
          darkBtn.classList.remove('active');
        });

        toggle.appendChild(darkBtn);
        toggle.appendChild(lightBtn);
        return toggle;
      }
    }));

    // Log level
    section.appendChild(this._buildSettingRow({
      label: 'Log Level',
      description: 'Controls verbosity of system logs',
      control: () => {
        const store = OverlordUI.getStore();
        const current = store?.get('ui.logLevel') || 'info';

        const select = h('select', { class: 'form-input settings-select' });
        for (const level of ['error', 'warn', 'info', 'debug']) {
          const opt = h('option', { value: level }, level.charAt(0).toUpperCase() + level.slice(1));
          if (level === current) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => {
          const store = OverlordUI.getStore();
          if (store) store.set('ui.logLevel', select.value);
          Toast.success(`Log level set to ${select.value}`);
        });
        return select;
      }
    }));

    // Connection status (read-only)
    section.appendChild(this._buildSettingRow({
      label: 'Connection',
      description: 'WebSocket connection to Overlord server',
      control: () => {
        const store = OverlordUI.getStore();
        const state = store?.get('ui.connectionState') || 'disconnected';
        const dotColor = state === 'connected' ? 'var(--accent-green)' :
                        state === 'reconnecting' ? 'var(--accent-yellow)' :
                        'var(--accent-red)';

        return h('div', { class: 'settings-connection-status' },
          h('span', { class: 'settings-connection-dot', style: { background: dotColor } }),
          h('span', null, state.charAt(0).toUpperCase() + state.slice(1))
        );
      }
    }));

    // Server info
    section.appendChild(this._buildSettingRow({
      label: 'Server',
      description: 'Backend server information',
      control: () => {
        const server = this._serverConfig?.server || {};
        const env = server.environment || 'development';
        const version = server.version || '0.1.0';
        const uptime = server.uptime ? `${Math.round(server.uptime / 60)}m` : '—';
        return h('div', { class: 'settings-server-info' },
          h('span', { class: 'settings-info-badge' }, env),
          h('span', { class: 'settings-info-detail' }, `v${version}`),
          h('span', { class: 'settings-info-detail' }, `Up ${uptime}`)
        );
      }
    }));

    return section;
  }

  // ── Folders Tab ─────────────────────────────────────────

  _buildFoldersTab() {
    const section = h('div', { class: 'settings-section' });
    const store = OverlordUI.getStore();
    const buildingId = store?.get('activeBuildingId');

    if (!buildingId) {
      section.appendChild(h('div', { class: 'settings-empty-state' },
        h('p', null, 'No active building selected. Create or select a building first.'),
      ));
      return section;
    }

    // Working directory display with git status
    section.appendChild(h('h4', { class: 'settings-section-title' }, 'Working Directory'));
    const workingDir = store?.get('building.workingDirectory') || '(not set)';
    const wdRow = h('div', { class: 'settings-folder-row settings-folder-primary' });
    const wdInfo = h('div', { class: 'settings-folder-info' },
      h('span', { class: 'settings-folder-path mono' }, workingDir),
      h('span', { class: 'settings-folder-badge', id: 'settings-git-status' }, 'Checking...')
    );
    wdRow.appendChild(wdInfo);
    section.appendChild(wdRow);

    // Detect git status for working directory
    if (workingDir !== '(not set)' && window.overlordSocket) {
      this._detectGitStatus(workingDir);
    }

    // Allowed paths section
    section.appendChild(h('h4', { class: 'settings-section-title', style: { marginTop: 'var(--sp-6)' } },
      'Allowed Folders'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'Additional folders agents can access beyond the working directory. Subfolders inherit access.'));

    const pathList = h('div', { class: 'settings-folder-list', id: 'settings-folder-list' });
    section.appendChild(pathList);

    // Load and render existing paths
    this._loadAllowedPaths(buildingId, pathList);

    // Add folder button
    const addRow = h('div', { class: 'settings-folder-add-row' });
    const addInput = h('input', {
      type: 'text',
      class: 'form-input settings-folder-input',
      placeholder: '/path/to/folder',
      id: 'settings-add-folder-input',
    });
    const addBtn = h('button', { class: 'btn btn-sm btn-primary' }, '+ Add Folder');
    addBtn.addEventListener('click', () => {
      const input = document.getElementById('settings-add-folder-input');
      const path = input?.value?.trim();
      if (!path) {
        Toast.warn('Enter a folder path');
        return;
      }
      this._addAllowedPath(buildingId, path, pathList);
      if (input) input.value = '';
    });
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn.click();
    });
    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    section.appendChild(addRow);

    return section;
  }

  async _detectGitStatus(dirPath) {
    if (!window.overlordSocket?.socket) return;
    try {
      const result = await new Promise((resolve) => {
        window.overlordSocket.socket.emit('git:detect', { path: dirPath }, resolve);
      });
      const badge = document.getElementById('settings-git-status');
      if (!badge) return;

      if (result?.ok && result.data?.isRepo) {
        const info = result.data;
        badge.textContent = `git: ${info.branch || 'unknown'}`;
        badge.classList.add('git-active');
        if (info.hasUncommitted) {
          badge.textContent += ' (modified)';
          badge.classList.add('git-modified');
        }
      } else {
        badge.textContent = 'Not a git repo';
        badge.classList.add('git-none');
      }
    } catch {
      const badge = document.getElementById('settings-git-status');
      if (badge) {
        badge.textContent = 'Git check failed';
        badge.classList.add('git-none');
      }
    }
  }

  async _loadAllowedPaths(buildingId, listEl) {
    if (!window.overlordSocket?.socket) return;
    try {
      const result = await new Promise((resolve) => {
        window.overlordSocket.socket.emit('folder:list-paths', { buildingId }, resolve);
      });

      listEl.textContent = '';

      if (!result?.ok || !result.data?.allowedPaths?.length) {
        listEl.appendChild(h('div', { class: 'settings-empty-hint' },
          'No additional folders configured. The working directory is always accessible.'
        ));
        return;
      }

      for (const folderPath of result.data.allowedPaths) {
        listEl.appendChild(this._buildFolderRow(buildingId, folderPath, listEl));
      }
    } catch {
      listEl.textContent = '';
      listEl.appendChild(h('div', { class: 'settings-empty-hint' }, 'Failed to load folder list'));
    }
  }

  _buildFolderRow(buildingId, folderPath, listEl) {
    const row = h('div', { class: 'settings-folder-row' });
    row.appendChild(h('span', { class: 'settings-folder-path mono' }, folderPath));

    const removeBtn = h('button', {
      class: 'btn btn-sm btn-ghost settings-folder-remove',
      title: 'Remove folder access',
    }, '\u2715');
    removeBtn.addEventListener('click', () => {
      this._removeAllowedPath(buildingId, folderPath, listEl);
    });
    row.appendChild(removeBtn);
    return row;
  }

  async _addAllowedPath(buildingId, path, listEl) {
    if (!window.overlordSocket?.socket) return;
    try {
      const result = await new Promise((resolve) => {
        window.overlordSocket.socket.emit('folder:add-path', { buildingId, path }, resolve);
      });
      if (result?.ok) {
        Toast.success(`Added folder: ${path}`);
        this._loadAllowedPaths(buildingId, listEl);
      } else {
        Toast.error(result?.error?.message || 'Failed to add folder');
      }
    } catch (err) {
      Toast.error('Failed to add folder');
    }
  }

  async _removeAllowedPath(buildingId, path, listEl) {
    if (!window.overlordSocket?.socket) return;
    try {
      const result = await new Promise((resolve) => {
        window.overlordSocket.socket.emit('folder:remove-path', { buildingId, path }, resolve);
      });
      if (result?.ok) {
        Toast.success(`Removed folder: ${path}`);
        this._loadAllowedPaths(buildingId, listEl);
      } else {
        Toast.error(result?.error?.message || 'Failed to remove folder');
      }
    } catch (err) {
      Toast.error('Failed to remove folder');
    }
  }

  // ── Quality Defaults Tab (#538) ─────────────────────────

  _buildQualityTab() {
    const section = h('div', { class: 'settings-section' });
    section.appendChild(h('h4', { class: 'settings-section-title' }, 'Quality Checks'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'Configure which automated quality checks run after each code change.'));

    // Fetch current quality config
    this._qualityConfig = this._qualityConfig || {
      autoLint: true,
      autoTypecheck: true,
      autoTest: true,
      autoSecurityScan: false,
      minCoverage: 80,
    };

    if (window.overlordSocket?.socket) {
      window.overlordSocket.socket.emit('quality:config:get', {}, (res) => {
        if (res?.ok && res.data) {
          this._qualityConfig = { ...this._qualityConfig, ...res.data };
          if (this._activeTab === 'quality') this._updateModalContent();
        }
      });
    }

    const toggles = [
      { key: 'autoLint',         label: 'Auto-Lint',          desc: 'Run linter after code changes' },
      { key: 'autoTypecheck',    label: 'Auto-Typecheck',     desc: 'Run type checker after code changes' },
      { key: 'autoTest',         label: 'Auto-Test',          desc: 'Run test suite after code changes' },
      { key: 'autoSecurityScan', label: 'Auto-Security Scan', desc: 'Run security scan after code changes' },
    ];

    for (const item of toggles) {
      section.appendChild(this._buildSettingRow({
        label: item.label,
        description: item.desc,
        control: () => {
          const current = this._qualityConfig[item.key] !== false;
          const toggle = h('button', {
            class: `settings-switch${current ? ' on' : ''}`,
            role: 'switch',
            'aria-checked': current ? 'true' : 'false'
          });
          toggle.appendChild(h('span', { class: 'settings-switch-knob' }));
          toggle.addEventListener('click', () => {
            const nowOn = !toggle.classList.contains('on');
            toggle.classList.toggle('on', nowOn);
            toggle.setAttribute('aria-checked', nowOn ? 'true' : 'false');
            this._qualityConfig[item.key] = nowOn;
            this._saveQualityConfig();
          });
          return toggle;
        }
      }));
    }

    // Min Coverage slider
    section.appendChild(this._buildSettingRow({
      label: 'Minimum Coverage',
      description: 'Required test coverage percentage',
      control: () => {
        const wrapper = h('div', { class: 'settings-slider-group' });
        const valueLabel = h('span', { class: 'settings-slider-value' },
          `${this._qualityConfig.minCoverage}%`);
        const slider = h('input', {
          type: 'range',
          class: 'settings-slider',
          min: '0',
          max: '100',
          step: '5',
          value: String(this._qualityConfig.minCoverage),
        });
        slider.addEventListener('input', () => {
          this._qualityConfig.minCoverage = Number(slider.value);
          valueLabel.textContent = `${slider.value}%`;
        });
        slider.addEventListener('change', () => {
          this._saveQualityConfig();
        });
        wrapper.appendChild(slider);
        wrapper.appendChild(valueLabel);
        return wrapper;
      }
    }));

    return section;
  }

  _saveQualityConfig() {
    if (!window.overlordSocket?.socket) return;
    window.overlordSocket.socket.emit('quality:config:set', this._qualityConfig, (res) => {
      if (res?.ok) {
        Toast.success('Quality settings saved');
      }
    });
  }

  // ── AI Providers Tab ────────────────────────────────────

  _buildAITab() {
    const section = h('div', { class: 'settings-section' });

    // Provider cards
    section.appendChild(h('h4', { class: 'settings-section-title' }, 'Configured Providers'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'AI providers are configured via environment variables on the server. These are read-only.'));

    const providerGrid = h('div', { class: 'settings-provider-grid' });

    for (const [key, provider] of Object.entries(PROVIDERS)) {
      const isConfigured = this._serverConfig?.providers?.[key]?.configured ?? false;
      const model = this._serverConfig?.providers?.[key]?.model || '—';

      const card = h('div', {
        class: `settings-provider-card${isConfigured ? ' configured' : ' unconfigured'}`
      },
        h('div', { class: 'settings-provider-header' },
          h('span', { class: 'settings-provider-icon' }, provider.icon),
          h('span', { class: 'settings-provider-name' }, provider.name),
          h('span', {
            class: `settings-provider-status ${isConfigured ? 'status-active' : 'status-inactive'}`
          }, isConfigured ? 'Active' : 'Not configured')
        ),
        h('div', { class: 'settings-provider-detail' },
          h('div', { class: 'settings-provider-row' },
            h('span', { class: 'settings-provider-label' }, 'Model'),
            h('span', { class: 'settings-provider-value' }, model)
          ),
          h('div', { class: 'settings-provider-row' },
            h('span', { class: 'settings-provider-label' }, 'Env Key'),
            h('span', { class: 'settings-provider-value mono' }, provider.envKey)
          )
        )
      );

      providerGrid.appendChild(card);
    }
    section.appendChild(providerGrid);

    // Room → Provider mapping
    section.appendChild(h('h4', { class: 'settings-section-title', style: { marginTop: 'var(--sp-6)' } },
      'Room \u2192 Provider Routing'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'Which AI provider handles each room type. Override with PROVIDER_ROOM_* env vars.'));

    // Table header
    const mappingTable = h('div', { class: 'settings-mapping-table' });
    mappingTable.appendChild(h('div', { class: 'settings-mapping-row settings-mapping-header' },
      h('span', { class: 'settings-mapping-room' }, 'Room Type'),
      h('span', { class: 'settings-mapping-provider' }, 'Provider'),
      h('span', { class: 'settings-mapping-model' }, 'Model'),
      h('span', { class: 'settings-mapping-source' }, 'Source')
    ));

    for (const [roomType, defaultProvider] of Object.entries(ROOM_PROVIDERS)) {
      const serverOverride = this._serverConfig?.roomProviderMap?.[roomType];
      const active = serverOverride || defaultProvider;
      const providerInfo = PROVIDERS[active] || { name: active, icon: '\u2753' };
      const isOverride = serverOverride && serverOverride !== defaultProvider;
      const model = this._serverConfig?.providers?.[active]?.model || '\u2014';

      mappingTable.appendChild(h('div', { class: 'settings-mapping-row' },
        h('span', { class: 'settings-mapping-room' },
          roomType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')),
        h('span', { class: 'settings-mapping-provider' },
          h('span', null, providerInfo.icon),
          h('span', null, ` ${providerInfo.name}`)),
        h('span', { class: 'settings-mapping-model mono' }, model),
        h('span', {
          class: `settings-mapping-source${isOverride ? ' override' : ''}`
        }, isOverride ? 'Override' : 'Default')
      ));
    }
    section.appendChild(mappingTable);

    return section;
  }

  // ── Display Tab ─────────────────────────────────────────

  _buildDisplayTab() {
    const section = h('div', { class: 'settings-section' });
    const store = OverlordUI.getStore();

    // Chat font size
    section.appendChild(this._buildSettingRow({
      label: 'Chat Font Size',
      description: 'Adjust the chat message text size',
      control: () => {
        const current = store?.get('ui.chatFontSize') || 'normal';
        const toggle = h('div', { class: 'settings-toggle-group' });

        for (const size of ['small', 'normal', 'large']) {
          const btn = h('button', {
            class: `settings-toggle-btn${current === size ? ' active' : ''}`
          }, size.charAt(0).toUpperCase() + size.slice(1));

          btn.addEventListener('click', () => {
            const store = OverlordUI.getStore();
            if (store) store.set('ui.chatFontSize', size);
            toggle.querySelectorAll('.settings-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Apply font size
            const chatEl = document.querySelector('.chat-messages');
            if (chatEl) {
              chatEl.classList.remove('font-small', 'font-normal', 'font-large');
              chatEl.classList.add(`font-${size}`);
            }
          });

          toggle.appendChild(btn);
        }
        return toggle;
      }
    }));

    // Show timestamps
    section.appendChild(this._buildSettingRow({
      label: 'Show Timestamps',
      description: 'Display timestamps on chat messages',
      control: () => {
        const current = store?.get('ui.showTimestamps') !== false;
        const toggle = h('button', {
          class: `settings-switch${current ? ' on' : ''}`,
          role: 'switch',
          'aria-checked': current ? 'true' : 'false'
        });
        toggle.appendChild(h('span', { class: 'settings-switch-knob' }));

        toggle.addEventListener('click', () => {
          const store = OverlordUI.getStore();
          const nowOn = !toggle.classList.contains('on');
          toggle.classList.toggle('on', nowOn);
          toggle.setAttribute('aria-checked', nowOn ? 'true' : 'false');
          if (store) store.set('ui.showTimestamps', nowOn);
        });
        return toggle;
      }
    }));

    // Show thinking blocks
    section.appendChild(this._buildSettingRow({
      label: 'Show AI Thinking',
      description: 'Display AI thinking/reasoning blocks in chat',
      control: () => {
        const current = store?.get('ui.showThinking') !== false;
        const toggle = h('button', {
          class: `settings-switch${current ? ' on' : ''}`,
          role: 'switch',
          'aria-checked': current ? 'true' : 'false'
        });
        toggle.appendChild(h('span', { class: 'settings-switch-knob' }));

        toggle.addEventListener('click', () => {
          const store = OverlordUI.getStore();
          const nowOn = !toggle.classList.contains('on');
          toggle.classList.toggle('on', nowOn);
          toggle.setAttribute('aria-checked', nowOn ? 'true' : 'false');
          if (store) store.set('ui.showThinking', nowOn);
        });
        return toggle;
      }
    }));

    return section;
  }

  // ── Helpers ─────────────────────────────────────────────

  _buildSettingRow({ label, description, control }) {
    const row = h('div', { class: 'settings-row' });
    const info = h('div', { class: 'settings-row-info' },
      h('span', { class: 'settings-row-label' }, label),
      description ? h('span', { class: 'settings-row-desc' }, description) : null
    );
    row.appendChild(info);

    const controlEl = control();
    if (controlEl) {
      const wrapper = h('div', { class: 'settings-row-control' });
      wrapper.appendChild(controlEl);
      row.appendChild(wrapper);
    }

    return row;
  }

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('overlord-theme', theme);

    const store = OverlordUI.getStore();
    if (store) store.set('ui.theme', theme);

    // Update theme toggle icon visibility
    const darkIcon = document.querySelector('.theme-icon-dark');
    const lightIcon = document.querySelector('.theme-icon-light');
    if (darkIcon) darkIcon.style.display = theme === 'dark' ? 'inline' : 'none';
    if (lightIcon) lightIcon.style.display = theme === 'light' ? 'inline' : 'none';
  }
}
