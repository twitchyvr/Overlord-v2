/**
 * GNAP Messaging Adapter (#600)
 *
 * Git-backed persistent messaging via the GNAP protocol.
 * Messages are stored as JSON files in a .gnap/messages/ directory
 * within the project's working directory, making them auditable
 * through git history.
 *
 * Layer: Agents (depends on Storage, Core)
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { logger } from '../core/logger.js';
import type { MessagingPort, AgentMessage } from '../core/messaging-port.js';

const log = logger.child({ module: 'gnap-messaging' });

interface GnapConfig {
  repoPath: string;  // Path to the .gnap directory
}

export class GnapMessagingAdapter implements MessagingPort {
  private _basePath: string;
  private _messagesDir: string;
  private _subscribers: Map<string, Set<(msg: AgentMessage) => void>> = new Map();

  constructor(config: GnapConfig) {
    this._basePath = resolve(config.repoPath);

    // Validate path is inside /tmp or a user home directory (not system paths)
    const safePrefixes = ['/tmp', '/var/tmp', '/Users', '/home', process.env.HOME || '/nonexistent'];
    const isSafe = safePrefixes.some(p => p && this._basePath.startsWith(p));
    if (!isSafe) {
      throw new Error(`GNAP repoPath must be within a safe directory, got: ${this._basePath}`);
    }

    this._messagesDir = join(this._basePath, '.gnap', 'messages');

    // Ensure directories exist
    if (!existsSync(this._messagesDir)) {
      mkdirSync(this._messagesDir, { recursive: true });
      log.info({ path: this._messagesDir }, 'Created GNAP messages directory');
    }
  }

  async send(to: string, message: Omit<AgentMessage, 'id' | 'timestamp' | 'transport'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: randomUUID(),
      timestamp: Date.now(),
      transport: 'gnap',
    };

    // Write message as JSON file
    const filename = `${fullMessage.timestamp}-${fullMessage.id.slice(0, 8)}.json`;
    const filePath = join(this._messagesDir, filename);

    try {
      writeFileSync(filePath, JSON.stringify(fullMessage, null, 2), 'utf8');
      log.debug({ id: fullMessage.id, to, type: message.type }, 'GNAP message written');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: msg, filePath }, 'Failed to write GNAP message');
      throw new Error(`GNAP write failed: ${msg}`);
    }

    // Notify subscribers
    const subs = this._subscribers.get(to);
    if (subs) {
      for (const cb of subs) {
        try { cb(fullMessage); } catch { /* subscriber error shouldn't crash adapter */ }
      }
    }
  }

  async receive(agentId: string): Promise<AgentMessage[]> {
    try {
      const files = readdirSync(this._messagesDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 100); // Bound result set

      const messages: AgentMessage[] = [];
      for (const file of files) {
        try {
          const content = readFileSync(join(this._messagesDir, file), 'utf8');
          const msg = JSON.parse(content) as AgentMessage;
          if (msg.to === agentId) { // Only messages TO this agent (matches bus adapter contract)
            messages.push(msg);
          }
        } catch { /* skip malformed files */ }
      }
      return messages;
    } catch {
      return [];
    }
  }

  subscribe(agentId: string, callback: (msg: AgentMessage) => void): () => void {
    if (!this._subscribers.has(agentId)) {
      this._subscribers.set(agentId, new Set());
    }
    this._subscribers.get(agentId)!.add(callback);

    return () => {
      const subs = this._subscribers.get(agentId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) this._subscribers.delete(agentId);
      }
    };
  }

  async history(agentId: string, limit: number = 50): Promise<AgentMessage[]> {
    // History includes both sent AND received (unlike receive which is incoming only)
    try {
      const files = readdirSync(this._messagesDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 200);

      const messages: AgentMessage[] = [];
      for (const file of files) {
        if (messages.length >= limit) break;
        try {
          const content = readFileSync(join(this._messagesDir, file), 'utf8');
          const msg = JSON.parse(content) as AgentMessage;
          if (msg.to === agentId || msg.from === agentId) {
            messages.push(msg);
          }
        } catch { /* skip malformed files */ }
      }
      return messages;
    } catch {
      return [];
    }
  }

  /**
   * Get GNAP status — directory exists, writable, message count, last write (#622)
   */
  getStatus(): { enabled: boolean; directory: string; messageCount: number; lastWrite: string | null; error: string | null } {
    try {
      if (!existsSync(this._messagesDir)) {
        return { enabled: false, directory: this._messagesDir, messageCount: 0, lastWrite: null, error: 'Directory does not exist' };
      }

      const files = readdirSync(this._messagesDir).filter(f => f.endsWith('.json'));
      let lastWrite: string | null = null;
      if (files.length > 0) {
        const lastFile = files.sort().reverse()[0];
        try {
          const content = readFileSync(join(this._messagesDir, lastFile), 'utf8');
          const msg = JSON.parse(content);
          lastWrite = msg.timestamp ? new Date(msg.timestamp).toISOString() : null;
        } catch { /* skip */ }
      }

      // Test writability
      const testFile = join(this._messagesDir, '.write-test');
      try {
        writeFileSync(testFile, 'test', 'utf8');
        unlinkSync(testFile);
      } catch {
        return { enabled: true, directory: this._messagesDir, messageCount: files.length, lastWrite, error: 'Directory not writable' };
      }

      return { enabled: true, directory: this._messagesDir, messageCount: files.length, lastWrite, error: null };
    } catch (e) {
      return { enabled: false, directory: this._messagesDir, messageCount: 0, lastWrite: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Send a test message to verify the pipeline works end-to-end (#622)
   */
  async sendTest(): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const testMsg = {
        from: 'system',
        to: 'system',
        type: 'notification' as const,
        subject: 'GNAP Test',
        body: `Test message sent at ${new Date().toISOString()}`,
      };
      await this.send('system', testMsg);

      // Verify it was written
      const received = await this.receive('system');
      const found = received.find(m => m.subject === 'GNAP Test');
      if (found) {
        // Clean up test message to avoid polluting the message directory
        const filename = `${found.timestamp}-${found.id.slice(0, 8)}.json`;
        try { unlinkSync(join(this._messagesDir, filename)); } catch { /* cleanup best-effort */ }
        return { ok: true, messageId: found.id };
      }
      return { ok: false, error: 'Message written but not found on read-back' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
