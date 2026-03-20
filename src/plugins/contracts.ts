/**
 * Plugin System Contracts
 *
 * Type definitions for the plugin system. Plugins extend Overlord v2 with
 * custom room types, tools, commands, and lifecycle hooks — all sandboxed
 * with explicit permission grants.
 *
 * Plugins declare a manifest (plugin.json) that specifies:
 * - What engine they use (JS or Lua)
 * - What permissions they need
 * - What they provide (room types, tools, commands)
 *
 * The PluginContext is the ONLY API surface exposed to plugin code.
 * No raw Node.js APIs, no direct bus access, no filesystem — just
 * the methods granted by their declared permissions.
 */

import type { Result, ToolDefinition } from '../core/contracts.js';
import type { Bus } from '../core/bus.js';

// ─── Plugin Manifest (plugin.json schema) ───

export interface PluginManifest {
  /** Unique plugin ID (kebab-case, e.g. 'my-custom-rooms') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Semver version string */
  version: string;
  /** Short description of what this plugin does */
  description: string;
  /** Plugin author (optional) */
  author?: string;
  /** Scripting engine: 'js' for Node.js vm sandbox, 'lua' for Lua runtime */
  engine: 'lua' | 'js';
  /** Relative path to main script file (from plugin directory) */
  entrypoint: string;
  /** Permissions this plugin requires — must be explicitly granted */
  permissions: PluginPermission[];
  /** What this plugin provides to the system */
  provides?: PluginProvides;
}

export interface PluginProvides {
  /** Room type names this plugin registers */
  roomTypes?: string[];
  /** Tool names this plugin registers */
  tools?: string[];
  /** Command names this plugin registers */
  commands?: string[];
}

// ─── Permissions ───

export type PluginPermission =
  | 'room:read'       // Read room state (list rooms, get room info)
  | 'room:write'      // Create/modify rooms
  | 'tool:execute'    // Execute tools via the tool registry
  | 'agent:read'      // Read agent state (list agents, get agent info)
  | 'bus:emit'        // Emit events on the event bus
  | 'storage:read'    // Read from plugin-scoped storage
  | 'storage:write'   // Write to plugin-scoped storage
  | 'fs:read'         // Read files from the filesystem
  | 'fs:write'        // Write files to the filesystem
  | 'net:http'        // Make outbound HTTP requests
  | 'security:read'   // Read security state (events, rules, budgets)
  | 'security:write'; // Write security rules, log security events

// ─── Plugin Lifecycle Hooks ───

export type PluginHook =
  | 'onLoad'               // Plugin loaded and initialized
  | 'onUnload'             // Plugin being unloaded (cleanup)
  | 'onRoomEnter'          // An agent entered any room
  | 'onRoomExit'           // An agent exited any room
  | 'onToolExecute'        // A tool was executed (fire-and-forget, post-execution)
  | 'onPhaseAdvance'       // A phase gate advanced
  | 'onPhaseGateEvaluate'  // Phase gate go/no-go decision (queryable)
  | 'onExitDocValidate'    // Custom exit document validation (queryable)
  | 'onAgentAssign'        // Agent assignment strategy (queryable)
  | 'onNotificationRule'   // Alert/notification routing (queryable)
  | 'onProgressReport'     // Custom progress metrics (queryable)
  | 'onBuildingCreate'     // Building initialization customization (queryable)
  | 'onPreToolUse'         // BEFORE tool execution — can block, warn, or allow (queryable)
  | 'onPostToolUse'        // AFTER tool execution — can inspect result, redact, log (queryable)
  | 'onSecurityEvent';     // When a security event occurs (for logging/alerting plugins)

export interface PluginHookData {
  hook: PluginHook;
  [key: string]: unknown;
}

// ─── Plugin Context (API surface exposed to sandboxed plugins) ───

export interface PluginContext {
  /** Plugin's own manifest */
  manifest: Readonly<PluginManifest>;

  /** Scoped logger — logs are tagged with plugin ID */
  log: PluginLogger;

  /** Event bus access — only if 'bus:emit' permission granted */
  bus: PluginBusAPI;

  /** Room access — requires 'room:read' and/or 'room:write' */
  rooms: PluginRoomAPI;

  /** Agent access — requires 'agent:read' */
  agents: PluginAgentAPI;

  /** Tool access — requires 'tool:execute' */
  tools: PluginToolAPI;

  /** Storage access — requires 'storage:read' and/or 'storage:write' */
  storage: PluginStorageAPI;
}

export interface PluginLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

export interface PluginBusAPI {
  /** Emit an event (namespaced to plugin: 'plugin:<pluginId>:<event>') */
  emit(event: string, data?: Record<string, unknown>): void;
  /** Subscribe to an event */
  on(event: string, handler: (data: Record<string, unknown>) => void): void;
  /** Unsubscribe from an event */
  off(event: string, handler: (data: Record<string, unknown>) => void): void;
}

