/**
 * Overlord v2 — Email View (Agent Interoffice Mail)
 *
 * 3-pane mail client layout:
 *   Left sidebar  — folder filters (Inbox, Sent, All)
 *   Middle pane   — email list with sender, subject, date
 *   Bottom pane   — email preview / thread view
 *
 * Store keys:
 *   email.inbox        — array of inbox emails
 *   email.sent         — array of sent emails
 *   email.thread       — array of emails in current thread
 *   email.unreadCount  — number of unread emails
 *   agents.list        — array of agent objects (for compose dropdown)
 */

import { Component } from '../engine/component.js';
import { OverlordUI } from '../engine/engine.js';
import { h, formatTime } from '../engine/helpers.js';
import { Toast } from '../components/toast.js';
import { Modal } from '../components/modal.js';
import { EntityLink, resolveAgent, resolveAgentName } from '../engine/entity-nav.js';


// ── Constants ────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  urgent: { class: 'email-priority--urgent', label: 'Urgent', icon: '!!' },
  normal: { class: 'email-priority--normal', label: 'Normal', icon: '' },
  low:    { class: 'email-priority--low',    label: 'Low',    icon: '' },
};

const FOLDERS = [
  { id: 'inbox', label: 'Inbox',  icon: '\u{1F4E5}' },
  { id: 'sent',  label: 'Sent',   icon: '\u{1F4E4}' },
  { id: 'all',   label: 'All',    icon: '\u{1F4EC}' },
];

/** Resolve display name — handles __user__ special ID (#667) */
function resolveFromName(email) {
  if (email.from_id === '__user__') return 'You';
  return email.from_name || resolveAgentName(email.from_id);
}


export class EmailView extends Component {

  constructor(el) {
    super(el);
    this._inbox = [];
    this._sent = [];
    this._thread = [];
    this._unreadCount = 0;
    this._agents = [];
    this._filter = 'inbox';
    this._listEl = null;
    this._previewEl = null;
    this._foldersEl = null;
    this._loading = true;
    this._selectedAgentForContext = '__user__';
    this._selectedEmailId = null;
    this._selectedThreadId = null;
    this._fetchGen = 0;
    this._searchQuery = '';
  }

  // ── Lifecycle ────────────────────────────────────────────────

  mount() {
    this._mounted = true;
    const store = OverlordUI.getStore();
    if (!store) return;

    // Seed from store
    this._inbox = store.get('email.inbox') || [];
    this._sent = store.get('email.sent') || [];
    this._unreadCount = store.get('email.unreadCount') || 0;
    this._agents = store.get('agents.list') || [];

    // Subscribe to store changes
    this.subscribe(store, 'email.inbox', (inbox) => {
      this._inbox = inbox || [];
      this._loading = false;
      if (this._filter === 'inbox' || this._filter === 'all') this._renderList();
      this._renderFolderBadges();
    });

    this.subscribe(store, 'email.sent', (sent) => {
      this._sent = sent || [];
      if (this._filter === 'sent' || this._filter === 'all') this._renderList();
      this._renderFolderBadges();
    });

    this.subscribe(store, 'email.unreadCount', (count) => {
      this._unreadCount = count || 0;
      this._renderFolderBadges();
    });

    this.subscribe(store, 'agents.list', (agents) => {
      const hadNoAgents = this._agents.length === 0;
      this._agents = agents || [];
      if (hadNoAgents && this._agents.length > 0) {
        this._fetchData();
        this._render();
      }
    });

    // Listen for live email events
    this._listeners.push(
      OverlordUI.subscribe('email:received', () => {
        if (this._filter === 'inbox' || this._filter === 'all') this._renderList();
        this._renderFolderBadges();
      })
    );

    // Fetch initial data
    this._fetchData();
    this._render();
  }

  destroy() {
    this._listEl = null;
    this._previewEl = null;
    this._foldersEl = null;
    super.destroy();
  }

  // ── Data fetching ──────────────────────────────────────────

  _fetchData() {
    const api = window.overlordSocket;
    if (!api) { this._loading = false; return; }

    const agents = this._getBuildingAgents();
    if (agents.length === 0) { this._loading = false; return; }

    const agentId = this._selectedAgentForContext || '__user__';
    const store = OverlordUI.getStore();
    const buildingId = store?.get('building.active') || '';
    this._loading = true;
    const gen = ++this._fetchGen;

    api.fetchInbox(agentId, { buildingId })
      .then((res) => {
        if (!this._mounted || gen !== this._fetchGen) return;
        if (!res || !res.ok) {
          this._loading = false;
          this._renderList();
        }
      })
      .catch(() => {
        if (!this._mounted || gen !== this._fetchGen) return;
        this._loading = false;
        this._renderList();
      });

    api.fetchSentEmails(agentId, { buildingId }).catch(() => {});
    api.fetchUnreadCount(agentId, { buildingId }).catch(() => {});
  }

