/**
 * Overlord v2 — Agent Activity Tracker
 *
 * Subscribes to real-time events and applies CSS animation classes
 * to agent cards/avatars wherever they appear in the DOM.
 *
 * Animation states:
 *   - thinking   — AI is generating a response (pulsing glow)
 *   - working    — agent is executing a tool (spinning gear overlay)
 *   - chatting   — agent is streaming text (typing indicator)
 *   - waiting    — agent waiting for input (slow pulse)
 *   - idle       — no activity (subtle breathing, optional)
 *   - error      — agent encountered an error (red pulse)
 *
 * Uses data-agent-id attributes to target specific agent elements
 * without requiring DOM rebuilds.
 *
 * Usage: Instantiate and mount() once at boot. No container needed.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';

const ACTIVITY_STATES = ['thinking', 'working', 'chatting', 'waiting', 'idle', 'error'];
const ACTIVITY_CLASS_PREFIX = 'agent-activity-';

// Auto-reset to idle after this many ms without new events
const THINKING_TIMEOUT = 30000;
const WORKING_TIMEOUT = 15000;
const CHATTING_TIMEOUT = 5000;


export class AgentActivityTracker extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    // Map of agentId → { state, timer }
    this._agentStates = new Map();
    this._activityTimers = new Map(); // agentId → setTimeout handle for badge auto-hide
  }

  mount() {
    this._mounted = true;

    // ── Thinking: AI is generating ──
    this._listeners.push(
      OverlordUI.subscribe('chat:stream-start', (data) => {
        if (data && data.agentId) {
          this._setState(data.agentId, 'thinking', THINKING_TIMEOUT);
        }
      })
    );

    // ── Chatting: streaming response text ──
    this._listeners.push(
      OverlordUI.subscribe('chat:stream-chunk', (data) => {
        if (data && data.agentId) {
          this._setState(data.agentId, 'chatting', CHATTING_TIMEOUT);
        }
      })
    );

    // ── Response complete: back to idle + show chat bubble (#584) ──
    this._listeners.push(
      OverlordUI.subscribe('chat:response', (data) => {
        if (data && data.agentId) {
          this._setState(data.agentId, 'idle');
          // Show a chat bubble with the first ~80 chars of the response
          if (data.content) {
            const text = typeof data.content === 'string'
              ? data.content
              : Array.isArray(data.content)
                ? data.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
                : '';
            if (text) this._showChatBubble(data.agentId, text);
          }
        }
      })
    );

    // ── Working: tool execution — track which tool for activity indicators (#583) ──
    this._listeners.push(
      OverlordUI.subscribe('tool:executed', (data) => {
        if (data && data.agentId) {
          this._setState(data.agentId, 'working', WORKING_TIMEOUT);
          this._setActivity(data.agentId, data.toolName || data.tool || 'working');
        }
      })
    );

    // ── Status change from server ──
    this._listeners.push(
      OverlordUI.subscribe('agent:status-changed', (data) => {
        if (!data || !data.agentId) return;
        const statusMap = {
          active: 'idle',
          working: 'working',
          paused: 'waiting',
          idle: 'idle',
          error: 'error'
        };
        const animState = statusMap[data.status] || 'idle';
        this._setState(data.agentId, animState);
      })
    );

    // ── Room enter: active ──
    this._listeners.push(
      OverlordUI.subscribe('room:agent:entered', (data) => {
        if (data && data.agentId) {
          this._setState(data.agentId, 'idle');
        }
      })
    );

    // ── Room exit: clear state ──
    this._listeners.push(
      OverlordUI.subscribe('room:agent:exited', (data) => {
        if (data && data.agentId) {
          this._clearState(data.agentId);
        }
      })
    );

    // ── Error events ──
    this._listeners.push(
      OverlordUI.subscribe('agent:error', (data) => {
        if (data && data.agentId) {
          this._setState(data.agentId, 'error');
        }
      })
    );
  }

  unmount() {
    this._mounted = false;
    // Clear all timers
    for (const [, entry] of this._agentStates) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this._agentStates.clear();
    this._listeners.forEach(fn => fn());
    this._listeners = [];
  }

  // ── State Management ──────────────────────────────────────

  /**
   * Set animation state for an agent.
   * @param {string} agentId
   * @param {string} state - One of ACTIVITY_STATES
   * @param {number} [autoResetMs] - Auto-reset to idle after N ms
   */
  _setState(agentId, state, autoResetMs) {
    const existing = this._agentStates.get(agentId);
    if (existing && existing.timer) {
      clearTimeout(existing.timer);
    }

    let timer = null;
    if (autoResetMs && state !== 'idle') {
      timer = setTimeout(() => {
        this._setState(agentId, 'idle');
      }, autoResetMs);
    }

    this._agentStates.set(agentId, { state, timer });
    this._applyClasses(agentId, state);
  }

  _clearState(agentId) {
    const existing = this._agentStates.get(agentId);
    if (existing && existing.timer) {
      clearTimeout(existing.timer);
    }
    this._agentStates.delete(agentId);
    this._removeAllClasses(agentId);
  }

  /**
   * Get current animation state for an agent.
   * @param {string} agentId
   * @returns {string|null}
   */
  getState(agentId) {
    const entry = this._agentStates.get(agentId);
    return entry ? entry.state : null;
  }

  /** Tool name → activity icon + label mapping (#583) */
  static ACTIVITY_ICONS = {
    read_file:     { icon: '\u{1F4C4}', label: 'Reading' },
    write_file:    { icon: '\u270F\uFE0F', label: 'Writing' },
    copy_file:     { icon: '\u{1F4CB}', label: 'Copying' },
    patch_file:    { icon: '\u270F\uFE0F', label: 'Editing' },
    list_dir:      { icon: '\u{1F4C2}', label: 'Browsing' },
    bash:          { icon: '\u{1F4BB}', label: 'Running' },
    web_search:    { icon: '\u{1F50D}', label: 'Searching' },
    fetch_webpage: { icon: '\u{1F310}', label: 'Fetching' },
    chat:          { icon: '\u{1F4AC}', label: 'Chatting' },
    session_note:  { icon: '\u{1F4DD}', label: 'Noting' },
    game_engine:   { icon: '\u{1F3AE}', label: 'Building' },
    dev_server:    { icon: '\u{1F680}', label: 'Serving' },
    working:       { icon: '\u{1F9E0}', label: 'Thinking' },
  };

  /**
   * Set the current activity indicator on agent cards (#583).
   * Shows a small icon + label overlay.
   */
  _setActivity(agentId, toolName) {
    const info = AgentActivityTracker.ACTIVITY_ICONS[toolName]
      || { icon: '\u2699\uFE0F', label: toolName.replace(/_/g, ' ') };

    const elements = document.querySelectorAll(`[data-agent-id="${agentId}"]`);
    for (const el of elements) {
      // Find or create the activity badge
      let badge = el.querySelector('.agent-activity-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'agent-activity-badge';
        // Insert after the avatar
        const avatar = el.querySelector('.agents-view-card-avatar, .agents-view-avatar-sm');
        if (avatar) {
          avatar.parentElement?.insertBefore(badge, avatar.nextSibling);
        } else {
          el.appendChild(badge);
        }
      }
      badge.textContent = `${info.icon} ${info.label}`;
      badge.style.display = 'inline-flex';
    }

    // Clear previous timer and set new auto-hide (prevents flicker from rapid tool calls)
    const prevTimer = this._activityTimers.get(agentId);
    if (prevTimer) clearTimeout(prevTimer);
    this._activityTimers.set(agentId, setTimeout(() => {
      const elements2 = document.querySelectorAll(`[data-agent-id="${agentId}"] .agent-activity-badge`);
      for (const b of elements2) b.style.display = 'none';
      this._activityTimers.delete(agentId);
    }, WORKING_TIMEOUT));
  }

  /**
   * Show a chat bubble on agent cards with a message preview (#584).
   */
  _showChatBubble(agentId, text) {
    const preview = text.length > 80 ? text.slice(0, 77) + '...' : text;
    const elements = document.querySelectorAll(`[data-agent-id="${agentId}"]`);

    for (const el of elements) {
      // Remove existing bubble
      const old = el.querySelector('.agent-chat-bubble');
      if (old) old.remove();

      const bubble = document.createElement('div');
      bubble.className = 'agent-chat-bubble';
      bubble.textContent = `\u{1F4AC} ${preview}`;
      el.appendChild(bubble);

      // Auto-remove after 8 seconds
      setTimeout(() => bubble.remove(), 8000);
    }
  }

  // ── DOM Class Application ─────────────────────────────────

  _applyClasses(agentId, state) {
    // Find all elements with this agent's data attribute
    const elements = document.querySelectorAll(`[data-agent-id="${agentId}"]`);
    for (const el of elements) {
      // Remove all activity classes
      for (const s of ACTIVITY_STATES) {
        el.classList.remove(`${ACTIVITY_CLASS_PREFIX}${s}`);
      }
      // Add the new state class
      el.classList.add(`${ACTIVITY_CLASS_PREFIX}${state}`);

      // Also apply to the avatar within the element (if it exists)
      const avatar = el.querySelector('.agents-view-card-avatar');
      if (avatar) {
        for (const s of ACTIVITY_STATES) {
          avatar.classList.remove(`${ACTIVITY_CLASS_PREFIX}${s}`);
        }
        avatar.classList.add(`${ACTIVITY_CLASS_PREFIX}${state}`);
      }

      // Apply to the status dot
      const dot = el.querySelector('.agents-view-status-dot');
      if (dot) {
        for (const s of ACTIVITY_STATES) {
          dot.classList.remove(`${ACTIVITY_CLASS_PREFIX}${s}`);
        }
        dot.classList.add(`${ACTIVITY_CLASS_PREFIX}${state}`);
      }
    }
  }

  _removeAllClasses(agentId) {
    const elements = document.querySelectorAll(`[data-agent-id="${agentId}"]`);
    for (const el of elements) {
      for (const s of ACTIVITY_STATES) {
        el.classList.remove(`${ACTIVITY_CLASS_PREFIX}${s}`);
      }
      const avatar = el.querySelector('.agents-view-card-avatar');
      if (avatar) {
        for (const s of ACTIVITY_STATES) {
          avatar.classList.remove(`${ACTIVITY_CLASS_PREFIX}${s}`);
        }
      }
      const dot = el.querySelector('.agents-view-status-dot');
      if (dot) {
        for (const s of ACTIVITY_STATES) {
          dot.classList.remove(`${ACTIVITY_CLASS_PREFIX}${s}`);
        }
      }
    }
  }
}
