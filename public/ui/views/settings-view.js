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
  { id: 'general',   label: 'General',   icon: '\u2699\uFE0F' },
  { id: 'folders',   label: 'Folders',   icon: '\u{1F4C2}' },
  { id: 'libraries', label: 'Libraries', icon: '\u{1F4DA}' },
  { id: 'quality',   label: 'Quality',   icon: '\u2705' },
  { id: 'ai',        label: 'AI',        icon: '\u{1F916}' },
  { id: 'display',   label: 'Display',   icon: '\u{1F5A5}\uFE0F' },
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
    this._tabGeneration = 0; // Incremented on every tab switch to cancel stale async ops
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
        this._tabGeneration++;
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
      case 'libraries':
        tabContent.appendChild(this._buildLibrariesTab());
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
        const current = localStorage.getItem('overlord-log-level') || store?.get('ui.logLevel') || 'info';

        const select = h('select', { class: 'form-input settings-select' });
        for (const level of ['error', 'warn', 'info', 'debug']) {
          const opt = h('option', { value: level }, level.charAt(0).toUpperCase() + level.slice(1));
          if (level === current) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => {
          const store = OverlordUI.getStore();
          if (store) store.set('ui.logLevel', select.value);
          localStorage.setItem('overlord-log-level', select.value);
          // Also notify server
          if (window.overlordSocket?.socket) {
            window.overlordSocket.socket.emit('settings:log-level', { level: select.value });
          }
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

    // Messaging mode (#601)
    section.appendChild(h('h4', { class: 'settings-section-title', style: { marginTop: 'var(--sp-6)' } }, 'Messaging'));
    section.appendChild(this._buildSettingRow({
      label: 'Messaging System',
      description: 'Choose how agents communicate',
      control: () => {
        const current = localStorage.getItem('overlord-messaging-mode') || 'internal';
        const group = h('div', { class: 'settings-toggle-group' });

        for (const mode of [
          { id: 'internal', label: '\u{1F4E8} Internal Mail', desc: 'SQLite database — fast, local' },
          { id: 'gnap', label: '\u{1F517} GNAP', desc: 'Git-backed — persistent, auditable' },
        ]) {
          const btn = h('button', {
            class: `settings-toggle-btn${current === mode.id ? ' active' : ''}`,
            title: mode.desc,
          }, mode.label);

          btn.addEventListener('click', () => {
            localStorage.setItem('overlord-messaging-mode', mode.id);
            group.querySelectorAll('.settings-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Notify server
            if (window.overlordSocket?.socket) {
              window.overlordSocket.socket.emit('settings:messaging-mode', { mode: mode.id });
            }
            Toast.success(`Messaging mode set to ${mode.label}`);
          });
          group.appendChild(btn);
        }
        return group;
      }
    }));

    return section;
  }

  // ── Folders Tab ─────────────────────────────────────────

  _buildFoldersTab() {
    const section = h('div', { class: 'settings-section' });
    const store = OverlordUI.getStore();
    const buildingId = store?.get('building.active');

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

    // Detect git status for working directory (guarded by generation counter)
    if (workingDir !== '(not set)' && window.overlordSocket) {
      this._detectGitStatus(workingDir, this._tabGeneration);
    }

    // Allowed paths section
    section.appendChild(h('h4', { class: 'settings-section-title', style: { marginTop: 'var(--sp-6)' } },
      'Allowed Folders'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'Additional folders agents can access beyond the working directory. Subfolders inherit access.'));

    const pathList = h('div', { class: 'settings-folder-list', id: 'settings-folder-list' });
    section.appendChild(pathList);

    // Load and render existing paths (guarded by generation counter)
    this._loadAllowedPaths(buildingId, pathList, this._tabGeneration);

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

    // Linked repositories section (#640)
    section.appendChild(h('h4', { class: 'settings-section-title', style: { marginTop: 'var(--sp-6)' } },
      'Linked Repositories'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'GitHub repositories linked as building blocks for this project.'));
    const repoListEl = h('div', { class: 'settings-repo-list', id: 'settings-repo-list' });
    section.appendChild(repoListEl);
    this._loadLinkedRepos(buildingId, repoListEl, this._tabGeneration);

    // Sync status section (#649)
    section.appendChild(h('h4', { class: 'settings-section-title', style: { marginTop: 'var(--sp-6)' } },
      'Sync Status'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'Check if linked repos have upstream changes.'));
    const syncContainer = h('div', { class: 'repo-sync-container', id: 'repo-sync-container' });
    const checkAllBtn = h('button', { class: 'btn btn-secondary btn-sm', style: { marginBottom: 'var(--sp-3)' } }, 'Check All Repos');
    checkAllBtn.addEventListener('click', () => {
      this._loadSyncStatus(buildingId, syncContainer, this._tabGeneration);
    });
    section.appendChild(checkAllBtn);
    section.appendChild(syncContainer);

    return section;
  }

  async _loadLinkedRepos(buildingId, listEl, gen) {
    if (!window.overlordSocket) return;
    try {
      const result = await window.overlordSocket.listRepos(buildingId);
      if (gen !== this._tabGeneration) return;
      if (!result?.ok || !result.data?.repos?.length) {
        listEl.appendChild(h('p', { class: 'settings-empty-hint' }, 'No repositories linked yet.'));
        return;
      }
      for (const repo of result.data.repos) {
        const row = h('div', { class: 'repo-list-item' },
          h('span', { class: 'repo-list-name' }, repo.name),
          h('span', { class: `repo-list-badge rel-${repo.relationship}` }, repo.relationship),
          h('span', { class: 'repo-list-url' }, repo.repo_url),
        );
        const removeBtn = h('button', {
          class: 'repo-remove-btn',
          title: 'Remove',
          'aria-label': `Remove ${repo.name}`,
        }, '\u2715');
        removeBtn.addEventListener('click', async () => {
          removeBtn.disabled = true;
          removeBtn.style.opacity = '0.4';
          try {
            const res = await window.overlordSocket.removeRepo({ buildingId, repoId: repo.id });
            if (res?.ok) {
              row.remove();
              Toast.success(`Removed ${repo.name}`);
              if (!listEl.querySelector('.repo-list-item')) {
                listEl.appendChild(h('p', { class: 'settings-empty-hint' }, 'No repositories linked yet.'));
              }
            } else {
              Toast.error(`Failed to remove: ${res?.error?.message || 'Unknown error'}`);
              removeBtn.disabled = false;
              removeBtn.style.opacity = '';
            }
          } catch {
            Toast.error('Failed to remove repository');
            removeBtn.disabled = false;
            removeBtn.style.opacity = '';
          }
        });
        row.appendChild(removeBtn);
        listEl.appendChild(row);
      }
    } catch (err) {
      listEl.appendChild(h('p', { class: 'settings-empty-hint' }, 'Failed to load repos.'));
    }
  }

  async _loadSyncStatus(buildingId, container, gen) {
    if (!window.overlordSocket) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(h('p', { class: 'settings-empty-hint' }, 'Checking upstream...'));

    try {
      const result = await window.overlordSocket.repoSyncStatus(buildingId);
      if (gen !== this._tabGeneration) return;
      while (container.firstChild) container.removeChild(container.firstChild);

      if (!result?.ok) {
        container.appendChild(h('p', { class: 'settings-empty-hint' },
          `Failed: ${result?.error?.message || 'Unknown error'}`));
        return;
      }

      const { repos, summary, fileOrigins } = result.data;

      if (repos.length === 0) {
        container.appendChild(h('p', { class: 'settings-empty-hint' }, 'No repos to check.'));
        return;
      }

      // Summary bar
      const summaryParts = [h('span', { class: 'sync-stat sync-synced' }, `${summary.reposSynced} synced`)];
      if (summary.reposBehind > 0) {
        summaryParts.push(h('span', { class: 'sync-stat sync-behind' }, `${summary.reposBehind} behind`));
      }
      if (summary.reposErrored > 0) {
        summaryParts.push(h('span', { class: 'sync-stat sync-error' }, `${summary.reposErrored} error`));
      }
      if (fileOrigins.total > 0) {
        summaryParts.push(h('span', { class: 'sync-stat sync-files' },
          `${fileOrigins.total} tracked files (${fileOrigins.modifiedLocally} modified)`));
      }
      const summaryEl = h('div', { class: 'repo-sync-summary' }, ...summaryParts);
      container.appendChild(summaryEl);

      // Per-repo rows
      for (const repo of repos) {
        const statusClass = repo.error ? 'sync-error' : repo.isSynced ? 'sync-synced' : 'sync-behind';
        const statusText = repo.error
          ? 'Error'
          : repo.isSynced
            ? 'In sync'
            : `Behind by ${repo.commitsBehind} commit${repo.commitsBehind !== 1 ? 's' : ''}`;

        const row = h('div', { class: 'repo-sync-row' },
          h('span', { class: 'repo-sync-name' }, repo.name),
          h('span', { class: `repo-sync-badge ${statusClass}` }, statusText),
          h('span', { class: 'repo-sync-branch' }, repo.branch),
          h('span', { class: 'repo-sync-time' },
            repo.lastSyncedAt ? `Synced: ${new Date(repo.lastSyncedAt).toLocaleDateString()}` : 'Never synced'),
        );

        // Fetch button for individual repo refresh
        const fetchBtn = h('button', {
          class: 'btn btn-ghost btn-xs',
          title: 'Fetch latest',
          'aria-label': `Fetch latest for ${repo.name}`,
        }, 'Fetch');
        fetchBtn.addEventListener('click', async () => {
          fetchBtn.disabled = true;
          fetchBtn.textContent = '...';
          try {
            const res = await window.overlordSocket.repoSyncFetch(buildingId, repo.id);
            if (res?.ok) {
              Toast.success(`Fetched latest for ${repo.name}`);
              this._loadSyncStatus(buildingId, container, this._tabGeneration);
            } else {
              Toast.error(`Fetch failed: ${res?.error?.message || 'Unknown'}`);
              fetchBtn.disabled = false;
              fetchBtn.textContent = 'Fetch';
            }
          } catch {
            Toast.error('Fetch failed');
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Fetch';
          }
        });
        row.appendChild(fetchBtn);
        container.appendChild(row);
      }
    } catch {
      if (gen !== this._tabGeneration) return;
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(h('p', { class: 'settings-empty-hint' }, 'Failed to check sync status.'));
    }
  }

  async _detectGitStatus(dirPath, gen) {
    if (!window.overlordSocket?.socket) return;
    try {
      const result = await new Promise((resolve) => {
        window.overlordSocket.socket.emit('git:detect', { path: dirPath }, resolve);
      });
      // Bail if user switched tabs while we were waiting
      if (gen !== this._tabGeneration) return;
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

  async _loadAllowedPaths(buildingId, listEl, gen) {
    if (!window.overlordSocket?.socket) return;
    try {
      const result = await new Promise((resolve) => {
        window.overlordSocket.socket.emit('folder:list-paths', { buildingId }, resolve);
      });
      // Bail if user switched tabs while we were waiting
      if (gen !== this._tabGeneration) return;

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

    const gen = this._tabGeneration;
    if (window.overlordSocket?.socket) {
      window.overlordSocket.socket.emit('quality:config:get', {}, (res) => {
        // Bail if user switched tabs while waiting
        if (gen !== this._tabGeneration) return;
        if (res?.ok && res.data) {
          this._qualityConfig = { ...this._qualityConfig, ...res.data };
          // Update toggle states in-place rather than rebuilding the entire modal
          const switches = document.querySelectorAll('.settings-switch[data-quality-key]');
          for (const sw of switches) {
            const key = sw.getAttribute('data-quality-key');
            const isOn = this._qualityConfig[key] !== false;
            sw.classList.toggle('on', isOn);
            sw.setAttribute('aria-checked', String(isOn));
          }
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
            'data-quality-key': item.key,
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

  // ── Documentation Libraries Tab (#811) ──────────────────

  _buildLibrariesTab() {
    const section = h('div', { class: 'settings-section' });
    const store = OverlordUI.getStore();
    const buildingId = store?.get('building.active');

    section.appendChild(h('h3', { class: 'settings-section-title' }, 'Documentation Libraries'));
    section.appendChild(h('p', { class: 'settings-section-desc', style: 'color:var(--text-muted); margin-bottom:var(--sp-4)' },
      'Libraries give your agents access to project documentation, API references, and code files. Agents can search and read library contents during conversations.'
    ));

    if (!buildingId) {
      section.appendChild(h('div', { class: 'settings-info', style: 'padding:var(--sp-4); background:var(--bg-secondary); border-radius:var(--radius-md); color:var(--text-muted)' },
        'Select a project first to manage its documentation libraries.'
      ));
      return section;
    }

    // Create library form
    const createRow = h('div', { style: 'display:flex; gap:var(--sp-2); margin-bottom:var(--sp-4)' });
    const pathInput = h('input', {
      type: 'text',
      class: 'form-input',
      placeholder: '/path/to/docs or /path/to/project',
      style: 'flex:1'
    });
    const nameInput = h('input', {
      type: 'text',
      class: 'form-input',
      placeholder: 'Library name (optional)',
      style: 'width:180px'
    });
    const addBtn = h('button', { class: 'btn btn-primary btn-md' }, '+ Add Library');
    addBtn.addEventListener('click', () => {
      const path = pathInput.value.trim();
      if (!path) { Toast.warning('Enter a folder path'); return; }
      const name = nameInput.value.trim() || path.split('/').pop() || 'Library';

      if (window.overlordSocket?.socket) {
        addBtn.textContent = 'Indexing...';
        addBtn.disabled = true;
        window.overlordSocket.socket.emit('doc:library:create', { buildingId, name, docRootPath: path }, (res) => {
          if (res?.ok) {
            const libraryId = res.data?.id || res.data?.libraryId;
            // Auto-index after creation
            window.overlordSocket.socket.emit('doc:library:index', { libraryId }, (indexRes) => {
              addBtn.textContent = '+ Add Library';
              addBtn.disabled = false;
              if (indexRes?.ok) {
                Toast.success(`Library "${name}" created and indexed (${indexRes.data?.indexed || 0} files)`);
              } else {
                Toast.success(`Library "${name}" created (indexing may be in progress)`);
              }
              pathInput.value = '';
              nameInput.value = '';
              this._updateModalContent();
            });
          } else {
            addBtn.textContent = '+ Add Library';
            addBtn.disabled = false;
            Toast.error(res?.error?.message || 'Failed to create library');
          }
        });
      }
    });
    createRow.appendChild(pathInput);
    createRow.appendChild(nameInput);
    createRow.appendChild(addBtn);
    section.appendChild(createRow);

    // List existing libraries
    const listContainer = h('div', { class: 'settings-libraries-list' });
    section.appendChild(listContainer);

    // Fetch libraries
    if (window.overlordSocket?.socket) {
      window.overlordSocket.socket.emit('doc:library:list', { buildingId }, (res) => {
        if (res?.ok && res.data?.length > 0) {
          for (const lib of res.data) {
            const card = h('div', {
              style: 'display:flex; align-items:center; justify-content:space-between; padding:var(--sp-3); border:1px solid var(--border-secondary); border-radius:var(--radius-md); margin-bottom:var(--sp-2)'
            },
              h('div', {},
                h('div', { style: 'font-weight:var(--font-medium)' }, lib.name || 'Unnamed'),
                h('div', { style: 'font-size:var(--text-xs); color:var(--text-muted)' }, lib.path || ''),
                h('div', { style: 'font-size:var(--text-xs); color:var(--text-muted)' },
                  `${lib.file_count || 0} files indexed`
                ),
              ),
              h('div', { style: 'display:flex; gap:var(--sp-2)' },
                (() => {
                  const reindexBtn = h('button', { class: 'btn btn-ghost btn-xs' }, 'Re-index');
                  reindexBtn.addEventListener('click', () => {
                    reindexBtn.textContent = 'Indexing...';
                    reindexBtn.disabled = true;
                    window.overlordSocket.socket.emit('doc:library:index', { libraryId: lib.id }, (indexRes) => {
                      reindexBtn.textContent = 'Re-index';
                      reindexBtn.disabled = false;
                      if (indexRes?.ok) {
                        Toast.success(`Re-indexed: ${indexRes.data?.indexed || 0} files`);
                        this._updateModalContent();
                      } else {
                        Toast.error('Re-indexing failed');
                      }
                    });
                  });
                  return reindexBtn;
                })(),
                (() => {
                  const delBtn = h('button', {
                    class: 'btn btn-ghost btn-xs',
                    style: 'color:var(--c-danger)'
                  }, 'Remove');
                  delBtn.addEventListener('click', () => {
                    if (!confirm(`Remove library "${lib.name}"? This deletes the index but not the source files.`)) return;
                    window.overlordSocket.socket.emit('doc:library:delete', { libraryId: lib.id }, (delRes) => {
                      if (delRes?.ok) {
                        Toast.info(`Library "${lib.name}" removed`);
                        this._updateModalContent();
                      } else {
                        Toast.error('Failed to remove library');
                      }
                    });
                  });
                  return delBtn;
                })(),
              ),
            );
            listContainer.appendChild(card);
          }
        } else {
          listContainer.appendChild(h('div', {
            style: 'padding:var(--sp-4); text-align:center; color:var(--text-muted); background:var(--bg-secondary); border-radius:var(--radius-md)'
          }, 'No libraries configured yet. Add a folder path above to index documentation for your agents.'));
        }
      });
    }

    return section;
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

    // Configured providers for the dropdown options
    const availableProviders = Object.entries(PROVIDERS)
      .filter(([key]) => this._serverConfig?.providers?.[key]?.configured)
      .map(([key, info]) => ({ key, ...info }));

    for (const [roomType, defaultProvider] of Object.entries(ROOM_PROVIDERS)) {
      const serverOverride = this._serverConfig?.roomProviderMap?.[roomType];
      const active = serverOverride || defaultProvider;
      const model = this._serverConfig?.providers?.[active]?.model || '\u2014';

      // Room type label
      const roomLabel = h('span', { class: 'settings-mapping-room' },
        roomType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));

      // Provider dropdown (editable) (#555)
      const select = h('select', { class: 'form-select settings-mapping-select' });
      for (const p of availableProviders) {
        const opt = h('option', { value: p.key }, `${p.icon} ${p.name}`);
        if (p.key === active) opt.selected = true;
        select.appendChild(opt);
      }
      // Add unconfigured providers as disabled options
      for (const [key, info] of Object.entries(PROVIDERS)) {
        if (!availableProviders.some(p => p.key === key)) {
          const opt = h('option', { value: key, disabled: true }, `${info.icon} ${info.name} (not configured)`);
          select.appendChild(opt);
        }
      }
      select.addEventListener('change', () => {
        this._saveRoomProvider(roomType, select.value, defaultProvider);
      });

      const providerCell = h('span', { class: 'settings-mapping-provider' });
      providerCell.appendChild(select);

      const isOverride = active !== defaultProvider;
      mappingTable.appendChild(h('div', { class: 'settings-mapping-row' },
        roomLabel,
        providerCell,
        h('span', { class: 'settings-mapping-model mono' }, model),
        h('span', {
          class: `settings-mapping-source${isOverride ? ' override' : ''}`
        }, isOverride ? 'Override' : 'Default')
      ));
    }
    section.appendChild(mappingTable);

    return section;
  }

  _saveRoomProvider(roomType, providerKey, defaultProvider) {
    if (!window.overlordSocket?.socket) return;
    const isDefault = providerKey === defaultProvider;
    window.overlordSocket.socket.emit('settings:room-provider', {
      roomType,
      provider: isDefault ? null : providerKey,
    }, (res) => {
      if (res?.ok) {
        Toast.success(`${roomType} now uses ${PROVIDERS[providerKey]?.name || providerKey}`);
        // Re-fetch server config to update model display
        this._fetchServerConfig();
      } else {
        Toast.error(res?.error?.message || 'Failed to save provider');
      }
    });
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
        const current = localStorage.getItem('overlord-chat-font-size') || store?.get('ui.chatFontSize') || 'normal';
        const toggle = h('div', { class: 'settings-toggle-group' });

        for (const size of ['small', 'normal', 'large']) {
          const btn = h('button', {
            class: `settings-toggle-btn${current === size ? ' active' : ''}`
          }, size.charAt(0).toUpperCase() + size.slice(1));

          btn.addEventListener('click', () => {
            const store = OverlordUI.getStore();
            if (store) store.set('ui.chatFontSize', size);
            localStorage.setItem('overlord-chat-font-size', size);
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
        const stored = localStorage.getItem('overlord-show-timestamps');
        const current = stored !== null ? stored === 'true' : store?.get('ui.showTimestamps') !== false;
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
          localStorage.setItem('overlord-show-timestamps', String(nowOn));
        });
        return toggle;
      }
    }));

    // Show thinking blocks
    section.appendChild(this._buildSettingRow({
      label: 'Show AI Thinking',
      description: 'Display AI thinking/reasoning blocks in chat',
      control: () => {
        const storedThink = localStorage.getItem('overlord-show-thinking');
        const current = storedThink !== null ? storedThink === 'true' : store?.get('ui.showThinking') !== false;
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
          localStorage.setItem('overlord-show-thinking', String(nowOn));
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
