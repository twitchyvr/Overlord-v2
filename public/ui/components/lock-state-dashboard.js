/**
 * Lock State Dashboard — Real-Time Resource Lock Visibility (#943)
 *
 * Shows active resource locks with agent ownership, TTL countdown,
 * resource type badges, and lock health indicators.
 *
 * Renders as a summary bar + lock card grid — each active lock gets a card
 * with resource info, agent identity, TTL bar, and status indicator.
 */

import { h } from '../engine/helpers.js';
import { OverlordUI } from '../engine/engine.js';

// Resource type display config — color and icon for each lock type
const RESOURCE_TYPES = {
  file:         { color: '#4a90d9', icon: '📄', label: 'File' },
  git:          { color: '#f05033', icon: '🔀', label: 'Git' },
  'github-api': { color: '#6e5494', icon: '🐙', label: 'GitHub API' },
  shell:        { color: '#4eaa25', icon: '💻', label: 'Shell' },
  browser:      { color: '#ff9800', icon: '🌐', label: 'Browser' },
  devserver:    { color: '#00bcd4', icon: '🖥️', label: 'Dev Server' },
  build:        { color: '#e91e63', icon: '🏗️', label: 'Build' },
  database:     { color: '#9c27b0', icon: '🗄️', label: 'Database' },
  plugin:       { color: '#607d8b', icon: '🔌', label: 'Plugin' },
  provider:     { color: '#795548', icon: '🤖', label: 'Provider' },
  __exclusive__:{ color: '#b71c1c', icon: '🔒', label: 'Exclusive' },
  default:      { color: '#757575', icon: '🔐', label: 'Resource' },
};

export class LockStateDashboard {

  /**
   * Render the lock state dashboard.
   * @param {object} snapshot - LockStateSnapshot from lock:state
   * @param {Function} onRefresh - callback to refresh data
   * @returns {HTMLElement}
   */
  static render(snapshot, onRefresh) {
    const container = h('div', { class: 'lock-dashboard' });
    const locks = snapshot?.locks ?? [];

    // ── Global Summary ──
    const activeLocks = locks.filter(l => l.status === 'active');
    const expiringLocks = locks.filter(l => l.status === 'expiring');
    const uniqueAgents = new Set(locks.map(l => l.agentId)).size;
    const uniqueResources = new Set(locks.map(l => l.resource)).size;

    const summaryBar = h('div', { class: 'lock-summary' },
      h('div', { class: 'lock-summary-stat' },
        h('span', { class: 'lock-summary-value' }, String(locks.length)),
        h('span', { class: 'lock-summary-label' }, 'Active Locks'),
      ),
      h('div', { class: 'lock-summary-stat' },
        h('span', { class: 'lock-summary-value' }, String(uniqueAgents)),
        h('span', { class: 'lock-summary-label' }, 'Agents Holding'),
      ),
      h('div', { class: 'lock-summary-stat' },
        h('span', { class: 'lock-summary-value' }, String(uniqueResources)),
        h('span', { class: 'lock-summary-label' }, 'Resources Locked'),
      ),
      h('div', { class: `lock-summary-stat${expiringLocks.length > 0 ? ' lock-summary-stat--warn' : ''}` },
        h('span', { class: 'lock-summary-value' }, String(expiringLocks.length)),
        h('span', { class: 'lock-summary-label' }, 'Expiring Soon'),
      ),
    );

    // ── Refresh + Timestamp ──
    const updatedAt = snapshot?.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString() : 'N/A';
    const headerRow = h('div', { class: 'lock-header-row' },
      h('span', { class: 'lock-updated-at' }, `Updated: ${updatedAt}`),
      h('button', {
        class: 'lock-refresh-btn',
        onclick: () => onRefresh?.(),
      }, '↻ Refresh'),
    );

    container.appendChild(summaryBar);
    container.appendChild(headerRow);

    // ── Empty State ──
    if (locks.length === 0) {
      container.appendChild(h('div', { class: 'lock-empty' },
        h('span', { class: 'lock-empty-icon' }, '🔓'),
        h('span', { class: 'lock-empty-text' }, 'No active locks — all resources are available'),
      ));
      return container;
    }

    // ── Lock Cards ──
    const grid = h('div', { class: 'lock-grid' });
    // Sort: expiring first, then by time remaining
    const sorted = [...locks].sort((a, b) => {
      if (a.status === 'expiring' && b.status !== 'expiring') return -1;
      if (b.status === 'expiring' && a.status !== 'expiring') return 1;
      return a.timeRemaining - b.timeRemaining;
    });

    for (const lock of sorted) {
      grid.appendChild(LockStateDashboard._renderLockCard(lock));
    }

    container.appendChild(grid);
    return container;
  }

