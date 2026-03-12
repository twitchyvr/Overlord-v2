/**
 * Overlord v2 — Settings View
 *
 * Modal-based settings interface with tabbed sections:
 *   General   — Theme toggle, log level
 *   AI        — Read-only provider display, model info
 *   Panels    — Panel visibility configuration
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
  { id: 'ai',       label: 'AI',       icon: '\u{1F916}' },
  { id: 'panels',   label: 'Panels',   icon: '\u{1F4CB}' },
  { id: 'display',  label: 'Display',  icon: '\u{1F5A5}\uFE0F' },
];

/** Known AI providers with display metadata. */
const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', icon: '\u{1F7E3}', envKey: 'ANTHROPIC_API_KEY' },
  minimax:   { name: 'MiniMax',            icon: '\u{1F7E2}', envKey: 'MINIMAX_API_KEY' },
  openai:    { name: 'OpenAI',             icon: '\u{1F7E1}', envKey: 'OPENAI_API_KEY' },
  ollama:    { name: 'Ollama (Local)',      icon: '\u{1F535}', envKey: 'OLLAMA_BASE_URL' },
};

/** Room type → default provider mapping. */
const ROOM_PROVIDERS = {
  discovery:     'anthropic',
  architecture:  'anthropic',
  'code-lab':    'minimax',
  'testing-lab': 'minimax',
  review:        'anthropic',
  deploy:        'anthropic',
};