  // ── Full render ────────────────────────────────────────────

  _render() {
    this.el.textContent = '';
    this.el.className = 'email-view';

    // No building selected — show empty state (#691)
    const store = OverlordUI.getStore();
    if (!store?.get('building.active')) {
      this.el.appendChild(h('div', { class: 'view-empty-state' },
        h('div', { class: 'view-empty-icon' }, '\u{1F4EC}'),
        h('h2', { class: 'view-empty-title' }, 'No Building Selected'),
        h('p', { class: 'view-empty-text' }, 'Select a project from the Dashboard to view mail.')
      ));
      return;
    }

    // ── Header: title + actions ──
    const header = h('div', { class: 'email-view-header' },
      h('div', { class: 'email-view-title-row' },
        h('h2', { class: 'email-view-title' }, 'Mail'),
        this._unreadCount > 0
          ? h('span', { class: 'email-view-unread-badge' }, String(this._unreadCount))
          : null,
      ),
      h('div', { class: 'email-view-actions' },
        this._buildAgentPicker(),
        h('button', {
          class: 'email-view-compose-btn',
          type: 'button',
          onClick: () => this._openComposeModal()
        }, '+ Compose')
      )
    );
    this.el.appendChild(header);

    // ── Thunderbird 3-pane: folders (left) | list+preview (right) ──
    const layout = h('div', { class: 'email-layout' });

    // Left: folder tree
    this._foldersEl = h('div', { class: 'email-folders' });
    this._renderFolderTree();
    layout.appendChild(this._foldersEl);

    // Right: list (top) + preview (bottom)
    const mainPane = h('div', { class: 'email-main-pane' });

    this._listEl = h('div', { class: 'email-list' });
    mainPane.appendChild(this._listEl);

    this._previewEl = h('div', { class: 'email-preview' });
    this._renderPreviewEmpty();
    mainPane.appendChild(this._previewEl);

    layout.appendChild(mainPane);
    this.el.appendChild(layout);

    // ── Delegated click handlers ──
    this.on('click', '.email-row', (e, target) => {
      // Don't intercept clicks on entity links
      if (e.target.closest('.entity-link')) return;

      const emailId = target.dataset.emailId;
      const threadId = target.dataset.threadId;
      if (emailId) {
        this._selectEmail(emailId, threadId);
      }
    });

    this.on('click', '.email-folder-item', (e, target) => {
      const folderId = target.dataset.folderId;
      if (folderId && folderId !== this._filter) {
        this._filter = folderId;
        this._selectedEmailId = null;
        this._selectedThreadId = null;
        this._renderFolders();
        this._renderList();
        this._renderPreviewEmpty();
      }
    });

    this._renderList();
  }

  // ── Folder sidebar ────────────────────────────────────────

  _renderFolders() {
    // Legacy — kept for _renderFolderBadges compatibility
    this._renderFolderTree();
  }

  _renderFolderTree() {
    if (!this._foldersEl) return;
    while (this._foldersEl.firstChild) this._foldersEl.removeChild(this._foldersEl.firstChild);

    const selectFolder = (folderId) => {
      this._filter = folderId;
      this._selectedEmailId = null;
      this._selectedThreadId = null;
      this._renderList();
      this._renderPreviewEmpty();
      this._renderFolderTree();
    };

    // Standard folders
    for (const folder of FOLDERS) {
      const isActive = this._filter === folder.id;
      const badge = this._getFolderBadge(folder.id);

      const item = h('div', {
        class: `email-folder-item${isActive ? ' email-folder-item--active' : ''}`,
      },
        h('span', { class: 'email-folder-icon' }, folder.icon),
        h('span', { class: 'email-folder-label' }, folder.label),
        badge > 0
          ? h('span', { class: 'email-folder-badge' }, String(badge))
          : null
      );
      item.addEventListener('click', () => selectFolder(folder.id));
      this._foldersEl.appendChild(item);
    }

    // Separator + custom folders heading
    this._foldersEl.appendChild(h('div', { class: 'email-folder-separator' }));
    this._foldersEl.appendChild(h('div', { class: 'email-folder-heading' }, 'Labels'));

    // Custom folders / labels
    const customFolders = this._customFolders || [
      { id: 'starred', label: 'Starred', icon: '\u2B50' },
      { id: 'important', label: 'Important', icon: '\u{1F534}' },
      { id: 'follow-up', label: 'Follow Up', icon: '\u{1F3F3}\uFE0F' },
      { id: 'archive', label: 'Archive', icon: '\u{1F4E6}' },
    ];

    for (const folder of customFolders) {
      const isActive = this._filter === folder.id;
      const item = h('div', {
        class: `email-folder-item${isActive ? ' email-folder-item--active' : ''}`,
      },
        h('span', { class: 'email-folder-icon' }, folder.icon),
        h('span', { class: 'email-folder-label' }, folder.label),
      );
      item.addEventListener('click', () => selectFolder(folder.id));
      this._foldersEl.appendChild(item);
    }
  }

