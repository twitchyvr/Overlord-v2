/**
 * Email Orchestrator (#670)
 *
 * Bridges the email system to the conversation loop. When an agent
 * receives an email, this module feeds it into the agent's room
 * as a chat message, then auto-replies with the result.
 *
 * Flow:
 *   1. email:dispatched fires on bus
 *   2. For each recipient agent, check if they're assigned to a room
 *   3. Emit a chat:message on behalf of the email sender
 *   4. When chat:response returns, auto-reply to the email thread
 *
 * Layer: Rooms (depends on Agents, Storage, Core)
 */

import { logger } from '../core/logger.js';
import { getDb } from '../storage/db.js';
import { replyToEmail, markAsRead } from '../agents/agent-email.js';
import type { Bus, BusEventData } from '../core/bus.js';

const log = logger.child({ module: 'email-orchestrator' });

/** Track emails currently being processed to prevent re-entrant loops */
const processingEmails = new Set<string>();

/** Cooldown per agent to prevent flooding (ms) */
const AGENT_COOLDOWN_MS = 5_000;
const lastProcessed = new Map<string, number>();

interface EmailOrchestratorDeps {
  bus: Bus;
}

export function initEmailOrchestrator({ bus }: EmailOrchestratorDeps): void {
  bus.on('email:dispatched', (data: BusEventData) => {
    handleDispatchedEmail(bus, data).catch((err) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Email orchestrator error');
    });
  });

  log.info('Email orchestrator initialized — agents will process received emails');
}

async function handleDispatchedEmail(bus: Bus, data: BusEventData): Promise<void> {
  const emailId = data.id as string;
  const fromId = data.from_id as string;
  const subject = data.subject as string || '(no subject)';
  const body = data.body as string || '';
  const buildingId = data.building_id as string || '';
  const threadId = data.thread_id as string || '';

  if (!emailId) return;

  // Don't process emails sent BY agents (only process emails TO agents)
  // This prevents infinite reply loops
  if (fromId !== '__user__') {
    log.debug({ emailId, fromId }, 'Skipping agent-sent email (only user-sent emails trigger work)');
    return;
  }

  // Get recipients from the email
  const recipients = (data.recipients as Array<{ agent_id: string; type: string }>) || [];
  if (recipients.length === 0) {
    // Try to get recipients from DB
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT agent_id, type FROM agent_email_recipients WHERE email_id = ?',
      ).all(emailId) as Array<{ agent_id: string; type: string }>;
      recipients.push(...rows);
    } catch {
      log.warn({ emailId }, 'Could not fetch email recipients');
      return;
    }
  }

  for (const recipient of recipients) {
    const agentId = recipient.agent_id;

    // Skip the user — they don't auto-process emails
    if (agentId === '__user__') continue;

    // Skip if already processing this email
    if (processingEmails.has(`${emailId}:${agentId}`)) continue;

    // Cooldown check — don't overwhelm agents
    const lastTime = lastProcessed.get(agentId) || 0;
    if (Date.now() - lastTime < AGENT_COOLDOWN_MS) {
      log.debug({ agentId, emailId }, 'Agent on cooldown — skipping email processing');
      continue;
    }

    processingEmails.add(`${emailId}:${agentId}`);
    lastProcessed.set(agentId, Date.now());

    try {
      await processEmailForAgent(bus, {
        emailId,
        agentId,
        fromId,
        subject,
        body,
        buildingId,
        threadId,
      });
    } catch (err) {
      log.error({ agentId, emailId, err: err instanceof Error ? err.message : String(err) }, 'Failed to process email for agent');
    } finally {
      processingEmails.delete(`${emailId}:${agentId}`);
    }
  }
}

async function processEmailForAgent(bus: Bus, params: {
  emailId: string;
  agentId: string;
  fromId: string;
  subject: string;
  body: string;
  buildingId: string;
  threadId: string;
}): Promise<void> {
  const { emailId, agentId, fromId, subject, body, buildingId, threadId } = params;

  // Find the agent's current room
  let roomId: string | null = null;
  try {
    const db = getDb();
    const agent = db.prepare('SELECT current_room_id FROM agents WHERE id = ?').get(agentId) as { current_room_id: string | null } | undefined;
    roomId = agent?.current_room_id || null;

    // If agent has no room, find a default room in the building
    if (!roomId && buildingId) {
      const defaultRoom = db.prepare(`
        SELECT r.id FROM rooms r
        JOIN floors f ON r.floor_id = f.id
        WHERE f.building_id = ?
        ORDER BY r.created_at ASC
        LIMIT 1
      `).get(buildingId) as { id: string } | undefined;
      roomId = defaultRoom?.id || null;
    }
  } catch {
    log.warn({ agentId }, 'Could not resolve agent room');
  }

  if (!roomId) {
    log.warn({ agentId, emailId }, 'Agent has no room — cannot process email');
    return;
  }

  log.info(
    { agentId, emailId, roomId, subject },
    'Processing email for agent — emitting as chat:message',
  );

  // Mark the email as read by the agent
  try {
    markAsRead(emailId, agentId);
  } catch { /* non-fatal */ }

  // Compose the chat message from the email content
  const chatText = `[Email from ${fromId === '__user__' ? 'the project owner' : fromId}]\nSubject: ${subject}\n\n${body}`;

  // Listen for the response to this specific message
  const responsePromise = new Promise<string>((resolve) => {
    const timeout = setTimeout(() => resolve(''), 120_000); // 2 min timeout

    const handler = (responseData: BusEventData) => {
      const respAgentId = responseData.agentId as string;
      const respRoomId = responseData.roomId as string;

      if (respAgentId === agentId && respRoomId === roomId) {
        clearTimeout(timeout);
        bus.off('chat:response', handler);

        // Extract text from response
        const content = responseData.content as Array<{ type: string; text?: string }> || [];
        const text = content
          .filter(b => b.type === 'text' && b.text)
          .map(b => b.text)
          .join('\n');
        resolve(text);
      }
    };

    bus.on('chat:response', handler);
  });

  // Emit the chat message — the chat orchestrator will pick it up
  bus.emit('chat:message', {
    socketId: `email:${emailId}`,
    text: chatText,
    roomId,
    agentId,
    buildingId,
    threadId: `email_thread_${threadId || emailId}`,
    attachments: [],
  });

  // Wait for the agent's response
  const responseText = await responsePromise;

  if (responseText) {
    // Auto-reply to the email with the agent's response
    try {
      const replyResult = replyToEmail(emailId, agentId, responseText, { priority: 'normal' });
      if (replyResult.ok) {
        log.info({ agentId, emailId }, 'Agent auto-replied to email');
      } else {
        log.warn({ agentId, emailId, error: replyResult.error }, 'Failed to auto-reply');
      }
    } catch (err) {
      log.error({ agentId, emailId, err: err instanceof Error ? err.message : String(err) }, 'Auto-reply failed');
    }
  } else {
    log.warn({ agentId, emailId }, 'Agent produced no response for email — no auto-reply sent');
  }
}
