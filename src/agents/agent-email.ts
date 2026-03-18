/**
 * Agent Email Service
 *
 * Asynchronous agent-to-agent messaging system. Agents can send structured
 * emails (with To/Cc, subject, body, priority) and process their inbox
 * when idle. Emails are threaded and persistent.
 *
 * Layer: Agents (depends on Storage, Core)
 */

import { randomUUID } from 'crypto';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';
import { getDb } from '../storage/db.js';
import { getAgent } from './agent-registry.js';

const log = logger.child({ module: 'agents:email' });

// ─── Types ───

export interface EmailRow {
  id: string;
  thread_id: string;
  from_id: string;
  subject: string;
  body: string;
  priority: string;
  status: string;
  building_id: string | null;
  parent_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface EmailRecipientRow {
  id: string;
  email_id: string;
  agent_id: string;
  type: string;
  read_at: string | null;
}

export interface EmailWithRecipients extends EmailRow {
  recipients: EmailRecipientRow[];
  from_name?: string;
}

export interface SendEmailParams {
  fromId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  priority?: 'normal' | 'urgent' | 'low';
  buildingId?: string;
  parentId?: string;
  threadId?: string;
}

// ─── Send Email ───

/**
 * Send an email from one agent to one or more agents.
 * Creates the email record and recipient entries.
 */
export function sendEmail(params: SendEmailParams): Result {
  const db = getDb();

  // Validate sender exists in agent registry (allow __user__ for human user mail #667)
  const isUserSender = params.fromId === '__user__';
  const senderAgent = isUserSender ? null : getAgent(params.fromId);
  if (!isUserSender && !senderAgent) {
    return err('AGENT_NOT_FOUND', `Sender agent ${params.fromId} does not exist in registry`);
  }

  // Prevent self-send
  if (params.to.includes(params.fromId)) {
    return err('EMAIL_SELF_SEND', 'Cannot send email to self');
  }

  const id = `email_${randomUUID()}`;

  // Fix operator precedence: explicit threadId > parentId lookup > new thread
  const threadId = params.threadId
    ? params.threadId
    : params.parentId
      ? (getThreadId(params.parentId) || id)
      : id;

  try {
    // Wrap in transaction for atomicity — if any recipient insert fails,
    // the entire operation rolls back (no orphaned emails).
    const insertAll = db.transaction(() => {
      // Insert the email
      db.prepare(`
        INSERT INTO agent_emails (id, thread_id, from_id, subject, body, priority, building_id, parent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        threadId,
        params.fromId,
        params.subject,
        params.body,
        params.priority || 'normal',
        params.buildingId || null,
        params.parentId || null,
      );

      // Insert recipients (to)
      for (const agentId of params.to) {
        const recipientId = `rcpt_${randomUUID()}`;
        db.prepare(`
          INSERT INTO agent_email_recipients (id, email_id, agent_id, type)
          VALUES (?, ?, ?, 'to')
        `).run(recipientId, id, agentId);
      }

      // Insert recipients (cc)
      if (params.cc) {
        for (const agentId of params.cc) {
          const recipientId = `rcpt_${randomUUID()}`;
          db.prepare(`
            INSERT INTO agent_email_recipients (id, email_id, agent_id, type)
            VALUES (?, ?, ?, 'cc')
          `).run(recipientId, id, agentId);
        }
      }
    });

    insertAll();

    log.info({ emailId: id, from: params.fromId, to: params.to, cc: params.cc, subject: params.subject, priority: params.priority }, 'Email sent');
    return ok({ id, threadId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message, from: params.fromId }, 'Failed to send email');
    return err('EMAIL_SEND_FAILED', message);
  }
}

/**
 * Get the thread ID for an existing email (for replies).
 */
function getThreadId(parentId: string): string | null {
  if (!parentId) return null;
  const db = getDb();
  const parent = db.prepare('SELECT thread_id FROM agent_emails WHERE id = ?').get(parentId) as { thread_id: string } | undefined;
  return parent?.thread_id || null;
}

// ─── Inbox ───

/**
 * Get inbox for an agent — emails they're a recipient of.
 */
export function getInbox(
  agentId: string,
  opts: { status?: string; priority?: string; limit?: number; offset?: number; buildingId?: string } = {},
): EmailWithRecipients[] {
  const db = getDb();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let sql = `
    SELECT DISTINCT e.*, a.name AS from_name
    FROM agent_emails e
    JOIN agent_email_recipients r ON r.email_id = e.id
    LEFT JOIN agents a ON a.id = e.from_id
    WHERE r.agent_id = ?
  `;
  const params: unknown[] = [agentId];

  // Filter by building to prevent cross-project data bleed (#772)
  if (opts.buildingId) {
    sql += ' AND e.building_id = ?';
    params.push(opts.buildingId);
  }

  if (opts.status) {
    sql += ' AND e.status = ?';
    params.push(opts.status);
  }
  if (opts.priority) {
    sql += ' AND e.priority = ?';
    params.push(opts.priority);
  }

  sql += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const emails = db.prepare(sql).all(...params) as Array<EmailRow & { from_name: string }>;

  return emails.map((e) => ({
    ...e,
    recipients: getRecipients(e.id),
  }));
}

/**
 * Get sent emails for an agent.
 */
export function getSentEmails(
  agentId: string,
  opts: { limit?: number; offset?: number; buildingId?: string } = {},
): EmailWithRecipients[] {
  const db = getDb();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let sql = `
    SELECT e.*, a.name AS from_name
    FROM agent_emails e
    LEFT JOIN agents a ON a.id = e.from_id
    WHERE e.from_id = ?
  `;
  const params: unknown[] = [agentId];

  // Filter by building (#772)
  if (opts.buildingId) {
    sql += ' AND e.building_id = ?';
    params.push(opts.buildingId);
  }

  sql += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const emails = db.prepare(sql).all(...params) as Array<EmailRow & { from_name: string }>;

  return emails.map((e) => ({
    ...e,
    recipients: getRecipients(e.id),
  }));
}

/**
 * Get an email thread — all emails in the thread in chronological order.
 */
export function getThread(threadId: string): EmailWithRecipients[] {
  const db = getDb();
  const emails = db.prepare(`
    SELECT e.*, a.name AS from_name
    FROM agent_emails e
    LEFT JOIN agents a ON a.id = e.from_id
    WHERE e.thread_id = ?
    ORDER BY e.created_at ASC
  `).all(threadId) as Array<EmailRow & { from_name: string }>;

  return emails.map((e) => ({
    ...e,
    recipients: getRecipients(e.id),
  }));
}

/**
 * Get a single email by ID.
 */
export function getEmail(emailId: string): EmailWithRecipients | null {
  const db = getDb();
  const email = db.prepare(`
    SELECT e.*, a.name AS from_name
    FROM agent_emails e
    LEFT JOIN agents a ON a.id = e.from_id
    WHERE e.id = ?
  `).get(emailId) as (EmailRow & { from_name: string }) | undefined;

  if (!email) return null;

  return {
    ...email,
    recipients: getRecipients(email.id),
  };
}

/**
 * Get recipients for an email.
 */
function getRecipients(emailId: string): EmailRecipientRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM agent_email_recipients WHERE email_id = ?').all(emailId) as EmailRecipientRow[];
}

// ─── Status Management ───

/**
 * Mark an email as read (by a specific recipient).
 */
export function markAsRead(emailId: string, agentId: string): Result {
  const db = getDb();

  try {
    // __user__ (project owner) bypasses recipient check (#728)
    // The user can read any email without being in agent_email_recipients
    if (agentId === '__user__') {
      db.prepare("UPDATE agent_emails SET status = 'read', read_at = datetime('now') WHERE id = ? AND read_at IS NULL")
        .run(emailId);
      return ok({ emailId, agentId, readAt: new Date().toISOString() });
    }

    // Verify the agent is actually a recipient of this email
    const recipient = db.prepare(
      'SELECT id FROM agent_email_recipients WHERE email_id = ? AND agent_id = ?',
    ).get(emailId, agentId) as { id: string } | undefined;

    if (!recipient) {
      return err('EMAIL_NOT_RECIPIENT', `Agent ${agentId} is not a recipient of email ${emailId}`);
    }

    // Mark the recipient's copy as read
    db.prepare(`
      UPDATE agent_email_recipients SET read_at = datetime('now')
      WHERE email_id = ? AND agent_id = ? AND read_at IS NULL
    `).run(emailId, agentId);

    // Check if all recipients have read — if so, mark email as read
    const unread = db.prepare(`
      SELECT COUNT(*) as cnt FROM agent_email_recipients
      WHERE email_id = ? AND read_at IS NULL
    `).get(emailId) as { cnt: number };

    if (unread.cnt === 0) {
      db.prepare("UPDATE agent_emails SET status = 'read', read_at = datetime('now') WHERE id = ?").run(emailId);
    }

    return ok({ emailId, agentId, readAt: new Date().toISOString() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err('EMAIL_MARK_READ_FAILED', message);
  }
}

/**
 * Get unread count for an agent.
 */
export function getUnreadCount(agentId: string, buildingId?: string): number {
  const db = getDb();
  let sql = `
    SELECT COUNT(DISTINCT r.email_id) as cnt
    FROM agent_email_recipients r
    JOIN agent_emails e ON e.id = r.email_id
    WHERE r.agent_id = ? AND r.read_at IS NULL
  `;
  const params: unknown[] = [agentId];

  if (buildingId) {
    sql += ' AND e.building_id = ?';
    params.push(buildingId);
  }

  const result = db.prepare(sql).get(...params) as { cnt: number };
  return result.cnt;
}

/**
 * Get pending (unread + urgent first) emails for idle processing.
 * Returns urgent emails first, then normal unread.
 */
export function getPendingEmails(agentId: string, limit = 10, buildingId?: string): EmailWithRecipients[] {
  const db = getDb();

  let sql = `
    SELECT DISTINCT e.*, a.name AS from_name
    FROM agent_emails e
    JOIN agent_email_recipients r ON r.email_id = e.id
    LEFT JOIN agents a ON a.id = e.from_id
    WHERE r.agent_id = ? AND r.read_at IS NULL
  `;
  const params: unknown[] = [agentId];

  if (buildingId) {
    sql += ' AND e.building_id = ?';
    params.push(buildingId);
  }

  sql += `
    ORDER BY
      CASE e.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      e.created_at ASC
    LIMIT ?
  `;
  params.push(limit);

  const emails = db.prepare(sql).all(...params) as Array<EmailRow & { from_name: string }>;

  return emails.map((e) => ({
    ...e,
    recipients: getRecipients(e.id),
  }));
}

// ─── Reply ───

/**
 * Reply to an email. Creates a new email in the same thread.
 */
export function replyToEmail(
  emailId: string,
  fromId: string,
  body: string,
  opts: { replyAll?: boolean; priority?: 'normal' | 'urgent' | 'low' } = {},
): Result {
  const original = getEmail(emailId);
  if (!original) return err('EMAIL_NOT_FOUND', `Email ${emailId} does not exist`);

  // Validate sender exists in agent registry (allow __user__ for human user #667)
  const isUserSender = fromId === '__user__';
  const senderAgent = isUserSender ? null : getAgent(fromId);
  if (!isUserSender && !senderAgent) return err('AGENT_NOT_FOUND', `Agent ${fromId} does not exist in registry`);

  const validatedFromId = isUserSender ? '__user__' : senderAgent!.id;

  // Determine recipients: reply to sender, or reply-all includes all recipients
  const to = [original.from_id];
  let cc: string[] = [];

  if (opts.replyAll) {
    const allRecipients = original.recipients
      .map((r) => r.agent_id)
      .filter((id) => id !== validatedFromId && id !== original.from_id);
    cc = allRecipients;
  }

  return sendEmail({
    fromId: validatedFromId,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject: original.subject.startsWith('Re: ') ? original.subject : `Re: ${original.subject}`,
    body,
    priority: opts.priority || (original.priority as 'normal' | 'urgent' | 'low'),
    buildingId: original.building_id || undefined,
    parentId: emailId,
    threadId: original.thread_id,
  });
}

/**
 * Forward an email to other agents.
 */
export function forwardEmail(
  emailId: string,
  fromId: string,
  to: string[],
  body?: string,
): Result {
  const original = getEmail(emailId);
  if (!original) return err('EMAIL_NOT_FOUND', `Email ${emailId} does not exist`);

  // Validate sender exists in agent registry (allow __user__ for human user #667)
  const isUserSender = fromId === '__user__';
  const senderAgent = isUserSender ? null : getAgent(fromId);
  if (!isUserSender && !senderAgent) return err('AGENT_NOT_FOUND', `Agent ${fromId} does not exist in registry`);

  const validatedFromId = isUserSender ? '__user__' : senderAgent!.id;

  // Resolve original sender name from registry (not from potentially stale email data)
  const originalSenderAgent = getAgent(original.from_id);
  const originalFromName = originalSenderAgent?.display_name || originalSenderAgent?.name || original.from_name || original.from_id;

  const forwardBody = body
    ? `${body}\n\n--- Forwarded ---\nFrom: ${originalFromName}\nSubject: ${original.subject}\n\n${original.body}`
    : `--- Forwarded ---\nFrom: ${originalFromName}\nSubject: ${original.subject}\n\n${original.body}`;

  return sendEmail({
    fromId: validatedFromId,
    to,
    subject: original.subject.startsWith('Fwd: ') ? original.subject : `Fwd: ${original.subject}`,
    body: forwardBody,
    buildingId: original.building_id || undefined,
    parentId: emailId,
    threadId: original.thread_id,
  });
}