  _getFolderBadge(folderId) {
    if (folderId === 'inbox') return this._unreadCount || this._inbox.length;
    if (folderId === 'sent') return this._sent.length;
    if (folderId === 'all') return this._inbox.length + this._sent.length;
    return 0;
  }

  _renderFolderBadges() {
    this._renderFolders();

    // Update header unread badge
    const badge = this.el.querySelector('.email-view-unread-badge');
    if (badge) {
      badge.textContent = this._unreadCount > 0 ? `${this._unreadCount} unread` : '';
    }
  }

  // ── List rendering ─────────────────────────────────────────

  _renderList() {
    if (!this._listEl) return;
    this._listEl.textContent = '';

    const items = this._getFilteredItems();

    if (this._loading) {
      this._listEl.appendChild(
        h('div', { class: 'loading-state' },
          h('div', { class: 'loading-spinner' }),
          h('p', { class: 'loading-text' }, 'Loading emails...')
        )
      );
      return;
    }

    // Search bar — always visible, even on empty inbox (#566)
    const searchBar = h('div', { class: 'email-search-bar' });
    const searchInput = h('input', {
      type: 'text',
      class: 'email-search-input',
      placeholder: 'Search emails...',
      value: this._searchQuery,
    });
    searchInput.addEventListener('input', () => {
      this._searchQuery = searchInput.value;
      this._renderList();
    });
    searchBar.appendChild(h('span', { class: 'email-search-icon' }, '\u{1F50D}'));
    searchBar.appendChild(searchInput);
    if (this._searchQuery) {
      const clearBtn = h('button', { class: 'email-search-clear', type: 'button' }, '\u2715');
      clearBtn.addEventListener('click', () => { this._searchQuery = ''; this._renderList(); });
      searchBar.appendChild(clearBtn);
    }
    this._listEl.appendChild(searchBar);

    if (items.length === 0) {
      this._listEl.appendChild(
        h('div', { class: 'email-view-empty' },
          h('div', { class: 'email-view-empty-icon' }, '\u{1F4EC}'),
          h('p', { class: 'email-view-empty-title' }, this._getEmptyTitle()),
          h('p', { class: 'email-view-empty-desc' }, this._getEmptyDesc())
        )
      );
      return;
    }

    // Column headers
    this._listEl.appendChild(
      h('div', { class: 'email-row email-row--header' },
        h('span', { class: 'email-row-sender' }, this._filter === 'sent' ? 'To' : 'From'),
        h('span', { class: 'email-row-subject' }, 'Subject'),
        h('span', { class: 'email-row-date' }, 'Date'),
      )
    );

    const frag = document.createDocumentFragment();
    for (const email of items) {
      frag.appendChild(this._buildEmailRow(email));
    }
    this._listEl.appendChild(frag);
  }

  _getFilteredItems() {
    let items;
    if (this._filter === 'inbox') items = this._inbox;
    else if (this._filter === 'sent') items = this._sent;
    else {
      // 'all' — merge and sort by date descending
      const merged = [...this._inbox, ...this._sent];
      const seen = new Set();
      items = merged.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }

    // Apply search filter (#566)
    const query = (this._searchQuery || '').toLowerCase().trim();
    if (query) {
      items = items.filter(e => {
        const subject = (e.subject || '').toLowerCase();
        const body = (e.body || '').toLowerCase();
        const from = (e.from_name || '').toLowerCase();
        return subject.includes(query) || body.includes(query) || from.includes(query);
      });
    }
    return items;
  }

  _getEmptyTitle() {
    if (this._filter === 'inbox') return 'Inbox empty';
    if (this._filter === 'sent') return 'No sent emails';
    return 'No emails';
  }

  _getEmptyDesc() {
    if (this._filter === 'inbox') return 'Agents use mail to communicate across rooms and coordinate work. Messages will appear here as agents collaborate on your project.';
    if (this._filter === 'sent') return 'Sent emails will appear here. You can compose messages to agents using the Compose button above.';
    return 'Agent Mail is the inter-agent communication system. Agents send reports, ask questions, and coordinate work through email. Start a conversation in Chat to see agents begin collaborating.';
  }

