/**
 * MCP Manager
 *
 * Manages multiple MCP (Model Context Protocol) server connections.
 * Discovers servers from config, starts enabled ones, registers their
 * tools in the tool registry, and handles enable/disable lifecycle.
 *
 * MCP tools are registered with the naming convention: mcp_<server>_<tool>
 * e.g. mcp_github_create_issue, mcp_filesystem_read_file
 *
 * Architecture: Tools layer — MCP servers provide tools, so they integrate
 * through the tool registry. MCP tools become first-class room tools.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { ok, err } from '../core/contracts.js';
import type { Result, ToolDefinition, ToolRegistryAPI } from '../core/contracts.js';
import type { Bus } from '../core/bus.js';
import { McpServerConnection } from './mcp-client.js';
import type { McpServerConfig, McpServerInfo } from './mcp-client.js';

const log = logger.child({ module: 'mcp-manager' });

// ─── Server Presets ───

export const SERVER_PRESETS: Record<string, McpServerConfig> = {
  github: {
    name: 'github',
    description: 'GitHub MCP: repos, issues, PRs, file browsing',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    enabled: false,
    builtin: true,
  },
  filesystem: {
    name: 'filesystem',
    description: 'Filesystem MCP: read/write files via MCP protocol',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: {},
    enabled: false,
    builtin: true,
  },
  sequential_thinking: {
    name: 'sequential_thinking',
    description: 'Sequential thinking MCP: structured reasoning steps',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: {},
    enabled: false,
    builtin: true,
  },
  obsidian: {
    name: 'obsidian',
    description: 'Obsidian Local REST API MCP: read/write/search vault notes',
    command: 'npx',
    args: ['-y', 'obsidian-local-rest-api-mcp-server'],
    env: { OBSIDIAN_API_KEY: '', OBSIDIAN_API_URL: 'https://127.0.0.1:27124' },
    enabled: false,
    builtin: true,
  },
};

// ─── Module State ───

const servers = new Map<string, McpServerConnection>();
let toolRegistry: ToolRegistryAPI | null = null;
let moduleBus: Bus | null = null;

// ─── Init ───

export interface InitMcpParams {
  bus: Bus;
  tools: ToolRegistryAPI;
}

/**
 * Initialize the MCP manager.
 * Loads config, starts enabled servers, and wires bus events.
 */
export async function initMcp(params: InitMcpParams): Promise<void> {
  const enabled = config.get('ENABLE_MCP');
  if (!enabled) {
    log.info('MCP system disabled (ENABLE_MCP=false)');
    return;
  }

  toolRegistry = params.tools;
  moduleBus = params.bus;
  const timeoutMs = config.get('MCP_TIMEOUT_MS') as number;

  // Wire bus events
  wireBusHandlers(params.bus);

  // Clean shutdown
  params.bus.on('server:shutdown', () => {
    for (const conn of servers.values()) {
      conn.destroy();
    }
    servers.clear();
    log.info('MCP servers shut down');
  });

  // Start enabled servers
  const configs = loadServerConfig();
  let started = 0;
  let failed = 0;

  for (const cfg of configs) {
    if (!cfg.enabled) continue;

    const conn = new McpServerConnection(cfg, timeoutMs);
    servers.set(cfg.name, conn);

    // Retry with exponential backoff
    let success = false;
    for (let attempt = 0; attempt <= conn.maxReconnects; attempt++) {
      const result = await conn.start();
      if (result.ok) {
        registerServerTools(conn);
        success = true;
        started++;
        break;
      }

      if (attempt < conn.maxReconnects) {
        const delay = Math.min(5000 * (attempt + 1), 15000);
        log.warn(
          { server: cfg.name, attempt: attempt + 1, maxRetries: conn.maxReconnects, delayMs: delay },
          'MCP server retry',
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (!success) {
      failed++;
      log.error({ server: cfg.name }, 'MCP server failed to start after all retries');
    }
  }

  broadcastServerList();
  log.info({ started, failed, total: configs.filter((c) => c.enabled).length }, 'MCP manager initialized');
}

// ─── Config Loading ───

/**
 * Load MCP server configs from the configured file.
 * Falls back to presets if file doesn't exist.
 */
export function loadServerConfig(): McpServerConfig[] {
  const cfgPath = path.resolve(config.get('MCP_SERVERS_CONFIG') as string);

  if (!fs.existsSync(cfgPath)) {
    log.info({ path: cfgPath }, 'MCP config file not found — using presets');
    return Object.values(SERVER_PRESETS);
  }

  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw) as McpServerConfig[];
    if (!Array.isArray(parsed)) {
      log.warn({ path: cfgPath }, 'MCP config is not an array — using presets');
      return Object.values(SERVER_PRESETS);
    }
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ path: cfgPath, error: msg }, 'Failed to parse MCP config');
    return Object.values(SERVER_PRESETS);
  }
}

