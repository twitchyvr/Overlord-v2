/**
 * Overlord v2 — Notification Center
 *
 * Bell icon with unread badge + drawer showing recent notifications.
 * Filters the activity stream for notification-worthy events:
 *   - Phase gate sign-offs and advances
 *   - Task completions
 *   - RAID risks and issues
 *   - Agent escalations and mentions
 *   - Milestone completions
 *   - Deployment events
 *
 * Persists read state in localStorage so unread badges survive page reload.
 *
 * Usage: Instantiate with the bell button element, then mount().
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Drawer } from './drawer.js';

const STORAGE_KEY = 'overlord_v2_notifications';
const MAX_NOTIFICATIONS = 50;

/**
 * Event types that generate notifications (subset of activity events).
 * Each entry: { match, icon, label, color, getTitle, navigate }
 */
const NOTIFICATION_TYPES = [
  {
    match: 'phase:gate:signed-off',
    icon: '\u2705',
    label: 'Phase Gate',
    color: 'var(--accent-green)',
    getTitle: (d) => `Phase gate signed off: ${d.phase || d.gateName || 'gate'}`,
    navigate: 'phase'
  },
  {
    match: 'phase:advanced',
    icon: '\u{1F680}',
    label: 'Phase Advanced',
    color: 'var(--accent-blue)',
    getTitle: (d) => `Phase advanced to ${d.toPhase || d.phase || 'next'}`,
    navigate: 'phase'
  },
  {
    match: 'task:created',
    icon: '\u2713',
    label: 'Task Created',
    color: 'var(--accent-blue)',
    getTitle: (d) => `New task: ${d.title || 'Untitled'}`,
    navigate: 'tasks'
  },
  {
    match: 'task:updated',
    icon: '\u2713',
    label: 'Task Updated',
    color: 'var(--accent-cyan)',
    getTitle: (d) => d.status === 'done'
      ? `Task completed: ${d.title || 'Untitled'}`
      : `Task updated: ${d.title || 'Untitled'}`,
    navigate: 'tasks'
  },
  {
    match: 'raid:entry:added',
    icon: '\u26A0',
    label: 'RAID Entry',
    color: 'var(--accent-orange)',
    getTitle: (d) => `New ${d.type || 'RAID'} entry: ${d.summary || 'entry'}`,
    navigate: 'raid-log'
  },
  {
    match: 'milestone:created',
    icon: '\u{1F3AF}',
    label: 'Milestone',
    color: 'var(--accent-green)',
    getTitle: (d) => `New milestone: ${d.title || 'Untitled'}`,
    navigate: 'milestones'
  },
  {
    match: 'milestone:updated',
    icon: '\u{1F3AF}',
    label: 'Milestone',
    color: 'var(--accent-green)',
    getTitle: (d) => d.status === 'completed'
      ? `Milestone completed: ${d.title || 'Untitled'}`
      : `Milestone updated: ${d.title || 'Untitled'}`,
    navigate: 'milestones'
  },
  {
    match: 'escalation:war-room',
    icon: '\u{1F6A8}',
    label: 'Escalation',
    color: 'var(--accent-red)',
    getTitle: (d) => `War room escalation: ${d.reason || d.summary || 'critical issue'}`,
    navigate: 'chat'
  },
  {
    match: 'escalation:stale-gate',
    icon: '\u{1F6A8}',
    label: 'Escalation',
    color: 'var(--accent-orange)',
    getTitle: (d) => `Stale gate escalation: ${d.gateName || d.phase || 'gate'}`,
    navigate: 'phase'
  },
  {
    match: 'deploy:check',
    icon: '\u{1F4E6}',
    label: 'Deployment',
    color: 'var(--accent-purple)',
    getTitle: (d) => `Deployment: ${d.status || 'check'} — ${d.summary || 'deployment event'}`,
    navigate: 'activity'
  },
  {
    match: 'agent:mentioned',
    icon: '\u{1F4AC}',
    label: 'Mention',
    color: 'var(--accent-amber)',
    getTitle: (d) => `${d.agentName || 'Agent'} mentioned in ${d.roomName || 'chat'}`,
    navigate: 'chat'
  }
];