  /**
   * Build a single email row for the list.
   */
  _buildEmailRow(email) {
    const isUnread = email.status === 'unread' || (!email.read_at && this._filter !== 'sent');
    const isSelected = this._selectedEmailId === email.id;
    const fromAgent = resolveAgent(email.from_id);
    const fromName = resolveFromName(email);
    const ts = email.created_at;

    let cls = 'email-row';
    if (isUnread) cls += ' unread';
    if (isSelected) cls += ' email-row--selected';
    if (email.priority === 'urgent') cls += ' email-row--urgent';

    const row = h('div', {
      class: cls,
      dataset: {
        emailId: email.id,
        threadId: email.thread_id || email.id,
      }
    });

    // Unread indicator dot (#566)
    if (isUnread) {
      row.appendChild(h('span', { class: 'email-unread-dot' }));
    } else {
      row.appendChild(h('span', { class: 'email-read-spacer' }));
    }

    // From / To column
    const senderText = this._filter === 'sent'
      ? this._getSentRecipientNames(email)
      : fromName;

    row.appendChild(h('span', { class: 'email-row-sender' }, senderText));

    // Subject column (with priority badge for urgent)
    const subjectContent = h('span', { class: 'email-row-subject' });
    if (email.priority === 'urgent') {
      subjectContent.appendChild(
        h('span', { class: 'email-priority-badge email-priority--urgent' }, 'URGENT')
      );
    }
    subjectContent.appendChild(
      document.createTextNode(email.subject || '(no subject)')
    );
    row.appendChild(subjectContent);

    // Date column
    row.appendChild(
      h('span', { class: 'email-row-date' }, ts ? formatTime(ts) : '')
    );

    return row;
  }

  _getSentRecipientNames(email) {
    const toRecipients = (email.recipients || [])
      .filter((r) => r.type === 'to')
      .map((r) => {
        const agent = resolveAgent(r.agent_id);
        return resolveAgentName(r.agent_id);
      });
    return toRecipients.join(', ') || 'unknown';
  }

  // ── Email selection & preview ─────────────────────────────

  async _selectEmail(emailId, threadId) {
    this._selectedEmailId = emailId;
    this._selectedThreadId = threadId || emailId;

    // Update row selection styling
    if (this._listEl) {
      this._listEl.querySelectorAll('.email-row--selected').forEach(
        (el) => el.classList.remove('email-row--selected')
      );
      const selected = this._listEl.querySelector(`[data-email-id="${emailId}"]`);
      if (selected) selected.classList.add('email-row--selected');
    }

    // Mark as read
    const api = window.overlordSocket;
    if (api && this._selectedAgentForContext && this._filter !== 'sent') {
      api.markEmailRead(emailId, this._selectedAgentForContext).catch(() => {});
      // Remove unread styling from the row
      const row = this._listEl?.querySelector(`[data-email-id="${emailId}"]`);
      if (row) row.classList.remove('unread');
    }

    // Load thread into preview
    await this._loadPreview(this._selectedThreadId, emailId);
  }

  async _loadPreview(threadId, emailId) {
    if (!this._previewEl) return;
    this._previewEl.textContent = '';

    // Loading state
    this._previewEl.appendChild(
      h('div', { class: 'loading-state' },
        h('div', { class: 'loading-spinner' }),
        h('p', { class: 'loading-text' }, 'Loading thread...')
      )
    );

    const api = window.overlordSocket;
    if (!api) {
      this._renderPreviewEmpty();
      return;
    }

    let thread = [];
    try {
      const res = await api.fetchEmailThread(threadId);
      thread = (res && res.ok) ? res.data : [];
    } catch {
      Toast.error('Error loading email thread');
      this._renderPreviewEmpty();
      return;
    }

    this._previewEl.textContent = '';

    if (thread.length === 0) {
      this._renderPreviewEmpty();
      return;
    }

    // Subject header
    const subject = thread[0]?.subject || 'No subject';
    this._previewEl.appendChild(
      h('div', { class: 'email-preview-header' },
        h('h3', { class: 'email-preview-subject' }, subject),
        h('span', { class: 'email-preview-count' },
          thread.length > 1 ? `${thread.length} messages` : '1 message'
        )
      )
    );

    // Thread messages
    const threadContainer = h('div', { class: 'email-preview-thread' });
    for (const email of thread) {
      threadContainer.appendChild(this._buildThreadMessage(email));
    }
    this._previewEl.appendChild(threadContainer);

    // Action buttons
    const lastEmailId = emailId || thread[thread.length - 1]?.id;
    const actions = h('div', { class: 'email-preview-actions' },
      h('button', {
        class: 'email-action-btn',
        type: 'button',
        onClick: () => this._replyFromPreview(lastEmailId, threadId),
      }, 'Reply'),
      h('button', {
        class: 'email-action-btn',
        type: 'button',
        onClick: () => this._replyAllFromPreview(lastEmailId, threadId),
      }, 'Reply All'),
      h('button', {
        class: 'email-action-btn',
        type: 'button',
        onClick: () => this._forwardFromPreview(lastEmailId),
      }, 'Forward'),
    );
    this._previewEl.appendChild(actions);

    // Inline reply area
    const replySection = this._buildInlineReply(lastEmailId, threadId);
    this._previewEl.appendChild(replySection);
  }