/**
 * Save current server configs to the config file.
 */
export function saveServerConfig(): void {
  const cfgPath = path.resolve(config.get('MCP_SERVERS_CONFIG') as string);
  const configs = [...servers.values()].map((s) => s.config);

  try {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(configs, null, 2));
    log.debug({ path: cfgPath, count: configs.length }, 'MCP config saved');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ path: cfgPath, error: msg }, 'Failed to save MCP config');
  }
}

// ─── Server Operations ───

/**
 * List all known MCP servers (active + disabled from config).
 */
export function listServers(): McpServerInfo[] {
  const configs = loadServerConfig();
  const result: McpServerInfo[] = [];
  const seen = new Set<string>();

  for (const cfg of configs) {
    seen.add(cfg.name);
    const conn = servers.get(cfg.name);

    if (conn) {
      result.push(conn.getInfo());
    } else {
      result.push({
        name: cfg.name,
        description: cfg.description || '',
        status: 'disconnected',
        tools: [],
        toolCount: 0,
        lastError: null,
        enabled: cfg.enabled,
        builtin: cfg.builtin,
      });
    }
  }

  // Include any live connections not in config (custom additions)
  for (const [name, conn] of servers) {
    if (!seen.has(name)) {
      result.push(conn.getInfo());
    }
  }

  return result;
}

/**
 * Enable and start a server by name.
 */
export async function enableServer(name: string, envOverrides: Record<string, string> = {}): Promise<Result<McpServerInfo>> {
  let conn = servers.get(name);

  if (!conn) {
    const configs = loadServerConfig();
    const cfg = configs.find((c) => c.name === name) || SERVER_PRESETS[name];
    if (!cfg) {
      return err('MCP_UNKNOWN_SERVER', `Unknown MCP server: "${name}"`);
    }

    cfg.enabled = true;
    Object.assign(cfg.env, envOverrides);
    const timeoutMs = config.get('MCP_TIMEOUT_MS') as number;
    conn = new McpServerConnection(cfg, timeoutMs);
    servers.set(name, conn);
  } else {
    (conn.config as McpServerConfig).enabled = true;
    Object.assign(conn.config.env, envOverrides);
  }

  const startResult = await conn.start();
  if (!startResult.ok) {
    return err('MCP_START_FAILED', startResult.error.message);
  }

  registerServerTools(conn);
  saveServerConfig();
  broadcastServerList();

  return ok(conn.getInfo());
}

/**
 * Disable and stop a server by name.
 */
export function disableServer(name: string): Result<McpServerInfo> {
  const conn = servers.get(name);
  if (!conn) {
    return err('MCP_SERVER_NOT_FOUND', `MCP server "${name}" is not loaded`);
  }

  (conn.config as McpServerConfig).enabled = false;
  conn.destroy();
  saveServerConfig();
  broadcastServerList();

  return ok(conn.getInfo());
}

/**
 * Add a custom MCP server and start it.
 */