  /**
   * Render a single lock card.
   * @param {object} lock - LockStateEntry
   * @returns {HTMLElement}
   */
  static _renderLockCard(lock) {
    const resType = LockStateDashboard._getResourceType(lock.resource);
    const config = RESOURCE_TYPES[resType] ?? RESOURCE_TYPES.default;
    const isExpiring = lock.status === 'expiring';
    const isExclusive = lock.resource === '__exclusive__';

    const ttlPct = lock.ttl > 0
      ? Math.min(100, Math.round((lock.timeRemaining / (lock.ttl + 5_000)) * 100))
      : 0;

    const ttlColor = ttlPct > 50 ? '#4caf50' : ttlPct > 20 ? '#ff9800' : '#f44336';

    const card = h('div', {
      class: `lock-card${isExpiring ? ' lock-card--expiring' : ''}${isExclusive ? ' lock-card--exclusive' : ''}`,
    },
      // Header: resource type badge + resource name
      h('div', { class: 'lock-card-header' },
        h('span', {
          class: 'lock-resource-badge',
          style: `background: ${config.color}`,
        }, `${config.icon} ${config.label}`),
        h('span', {
          class: `lock-status-dot ${isExpiring ? 'lock-status-dot--expiring' : 'lock-status-dot--active'}`,
        }),
      ),

      // Resource key
      h('div', { class: 'lock-resource-key', title: lock.resource },
        LockStateDashboard._formatResourceKey(lock.resource),
      ),

      // Agent info
      h('div', { class: 'lock-agent-row' },
        h('span', { class: 'lock-agent-label' }, 'Agent:'),
        h('span', { class: 'lock-agent-id' }, lock.agentId || 'unknown'),
      ),

      // TTL bar
      h('div', { class: 'lock-ttl-row' },
        h('div', { class: 'lock-ttl-bar' },
          h('div', {
            class: 'lock-ttl-fill',
            style: `width: ${ttlPct}%; background: ${ttlColor}`,
          }),
        ),
        h('span', { class: 'lock-ttl-text' },
          LockStateDashboard._formatMs(lock.timeRemaining) + ' remaining',
        ),
      ),

      // Metadata row (tool name, concurrency mode)
      lock.metadata ? h('div', { class: 'lock-metadata' },
        lock.metadata.toolName
          ? h('span', { class: 'lock-meta-tag' }, `tool: ${lock.metadata.toolName}`)
          : null,
        lock.metadata.concurrencyMode
          ? h('span', { class: 'lock-meta-tag' }, `mode: ${lock.metadata.concurrencyMode}`)
          : null,
      ) : null,

      // Timestamps
      h('div', { class: 'lock-timestamps' },
        h('span', {}, `Acquired: ${new Date(lock.acquiredAt).toLocaleTimeString()}`),
        h('span', {}, `Refreshed: ${new Date(lock.refreshedAt).toLocaleTimeString()}`),
      ),
    );

    return card;
  }

  /**
   * Extract resource type from a resource key like "file:src/foo.ts" or "git:<buildingId>"
   */
  static _getResourceType(resource) {
    if (resource === '__exclusive__') return '__exclusive__';
    const colon = resource.indexOf(':');
    if (colon > 0) return resource.substring(0, colon);
    return 'default';
  }

  /**
   * Format a resource key for display — truncate long file paths.
   */
  static _formatResourceKey(resource) {
    if (resource === '__exclusive__') return 'Global Exclusive Lock';
    const colon = resource.indexOf(':');
    if (colon > 0) {
      const value = resource.substring(colon + 1);
      if (value.length > 40) return '...' + value.slice(-37);
      return value;
    }
    return resource;
  }

  /**
   * Format milliseconds to human-readable "Xs" or "Xm Ys" format.
   */
  static _formatMs(ms) {
    if (ms <= 0) return '0s';
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }
}
