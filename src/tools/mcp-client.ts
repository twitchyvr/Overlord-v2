/**
 * MCP Client — JSON-RPC Subprocess Connection
 *
 * Speaks the Model Context Protocol (MCP) via JSON-RPC 2.0 over stdin/stdout.
 * Each MCP server is a subprocess that provides tools, resources, and prompts.
 *
 * Protocol flow:
 *   1. spawn subprocess → stdin/stdout pipes
 *   2. send initialize request → receive capabilities
 *   3. send notifications/initialized
 *   4. send tools/list → discover available tools
 *   5. send tools/call → execute a tool
 *
 * Reference: https://modelcontextprotocol.io/specification
 */

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'mcp-client' });

// ─── Types ───

export interface McpServerConfig {
  name: string;
  description: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  builtin: boolean;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerInfo {
  name: string;
  description: string;
  status: McpServerStatus;
  tools: string[];
  toolCount: number;
  lastError: string | null;
  enabled: boolean;
  builtin: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

// ─── MCP Server Connection ───

export class McpServerConnection {
  readonly config: McpServerConfig;
  private proc: ReturnType<typeof spawn> | null = null;
  private ready = false;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = '';
  private _tools: McpToolDef[] = [];
  private _status: McpServerStatus = 'disconnected';
  private _lastError: string | null = null;
  private reconnectAttempts = 0;
  readonly maxReconnects = 3;
  private timeoutMs: number;

  constructor(config: McpServerConfig, timeoutMs = 60_000) {
    this.config = config;
    this.timeoutMs = timeoutMs;
  }

  get status(): McpServerStatus { return this._status; }
  get lastError(): string | null { return this._lastError; }
  get tools(): McpToolDef[] { return [...this._tools]; }
  get isReady(): boolean { return this.ready; }

  getInfo(): McpServerInfo {
    return {
      name: this.config.name,
      description: this.config.description,
      status: this._status,
      tools: this._tools.map((t) => t.name),
      toolCount: this._tools.length,
      lastError: this._lastError,
      enabled: this.config.enabled,
      builtin: this.config.builtin,
    };
  }

  /**
   * Start the MCP server subprocess and initialize the connection.
   * Resolves when the server is ready and tools are discovered.
   */
  async start(): Promise<Result> {
    if (this.proc) return ok({ name: this.config.name, status: 'already_running' });

    this._status = 'connecting';
    this._lastError = null;

    // Resolve command to full path to avoid PATH issues in spawned envs
    const command = this.resolveCommand(this.config.command);

    log.info(
      { server: this.config.name, command, args: this.config.args },
      'Starting MCP server',
    );

    try {
      // Merge env: process.env + server-specific env (only non-empty values)
      const env: Record<string, string> = { ...process.env as Record<string, string> };
      for (const [k, v] of Object.entries(this.config.env)) {
        if (v) env[k] = v;
      }

      this.proc = spawn(command, this.config.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk));
      this.proc.stderr!.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) log.warn({ server: this.config.name, stderr: msg }, 'MCP server stderr');
      });

      this.proc.on('exit', (code, signal) => {
        log.warn({ server: this.config.name, code, signal }, 'MCP server exited');
        this.proc = null;
        this.ready = false;
        this._status = 'disconnected';
        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error(`MCP server "${this.config.name}" exited`));
        }
        this.pendingRequests.clear();
      });

      this.proc.on('error', (e: Error) => {
        log.error({ server: this.config.name, error: e.message }, 'MCP server spawn error');
        this._lastError = e.message;
        this._status = 'error';
      });

      // Initialize JSON-RPC handshake
      await this.initialize();
      this._status = 'connected';
      this.reconnectAttempts = 0;

      log.info(
        { server: this.config.name, toolCount: this._tools.length, tools: this._tools.map((t) => t.name) },
        'MCP server connected',
      );

      return ok({ name: this.config.name, tools: this._tools.map((t) => t.name) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ server: this.config.name, error: msg }, 'Failed to start MCP server');
      this._lastError = msg;
      this._status = 'error';
      this.proc?.kill();
      this.proc = null;
      return err('MCP_START_FAILED', `MCP server "${this.config.name}" failed to start: ${msg}`);
    }
  }

  /**
   * Call a tool on this MCP server.
   */
  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<Result<string>> {
    if (!this.ready) {
      return err('MCP_NOT_READY', `MCP server "${this.config.name}" is not ready`);
    }

    try {
      const result = await this.send('tools/call', { name: toolName, arguments: args }) as {
        content?: Array<{ text?: string; type?: string }>;
      };
      const content = result?.content || [];
      const text = content.map((c) => c.text || JSON.stringify(c)).join('\n');
      return ok(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err('MCP_TOOL_ERROR', `MCP tool "${toolName}" on "${this.config.name}" failed: ${msg}`);
    }
  }

  /**
   * Destroy the connection — kill subprocess and clean up.
   */
  destroy(): void {
    if (this.proc) {
      try { this.proc.kill(); } catch { /* ignore */ }
      this.proc = null;
    }
    this.ready = false;
    this._status = 'disconnected';
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error(`MCP server "${this.config.name}" destroyed`));
    }
    this.pendingRequests.clear();
    log.debug({ server: this.config.name }, 'MCP server connection destroyed');
  }

  // ─── Private: JSON-RPC Protocol ───

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // Ignore malformed JSON lines
      }
    }
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin?.writable) {
        return reject(new Error(`MCP server "${this.config.name}" not running`));
      }

      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(
          `MCP server "${this.config.name}" timeout on ${method} after ${this.timeoutMs / 1000}s`,
        ));
      }, this.timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.proc.stdin.write(msg + '\n');
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.proc?.stdin?.writable) return;
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.proc.stdin.write(msg + '\n');
  }

  private async initialize(): Promise<void> {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'overlord-v2', version: '1.0.0-rc.2' },
    });

    this.notify('notifications/initialized', {});
    this.ready = true;

    // Discover tools
    try {
      const result = await this.send('tools/list', {}) as { tools?: McpToolDef[] };
      this._tools = result?.tools || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ server: this.config.name, error: msg }, 'Could not list MCP tools');
      this._tools = [];
    }
  }

  private resolveCommand(command: string): string {
    if (['npx', 'node', 'uvx'].includes(command)) {
      try {
        const resolved = execFileSync('which', [command], {
          encoding: 'utf8',
          timeout: 3_000,
        }).trim();
        if (resolved) return resolved;
      } catch {
        // Fall through to plain command name
      }
    }
    return command;
  }
}
