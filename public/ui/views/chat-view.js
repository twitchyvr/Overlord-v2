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
import { h, setTrustedContent, escapeHtml, formatTime } from '../engine/helpers.js';
import { TokenInput } from '../components/token-input.js';
import { Table } from '../components/table.js';


export class ChatView extends Component {

  constructor(el, opts = {}) {
    super(el, opts);
    this._messagesEl = null;
    this._tokenInput = null;
    this._scrollLocked = true;   // auto-scroll when at bottom
    this._streamingMessage = null; // element being streamed into
    this._streamBuffer = '';      // accumulated stream text
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
  }

  _render() {
    this.el.textContent = '';
    this.el.className = 'chat-view';

    // Chat header
    const header = h('div', { class: 'chat-header' },
      h('span', { class: 'chat-header-title' }, 'Chat'),
      h('div', { class: 'chat-header-actions' },
        h('button', {
          class: 'btn btn-ghost btn-sm',
          title: 'Clear chat',
          onClick: () => this._clearChat()
        }, 'Clear')
      )
    );
    this.el.appendChild(header);

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

  /** Render the message list. */
  _renderMessages(messages) {
    if (!this._messagesEl) return;
    this._messagesEl.textContent = '';

    if (messages.length === 0) {
      this._messagesEl.appendChild(this._renderEmptyChat());
      return;
    }

    const frag = document.createDocumentFragment();
    for (const msg of messages) {
      frag.appendChild(this._createMessageEl(msg));
    }
    this._messagesEl.appendChild(frag);

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
        const parsed = marked.parse(msg.content, { breaks: true, gfm: true });
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
    // Non-streaming response — add as complete message
    const store = OverlordUI.getStore();
    if (!store) return;
    store.update('chat.messages', messages => {
      return [...(messages || []), {
        id: data.messageId || Date.now().toString(),
        role: data.role || 'assistant',
        content: data.content || data.message,
        agentName: data.agentName,
        timestamp: new Date().toISOString(),
        thinking: data.thinking,
        toolCalls: data.toolCalls
      }];
    });
  }

  // ── Token Handling ───────────────────────────────────────────

  _handleTokenTrigger(type, query) {
    const store = OverlordUI.getStore();
    if (!store || !this._tokenInput) return;

    let suggestions = [];

    if (type === 'command') {
      // Static command list
      const commands = [
        { id: 'help', label: 'help', description: 'Show available commands' },
        { id: 'status', label: 'status', description: 'Show project status' },
        { id: 'phase', label: 'phase', description: 'Show current phase info' },
        { id: 'agents', label: 'agents', description: 'List all agents' },
        { id: 'raid', label: 'raid', description: 'Show RAID log summary' },
        { id: 'rooms', label: 'rooms', description: 'List active rooms' },
        { id: 'deploy', label: 'deploy', description: 'Start deploy phase' },
        { id: 'review', label: 'review', description: 'Start review phase' }
      ];
      suggestions = commands.filter(c => c.label.startsWith(query.toLowerCase()));

    } else if (type === 'agent') {
      // Agent list from store
      const agents = store.get('agents.list') || [];
      suggestions = agents
        .filter(a => (a.name || '').toLowerCase().startsWith(query.toLowerCase()))
        .map(a => ({ id: a.id, label: a.name, description: a.role, icon: '\u{1F916}' }));

    } else if (type === 'reference') {
      // Room references from store
      const rooms = store.get('rooms.list') || [];
      suggestions = rooms
        .filter(r => (r.type || r.name || '').toLowerCase().startsWith(query.toLowerCase()))
        .map(r => ({ id: r.id, label: r.name || r.type, description: `Room: ${r.type}`, icon: '\u{1F3E0}' }));

      // Add RAID as a reference option
      suggestions.push({ id: 'raid-log', label: 'raid-log', description: 'RAID Log', icon: '\u26A0' });
    }

    this._tokenInput.setSuggestions(suggestions);
  }

  // ── Send ─────────────────────────────────────────────────────

  _sendMessage(text, tokens) {
    if (!text.trim() && tokens.length === 0) return;

    // Add to local messages
    const store = OverlordUI.getStore();
    if (store) {
      store.update('chat.messages', messages => {
        return [...(messages || []), {
          id: Date.now().toString(),
          role: 'user',
          content: text,
          tokens,
          timestamp: new Date().toISOString()
        }];
      });
    }

    // Send via socket
    if (window.overlordSocket) {
      window.overlordSocket.sendMessage({
        content: text,
        tokens,
        buildingId: store?.get('building.active')
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
}
