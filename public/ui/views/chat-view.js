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
import { h, setTrustedContent, escapeHtml, formatTime, debounce, linkEntities } from '../engine/helpers.js';
import { TokenInput } from '../components/token-input.js';
import { Table } from '../components/table.js';
import { Toast } from '../components/toast.js';
import { EntityLink } from '../engine/entity-nav.js';


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


/* ── Contextual suggestion definitions per room type ──────── */

const ROOM_SUGGESTIONS = {
  'strategist':           ['Start quick setup', 'Describe your project', 'Define phases'],
  'building-architect':   ['Describe architecture', 'List components', 'Show blueprint'],
  'discovery':            ['Gather requirements', 'Identify risks', 'List stakeholders'],
  'architecture':         ['Design system', 'Break down tasks', 'Review structure'],
  'code-lab':             ['Run tests', 'List files', 'Check build'],
  'testing-lab':          ['Run test suite', 'Check coverage', 'Report bugs'],
  'review':               ['View exit document', 'Check test results', 'Review changes'],
  'deploy':               ['Deploy status', 'Run checks', 'View changelog'],
  'war-room':             ['Escalation status', 'Critical issues', 'Action items'],
  '_default':             ['Create task', 'Search RAID log'],
};


/* ── Friendly tool labels for non-technical users (#521) ───── */