export async function addServer(cfg: McpServerConfig): Promise<Result<McpServerInfo>> {
  if (!cfg.name || !cfg.command) {
    return err('MCP_INVALID_CONFIG', 'Server name and command are required');
  }

  if (servers.has(cfg.name)) {
    return err('MCP_DUPLICATE', `Server "${cfg.name}" already exists`);
  }

  cfg.enabled = true;
  cfg.builtin = false;
  const timeoutMs = config.get('MCP_TIMEOUT_MS') as number;
  const conn = new McpServerConnection(cfg, timeoutMs);
  servers.set(cfg.name, conn);

  const startResult = await conn.start();
  if (!startResult.ok) {
    servers.delete(cfg.name);
    return err('MCP_START_FAILED', startResult.error.message);
  }

  registerServerTools(conn);
  saveServerConfig();
  broadcastServerList();

  return ok(conn.getInfo());
}

/**
 * Remove a server (stop + delete from config).
 */
export function removeServer(name: string): Result {
  const conn = servers.get(name);
  if (conn) {
    conn.destroy();
    servers.delete(name);
  }
  saveServerConfig();
  broadcastServerList();

  return ok({ name, status: 'removed' });
}

/**
 * Get a server connection by name.
 */
export function getServer(name: string): McpServerConnection | undefined {
  return servers.get(name);
}

/**
 * Call a tool on a specific MCP server.
 */
export async function callServerTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<Result<string>> {
  const conn = servers.get(serverName);
  if (!conn) {
    return err('MCP_SERVER_NOT_FOUND', `MCP server "${serverName}" is not loaded`);
  }
  return conn.callTool(toolName, args);
}

// ─── Tool Registration ───

/**
 * Register all tools from an MCP server in the tool registry.
 * Tools are namespaced: mcp_<server>_<tool>
 */
function registerServerTools(conn: McpServerConnection): void {
  if (!toolRegistry) return;

  for (const toolDef of conn.tools) {
    const toolName = `mcp_${conn.config.name}_${toolDef.name}`;

    const definition: ToolDefinition = {
      name: toolName,
      description: `[MCP:${conn.config.name}] ${toolDef.description || toolDef.name}`,
      category: 'mcp',
      inputSchema: toolDef.inputSchema || { type: 'object', properties: {} },
      execute: async (params: Record<string, unknown>) => {
        const result = await conn.callTool(toolDef.name, params);
        if (!result.ok) throw new Error(result.error.message);
        return result.data;
      },
    };

    try {
      toolRegistry.registerTool(definition);
      log.info({ server: conn.config.name, tool: toolName }, 'MCP tool registered');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ server: conn.config.name, tool: toolName, error: msg }, 'Failed to register MCP tool');
    }
  }
}

// ─── Bus Event Handlers ───

function wireBusHandlers(bus: Bus): void {
  bus.on('mcp:list-servers', () => {
    bus.emit('mcp:servers-updated', { servers: listServers() });
  });

  bus.on('mcp:enable-server', async (data: Record<string, unknown>) => {
    const name = data.name as string;
    const env = (data.env || {}) as Record<string, string>;
    const result = await enableServer(name, env);
    bus.emit('mcp:server-result', { name, ...result });
  });

  bus.on('mcp:disable-server', (data: Record<string, unknown>) => {
    const name = data.name as string;
    const result = disableServer(name);
    bus.emit('mcp:server-result', { name, ...result });
  });

  bus.on('mcp:add-server', async (data: Record<string, unknown>) => {
    const cfg = data as unknown as McpServerConfig;
    const result = await addServer(cfg);
    bus.emit('mcp:server-result', { name: cfg.name, ...result });
  });

  bus.on('mcp:remove-server', (data: Record<string, unknown>) => {
    const name = data.name as string;
    const result = removeServer(name);
    bus.emit('mcp:server-result', { name, ...result });
  });

  log.debug('MCP bus handlers wired');
}

function broadcastServerList(): void {
  if (!moduleBus) return;
  try {
    moduleBus.emit('mcp:servers-updated', { servers: listServers() });
  } catch {
    // Ignore broadcast failures
  }
}
