/**
 * Overlord v2 — Email View (Agent Interoffice Mail)
 *
 * Full-page view for the agent-to-agent email system.
 * Shows inbox, sent mail, compose form, and threaded conversations.
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
import { Tabs } from '../components/tabs.js';
import { Toast } from '../components/toast.js';
import { Modal } from '../components/modal.js';
import { Drawer } from '../components/drawer.js';
import { EntityLink, resolveAgent } from '../engine/entity-nav.js';


// ── Constants ────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  urgent: { class: 'email-priority--urgent', label: 'Urgent', icon: '!!' },
  normal: { class: 'email-priority--normal', label: 'Normal', icon: '' },
  low:    { class: 'email-priority--low',    label: 'Low',    icon: '' },
};


export class EmailView extends Component {

  constructor(el) {
    super(el);
    this._inbox = [];
    this._sent = [];
    this._thread = [];
    this._unreadCount = 0;
    this._agents = [];
    this._filter = 'inbox';
    this._tabs = null;
    this._listEl = null;
    this._loading = true;
    this._selectedAgentForContext = null;
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
      if (this._filter === 'inbox') this._renderList();
      this._updateTabBadges();
    });

    this.subscribe(store, 'email.sent', (sent) => {
      this._sent = sent || [];
      if (this._filter === 'sent') this._renderList();
      this._updateTabBadges();
    });

    this.subscribe(store, 'email.unreadCount', (count) => {
      this._unreadCount = count || 0;
      this._updateTabBadges();
    });

    this.subscribe(store, 'agents.list', (agents) => {
      const hadNoAgents = this._agents.length === 0;
      this._agents = agents || [];
      // If agents just became available, fetch email data
      if (hadNoAgents && this._agents.length > 0) {
        this._fetchData();
        this._render();
      }
    });

    // Listen for live email events
    this._listeners.push(
      OverlordUI.subscribe('email:received', () => {
        if (this._filter === 'inbox') this._renderList();
        this._updateTabBadges();
      })
    );

    // Fetch initial data
    this._fetchData();
    this._render();
  }

  destroy() {
    this._tabs = null;
    this._listEl = null;
    super.destroy();
  }

  // ── Data fetching ──────────────────────────────────────────

  _fetchData() {
    const api = window.overlordSocket;
    if (!api) { this._loading = false; return; }

    const agents = this._agents;
    if (agents.length === 0) { this._loading = false; return; }

    const agentId = this._selectedAgentForContext || agents[0].id;
    this._loading = true;
    const gen = ++this._fetchGen;

    // Fetch inbox — always resolve loading state regardless of success/failure
    api.fetchInbox(agentId)
      .then((res) => {
        if (!this._mounted || gen !== this._fetchGen) return;
        // On success, store subscription already set _loading = false.
        // On failure (ok: false), subscription never fires — handle it here.
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

    // ── Filter tabs ──
    const tabWrapper = h('div', { class: 'email-view-tabs' });
    const tabContainer = h('div');
    tabWrapper.appendChild(tabContainer);

    this._tabs = new Tabs(tabContainer, {
      items: [
        { id: 'inbox', label: 'Inbox', badge: String(this._inbox.length) },
        { id: 'sent',  label: 'Sent',  badge: String(this._sent.length) },
      ],
      activeId: this._filter,
      style: 'pills',
      onChange: (id) => {
        this._filter = id;
        this._renderList();
        this._updateTabBadges();
      }
    });
    this._tabs.mount();
    this.el.appendChild(tabWrapper);

    // ── Email list container ──
    this._listEl = h('div', { class: 'email-view-list' });
    this.el.appendChild(this._listEl);

    // ── Delegated click handlers ──
    this.on('click', '.email-view-item', (e, target) => {
      const emailId = target.dataset.emailId;
      const threadId = target.dataset.threadId;
      if (threadId) {
        this._openThreadDrawer(threadId, emailId);
      }
    });

    this._renderList();
  }

  // ── List rendering ─────────────────────────────────────────

  _renderList() {
    if (!this._listEl) return;
    this._listEl.textContent = '';

    const items = this._filter === 'inbox' ? this._inbox : this._sent;

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
          h('p', { class: 'email-view-empty-title' },
            this._filter === 'inbox' ? 'Inbox empty' : 'No sent emails'),
          h('p', { class: 'email-view-empty-desc' },
            this._filter === 'inbox'
              ? 'Agent emails will appear here when agents communicate.'
              : 'Sent emails will appear here after composing.')
        )
      );
      return;
    }

    const frag = document.createDocumentFragment();
    for (const email of items) {
      frag.appendChild(this._buildEmailItem(email));
    }
    this._listEl.appendChild(frag);
  }

  /**
   * Build a single email row element.
   */
  _buildEmailItem(email) {
    const isUnread = email.status === 'unread' || (!email.read_at && this._filter === 'inbox');
    const priorityCfg = PRIORITY_CONFIG[email.priority] || PRIORITY_CONFIG.normal;
    const fromAgent = resolveAgent(email.from_id);
    const fromName = email.from_name || fromAgent?.name || email.from_id;
    const ts = email.created_at;
    const recipientCount = email.recipients ? email.recipients.length : 0;

    const row = h('div', {
      class: `email-view-item${isUnread ? ' email-view-item--unread' : ''}`,
      dataset: {
        emailId: email.id,
        threadId: email.thread_id || email.id,
      }
    });

    // Priority indicator
    if (email.priority === 'urgent') {
      row.appendChild(h('span', { class: 'email-view-priority email-priority--urgent' }, '!!'));
    } else {
      row.appendChild(h('span', { class: 'email-view-priority' }));
    }

    // Sender/recipient column
    const senderCol = h('div', { class: 'email-view-sender' });
    if (this._filter === 'inbox') {
      senderCol.appendChild(h('span', { class: 'email-view-sender-name' }, fromName));
    } else {
      // Sent view: show recipients
      const toNames = (email.recipients || [])
        .filter((r) => r.type === 'to')
        .map((r) => {
          const agent = resolveAgent(r.agent_id);
          return agent?.name || r.agent_id;
        })
        .join(', ');
      senderCol.appendChild(h('span', { class: 'email-view-sender-name' }, `To: ${toNames || 'unknown'}`));
    }
    if (recipientCount > 1) {
      senderCol.appendChild(h('span', { class: 'email-view-recipient-count' }, `+${recipientCount - 1}`));
    }
    row.appendChild(senderCol);

    // Subject + preview
    const subjectCol = h('div', { class: 'email-view-subject-col' },
      h('span', { class: 'email-view-subject' }, email.subject || '(no subject)'),
      h('span', { class: 'email-view-preview' }, this._truncate(email.body, 80))
    );
    row.appendChild(subjectCol);

    // Timestamp
    if (ts) {
      row.appendChild(h('span', { class: 'email-view-time' }, formatTime(ts)));
    }

    return row;
  }

  // ── Tab badges ─────────────────────────────────────────────

  _updateTabBadges() {
    if (!this._tabs) return;
    const inboxBadge = this._unreadCount > 0 ? `${this._unreadCount}` : String(this._inbox.length);
    this._tabs.setBadge('inbox', inboxBadge);
    this._tabs.setBadge('sent', String(this._sent.length));

    // Update header unread badge
    const badge = this.el.querySelector('.email-view-unread-badge');
    if (badge) {
      badge.textContent = this._unreadCount > 0 ? `${this._unreadCount} unread` : '';
    }
  }

  // ── Agent picker ───────────────────────────────────────────

  _buildAgentPicker() {
    const select = h('select', {
      class: 'email-view-agent-picker',
      onChange: (e) => {
        this._selectedAgentForContext = e.target.value;
        this._loading = true;
        this._renderList();
        this._fetchData();
      }
    });

    if (this._agents.length === 0) {
      select.appendChild(h('option', { value: '' }, 'No agents'));
    } else {
      for (const agent of this._agents) {
        const opt = h('option', {
          value: agent.id,
          selected: this._selectedAgentForContext === agent.id ||
            (!this._selectedAgentForContext && this._agents[0]?.id === agent.id)
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
    const fromAgentId = this._selectedAgentForContext || this._agents[0]?.id || '';

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
    for (const agent of this._agents) {
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
        } catch (err) {
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
          const fromId = this._selectedAgentForContext || this._agents[0]?.id;
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
    const fromName = email.from_name || fromAgent?.name || email.from_id;
    const ts = email.created_at;

    const msg = h('div', { class: 'email-thread-message' },
      h('div', { class: 'email-thread-message-header' },
        h('span', { class: 'email-thread-message-from' }, fromName),
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

  // ── Helpers ────────────────────────────────────────────────

  _truncate(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  }
}