/** Panel registry with labels and descriptions. */
const PANELS = [
  { id: 'phase',    label: 'Phase Gates',  desc: 'Phase progression and gate status' },
  { id: 'agents',   label: 'Agents',       desc: 'Active agent roster and positions' },
  { id: 'tasks',    label: 'Tasks',        desc: 'Task list with status tracking' },
  { id: 'raid',     label: 'RAID Log',     desc: 'Risks, Assumptions, Issues, Dependencies' },
  { id: 'activity', label: 'Activity',     desc: 'Real-time activity feed' },
  { id: 'projects', label: 'Projects',     desc: 'Project list and management' },
  { id: 'tools',    label: 'Tools',        desc: 'Available tools and MCP servers' },
  { id: 'logs',     label: 'Logs',         desc: 'System and debug logs' },
  { id: 'team',     label: 'Team',         desc: 'Agent team roster by role' },
];


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
      case 'ai':
        tabContent.appendChild(this._buildAITab());
        break;
      case 'panels':
        tabContent.appendChild(this._buildPanelsTab());
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
        const port = this._serverConfig?.port || '4000';
        const env = this._serverConfig?.environment || 'development';
        return h('div', { class: 'settings-server-info' },
          h('span', { class: 'settings-info-badge' }, env),
          h('span', { class: 'settings-info-detail' }, `Port ${port}`)
        );
      }
    }));

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
      'Room Provider Defaults'));
    section.appendChild(h('p', { class: 'settings-section-desc' },
      'Default AI provider assignment per room type. Override with PROVIDER_* env vars.'));

    const mappingTable = h('div', { class: 'settings-mapping-table' });
    for (const [roomType, defaultProvider] of Object.entries(ROOM_PROVIDERS)) {
      const serverOverride = this._serverConfig?.roomProviders?.[roomType];
      const active = serverOverride || defaultProvider;
      const providerInfo = PROVIDERS[active] || { name: active, icon: '\u2753' };

      mappingTable.appendChild(h('div', { class: 'settings-mapping-row' },
        h('span', { class: 'settings-mapping-room' },
          roomType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')),
        h('span', { class: 'settings-mapping-provider' },
          h('span', null, providerInfo.icon),
          h('span', null, ` ${providerInfo.name}`)),
        serverOverride && serverOverride !== defaultProvider
          ? h('span', { class: 'settings-mapping-override' }, 'Override')
          : null
      ));
    }
    section.appendChild(mappingTable);

    return section;
  }

  // ── Panels Tab ──────────────────────────────────────────

  _buildPanelsTab() {
    const section = h('div', { class: 'settings-section' });
    const store = OverlordUI.getStore();
    const visibility = store?.get('panels.visibility') || {};

    section.appendChild(h('p', { class: 'settings-section-desc' },
      'Toggle sidebar panels on or off. Changes are saved automatically.'));

    const panelList = h('div', { class: 'settings-panel-list' });

    for (const panel of PANELS) {
      const isVisible = visibility[panel.id] !== false; // default visible
      const row = h('div', { class: 'settings-panel-row' });

      const info = h('div', { class: 'settings-panel-info' },
        h('span', { class: 'settings-panel-name' }, panel.label),
        h('span', { class: 'settings-panel-desc' }, panel.desc)
      );

      const toggleWrapper = h('div', { class: 'settings-switch-wrapper' });
      const toggle = h('button', {
        class: `settings-switch${isVisible ? ' on' : ''}`,
        role: 'switch',
        'aria-checked': isVisible ? 'true' : 'false',
        'aria-label': `Toggle ${panel.label} panel`
      });

      const knob = h('span', { class: 'settings-switch-knob' });
      toggle.appendChild(knob);

      toggle.addEventListener('click', () => {
        const store = OverlordUI.getStore();
        if (!store) return;
        const vis = { ...(store.get('panels.visibility') || {}) };
        vis[panel.id] = !isVisible;
        store.set('panels.visibility', vis);

        // Toggle visual state
        const nowOn = vis[panel.id];
        toggle.classList.toggle('on', nowOn);
        toggle.setAttribute('aria-checked', nowOn ? 'true' : 'false');

        // Show/hide the actual panel element
        const panelEl = document.getElementById(`panel-${panel.id}`);
        if (panelEl) {
          panelEl.style.display = nowOn ? '' : 'none';
        }
      });

      toggleWrapper.appendChild(toggle);
      row.appendChild(info);
      row.appendChild(toggleWrapper);
      panelList.appendChild(row);
    }

    section.appendChild(panelList);

    // Quick actions
    const actions = h('div', { class: 'settings-panel-actions' });

    const showAllBtn = h('button', { class: 'btn btn-secondary btn-sm' }, 'Show All');
    showAllBtn.addEventListener('click', () => {
      const store = OverlordUI.getStore();
      if (!store) return;
      const vis = {};
      PANELS.forEach(p => { vis[p.id] = true; });
      store.set('panels.visibility', vis);
      PANELS.forEach(p => {
        const el = document.getElementById(`panel-${p.id}`);
        if (el) el.style.display = '';
      });
      this._updateModalContent();
      Toast.success('All panels visible');
    });

    const hideAllBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Hide All');
    hideAllBtn.addEventListener('click', () => {
      const store = OverlordUI.getStore();
      if (!store) return;
      const vis = {};
      PANELS.forEach(p => { vis[p.id] = false; });
      store.set('panels.visibility', vis);
      PANELS.forEach(p => {
        const el = document.getElementById(`panel-${p.id}`);
        if (el) el.style.display = 'none';
      });
      this._updateModalContent();
      Toast.success('All panels hidden');
    });

    actions.appendChild(hideAllBtn);
    actions.appendChild(showAllBtn);
    section.appendChild(actions);

    return section;
  }

  // ── Display Tab ─────────────────────────────────────────

  _buildDisplayTab() {
    const section = h('div', { class: 'settings-section' });
    const store = OverlordUI.getStore();

    // Panel width
    section.appendChild(this._buildSettingRow({
      label: 'Panel Width',
      description: 'Width of the right sidebar in pixels',
      control: () => {
        const current = store?.get('panels.width') || 320;
        const input = h('input', {
          class: 'form-input settings-number-input',
          type: 'number',
          min: '200',
          max: '600',
          step: '20',
          value: String(current),
        });
        input.addEventListener('change', () => {
          const val = Math.max(200, Math.min(600, parseInt(input.value, 10) || 320));
          input.value = String(val);
          const store = OverlordUI.getStore();
          if (store) store.set('panels.width', val);
          const rightPanel = document.getElementById('right-panel');
          if (rightPanel) rightPanel.style.width = `${val}px`;
          Toast.success(`Panel width set to ${val}px`);
        });
        return input;
      }
    }));

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