export class NotificationCenter extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._notifications = [];
    this._readIds = new Set();
    this._drawerOpen = false;

    // Load persisted read state
    this._loadReadState();
  }

  mount() {
    this._mounted = true;

    // Subscribe to activity stream for new notifications
    this._listeners.push(
      OverlordUI.subscribe('activity:new', (data) => this._handleActivity(data))
    );

    // Subscribe to store for initial activity load
    const store = OverlordUI.getStore();
    if (store) {
      const existing = store.get('activity.items') || [];
      this._hydrateFromActivity(existing);
    }

    this._renderBell();
  }

  unmount() {
    this._mounted = false;
    this._listeners.forEach(fn => fn());
    this._listeners = [];
  }

  // ── Public API ────────────────────────────────────────────

  get unreadCount() {
    return this._notifications.filter(n => !this._readIds.has(n.id)).length;
  }

  // ── Activity Handling ─────────────────────────────────────

  _handleActivity(data) {
    if (!data || !data.event) return;

    const typeDef = NOTIFICATION_TYPES.find(t => t.match === data.event);
    if (!typeDef) return; // Not notification-worthy

    const notification = {
      id: `${data.event}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      event: data.event,
      title: typeDef.getTitle(data),
      icon: typeDef.icon,
      label: typeDef.label,
      color: typeDef.color,
      navigate: typeDef.navigate,
      timestamp: data.timestamp || Date.now(),
      data
    };

    this._notifications.unshift(notification);
    if (this._notifications.length > MAX_NOTIFICATIONS) {
      this._notifications = this._notifications.slice(0, MAX_NOTIFICATIONS);
    }

    this._renderBell();

    // Update drawer if open
    if (this._drawerOpen) {
      this._openDrawer();
    }
  }

  _hydrateFromActivity(items) {
    for (const item of items) {
      const typeDef = NOTIFICATION_TYPES.find(t => t.match === item.event);
      if (!typeDef) continue;

      this._notifications.push({
        id: `${item.event}-${item.timestamp || 0}-${Math.random().toString(36).slice(2, 6)}`,
        event: item.event,
        title: typeDef.getTitle(item),
        icon: typeDef.icon,
        label: typeDef.label,
        color: typeDef.color,
        navigate: typeDef.navigate,
        timestamp: item.timestamp || 0,
        data: item
      });
    }

    // Sort newest first, trim
    this._notifications.sort((a, b) => b.timestamp - a.timestamp);
    if (this._notifications.length > MAX_NOTIFICATIONS) {
      this._notifications = this._notifications.slice(0, MAX_NOTIFICATIONS);
    }

    this._renderBell();
  }

  // ── Bell Rendering ────────────────────────────────────────

  _renderBell() {
    if (!this.el) return;
    this.el.textContent = '';

    const unread = this.unreadCount;

    const btn = h('button', {
      class: 'toolbar-btn-icon notif-bell-btn',
      title: unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications',
      'aria-label': unread > 0 ? `${unread} unread notifications` : 'Notifications'
    });

    // Bell icon (Unicode bell)
    const icon = h('span', { class: 'notif-bell-icon' }, '\u{1F514}');
    btn.appendChild(icon);

    // Badge (only when unread > 0)
    if (unread > 0) {
      const badge = h('span', {
        class: 'notif-badge',
        'aria-hidden': 'true'
      }, unread > 99 ? '99+' : String(unread));
      btn.appendChild(badge);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleDrawer();
    });

    this.el.appendChild(btn);
  }

  // ── Drawer ────────────────────────────────────────────────

  _toggleDrawer() {
    if (this._drawerOpen) {
      Drawer.close();
      this._drawerOpen = false;
    } else {
      this._openDrawer();
    }
  }

  _openDrawer() {
    this._drawerOpen = true;
    const content = this._buildDrawerContent();

    Drawer.open('notification-center', {
      title: 'Notifications',
      content,
      width: '380px',
      onClose: () => {
        this._drawerOpen = false;
      }
    });
  }

  _buildDrawerContent() {
    const container = h('div', { class: 'notif-drawer' });

    // Header actions
    if (this._notifications.length > 0) {
      const actions = h('div', { class: 'notif-drawer-actions' });

      if (this.unreadCount > 0) {
        const markAllBtn = h('button', {
          class: 'notif-mark-all-btn'
        }, 'Mark all as read');
        markAllBtn.addEventListener('click', () => {
          this._markAllRead();
        });
        actions.appendChild(markAllBtn);
      }

      const clearBtn = h('button', {
        class: 'notif-clear-btn'
      }, 'Clear all');
      clearBtn.addEventListener('click', () => {
        this._clearAll();
      });
      actions.appendChild(clearBtn);

      container.appendChild(actions);
    }

    // Notification list
    if (this._notifications.length === 0) {
      container.appendChild(h('div', { class: 'notif-empty' },
        h('span', { class: 'notif-empty-icon' }, '\u{1F514}'),
        h('p', null, 'No notifications yet'),
        h('p', { class: 'notif-empty-hint' }, 'You\u2019ll be notified when important events happen in your project.')
      ));
    } else {
      const list = h('div', { class: 'notif-list' });

      for (const notif of this._notifications) {
        const isRead = this._readIds.has(notif.id);

        const item = h('div', {
          class: `notif-item${isRead ? ' read' : ''}`,
          'data-notif-id': notif.id
        });

        // Icon
        const iconEl = h('span', {
          class: 'notif-item-icon',
          style: { color: notif.color }
        }, notif.icon);

        // Content
        const contentEl = h('div', { class: 'notif-item-content' },
          h('span', { class: 'notif-item-title' }, notif.title),
          h('span', { class: 'notif-item-time' }, this._formatTime(notif.timestamp))
        );

        // Unread dot
        if (!isRead) {
          item.appendChild(h('span', { class: 'notif-unread-dot' }));
        }

        item.appendChild(iconEl);
        item.appendChild(contentEl);

        item.addEventListener('click', () => {
          this._markRead(notif.id);
          Drawer.close();
          this._drawerOpen = false;
          if (notif.navigate) {
            OverlordUI.dispatch(`navigate:${notif.navigate}`);
          }
        });

        list.appendChild(item);
      }

      container.appendChild(list);
    }

    return container;
  }

  // ── Read State ────────────────────────────────────────────

  _markRead(id) {
    this._readIds.add(id);
    this._saveReadState();
    this._renderBell();
  }

  _markAllRead() {
    for (const n of this._notifications) {
      this._readIds.add(n.id);
    }
    this._saveReadState();
    this._renderBell();
    this._openDrawer(); // Refresh drawer content
  }

  _clearAll() {
    this._notifications = [];
    this._readIds.clear();
    this._saveReadState();
    this._renderBell();
    Drawer.close();
    this._drawerOpen = false;
  }

  _loadReadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.readIds)) {
          this._readIds = new Set(parsed.readIds);
        }
      }
    } catch {
      // Ignore corrupted data
    }
  }

  _saveReadState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        readIds: [...this._readIds].slice(-MAX_NOTIFICATIONS)
      }));
    } catch {
      // Storage full or unavailable
    }
  }

  // ── Time Formatting ───────────────────────────────────────

  _formatTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }
}