  _renderPreviewEmpty() {
    if (!this._previewEl) return;
    this._previewEl.textContent = '';
    this._previewEl.appendChild(
      h('div', { class: 'email-preview-empty' },
        h('p', { class: 'email-preview-empty-text' }, 'Select an email to view its contents')
      )
    );
  }

  /**
   * Build a single message inside the preview thread.
   */
  _buildThreadMessage(email) {
    const fromAgent = resolveAgent(email.from_id);
    const fromName = resolveFromName(email);
    const ts = email.created_at;

    const msg = h('div', { class: 'email-thread-message' },
      h('div', { class: 'email-thread-message-header' },
        h('div', { class: 'email-thread-message-from-row' },
          email.from_id
            ? EntityLink.agent(email.from_id, fromName)
            : h('span', { class: 'email-thread-message-from' }, fromName),
          email.priority === 'urgent'
            ? h('span', { class: 'email-priority--urgent email-thread-priority-badge' }, 'URGENT')
            : null,
        ),
        ts ? h('span', { class: 'email-thread-message-time' }, formatTime(ts)) : null
      ),
      h('div', { class: 'email-thread-message-recipients' },
        ...this._buildRecipientTags(email.recipients || [])
      ),
      h('div', { class: 'email-thread-message-body' }, email.body)
    );

    return msg;
  }

  _buildRecipientTags(recipients) {
    if (recipients.length === 0) return [];

    const tags = [];
    for (const r of recipients) {
      const agent = resolveAgent(r.agent_id);
      const name = resolveAgentName(r.agent_id);
      const typeLabel = r.type === 'cc' ? 'CC' : '';
      tags.push(
        h('span', { class: `email-recipient-tag ${r.type === 'cc' ? 'email-recipient-tag--cc' : ''}` },
          typeLabel ? `${typeLabel}: ${name}` : name
        )
      );
    }
    return tags;
  }

  // ── Reply / Forward from preview ──────────────────────────

  _buildInlineReply(emailId, threadId) {
    const section = h('div', { class: 'email-preview-reply' });
    const replyBody = h('textarea', {
      class: 'email-compose-textarea',
      placeholder: 'Write a reply...',
      rows: 3,
    });
    section.appendChild(replyBody);

    const replyBtn = h('button', {
      class: 'email-action-btn email-action-btn--primary',
      type: 'button',
      onClick: async () => {
        const body = replyBody.value.trim();
        if (!body) return;
        const fromId = this._selectedAgentForContext || '__user__';
        if (!fromId) { Toast.warning('No agent selected'); return; }

        replyBtn.disabled = true;
        replyBtn.textContent = 'Sending...';

        const api = window.overlordSocket;
        if (!api) { Toast.error('Not connected'); return; }

        try {
          const res = await api.replyToEmail(emailId, fromId, body);
          if (res && res.ok) {
            Toast.success('Reply sent');
            replyBody.value = '';
            this._fetchData();
            // Reload the preview to show the new message
            await this._loadPreview(threadId, emailId);
          } else {
            replyBtn.disabled = false;
            replyBtn.textContent = 'Send Reply';
          }
        } catch {
          Toast.error('Error sending reply');
          replyBtn.disabled = false;
          replyBtn.textContent = 'Send Reply';
        }
      }
    }, 'Send Reply');
    section.appendChild(replyBtn);

    return section;
  }

