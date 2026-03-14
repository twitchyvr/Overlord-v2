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
import { EntityLink, resolveAgent } from '../engine/entity-nav.js';


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
    this._selectedAgentForContext = null;
    this._selectedEmailId = null;
    this._selectedThreadId = null;
    this._fetchGen = 0;
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

    const agentId = this._selectedAgentForContext || agents[0].id;
    this._loading = true;
    const gen = ++this._fetchGen;

    api.fetchInbox(agentId)
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

    api.fetchSentEmails(agentId).catch(() => {});
    api.fetchUnreadCount(agentId).catch(() => {});
  }

  // ── Full render ────────────────────────────────────────────

  _render() {
    this.el.textContent = '';
    this.el.className = 'email-view';

    // ── Header row ──
    const header = h('div', { class: 'email-view-header' },
      h('div', { class: 'email-view-title-row' },
        h('h2', { class: 'email-view-title' }, 'Agent Mail'),
        h('span', { class: 'email-view-unread-badge' },
          this._unreadCount > 0 ? `${this._unreadCount} unread` : '')
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

    // ── 3-pane layout ──
    const layout = h('div', { class: 'email-layout' });

    // Left sidebar — folders
    this._foldersEl = h('div', { class: 'email-folders' });
    this._renderFolders();
    layout.appendChild(this._foldersEl);

    // Right side — list + preview stacked
    const mainPane = h('div', { class: 'email-main-pane' });

    // Email list
    this._listEl = h('div', { class: 'email-list' });
    mainPane.appendChild(this._listEl);

    // Preview pane
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
    if (!this._foldersEl) return;
    this._foldersEl.textContent = '';

    for (const folder of FOLDERS) {
      const isActive = this._filter === folder.id;
      const badge = this._getFolderBadge(folder.id);

      const item = h('div', {
        class: `email-folder-item${isActive ? ' email-folder-item--active' : ''}`,
        dataset: { folderId: folder.id },
      },
        h('span', { class: 'email-folder-icon' }, folder.icon),
        h('span', { class: 'email-folder-label' }, folder.label),
        badge > 0
          ? h('span', { class: 'email-folder-badge' }, String(badge))
          : null
      );
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
    if (this._filter === 'inbox') return this._inbox;
    if (this._filter === 'sent') return this._sent;
    // 'all' — merge and sort by date descending
    const merged = [...this._inbox, ...this._sent];
    // De-duplicate by id (an email can appear in both inbox and sent if self-CC'd somehow)
    const seen = new Set();
    const unique = merged.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    unique.sort((a, b) => {
      const da = a.created_at || '';
      const db = b.created_at || '';
      return db.localeCompare(da);
    });
    return unique;
  }

  _getEmptyTitle() {
    if (this._filter === 'inbox') return 'Inbox empty';
    if (this._filter === 'sent') return 'No sent emails';
    return 'No emails';
  }

  _getEmptyDesc() {
    if (this._filter === 'inbox') return 'Agent emails will appear here when agents communicate.';
    if (this._filter === 'sent') return 'Sent emails will appear here after composing.';
    return 'No emails have been sent or received yet.';
  }

  /**
   * Build a single email row for the list.
   */
  _buildEmailRow(email) {
    const isUnread = email.status === 'unread' || (!email.read_at && this._filter !== 'sent');
    const isSelected = this._selectedEmailId === email.id;
    const fromAgent = resolveAgent(email.from_id);
    const fromName = email.from_name || fromAgent?.name || email.from_id;
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
        return agent?.name || r.agent_id;
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
    const fromName = email.from_name || fromAgent?.name || email.from_id;
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
      const name = agent?.name || r.agent_id;
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
        const fromId = this._selectedAgentForContext || this._agents[0]?.id;
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

        const fromId = this._selectedAgentForContext || this._agents[0]?.id;
        const allRecipients = (lastEmail.recipients || [])
          .map((r) => r.agent_id)
          .filter((id) => id !== fromId);
        if (lastEmail.from_id !== fromId) allRecipients.push(lastEmail.from_id);

        const uniqueTo = [...new Set(allRecipients)];

        this._openComposeModal({
          to: uniqueTo,
          subject: lastEmail.subject?.startsWith('Re: ') ? lastEmail.subject : `Re: ${lastEmail.subject}`,
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
    const fromName = email.from_name || fromAgent?.name || email.from_id;

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

    if (buildingAgents.length === 0) {
      select.appendChild(h('option', { value: '' }, 'No agents'));
    } else {
      for (const agent of buildingAgents) {
        const opt = h('option', {
          value: agent.id,
          selected: this._selectedAgentForContext === agent.id ||
            (!this._selectedAgentForContext && buildingAgents[0]?.id === agent.id)
        }, agent.display_name || agent.name || agent.id);
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
    const fromAgentId = this._selectedAgentForContext || buildingAgents[0]?.id || '';

    const content = h('div', { class: 'email-compose' });

    // From (read-only display)
    const fromAgent = resolveAgent(fromAgentId);
    content.appendChild(
      h('div', { class: 'email-compose-field' },
        h('label', {}, 'From:'),
        h('span', { class: 'email-compose-from' }, fromAgent?.name || fromAgentId)
      )
    );

    // To: multi-select checkboxes
    const toContainer = h('div', { class: 'email-compose-to-list' });
    const selectedTo = new Set(prefill.to || []);
    for (const agent of buildingAgents) {
      if (agent.id === fromAgentId) continue;
      const checkbox = h('input', {
        type: 'checkbox',
        value: agent.id,
        checked: selectedTo.has(agent.id),
        class: 'email-compose-to-check'
      });
      toContainer.appendChild(
        h('label', { class: 'email-compose-to-label' },
          checkbox,
          h('span', {}, agent.display_name || agent.name || agent.id)
        )
      );
    }
    content.appendChild(
      h('div', { class: 'email-compose-field' },
        h('label', {}, 'To:'),
        toContainer
      )
    );

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
        const to = [...toContainer.querySelectorAll('.email-compose-to-check:checked')]
          .map((cb) => cb.value);
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
          const res = await api.sendAgentEmail({
            fromId: fromAgentId,
            to,
            subject,
            body,
            priority: prioritySelect.value,
          });

          if (res && res.ok) {
            Toast.success('Email sent');
            Modal.close('email-compose');
            this._fetchData();
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

  // ── Helpers ────────────────────────────────────────────────

  _truncate(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  }
}