const TOOL_LABELS = {
  'list_dir':      'Browsing files',
  'read_file':     'Reading a file',
  'write_file':    'Writing code',
  'web_search':    'Searching the web',
  'record_note':   'Taking notes',
  'recall_notes':  'Checking notes',
  'session_note':  'Saving context',
  'bash':          'Running a command',
  'fetch_webpage': 'Fetching a page',
  'patch_file':    'Updating code',
  'search_files':  'Searching files',
  'create_dir':    'Creating a folder',
  'delete_file':   'Removing a file',
  'move_file':     'Moving a file',
  'copy_file':     'Copying a file',
};


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
    this._suggestionsBarEl = null; // contextual suggestions bar

    // Per-room message history (#537)
    this._roomMessages = new Map();  // roomId -> messages[]
    this._previousRoomId = null;

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
        this._updateSuggestionsBar(); // Hide suggestions while streaming (#553)
      }),
      OverlordUI.subscribe('chat:stream-chunk', (data) => {
        this._handleStreamChunk(data);
      }),
      OverlordUI.subscribe('chat:stream-end', (data) => {
        this._handleStreamEnd(data);
        this._updateSuggestionsBar(); // Show suggestions again (#553)
      }),
      OverlordUI.subscribe('chat:response', (data) => {
        this._handleResponse(data);
        this._updateSuggestionsBar(); // Show suggestions after response (#553)
      }),
      OverlordUI.subscribe('plan:submitted', (data) => {
        this._handlePlanSubmitted(data);
      }),
      OverlordUI.subscribe('plan:reviewed', (data) => {
        this._handlePlanReviewed(data);
      })
    );

    // Invalidate suggestion caches when underlying data changes
    this.subscribe(store, 'commands.list', () => { this._cmdCache = null; });
    this.subscribe(store, 'agents.list', () => { this._agentCache = null; this._updateRoomIndicator(); });
    this.subscribe(store, 'rooms.list', () => { this._refCache = null; });
    this.subscribe(store, 'raid.entries', () => { this._refCache = null; });

    // Update chat header and suggestions when active room changes
    this.subscribe(store, 'rooms.active', (newRoomId) => {
      this._handleRoomSwitch(newRoomId);
      this._updateRoomIndicator();
      this._updateSuggestionsBar();
    });

    // Listen for room selection from building sidebar
    this._listeners.push(
      OverlordUI.subscribe('building:room-selected', () => {
        this._updateRoomIndicator();
        this._updateSuggestionsBar();
      })
    );

    // Hydrate from store — messages may have arrived before this view mounted.
    // Always call _renderMessages so the empty state is shown when no messages exist.
    const existingMessages = store.get('chat.messages') || [];
    this._renderMessages(existingMessages);
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
        h('span', { class: 'chat-header-title' }, 'Chat'),
        h('span', { class: 'chat-room-indicator', id: 'chat-room-indicator' }),
        h('span', { class: 'chat-room-agents', id: 'chat-room-agents' })
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

    // Initialize room indicator
    this._updateRoomIndicator();

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

    // Contextual suggestions bar (above input)
    this._suggestionsBarEl = this._buildSuggestionsBar();
    this.el.appendChild(this._suggestionsBarEl);

    // Token input with attachment support
    const inputContainer = h('div', { class: 'chat-input-container' });

    // Attachment preview area (above input)
    this._attachPreviewEl = h('div', { class: 'chat-attach-preview', hidden: true });
    inputContainer.appendChild(this._attachPreviewEl);
    this._pendingAttachments = [];

    // Input row: attach button + token input
    const inputRow = h('div', { class: 'chat-input-row' });

    // Attach button
    const attachBtn = h('button', {
      class: 'chat-attach-btn',
      title: 'Attach file',
      onClick: () => this._openFilePicker(),
    }, '\u{1F4CE}');
    inputRow.appendChild(attachBtn);

    // Hidden file input
    this._fileInput = h('input', {
      type: 'file',
      multiple: true,
      style: { display: 'none' },
      onChange: (e) => this._handleFileSelect(e),
    });
    inputRow.appendChild(this._fileInput);

    this._tokenInput = new TokenInput(inputRow, {
      placeholder: 'Message Overlord... (/ for commands, @ to mention)',
      onSubmit: (text, tokens) => this._sendMessage(text, tokens),
      onTokenTrigger: (type, query) => this._handleTokenTrigger(type, query)
    });
    this._tokenInput.mount();
    inputContainer.appendChild(inputRow);
    this.el.appendChild(inputContainer);

    // Drag-and-drop on the messages area
    this._messagesEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      this._messagesEl.classList.add('chat-drag-over');
    });
    this._messagesEl.addEventListener('dragleave', () => {
      this._messagesEl.classList.remove('chat-drag-over');
    });
    this._messagesEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this._messagesEl.classList.remove('chat-drag-over');
      if (e.dataTransfer?.files?.length) {
        this._addFiles(Array.from(e.dataTransfer.files));
      }
    });
  }

  /**
   * Render the message list.
   *
   * Handle room switch — preserve old messages and show divider (#537).
   */
  _handleRoomSwitch(newRoomId) {
    if (!newRoomId || newRoomId === this._previousRoomId) return;

    const store = OverlordUI.getStore();
    const currentMessages = store?.get('chat.messages') || [];

    // Save current room's messages before switching
    if (this._previousRoomId && currentMessages.length > 0) {
      this._roomMessages.set(this._previousRoomId, [...currentMessages]);
    }

    // Look up the previous room's display name
    if (this._previousRoomId && currentMessages.length > 0 && this._messagesEl) {
      const rooms = store?.get('rooms.list') || [];
      const prevRoom = rooms.find(r => r.id === this._previousRoomId);
      const roomLabel = prevRoom
        ? (prevRoom.type || prevRoom.name || 'Unknown').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : 'Previous';
      // Insert a room divider in the chat
      const divider = h('div', { class: 'chat-room-divider' },
        h('span', { class: 'chat-room-divider-line' }),
        h('span', { class: 'chat-room-divider-label' }, `Previous: ${roomLabel} Room`),
        h('span', { class: 'chat-room-divider-line' })
      );
      this._messagesEl.appendChild(divider);
    }

    this._previousRoomId = newRoomId;
  }

  /**
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

      // Remove any streaming element — the store now has the final message
      const streamingEl = this._messagesEl.querySelector('.streaming');
      if (streamingEl) {
        streamingEl.remove();
        this._streamingMessage = null;
        this._streamBuffer = '';
      }

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

    // Sender name + timestamp (agent names are clickable entity links)
    const senderEl = (role === 'agent' || role === 'assistant') && msg.agentId
      ? EntityLink.agent(msg.agentId, msg.agentName || 'Agent')
      : h('span', { class: 'chat-message-sender' },
          msg.agentName || (role === 'user' ? 'You' : role === 'assistant' ? 'Overlord' : 'System')
        );
    if (senderEl.classList && !senderEl.classList.contains('chat-message-sender')) {
      senderEl.classList.add('chat-message-sender');
    }
    const meta = h('div', { class: 'chat-message-meta' },
      senderEl,
      msg.timestamp ? h('span', { class: 'chat-message-time' }, formatTime(msg.timestamp)) : null
    );
    contentWrap.appendChild(meta);

    // Recipient badges for multicast/direct messages (#585)
    if (msg.recipients && msg.recipients.length > 0 && msg.messageMode !== 'broadcast') {
      const recipientRow = h('div', { class: 'chat-message-recipients' },
        h('span', { class: 'chat-recipient-arrow' }, '\u2192'),
      );
      for (const rid of msg.recipients) {
        const rAgent = resolveAgent(rid);
        const rName = rAgent?.display_name || rAgent?.name || rid;
        recipientRow.appendChild(h('span', { class: 'chat-recipient-badge' }, `@${rName}`));
      }
      contentWrap.appendChild(recipientRow);
    }

    // Message content — handle both string and array-of-blocks formats (#532)
    const content = h('div', { class: 'chat-message-content' });

    const rawContent = msg.content;
    let textContent = '';

    // Collect interleaved thinking blocks for inline display (#594)
    const interleavedThinking = [];

    if (Array.isArray(rawContent)) {
      // Content is an array of blocks (e.g. [{type:'text', text:'...'}, {type:'thinking',...}, {type:'tool_use',...}])
      const textBlocks = [];
      for (const block of rawContent) {
        if (block.type === 'text' && block.text) {
          textBlocks.push(block.text);
        } else if (block.type === 'thinking' && block.thinking) {
          interleavedThinking.push(block.thinking);
        }
      }
      textContent = textBlocks.join('\n');
    } else if (rawContent && typeof rawContent === 'string') {
      textContent = rawContent;
    }

    if (textContent) {
      if (typeof marked !== 'undefined' && this._looksLikeMarkdown(textContent)) {
        const text = this._formatContentBlocks(textContent);
        const parsed = marked.parse(text, { breaks: true, gfm: true });
        setTrustedContent(content, parsed);
        Table.styleMarkdownTables(content);
      } else {
        // Use entity linking for plain text messages (@agent, #123)
        const linked = linkEntities(textContent);
        content.appendChild(linked);
      }
    }
    contentWrap.appendChild(content);

    // Interleaved thinking blocks from content array (#594)
    if (interleavedThinking.length > 0) {
      for (const thought of interleavedThinking) {
        contentWrap.appendChild(this._buildThinkingBubble(thought));
      }
    }

    // Thinking indicator (if present as top-level field)
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

    // Attachments (if present)
    if (msg.attachments && msg.attachments.length > 0) {
      const attachEl = h('div', { class: 'chat-attachments' });
      for (const att of msg.attachments) {
        attachEl.appendChild(this._buildAttachmentPreview(att));
      }
      contentWrap.appendChild(attachEl);
    }

    // Plan card (if present)
    if (msg.plan) {
      contentWrap.appendChild(this._buildPlanCard(msg.plan));
    }

    // Message actions
    const actions = this._buildMessageActions(msg);
    contentWrap.appendChild(actions);

    el.appendChild(contentWrap);
    return el;
  }

  /** Build an attachment preview chip. */
  _buildAttachmentPreview(att) {
    const isImage = att.mimeType && att.mimeType.startsWith('image/');
    const el = h('div', { class: `chat-attachment ${isImage ? 'chat-attachment-image' : ''}` });

    if (isImage && att.url) {
      const img = h('img', {
        src: att.url,
        alt: att.fileName,
        class: 'chat-attachment-thumb',
        loading: 'lazy',
      });
      el.appendChild(img);
    } else {
      const icon = this._fileIcon(att.mimeType);
      el.appendChild(h('span', { class: 'chat-attachment-icon' }, icon));
    }

    const info = h('div', { class: 'chat-attachment-info' });
    info.appendChild(h('span', { class: 'chat-attachment-name' }, att.fileName || 'Unnamed'));
    info.appendChild(h('span', { class: 'chat-attachment-size' }, this._formatFileSize(att.size || 0)));
    el.appendChild(info);

    return el;
  }

  /** Map MIME type to a file icon character. */
  _fileIcon(mimeType) {
    if (!mimeType) return '\u{1F4C4}';
    if (mimeType.startsWith('image/')) return '\u{1F5BC}';
    if (mimeType.startsWith('video/')) return '\u{1F3AC}';
    if (mimeType.startsWith('audio/')) return '\u{1F3B5}';
    if (mimeType.includes('pdf')) return '\u{1F4D1}';
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) return '\u{1F4E6}';
    if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('typescript')) return '\u{1F4BB}';
    return '\u{1F4C4}';
  }

  /** Format bytes to human-readable size. */
  _formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  /** Build a plan approval card. */
  _buildPlanCard(plan) {
    const card = h('div', { class: `chat-plan-card chat-plan-${plan.status || 'pending'}` });

    // Header
    const header = h('div', { class: 'chat-plan-header' });
    const statusBadge = h('span', { class: `chat-plan-badge chat-plan-badge-${plan.status || 'pending'}` },
      (plan.status || 'pending').toUpperCase()
    );
    header.appendChild(h('span', { class: 'chat-plan-label' }, 'Plan'));
    header.appendChild(statusBadge);
    card.appendChild(header);

    // Title
    card.appendChild(h('h4', { class: 'chat-plan-title' }, plan.title || 'Untitled Plan'));

    // Rationale
    if (plan.rationale) {
      card.appendChild(h('p', { class: 'chat-plan-rationale' }, plan.rationale));
    }

    // Steps
    if (plan.steps && plan.steps.length > 0) {
      const stepsEl = h('ol', { class: 'chat-plan-steps' });
      for (const step of plan.steps) {
        const stepEl = h('li', { class: `chat-plan-step chat-plan-step-${step.status || 'pending'}` },
          step.description
        );
        stepsEl.appendChild(stepEl);
      }
      card.appendChild(stepsEl);
    }

    // Actions (only for pending plans)
    if (plan.status === 'pending' && plan.id) {
      const actions = h('div', { class: 'chat-plan-actions' });
      const approveBtn = h('button', {
        class: 'chat-plan-btn chat-plan-btn-approve',
        onClick: () => this._reviewPlan(plan.id, 'approved'),
      }, 'Approve');
      const rejectBtn = h('button', {
        class: 'chat-plan-btn chat-plan-btn-reject',
        onClick: () => this._reviewPlan(plan.id, 'rejected'),
      }, 'Reject');
      const changesBtn = h('button', {
        class: 'chat-plan-btn chat-plan-btn-changes',
        onClick: () => this._reviewPlan(plan.id, 'changes-requested'),
      }, 'Request Changes');
      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
      actions.appendChild(changesBtn);
      card.appendChild(actions);
    }

    // Review comment
    if (plan.review_comment) {
      card.appendChild(h('div', { class: 'chat-plan-review' },
        h('span', { class: 'chat-plan-reviewer' }, `${plan.reviewed_by || 'Reviewer'}: `),
        plan.review_comment
      ));
    }

    return card;
  }

  /** Send plan review verdict via socket. */
  _reviewPlan(planId, verdict) {
    if (!window.overlordSocket) return;
    window.overlordSocket.reviewPlan(planId, verdict).then((res) => {
      if (res && res.ok) {
        // Plan will be updated via plan:reviewed socket event
      }
    }).catch(() => { Toast.error('Failed to submit plan review'); });
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

  /** Build a tool call chip with friendly labels (#521). */
  _buildToolChip(toolCall) {
    const rawName = toolCall.name || toolCall.tool || '';
    const friendlyLabel = TOOL_LABELS[rawName] || rawName.replace(/_/g, ' ');

    const chip = h('div', { class: 'tool-chip' },
      h('span', { class: 'tool-chip-name' }, friendlyLabel),
      toolCall.status ? h('span', {
        class: `tool-chip-status tool-chip-${toolCall.status}`
      }, toolCall.status) : null
    );

    // Add hidden details with a toggle for advanced users
    if (toolCall.input) {
      const paramText = typeof toolCall.input === 'object'
        ? Object.keys(toolCall.input).join(', ')
        : String(toolCall.input);

      const detailsEl = h('span', {
        class: 'tool-chip-params',
        style: { display: 'none' }
      }, `${rawName}(${paramText})`);

      const toggleBtn = h('button', {
        class: 'tool-chip-toggle',
        title: 'Show details',
        onClick: (e) => {
          e.stopPropagation();
          const hidden = detailsEl.style.display === 'none';
          detailsEl.style.display = hidden ? '' : 'none';
          toggleBtn.textContent = hidden ? '\u25B4' : '\u25BE';
          toggleBtn.title = hidden ? 'Hide details' : 'Show details';
        }
      }, '\u25BE');

      chip.appendChild(toggleBtn);
      chip.appendChild(detailsEl);
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
        const copyText = Array.isArray(msg.content)
          ? msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
          : (msg.content || '');
        navigator.clipboard.writeText(copyText).catch(() => {});
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
    const streamSender = data.agentId
      ? EntityLink.agent(data.agentId, data.agentName || 'Overlord')
      : h('span', { class: 'chat-message-sender' }, data.agentName || 'Overlord');
    if (streamSender.classList && !streamSender.classList.contains('chat-message-sender')) {
      streamSender.classList.add('chat-message-sender');
    }
    const meta = h('div', { class: 'chat-message-meta' },
      streamSender,
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

    // Remove the streaming element from the DOM entirely.
    // The final message will be rendered by the store subscription
    // when chat:response adds it to chat.messages.  Keeping this
    // element around causes a duplicate because _renderMessages
    // can't find it (the .streaming class would already be removed).
    this._streamingMessage.remove();
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

  // ── Plan Event Handling ──────────────────────────────────────

  _handlePlanSubmitted(plan) {
    const store = OverlordUI.getStore();
    if (!store) return;
    // Add plan as a special message in the chat
    store.update('chat.messages', (messages) => {
      return [...(messages || []), {
        id: `plan_msg_${plan.id}`,
        role: 'agent',
        content: `Submitted a plan: **${plan.title}**`,
        agentName: 'Agent',
        plan: plan,
        type: 'plan',
        timestamp: Date.now(),
      }];
    });
  }

  _handlePlanReviewed(plan) {
    const store = OverlordUI.getStore();
    if (!store) return;
    // Update the plan in existing messages
    store.update('chat.messages', (messages) => {
      return (messages || []).map((msg) => {
        if (msg.plan && msg.plan.id === plan.id) {
          return { ...msg, plan: plan };
        }
        return msg;
      });
    });
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
    if (!text.trim() && tokens.length === 0 && this._pendingAttachments.length === 0) return;

    if (window.overlordSocket) {
      const store = OverlordUI.getStore();
      window.overlordSocket.sendMessage({
        text,
        tokens,
        attachments: this._pendingAttachments,
        buildingId: store?.get('building.active'),
        roomId: store?.get('rooms.active'),
      });
    }
    // Clear pending attachments
    this._pendingAttachments = [];
    this._updateAttachPreview();
  }

  _clearChat() {
    const store = OverlordUI.getStore();
    if (store) store.set('chat.messages', []);
  }

  /** Update the room indicator badge in the chat header. */
  _updateRoomIndicator() {
    const indicator = this.el?.querySelector('#chat-room-indicator');
    const agentsEl = this.el?.querySelector('#chat-room-agents');
    if (!indicator) return;

    const store = OverlordUI.getStore();
    const activeRoomId = store?.get('rooms.active');
    const rooms = store?.get('rooms.list') || [];
    const room = rooms.find(r => r.id === activeRoomId);

    if (room) {
      indicator.textContent = room.name || room.type || 'Unknown Room';
      indicator.title = `Chat is connected to: ${room.name || room.type} (${room.type})`;
      indicator.hidden = false;
    } else if (activeRoomId) {
      indicator.textContent = 'Room';
      indicator.title = `Active room: ${activeRoomId}`;
      indicator.hidden = false;
    } else {
      indicator.textContent = '';
      indicator.hidden = true;
    }

    // Show agents in the current room (#510)
    if (agentsEl) {
      if (activeRoomId) {
        const allAgents = store?.get('agents.list') || [];
        const roomAgents = allAgents.filter(a => a.current_room_id === activeRoomId);
        if (roomAgents.length > 0) {
          const names = roomAgents.map(a => a.display_name || a.name || 'Agent').join(', ');
          agentsEl.textContent = names;
          agentsEl.title = `Agents in this room: ${names}`;
          agentsEl.hidden = false;
        } else {
          agentsEl.textContent = '';
          agentsEl.hidden = true;
        }
      } else {
        agentsEl.textContent = '';
        agentsEl.hidden = true;
      }
    }
  }

  // ── File Attachment ─────────────────────────────────────────

  _openFilePicker() {
    if (this._fileInput) this._fileInput.click();
  }

  _handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) this._addFiles(files);
    e.target.value = '';
  }

  _addFiles(files) {
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        // Skip files over 10MB — inform user
        import('../engine/engine.js').then(({ OverlordUI }) => {
          OverlordUI.dispatch('toast:show', { message: `File "${file.name}" exceeds 10MB limit`, type: 'warning' });
        });
        continue;
      }
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        this._pendingAttachments.push({
          id,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          data: base64,
        });
        this._updateAttachPreview();
      };
      reader.readAsDataURL(file);
    }
  }

  _removeAttachment(id) {
    this._pendingAttachments = this._pendingAttachments.filter((a) => a.id !== id);
    this._updateAttachPreview();
  }

  _updateAttachPreview() {
    if (!this._attachPreviewEl) return;
    this._attachPreviewEl.textContent = '';

    if (this._pendingAttachments.length === 0) {
      this._attachPreviewEl.hidden = true;
      return;
    }

    this._attachPreviewEl.hidden = false;
    for (const att of this._pendingAttachments) {
      const chip = h('div', { class: 'chat-attach-chip' },
        h('span', { class: 'chat-attach-chip-icon' }, this._fileIcon(att.mimeType)),
        h('span', { class: 'chat-attach-chip-name' }, att.fileName),
        h('span', { class: 'chat-attach-chip-size' }, this._formatFileSize(att.size)),
        h('button', {
          class: 'chat-attach-chip-remove',
          onClick: () => this._removeAttachment(att.id),
        }, '\u00D7')
      );
      this._attachPreviewEl.appendChild(chip);
    }
  }

  // ── Contextual Suggestions ──────────────────────────────────

  /** Build the suggestions bar with context-aware pill buttons. */
  _buildSuggestionsBar() {
    const bar = h('div', { class: 'chat-suggestions-bar' });
    const pills = this._getSuggestionPills();
    for (const text of pills) {
      const pill = h('button', { class: 'chat-suggestion-pill' }, text);
      pill.addEventListener('click', () => {
        // Auto-send the suggestion instead of just filling input (#564)
        this._sendMessage(text, []);
      });
      bar.appendChild(pill);
    }
    return bar;
  }

  /** Get the current room type and return matching suggestions. */
  _getSuggestionPills() {
    const store = OverlordUI.getStore();
    const activeRoomId = store?.get('rooms.active');
    const rooms = store?.get('rooms.list') || [];
    const room = rooms.find(r => r.id === activeRoomId);
    const roomType = room?.type || '';
    return ROOM_SUGGESTIONS[roomType] || ROOM_SUGGESTIONS['_default'];
  }

  /** Rebuild the suggestions bar when room context changes. */
  _updateSuggestionsBar() {
    if (!this._suggestionsBarEl) return;
    const store = OverlordUI.getStore();
    const isProcessing = store?.get('ui.processing') || store?.get('ui.streaming');
    // Hide suggestions while agent is actively responding (#553)
    if (isProcessing) {
      this._suggestionsBarEl.style.display = 'none';
      return;
    }
    this._suggestionsBarEl.style.display = '';
    const newBar = this._buildSuggestionsBar();
    this._suggestionsBarEl.replaceWith(newBar);
    this._suggestionsBarEl = newBar;
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
   * Check if a parsed JSON object looks like an exit document (#522).
   * Exit documents contain fields like effortLevel, projectGoals, etc.
   */
  _isExitDocument(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const exitFields = ['effortLevel', 'projectGoals', 'successCriteria', 'phases', 'milestones',
      'projectName', 'deliverables', 'acceptanceCriteria', 'requirements', 'taskBreakdown'];
    const matchCount = exitFields.filter((f) => f in obj).length;
    return matchCount >= 2;
  }

  /**
   * Render an exit document as a friendly summary card (#522).
   * Returns a markdown string with a human-readable summary.
   */
  _renderExitDocumentSummary(obj) {
    const parts = [];
    const title = obj.projectName || obj.title || 'Blueprint';
    parts.push(`### ${title} ready`);

    const stats = [];
    if (obj.projectGoals) {
      const count = Array.isArray(obj.projectGoals) ? obj.projectGoals.length : 1;
      stats.push(`${count} goal${count !== 1 ? 's' : ''}`);
    }
    if (obj.successCriteria || obj.acceptanceCriteria) {
      const criteria = obj.successCriteria || obj.acceptanceCriteria;
      const count = Array.isArray(criteria) ? criteria.length : 1;
      stats.push(`${count} ${obj.successCriteria ? 'success' : 'acceptance'} criteria`);
    }
    if (obj.phases) {
      const count = Array.isArray(obj.phases) ? obj.phases.length : 1;
      stats.push(`${count} phase${count !== 1 ? 's' : ''}`);
    }
    if (obj.milestones) {
      const count = Array.isArray(obj.milestones) ? obj.milestones.length : 1;
      stats.push(`${count} milestone${count !== 1 ? 's' : ''}`);
    }
    if (obj.deliverables) {
      const count = Array.isArray(obj.deliverables) ? obj.deliverables.length : 1;
      stats.push(`${count} deliverable${count !== 1 ? 's' : ''}`);
    }
    if (obj.requirements) {
      const count = Array.isArray(obj.requirements) ? obj.requirements.length : 1;
      stats.push(`${count} requirement${count !== 1 ? 's' : ''}`);
    }
    if (obj.taskBreakdown) {
      const count = Array.isArray(obj.taskBreakdown) ? obj.taskBreakdown.length : 1;
      stats.push(`${count} task${count !== 1 ? 's' : ''}`);
    }
    if (obj.effortLevel) {
      stats.push(`effort: ${obj.effortLevel}`);
    }

    if (stats.length > 0) {
      parts.push(stats.join(' | '));
    }

    // List goals as bullet points if present
    if (Array.isArray(obj.projectGoals) && obj.projectGoals.length > 0) {
      parts.push('\n**Goals:**');
      for (const goal of obj.projectGoals.slice(0, 5)) {
        const goalText = typeof goal === 'string' ? goal : (goal.description || goal.name || JSON.stringify(goal));
        parts.push(`- ${goalText}`);
      }
    }

    // List phases if present
    if (Array.isArray(obj.phases) && obj.phases.length > 0) {
      parts.push('\n**Phases:**');
      for (const phase of obj.phases.slice(0, 6)) {
        const phaseText = typeof phase === 'string' ? phase : (phase.name || phase.title || JSON.stringify(phase));
        parts.push(`- ${phaseText}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Format message content: detect exit documents and wrap bare JSON blocks
   * in markdown code fences so marked renders them as formatted blocks.
   * Handles: exit documents (#522), entire-message JSON, embedded JSON,
   * and JSON already wrapped in code fences.
   */
  _formatContentBlocks(text) {
    const trimmed = text.trim();

    // Entire message is a single JSON value
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const obj = JSON.parse(trimmed);
        if (this._isExitDocument(obj)) {
          return this._renderExitDocumentSummary(obj);
        }
        return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
      } catch { /* not valid JSON — continue */ }
    }

    // Detect exit documents already wrapped in code fences by the AI (#522)
    // e.g. ```json\n{...}\n```
    const fencedResult = text.replace(
      /```(?:json)?\s*\n(\{[\s\S]*?\})\s*\n```/g,
      (fullMatch, jsonContent) => {
        try {
          const obj = JSON.parse(jsonContent);
          if (this._isExitDocument(obj)) {
            return this._renderExitDocumentSummary(obj);
          }
        } catch { /* not valid JSON — leave as-is */ }
        return fullMatch;
      }
    );
    if (fencedResult !== text) return fencedResult;

    // Look for bare JSON objects/arrays embedded between text.
    return text.replace(
      /^(\{[\s\S]*?\n\}|\[[\s\S]*?\n\])/gm,
      (match) => {
        try {
          const obj = JSON.parse(match);
          if (this._isExitDocument(obj)) {
            return this._renderExitDocumentSummary(obj);
          }
          return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
        } catch {
          return match;
        }
      }
    );
  }

  /** @deprecated Use _formatContentBlocks instead */
  _wrapJsonBlocks(text) {
    return this._formatContentBlocks(text);
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
