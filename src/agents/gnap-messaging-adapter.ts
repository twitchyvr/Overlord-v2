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
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
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
    const all = await this.receive(agentId);
    return all.slice(0, limit);
  }
}
