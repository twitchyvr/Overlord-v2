/**
 * Overlord v2 — Chat View
 *
 * Main conversational interface with streaming messages,
 * token-based input (/, @, #), plan approval, and
 * thinking bubble visualization.
 *
 * Lives in #center-panel as the default view.
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, setTrustedContent, escapeHtml, formatTime, debounce } from '../engine/helpers.js';
import { TokenInput } from '../components/token-input.js';
import { Table } from '../components/table.js';


/**
 * Fuzzy-match scorer.  Returns a score ≥ 0 if needle matches haystack,
 * or -1 if it doesn't.  Higher scores = better match.
 *
 * Scoring:
 *   +10  exact match (haystack === needle)
 *   +5   prefix match (haystack starts with needle)
 *   +3   consecutive character run bonus (per consecutive char after first)
 *   +1   per matched character
 *   -0   characters that aren't matched don't penalize (they just don't add)
 */
function fuzzyScore(needle, haystack) {
  if (!needle) return 1;                    // empty query matches everything
  const n = needle.toLowerCase();
  const h2 = haystack.toLowerCase();
  if (h2 === n) return 100;                 // exact
  if (h2.startsWith(n)) return 50 + n.length; // prefix

  let score = 0;
  let hi = 0;
  let consecutive = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni];
    let found = false;
    while (hi < h2.length) {
      if (h2[hi] === ch) {
        score += 1 + (consecutive > 0 ? 3 : 0);
        consecutive++;
        hi++;
        found = true;
        break;
      }
      consecutive = 0;
      hi++;
    }
    if (!found) return -1;                  // needle char not in haystack
  }
  return score;
}

/**
 * Filter + rank an array of suggestion objects by fuzzy match.
 * Each object must have a `label` string.
 * Optionally matches against `description` as a secondary signal.
 */