  _replyFromPreview(emailId, threadId) {
    // Scroll to the inline reply textarea
    const textarea = this._previewEl?.querySelector('.email-compose-textarea');
    if (textarea) {
      textarea.focus();
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  _replyAllFromPreview(emailId, threadId) {
    // For reply-all, open compose modal pre-filled
    const api = window.overlordSocket;
    if (!api) return;

    api.fetchEmailThread(threadId)
      .then((res) => {
        if (!res || !res.ok) return;
        const thread = res.data || [];
        const lastEmail = thread[thread.length - 1];
        if (!lastEmail) return;

        const fromId = this._selectedAgentForContext || '__user__';
        const allRecipients = (lastEmail.recipients || [])
          .map((r) => r.agent_id)
          .filter((id) => id !== fromId);
        if (lastEmail.from_id !== fromId) allRecipients.push(lastEmail.from_id);

        const uniqueTo = [...new Set(allRecipients)];

        this._openComposeModal({
          to: uniqueTo,
          subject: lastEmail.subject?.startsWith('Re: ') ? lastEmail.subject : `Re: ${lastEmail.subject}`,
          replyToEmailId: lastEmail.id,
          replyAll: true,
          threadId,
        });
      })
      .catch(() => {});
  }

  _forwardFromPreview(emailId) {
    const api = window.overlordSocket;
    if (!api) return;

    // Find the email in current data
    const allEmails = [...this._inbox, ...this._sent];
    const email = allEmails.find((e) => e.id === emailId);
    if (!email) return;

    const fromAgent = resolveAgent(email.from_id);
    const fromName = resolveFromName(email);

    this._openComposeModal({
      subject: email.subject?.startsWith('Fwd: ') ? email.subject : `Fwd: ${email.subject}`,
      body: `\n\n--- Forwarded ---\nFrom: ${fromName}\nSubject: ${email.subject}\n\n${email.body}`,
    });
  }

  // ── Agent picker ───────────────────────────────────────────

  /** Get agents filtered to the active building to prevent duplicates (#534). */
  _getBuildingAgents() {
    const store = OverlordUI.getStore();
    const activeBuildingId = store?.get('building.active');
    if (!activeBuildingId) return this._agents;
    const filtered = this._agents.filter(a => a.building_id === activeBuildingId);
    return filtered.length > 0 ? filtered : this._agents;
  }

  _buildAgentPicker() {
    const buildingAgents = this._getBuildingAgents();

    const select = h('select', {
      class: 'email-view-agent-picker',
      onChange: (e) => {
        this._selectedAgentForContext = e.target.value;
        this._selectedEmailId = null;
        this._selectedThreadId = null;
        this._loading = true;
        this._renderList();
        this._renderPreviewEmpty();
        this._fetchData();
      }
    });

    // "You" option — the human user's mailbox (#667)
    const userOpt = h('option', {
      value: '__user__',
      selected: this._selectedAgentForContext === '__user__' || !this._selectedAgentForContext,
    }, 'You (Project Owner)');
    select.appendChild(userOpt);

    if (buildingAgents.length > 0) {
      select.appendChild(h('option', { disabled: true }, '\u2500\u2500\u2500 Agents \u2500\u2500\u2500'));
      for (const agent of buildingAgents) {
        const opt = h('option', {
          value: agent.id,
          selected: this._selectedAgentForContext === agent.id,
        }, agent.display_name || agent.name || 'Agent');
        select.appendChild(opt);
      }
    }

    return h('div', { class: 'email-view-agent-picker-wrapper' },
      h('label', { class: 'email-view-picker-label' }, 'Viewing as:'),
      select
    );
  }

  // ── Compose modal ──────────────────────────────────────────

  _openComposeModal(prefill = {}) {
    const buildingAgents = this._getBuildingAgents();
    const fromAgentId = this._selectedAgentForContext || '__user__';

    const content = h('div', { class: 'email-compose' });

    // From (read-only display)
    const fromAgent = resolveAgent(fromAgentId);
    const fromName = fromAgentId === '__user__' ? 'You (Project Owner)' : (fromAgent?.name || 'Agent');
    content.appendChild(
      h('div', { class: 'email-compose-field' },
        h('label', {}, 'From:'),
        h('span', { class: 'email-compose-from' }, fromName)
      )
    );

    // To: chip-based recipient selector with search (#554)
    const toField = h('div', { class: 'email-compose-field' });
    toField.appendChild(h('label', {}, 'To:'));
    const toChipArea = h('div', { class: 'email-compose-chips' });
    const toSearchInput = h('input', {
      type: 'text',
      class: 'email-compose-chip-search',
      placeholder: 'Search recipients...',
    });
    const toDropdown = h('div', { class: 'email-compose-chip-dropdown' });
    const selectedTo = new Set(prefill.to || []);
    // Include user + all agents except sender as available recipients (#667)
    const userRecipient = { id: '__user__', name: 'You (Project Owner)', display_name: 'You (Project Owner)', role: 'owner' };
    const availableAgents = [
      ...(fromAgentId !== '__user__' ? [userRecipient] : []),
      ...buildingAgents.filter(a => a.id !== fromAgentId),
    ];

    const renderToChips = () => {
      toChipArea.querySelectorAll('.email-compose-chip').forEach(c => c.remove());
      for (const id of selectedTo) {
        const agent = resolveAgent(id);
        const name = agent?.display_name || agent?.name || id;
        const initial = (name[0] || '?').toUpperCase();
        const chip = h('span', { class: 'email-compose-chip' },
          h('span', { class: 'email-compose-chip-avatar' }, initial),
          h('span', { class: 'email-compose-chip-name' }, name),
        );
        const removeBtn = h('button', { class: 'email-compose-chip-remove', type: 'button' }, '\u00D7');
        removeBtn.addEventListener('click', () => { selectedTo.delete(id); renderToChips(); });
        chip.appendChild(removeBtn);
        toChipArea.insertBefore(chip, toSearchInput);
      }
    };

    const showDropdown = (query) => {
      toDropdown.textContent = '';
      const q = (query || '').toLowerCase();
      const matches = availableAgents.filter(a => {
        if (selectedTo.has(a.id)) return false;
        const name = (a.display_name || a.name || '').toLowerCase();
        return !q || name.includes(q) || a.role?.toLowerCase().includes(q);
      });
      if (matches.length === 0) {
        toDropdown.style.display = 'none';
        return;
      }
      toDropdown.style.display = 'block';
      for (const agent of matches.slice(0, 8)) {
        const name = agent.display_name || agent.name || 'Agent';
        const initial = (name[0] || '?').toUpperCase();
        const opt = h('div', { class: 'email-compose-chip-option' },
          h('span', { class: 'email-compose-chip-avatar' }, initial),
          h('span', { class: 'email-compose-chip-opt-name' }, name),
          h('span', { class: 'email-compose-chip-opt-role' }, agent.role || ''),
        );
        opt.addEventListener('click', () => {
          selectedTo.add(agent.id);
          toSearchInput.value = '';
          toDropdown.style.display = 'none';
          renderToChips();
        });
        toDropdown.appendChild(opt);
      }
    };

    toSearchInput.addEventListener('input', () => showDropdown(toSearchInput.value));
    toSearchInput.addEventListener('focus', () => showDropdown(toSearchInput.value));
    toSearchInput.addEventListener('blur', () => setTimeout(() => { toDropdown.style.display = 'none'; }, 200));

    toChipArea.appendChild(toSearchInput);
    renderToChips();

    const toWrapper = h('div', { class: 'email-compose-to-wrapper' });
    toWrapper.appendChild(toChipArea);
    toWrapper.appendChild(toDropdown);
    toField.appendChild(toWrapper);
    content.appendChild(toField);

    // Subject
    const subjectInput = h('input', {
      type: 'text',
      class: 'email-compose-input',
      placeholder: 'Subject',
      value: prefill.subject || '',
    });
    content.appendChild(
      h('div', { class: 'email-compose-field' },
        h('label', {}, 'Subject:'),
        subjectInput
      )
    );

    // Priority
    const prioritySelect = h('select', { class: 'email-compose-input' },
      h('option', { value: 'normal', selected: (prefill.priority || 'normal') === 'normal' }, 'Normal'),
      h('option', { value: 'urgent', selected: prefill.priority === 'urgent' }, 'Urgent'),
      h('option', { value: 'low', selected: prefill.priority === 'low' }, 'Low'),
    );
    content.appendChild(
      h('div', { class: 'email-compose-field' },
        h('label', {}, 'Priority:'),
        prioritySelect
      )
    );

    // Body
    const bodyTextarea = h('textarea', {
      class: 'email-compose-textarea',
      placeholder: 'Write your message...',
      rows: 6,
    }, prefill.body || '');
    content.appendChild(
      h('div', { class: 'email-compose-field' },
        h('label', {}, 'Message:'),
        bodyTextarea
      )
    );

    // Send button
    const sendBtn = h('button', {
      class: 'email-compose-send-btn',
      type: 'button',
      onClick: async () => {
        const to = [...selectedTo];
        const subject = subjectInput.value.trim();
        const body = bodyTextarea.value.trim();

        if (to.length === 0) { Toast.warning('Select at least one recipient'); return; }
        if (!subject) { Toast.warning('Subject is required'); return; }
        if (!body) { Toast.warning('Message body is required'); return; }

        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';

        const api = window.overlordSocket;
        if (!api) { Toast.error('Not connected'); return; }

        try {
          let res;
          if (prefill.replyToEmailId) {
            // Reply to existing thread
            res = await api.replyToEmail(prefill.replyToEmailId, fromAgentId, body, {
              replyAll: !!prefill.replyAll,
              priority: prioritySelect.value,
            });
          } else {
            // New email
            res = await api.sendAgentEmail({
              fromId: fromAgentId,
              to,
              subject,
              body,
              priority: prioritySelect.value,
            });
          }

          if (res && res.ok) {
            Toast.success(prefill.replyToEmailId ? 'Reply sent' : 'Email sent');
            Modal.close('email-compose');
            this._fetchData();
            // Reload preview if replying in a thread
            if (prefill.threadId) {
              this._loadPreview(prefill.threadId, prefill.replyToEmailId);
            }
          } else {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
          }
        } catch {
          Toast.error('Error sending email');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
        }
      }
    }, 'Send');
    content.appendChild(sendBtn);

    Modal.open('email-compose', {
      title: 'Compose Email',
      content,
      size: 'md',
    });
  }

  // ── Thread drawer ──────────────────────────────────────────

  async _openThreadDrawer(threadId, emailId) {
    const api = window.overlordSocket;
    if (!api) return;

    // Mark as read
    if (emailId && this._selectedAgentForContext) {
      api.markEmailRead(emailId, this._selectedAgentForContext).catch(() => {});
    }

    let thread = [];
    try {
      const res = await api.fetchEmailThread(threadId);
      thread = (res && res.ok) ? res.data : [];
    } catch (err) {
      Toast.error('Error loading email thread');
    }

    const content = h('div', { class: 'email-thread' });

    if (thread.length === 0) {
      content.appendChild(h('p', { class: 'email-thread-empty' }, 'No messages in this thread.'));
    } else {
      for (const email of thread) {
        content.appendChild(this._buildThreadMessage(email));
      }
    }

    // Reply form
    const replySection = h('div', { class: 'email-thread-reply' });
    const replyBody = h('textarea', {
      class: 'email-compose-textarea',
      placeholder: 'Write a reply...',
      rows: 3,
    });
    replySection.appendChild(replyBody);

    const replyActions = h('div', { class: 'email-thread-reply-actions' },
      h('button', {
        class: 'email-compose-send-btn email-compose-send-btn--small',
        type: 'button',
        onClick: async () => {
          const body = replyBody.value.trim();
          if (!body) return;
          const fromId = this._selectedAgentForContext || '__user__';
          if (!fromId) { Toast.warning('No agent selected'); return; }

          const btn = replyActions.querySelector('button');
          btn.disabled = true;
          btn.textContent = 'Sending...';

          try {
            const replyRes = await api.replyToEmail(emailId || thread[thread.length - 1]?.id, fromId, body);
            if (replyRes && replyRes.ok) {
              Toast.success('Reply sent');
              // Close and refresh thread to avoid stacking
              Drawer.close();
              this._openThreadDrawer(threadId, emailId);
              this._fetchData();
            } else {
              btn.disabled = false;
              btn.textContent = 'Reply';
            }
          } catch (err) {
            Toast.error('Error sending reply');
            btn.disabled = false;
            btn.textContent = 'Reply';
          }
        }
      }, 'Reply')
    );
    replySection.appendChild(replyActions);
    content.appendChild(replySection);

    const firstSubject = thread[0]?.subject || 'Thread';

    Drawer.open('email-thread', {
      title: firstSubject,
      width: '520px',
      content,
    });
  }

  /**
   * Build a single message in a thread view.
   */
  _buildThreadMessage(email) {
    const fromAgent = resolveAgent(email.from_id);
    const fromName = resolveFromName(email);
    const ts = email.created_at;

    const msg = h('div', { class: 'email-thread-message' },
      h('div', { class: 'email-thread-message-header' },
        email.from_id
          ? EntityLink.agent(email.from_id, fromName)
          : h('span', { class: 'email-thread-message-from' }, fromName),
        email.priority === 'urgent'
          ? h('span', { class: 'email-priority--urgent email-thread-priority-badge' }, 'URGENT')
          : null,
        ts ? h('span', { class: 'email-thread-message-time' }, formatTime(ts)) : null
      ),
      h('div', { class: 'email-thread-message-recipients' },
        ...this._buildRecipientTags(email.recipients || [])
      ),
      h('div', { class: 'email-thread-message-body' }, email.body)
    );

    return msg;
  }

  _buildRecipientTags(recipients) {
    if (recipients.length === 0) return [];

    const tags = [];
    for (const r of recipients) {
      const agent = resolveAgent(r.agent_id);
      const name = resolveAgentName(r.agent_id);
      const typeLabel = r.type === 'cc' ? 'CC' : '';
      tags.push(
        h('span', { class: `email-recipient-tag ${r.type === 'cc' ? 'email-recipient-tag--cc' : ''}` },
          typeLabel ? `${typeLabel}: ${name}` : name
        )
      );
    }
    return tags;
  }

  // ── Helpers ────────────────────────────────────────────────

  _truncate(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  }
}