export interface PluginRoomAPI {
  /** List all rooms */
  listRooms(): Result;
  /** Get a room by ID */
  getRoom(roomId: string): Result;
  /** Register a new room type (requires 'room:write') */
  registerRoomType(type: string, factory: unknown): Result;
}

export interface PluginAgentAPI {
  /** List all agents */
  listAgents(filters?: { status?: string; roomId?: string }): Result;
  /** Get agent by ID */
  getAgent(agentId: string): Result;
}

export interface PluginToolAPI {
  /** Register a new tool */
  registerTool(definition: ToolDefinition): Result;
  /** Execute a tool by name */
  executeTool(name: string, params: Record<string, unknown>): Promise<Result>;
}

export interface PluginStorageAPI {
  /** Get a value from plugin-scoped storage */
  get(key: string): unknown;
  /** Set a value in plugin-scoped storage */
  set(key: string, value: unknown): void;
  /** Delete a value from plugin-scoped storage */
  delete(key: string): boolean;
  /** List all keys in plugin-scoped storage */
  keys(): string[];
}

// ─── Plugin Instance (loaded plugin runtime state) ───

export type PluginStatus = 'loading' | 'active' | 'error' | 'unloaded';

export interface PluginInstance {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Current status */
  status: PluginStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Registered lifecycle hook handlers */
  hooks: Partial<Record<PluginHook, PluginHookHandler>>;
  /** The sandboxed context provided to this plugin */
  context: PluginContext;
  /** Timestamp when plugin was loaded */
  loadedAt: number;
  /** Directory path from which this plugin was loaded */
  dir: string;
  /** Whether this plugin is a built-in (shipped with Overlord) */
  isBuiltIn: boolean;
}

/** Log entry from a plugin's scoped logger */
export interface PluginLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: Record<string, unknown>;
}

export type PluginHookHandler = (data: PluginHookData) => void | Promise<void>;

// ─── Security Hook Types ───

/** Return value from onPreToolUse / onPostToolUse hooks */
export interface SecurityHookResult {
  /** 'allow' = proceed, 'warn' = proceed with warning, 'block' = deny execution */
  action: 'allow' | 'warn' | 'block';
  /** Human-readable message explaining the decision */
  message?: string;
  /** Suggestion for a safer alternative */
  suggestion?: string;
}

/** Data passed to onPreToolUse hooks */
export interface PreToolUseHookData extends PluginHookData {
  hook: 'onPreToolUse';
  toolName: string;
  toolParams: Record<string, unknown>;
  agentId: string;
  roomId: string;
  buildingId?: string;
  securityLevel?: string;
}

/** Data passed to onPostToolUse hooks */
export interface PostToolUseHookData extends PluginHookData {
  hook: 'onPostToolUse';
  toolName: string;
  toolParams: Record<string, unknown>;
  agentId: string;
  roomId: string;
  buildingId?: string;
  securityLevel?: string;
  result: unknown;
  success: boolean;
}

/** Security event logged by plugins */
export interface SecurityEvent {
  timestamp: number;
  type: string;
  action: 'allow' | 'warn' | 'block';
  toolName?: string;
  agentId?: string;
  roomId?: string;
  buildingId?: string;
  message: string;
  pluginId?: string;
  details?: Record<string, unknown>;
}

// ─── Plugin Sandbox (execution environment) ───

export interface PluginSandbox {
  /** Execute the plugin's entrypoint script */
  execute(code: string): Result;
  /** Call a lifecycle hook if registered */
  callHook(hook: PluginHook, data: PluginHookData): Promise<Result>;
  /** Get registered hooks */
  getHooks(): Partial<Record<PluginHook, PluginHookHandler>>;
  /** Tear down the sandbox */
  destroy(): void;
}

// ─── Init Params ───

export interface InitPluginsParams {
  bus: Bus;
  rooms: {
    registerRoomType: (type: string, factory: unknown) => void;
    listRooms: () => unknown[];
    getRoom: (roomId: string) => unknown | null;
  };
  agents: {
    listAgents: (filters?: { status?: string; roomId?: string }) => unknown[];
    getAgent: (agentId: string) => unknown | null;
  };
  tools: {
    registerTool: (def: ToolDefinition) => void;
    getTool: (name: string) => ToolDefinition | null;
    executeInRoom: (params: {
      toolName: string;
      params: Record<string, unknown>;
      roomAllowedTools: string[];
      context: { roomId: string; roomType: string; agentId: string; fileScope: string };
    }) => Promise<Result>;
  };
}