function fuzzyFilter(items, query, labelKey = 'label') {
  if (!query) return items;
  const scored = [];
  for (const item of items) {
    let best = fuzzyScore(query, item[labelKey] || '');
    // Also check aliases (commands) or description as fallback
    if (best < 0 && item.aliases) {
      for (const alias of item.aliases) {
        const s = fuzzyScore(query, alias);
        if (s > best) best = s;
      }
    }
    if (best < 0 && item.description) {
      const ds = fuzzyScore(query, item.description);
      if (ds >= 0) best = Math.max(0, ds - 5);  // description match scored lower
    }
    if (best >= 0) scored.push({ item, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.item);
}


export class ChatView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._messagesEl = null;
    this._tokenInput = null;
    this._scrollLocked = true;   // auto-scroll when at bottom
    this._streamingMessage = null; // element being streamed into
    this._streamBuffer = '';      // accumulated stream text
    this._renderedCount = 0;     // tracks how many messages are in DOM
    this._lastRenderedId = null;  // last message id for incremental detection

    // Token suggestion caches (populated on first fetch, cleared on reconnect)
    this._cmdCache = null;
    this._agentCache = null;
    this._refCache = null;

    // Debounced trigger handler (150 ms)
    this._debouncedTrigger = debounce((type, query) => {
      this._resolveTokenSuggestions(type, query);
    }, 150);
  }

  mount() {
    this._mounted = true;
    this._render();

    const store = OverlordUI.getStore();
    if (!store) return;

    // Subscribe to chat messages
    this.subscribe(store, 'chat.messages', (messages) => {
      this._renderMessages(messages || []);
    });

    // Listen for streaming events
    this._listeners.push(
      OverlordUI.subscribe('chat:stream-start', (data) => {
        this._handleStreamStart(data);
      }),
      OverlordUI.subscribe('chat:stream-chunk', (data) => {
        this._handleStreamChunk(data);
      }),
      OverlordUI.subscribe('chat:stream-end', (data) => {
        this._handleStreamEnd(data);
      }),
      OverlordUI.subscribe('chat:response', (data) => {
        this._handleResponse(data);
      })
    );

    // Invalidate suggestion caches when underlying data changes
    this.subscribe(store, 'commands.list', () => { this._cmdCache = null; });
    this.subscribe(store, 'agents.list', () => { this._agentCache = null; });
    this.subscribe(store, 'rooms.list', () => { this._refCache = null; });
    this.subscribe(store, 'raid.entries', () => { this._refCache = null; });

    // Hydrate from store — messages may have arrived before this view mounted
    const existingMessages = store.get('chat.messages');
    if (existingMessages && existingMessages.length > 0) {
      this._renderMessages(existingMessages);
    }
  }

  _render() {
    this.el.textContent = '';
    this.el.className = 'chat-view';

    // Chat header
    const header = h('div', { class: 'chat-header' },
      h('div', { class: 'chat-header-left' },
        h('button', {
          class: 'btn btn-ghost btn-sm chat-conversations-btn',
          title: 'Conversations',
          onClick: () => this._toggleConversations()
        }, '\u{1F4AC}'),
        h('span', { class: 'chat-header-title' }, 'Chat')
      ),
      h('div', { class: 'chat-header-actions' },
        h('button', {
          class: 'btn btn-ghost btn-sm',
          title: 'New conversation',
          onClick: () => this._newConversation()
        }, '+ New'),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          title: 'Clear chat',
          onClick: () => this._clearChat()
        }, 'Clear')
      )
    );
    this.el.appendChild(header);

    // Conversations sidebar (hidden by default)
    this._conversationsEl = h('div', { class: 'chat-conversations', hidden: true });
    this.el.appendChild(this._conversationsEl);

    // Messages area
    this._messagesEl = h('div', { class: 'chat-messages' });
    this._messagesEl.addEventListener('scroll', () => this._checkScrollLock());
    this.el.appendChild(this._messagesEl);

    // Scroll-to-bottom button
    this._scrollBtn = h('button', {
      class: 'chat-scroll-btn',
      style: { display: 'none' },
      onClick: () => this._scrollToBottom()
    }, '\u25BC');
    this.el.appendChild(this._scrollBtn);

    // Token input
    const inputContainer = h('div', { class: 'chat-input-container' });
    this._tokenInput = new TokenInput(inputContainer, {
      placeholder: 'Message Overlord... (/ for commands, @ to mention)',
      onSubmit: (text, tokens) => this._sendMessage(text, tokens),
      onTokenTrigger: (type, query) => this._handleTokenTrigger(type, query)
    });
    this._tokenInput.mount();
    this.el.appendChild(inputContainer);
  }

  /**
   * Render the message list.
   *
   * Uses incremental append when new messages arrive to preserve scroll
   * position for users reading history.  Falls back to full re-render
   * only when the message set diverges (clear, reload, etc.).
   */
  _renderMessages(messages) {
    if (!this._messagesEl) return;

    if (messages.length === 0) {
      this._messagesEl.textContent = '';
      this._messagesEl.appendChild(this._renderEmptyChat());
      this._renderedCount = 0;
      return;
    }

    // Detect if we can incrementally append (messages grew at the end)
    const prevCount = this._renderedCount || 0;
    const canAppend = prevCount > 0
      && messages.length > prevCount
      && this._lastRenderedId === (messages[prevCount - 1]?.id || prevCount - 1);

    if (canAppend) {
      // Remove empty state if present
      const emptyState = this._messagesEl.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      // Append only the new messages
      const frag = document.createDocumentFragment();
      for (let i = prevCount; i < messages.length; i++) {
        frag.appendChild(this._createMessageEl(messages[i]));
      }
      this._messagesEl.appendChild(frag);
    } else {
      // Full re-render — save and restore scroll position if user scrolled up
      const savedScroll = this._scrollLocked ? null : this._messagesEl.scrollTop;

      this._messagesEl.textContent = '';
      const frag = document.createDocumentFragment();
      for (const msg of messages) {
        frag.appendChild(this._createMessageEl(msg));
      }
      this._messagesEl.appendChild(frag);

      if (savedScroll !== null) {
        this._messagesEl.scrollTop = savedScroll;
      }
    }

    this._renderedCount = messages.length;
    this._lastRenderedId = messages[messages.length - 1]?.id || messages.length - 1;

    if (this._scrollLocked) this._scrollToBottom();
  }

  /** Create a single message element. */
  _createMessageEl(msg) {
    const role = msg.role || 'system';
    const el = h('div', {
      class: `chat-message chat-message-${role}`,
      'data-message-id': msg.id || ''
    });

    // Avatar/role indicator
    const avatar = h('div', { class: 'chat-message-avatar' },
      role === 'user' ? 'U' :
      role === 'assistant' ? 'A' :
      role === 'agent' ? (msg.agentName || 'AG')[0].toUpperCase() :
      'S'
    );
    el.appendChild(avatar);

    // Message content wrapper
    const contentWrap = h('div', { class: 'chat-message-content-wrap' });

    // Sender name + timestamp
    const meta = h('div', { class: 'chat-message-meta' },
      h('span', { class: 'chat-message-sender' },
        msg.agentName || (role === 'user' ? 'You' : role === 'assistant' ? 'Overlord' : 'System')
      ),
      msg.timestamp ? h('span', { class: 'chat-message-time' }, formatTime(msg.timestamp)) : null
    );
    contentWrap.appendChild(meta);

    // Message content
    const content = h('div', { class: 'chat-message-content' });

    if (msg.content) {
      // Render markdown if marked is available
      if (typeof marked !== 'undefined' && this._looksLikeMarkdown(msg.content)) {
        const text = this._wrapJsonBlocks(msg.content);
        const parsed = marked.parse(text, { breaks: true, gfm: true });
        setTrustedContent(content, parsed);
        Table.styleMarkdownTables(content);
      } else {
        content.textContent = msg.content;
      }
    }
    contentWrap.appendChild(content);

    // Thinking indicator (if present)
    if (msg.thinking) {
      const thinkingEl = this._buildThinkingBubble(msg.thinking);
      contentWrap.appendChild(thinkingEl);
    }

    // Tool calls (if present)
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const toolsEl = h('div', { class: 'chat-tool-calls' });
      for (const tc of msg.toolCalls) {
        toolsEl.appendChild(this._buildToolChip(tc));
      }
      contentWrap.appendChild(toolsEl);
    }

    // Message actions
    const actions = this._buildMessageActions(msg);
    contentWrap.appendChild(actions);

    el.appendChild(contentWrap);
    return el;
  }

  /** Build a thinking bubble. */
  _buildThinkingBubble(thinking) {
    const bubble = h('div', { class: 'thinking-bubble' });
    const toggle = h('div', { class: 'thinking-bubble-toggle' },
      h('span', { class: 'thinking-bubble-icon' }, '\u{1F4AD}'),
      h('span', null, 'Thinking'),
      h('span', { class: 'thinking-bubble-chevron' }, '\u25B6')
    );

    const body = h('div', { class: 'thinking-bubble-body', style: { display: 'none' } });
    body.textContent = typeof thinking === 'string' ? thinking : JSON.stringify(thinking, null, 2);

    toggle.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      toggle.querySelector('.thinking-bubble-chevron').textContent = isOpen ? '\u25B6' : '\u25BC';
    });

    bubble.appendChild(toggle);
    bubble.appendChild(body);
    return bubble;
  }

  /** Build a tool call chip. */
  _buildToolChip(toolCall) {
    const chip = h('div', { class: 'tool-chip' },
      h('span', { class: 'tool-chip-name' }, toolCall.name || toolCall.tool),
      toolCall.status ? h('span', {
        class: `tool-chip-status tool-chip-${toolCall.status}`
      }, toolCall.status) : null
    );

    if (toolCall.input) {
      const paramText = typeof toolCall.input === 'object'
        ? Object.keys(toolCall.input).join(', ')
        : String(toolCall.input);
      chip.appendChild(h('span', { class: 'tool-chip-params' }, paramText));
    }

    return chip;
  }

  /** Build message action buttons. */
  _buildMessageActions(msg) {
    const actions = h('div', { class: 'chat-message-actions' });

    // Copy button
    const copyBtn = h('button', {
      class: 'chat-action-btn',
      title: 'Copy',
      onClick: () => {
        navigator.clipboard.writeText(msg.content || '').catch(() => {});
      }
    }, '\u{1F4CB}');
    actions.appendChild(copyBtn);

    return actions;
  }

  _renderEmptyChat() {
    return h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-icon' }, '\u{1F4AC}'),
      h('p', { class: 'empty-state-title' }, 'Start a Conversation'),
      h('p', { class: 'empty-state-text' }, 'Send a message to begin working with your agents. Use / for commands, @ to mention agents.')
    );
  }

  // ── Stream Handling ──────────────────────────────────────────

  _handleStreamStart(data) {
    this._streamBuffer = '';
    const el = h('div', {
      class: 'chat-message chat-message-assistant streaming',
      'data-message-id': data.messageId || ''
    });

    const avatar = h('div', { class: 'chat-message-avatar' }, 'A');
    const contentWrap = h('div', { class: 'chat-message-content-wrap' });
    const meta = h('div', { class: 'chat-message-meta' },
      h('span', { class: 'chat-message-sender' }, data.agentName || 'Overlord'),
      h('span', { class: 'chat-message-time' }, formatTime(new Date()))
    );
    const content = h('div', { class: 'chat-message-content' },
      h('span', { class: 'stream-cursor' }, '\u2588')
    );

    contentWrap.appendChild(meta);
    contentWrap.appendChild(content);
    el.appendChild(avatar);
    el.appendChild(contentWrap);

    this._streamingMessage = el;
    this._messagesEl.appendChild(el);
    if (this._scrollLocked) this._scrollToBottom();
  }

  _handleStreamChunk(data) {
    if (!this._streamingMessage) return;
    this._streamBuffer += data.text || data.content || '';

    const content = this._streamingMessage.querySelector('.chat-message-content');
    if (!content) return;

    // Render partial markdown
    if (typeof marked !== 'undefined') {
      const parsed = marked.parse(this._streamBuffer, { breaks: true, gfm: true });
      setTrustedContent(content, parsed);
      Table.styleMarkdownTables(content);
    } else {
      content.textContent = this._streamBuffer;
    }

    // Re-add cursor
    content.appendChild(h('span', { class: 'stream-cursor' }, '\u2588'));

    if (this._scrollLocked) this._scrollToBottom();
  }

  _handleStreamEnd(data) {
    if (!this._streamingMessage) return;
    this._streamingMessage.classList.remove('streaming');

    // Remove cursor
    const cursor = this._streamingMessage.querySelector('.stream-cursor');
    if (cursor) cursor.remove();

    // Final render
    const content = this._streamingMessage.querySelector('.chat-message-content');
    if (content && this._streamBuffer) {
      if (typeof marked !== 'undefined') {
        const parsed = marked.parse(this._streamBuffer, { breaks: true, gfm: true });
        setTrustedContent(content, parsed);
        Table.styleMarkdownTables(content);
      } else {
        content.textContent = this._streamBuffer;
      }
    }

    this._streamingMessage = null;
    this._streamBuffer = '';
  }

  _handleResponse(data) {
    // Socket bridge already adds to chat.messages store — this handler
    // is for rendering non-streaming responses that bypass the stream flow
    // (e.g., error responses or responses when streaming wasn't active).
    // The store subscription in mount() handles re-rendering.
    if (data.type === 'error' && data.error) {
      const store = OverlordUI.getStore();
      if (!store) return;
      store.update('chat.messages', messages => {
        return [...(messages || []), {
          id: Date.now().toString(),
          role: 'system',
          content: `Error: ${data.error.message || data.error.code || 'Unknown error'}`,
          type: 'error',
          timestamp: new Date().toISOString(),
        }];
      });
    }
  }

  // ── Token Handling ───────────────────────────────────────────

  /**
   * Called by TokenInput on every keystroke after a trigger char.
   * Delegates to the debounced resolver so rapid typing doesn't
   * fire excessive server fetches.
   */
  _handleTokenTrigger(type, query) {
    this._debouncedTrigger(type, query);
  }

  /**
   * Resolve suggestions for a token trigger.
   *
   * Strategy per type:
   *   1. On first invocation, fetch from server and cache.
   *   2. On subsequent invocations, filter the cache with fuzzy matching.
   *   3. If the server returns empty, fall back to a static list.
   */
  async _resolveTokenSuggestions(type, query) {
    const store = OverlordUI.getStore();
    if (!store || !this._tokenInput) return;

    let suggestions = [];

    if (type === 'command') {
      // ── Fetch + cache commands ──────────────────────────
      if (!this._cmdCache) {
        let commands = store.get('commands.list');
        if (!commands && window.overlordSocket) {
          await window.overlordSocket.fetchCommands();
          commands = store.get('commands.list');
        }

        if (commands && commands.length > 0) {
          this._cmdCache = commands.map(c => ({
            id: c.id || c.name,
            label: c.name,
            description: c.description || '',
            aliases: c.aliases || [],
            icon: this._commandIcon(c.name)
          }));
        } else {
          // Static fallback
          this._cmdCache = [
            { id: 'help',    label: 'help',    description: 'Show available commands',  icon: '\u2753' },
            { id: 'status',  label: 'status',  description: 'Show project status',      icon: '\u{1F4CA}' },
            { id: 'phase',   label: 'phase',   description: 'Show current phase info',  icon: '\u{1F3AF}' },
            { id: 'agents',  label: 'agents',  description: 'List all agents',          icon: '\u{1F916}' },
            { id: 'raid',    label: 'raid',    description: 'Show RAID log summary',    icon: '\u26A0\uFE0F' },
            { id: 'rooms',   label: 'rooms',   description: 'List active rooms',        icon: '\u{1F3E0}' },
            { id: 'deploy',  label: 'deploy',  description: 'Start deploy phase',       icon: '\u{1F680}' },
            { id: 'review',  label: 'review',  description: 'Start review phase',       icon: '\u{1F50D}' },
            { id: 'build',   label: 'build',   description: 'Start build process',      icon: '\u{1F528}' },
            { id: 'test',    label: 'test',     description: 'Run tests',               icon: '\u2705' }
          ];
        }
      }
      suggestions = fuzzyFilter(this._cmdCache, query);

    } else if (type === 'agent') {
      // ── Fetch + cache agents ────────────────────────────
      if (!this._agentCache) {
        const agents = store.get('agents.list') || [];
        this._agentCache = agents.map(a => ({
          id: a.id,
          label: a.name || a.id,
          description: a.role || a.specialization || '',
          icon: this._agentIcon(a)
        }));
        // If store was empty, try to trigger a fetch for next time
        if (this._agentCache.length === 0 && window.overlordSocket && window.overlordSocket.fetchAgents) {
          window.overlordSocket.fetchAgents();
          // Don't await — the cache will repopulate on next trigger
          this._agentCache = null;
        }
      }
      suggestions = fuzzyFilter(this._agentCache || [], query);

      // Graceful fallback if still empty
      if (suggestions.length === 0 && !query) {
        suggestions = [{ id: '_no_agents', label: 'No agents loaded', description: 'Start a project to spawn agents', icon: '\u{1F916}' }];
      }

    } else if (type === 'reference') {
      // ── Fetch + cache references ────────────────────────
      if (!this._refCache) {
        const rooms = store.get('rooms.list') || [];
        const raidEntries = store.get('raid.entries') || [];

        this._refCache = [
          // Rooms
          ...rooms.map(r => ({
            id: r.id,
            label: r.name || r.type,
            description: `Room: ${r.type}`,
            icon: '\u{1F3E0}'
          })),
          // RAID entries
          ...raidEntries.slice(0, 20).map(e => ({
            id: e.id,
            label: e.id,
            description: `${e.type}: ${e.title || e.summary || ''}`,
            icon: '\u26A0\uFE0F'
          })),
          // Static references
          { id: 'raid-log', label: 'raid-log', description: 'RAID Log', icon: '\u{1F4D3}' }
        ];
      }
      suggestions = fuzzyFilter(this._refCache, query);
    }

    this._tokenInput.setSuggestions(suggestions);
  }

  /** Map a command name to a contextual icon. */
  _commandIcon(name) {
    const map = {
      help: '\u2753', status: '\u{1F4CA}', phase: '\u{1F3AF}',
      agents: '\u{1F916}', raid: '\u26A0\uFE0F', rooms: '\u{1F3E0}',
      deploy: '\u{1F680}', review: '\u{1F50D}', build: '\u{1F528}',
      test: '\u2705', config: '\u2699\uFE0F', clear: '\u{1F9F9}',
      history: '\u{1F4DC}', export: '\u{1F4E4}', import: '\u{1F4E5}'
    };
    return map[name] || '\u{1F4BB}';
  }

  /** Choose an icon for an agent based on role/specialization. */
  _agentIcon(agent) {
    const role = (agent.role || agent.specialization || '').toLowerCase();
    if (role.includes('architect'))  return '\u{1F3D7}\uFE0F';
    if (role.includes('strateg'))   return '\u{1F9E0}';
    if (role.includes('code') || role.includes('develop')) return '\u{1F4BB}';
    if (role.includes('test') || role.includes('qa'))      return '\u{1F9EA}';
    if (role.includes('deploy') || role.includes('ops'))   return '\u{1F680}';
    if (role.includes('design') || role.includes('ux'))    return '\u{1F3A8}';
    if (role.includes('security'))  return '\u{1F6E1}\uFE0F';
    if (role.includes('review'))    return '\u{1F50D}';
    return '\u{1F916}';
  }

  /** Invalidate suggestion caches (call on reconnect or data refresh). */
  invalidateSuggestionCaches() {
    this._cmdCache = null;
    this._agentCache = null;
    this._refCache = null;
  }

  // ── Send ─────────────────────────────────────────────────────

  _sendMessage(text, tokens) {
    if (!text.trim() && tokens.length === 0) return;

    // Send via socket — the socket bridge handles adding the user message
    // to the store, so we don't duplicate it here
    if (window.overlordSocket) {
      const store = OverlordUI.getStore();
      window.overlordSocket.sendMessage({
        text,
        tokens,
        buildingId: store?.get('building.active'),
      });
    }
  }

  _clearChat() {
    const store = OverlordUI.getStore();
    if (store) store.set('chat.messages', []);
  }

  // ── Scroll ───────────────────────────────────────────────────

  _checkScrollLock() {
    if (!this._messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = this._messagesEl;
    this._scrollLocked = scrollHeight - scrollTop - clientHeight < 150;
    if (this._scrollBtn) {
      this._scrollBtn.style.display = this._scrollLocked ? 'none' : '';
    }
  }

  _scrollToBottom() {
    if (!this._messagesEl) return;
    requestAnimationFrame(() => {
      this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    });
  }

  _looksLikeMarkdown(text) {
    return /[*_`#\[\]|>-]/.test(text) || text.includes('\n');
  }

  /**
   * Detect bare JSON blocks in message text and wrap them in markdown
   * code fences so marked renders them as formatted code blocks.
   * Handles: entire message is JSON, or JSON embedded between prose.
   */
  _wrapJsonBlocks(text) {
    const trimmed = text.trim();

    // Entire message is a single JSON value
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const obj = JSON.parse(trimmed);
        return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
      } catch { /* not valid JSON — continue */ }
    }

    // Look for JSON objects/arrays embedded between text.
    // Match lines starting with { or [ that form valid JSON spanning multiple lines.
    return text.replace(
      /^(\{[\s\S]*?\n\}|\[[\s\S]*?\n\])/gm,
      (match) => {
        try {
          const obj = JSON.parse(match);
          return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
        } catch {
          return match;
        }
      }
    );
  }

  // ── Conversations ──────────────────────────────────────────

  _toggleConversations() {
    if (!this._conversationsEl) return;
    const showing = !this._conversationsEl.hidden;
    this._conversationsEl.hidden = showing;
    if (!showing) this._fetchConversations();
  }

  async _fetchConversations() {
    if (!window.overlordSocket) return;
    await window.overlordSocket.fetchConversations();
    this._renderConversations();
  }

  _renderConversations() {
    if (!this._conversationsEl) return;
    const store = OverlordUI.getStore();
    const conversations = store?.get('conversations.list') || [];
    const activeThread = store?.get('conversations.active') || '';

    this._conversationsEl.textContent = '';

    const header = h('div', { class: 'chat-conv-header' },
      h('span', null, 'Conversations'),
      h('button', {
        class: 'btn btn-ghost btn-xs',
        onClick: () => this._newConversation()
      }, '+ New')
    );
    this._conversationsEl.appendChild(header);

    if (conversations.length === 0) {
      this._conversationsEl.appendChild(
        h('div', { class: 'chat-conv-empty' }, 'No conversations yet. Start chatting!')
      );
      return;
    }

    const list = h('div', { class: 'chat-conv-list' });
    for (const conv of conversations) {
      const isActive = conv.threadId === activeThread;
      const item = h('div', {
        class: `chat-conv-item${isActive ? ' active' : ''}`,
        onClick: () => this._loadConversation(conv.threadId)
      },
        h('div', { class: 'chat-conv-title' }, conv.title || 'Untitled'),
        h('div', { class: 'chat-conv-meta' },
          h('span', null, `${conv.messageCount} msgs`),
          h('span', null, conv.lastMessageAt ? formatTime(new Date(conv.lastMessageAt).getTime()) : '')
        ),
        h('button', {
          class: 'chat-conv-delete',
          title: 'Delete conversation',
          onClick: (e) => { e.stopPropagation(); this._deleteConversation(conv.threadId); }
        }, '\u00D7')
      );
      list.appendChild(item);
    }
    this._conversationsEl.appendChild(list);
  }

  async _loadConversation(threadId) {
    if (!window.overlordSocket) return;
    await window.overlordSocket.loadConversation(threadId);
    this._conversationsEl.hidden = true;
    this._renderedCount = 0;
    this._lastRenderedId = null;
  }

  async _newConversation() {
    if (!window.overlordSocket) return;
    await window.overlordSocket.createConversation('');
    this._renderedCount = 0;
    this._lastRenderedId = null;
    if (this._conversationsEl) this._conversationsEl.hidden = true;
  }

  async _deleteConversation(threadId) {
    if (!window.overlordSocket) return;
    await window.overlordSocket.deleteConversation(threadId);
    this._renderConversations();
  }
}
