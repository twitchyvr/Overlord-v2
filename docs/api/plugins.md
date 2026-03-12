# Plugin System — Complete Reference

Overlord v2 supports plugins that extend the system with custom room types, tools,
commands, and lifecycle hooks. Plugins run in a sandboxed context with explicit
permission grants.

**Source:** `src/plugins/contracts.ts`, `src/plugins/plugin-loader.ts`, `src/plugins/plugin-sandbox.ts`

---

## Plugin Structure

A plugin is a directory containing a manifest and an entrypoint script:

```
plugins/
  my-plugin/
    plugin.json          ← Manifest (required)
    main.js              ← JavaScript entrypoint
    main.lua             ← Lua entrypoint (if engine: "lua")
    README.md            ← Optional documentation
```

---

## Plugin Manifest (`plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A brief description of what this plugin does",
  "author": "Author Name",
  "engine": "js",
  "entrypoint": "main.js",
  "permissions": [
    "room:read",
    "tool:execute",
    "bus:emit"
  ],
  "provides": {
    "roomTypes": ["security-audit"],
    "tools": ["security-scan"],
    "commands": ["scan"]
  }
}
```

### Manifest Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique plugin identifier (lowercase, hyphens) |
| `name` | `string` | Yes | Human-readable name |
| `version` | `string` | Yes | SemVer version string |
| `description` | `string` | Yes | Brief description |
| `author` | `string` | No | Author name or organization |
| `engine` | `'js' \| 'lua'` | Yes | Scripting engine |
| `entrypoint` | `string` | Yes | Path to main script (relative to plugin dir) |
| `permissions` | `string[]` | Yes | Required permissions (see below) |
| `provides` | `object` | No | What the plugin registers |
| `provides.roomTypes` | `string[]` | No | Custom room type identifiers |
| `provides.tools` | `string[]` | No | Custom tool names |
| `provides.commands` | `string[]` | No | Custom command names |

---

## Permissions

Plugins must declare required permissions. The system validates these at load time.

| Permission | Description | Risk Level |
|------------|-------------|------------|
| `room:read` | List and get room information | Low |
| `room:write` | Create and modify rooms | Medium |
| `tool:execute` | Execute registered tools | Medium |
| `agent:read` | List and get agent information | Low |
| `bus:emit` | Emit events on the internal bus | Medium |
| `storage:read` | Read from plugin-scoped storage | Low |
| `storage:write` | Write to plugin-scoped storage | Low |
| `fs:read` | Read files from the filesystem | High |
| `fs:write` | Write files to the filesystem | High |
| `net:http` | Make outbound HTTP requests | High |

---

## Plugin Context API

When loaded, a plugin receives a context object with sandboxed access to system APIs.
Only APIs matching granted permissions are available.

### `context.manifest`
Read-only access to the plugin's own manifest.

```javascript
module.exports = function(context) {
  console.log(`Plugin ${context.manifest.name} v${context.manifest.version} loaded`);
};
```

### `context.log`
Scoped logger (prefixed with the plugin ID).

```javascript
context.log.info('Plugin initialized');
context.log.warn('Something unusual happened');
context.log.error('Something went wrong', { details: '...' });
```

### `context.bus`
Event bus access (requires `bus:emit` permission).

```javascript
// Emit an event
context.bus.emit('my-plugin:scan-complete', { findings: 3 });

// Subscribe to events
context.bus.on('phase:advanced', (data) => {
  context.log.info(`Phase advanced to ${data.to}`);
});
```

### `context.rooms`
Room management (requires `room:read` or `room:write` permission).

```javascript
// List rooms
const rooms = await context.rooms.list();

// Get room details
const room = await context.rooms.get(roomId);

// Register a custom room type (requires room:write)
context.rooms.registerType({
  type: 'security-audit',
  floor: 'integration',
  tables: [{ type: 'audit_table', seats: 2 }],
  tools: ['security-scan', 'read_file', 'bash'],
  exitRequirements: ['audit_report'],
  fileScope: 'read-only'
});
```

### `context.agents`
Agent information (requires `agent:read` permission).

```javascript
const agents = await context.agents.list();
const agent = await context.agents.get(agentId);
```

### `context.tools`
Tool management (requires `tool:execute` permission).

```javascript
// Register a custom tool
context.tools.register({
  name: 'security-scan',
  description: 'Scan codebase for security vulnerabilities',
  category: 'security',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Directory to scan' },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
    },
    required: ['target']
  },
  execute: async (params, ctx) => {
    const findings = await runSecurityScan(params.target, params.severity);
    return { ok: true, data: { findings, count: findings.length } };
  }
});

// Execute a tool (within permission scope)
const result = await context.tools.execute('bash', { command: 'npm audit' });
```

### `context.storage`
Plugin-scoped key-value storage (requires `storage:read`/`storage:write`).

```javascript
// Write
await context.storage.set('last-scan', { timestamp: Date.now(), findings: 5 });

// Read
const lastScan = await context.storage.get('last-scan');

// Delete
await context.storage.delete('last-scan');
```

---

## Lifecycle Hooks

Plugins can implement lifecycle hooks that fire at specific system events.

### `onLoad`
Called when the plugin is loaded. Use for initialization.

```javascript
module.exports = function(context) {
  // This IS the onLoad hook — the exported function itself

  // Register tools, room types, commands here
  context.tools.register({ /* ... */ });

  // Return hook handlers
  return {
    onUnload: () => { /* cleanup */ },
    onRoomEnter: (data) => { /* agent entered a room */ },
    onRoomExit: (data) => { /* agent exited a room */ },
    onToolExecute: (data) => { /* tool was executed */ },
    onPhaseAdvance: (data) => { /* phase advanced */ }
  };
};
```

### `onUnload`
Called when the plugin is being unloaded. Clean up resources.

```javascript
onUnload: () => {
  context.log.info('Plugin unloading — cleaning up');
  // Cancel timers, close connections, etc.
}
```

### `onRoomEnter`
Called when any agent enters any room.

```javascript
onRoomEnter: ({ roomId, roomType, agentId, agentName }) => {
  if (roomType === 'security-audit') {
    context.log.info(`Agent ${agentName} entered security audit room`);
  }
}
```

### `onRoomExit`
Called when any agent exits any room.

```javascript
onRoomExit: ({ roomId, roomType, agentId }) => {
  context.log.info(`Agent ${agentId} exited ${roomType}`);
}
```

### `onToolExecute`
Called after any tool execution completes.

```javascript
onToolExecute: ({ toolName, agentId, roomId, result, duration }) => {
  if (toolName === 'bash' && result.data?.exitCode !== 0) {
    context.log.warn(`Bash command failed in room ${roomId}`);
  }
}
```

### `onPhaseAdvance`
Called when a building advances to a new phase.

```javascript
onPhaseAdvance: ({ buildingId, from, to }) => {
  context.log.info(`Building ${buildingId} advanced: ${from} → ${to}`);
}
```

---

## Complete Plugin Example

```javascript
// plugins/security-audit/main.js

module.exports = function(context) {
  context.log.info('Security Audit plugin loaded');

  // Register a custom tool
  context.tools.register({
    name: 'security-scan',
    description: 'Scan project for security vulnerabilities',
    category: 'security',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Directory to scan' },
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['deps', 'secrets', 'permissions', 'injection'] },
          default: ['deps', 'secrets']
        }
      },
      required: ['target']
    },
    execute: async (params, ctx) => {
      const findings = [];

      if (params.checks.includes('deps')) {
        const audit = await context.tools.execute('bash', { command: 'npm audit --json' });
        if (audit.ok) findings.push({ type: 'deps', data: audit.data });
      }

      if (params.checks.includes('secrets')) {
        const grep = await context.tools.execute('bash', {
          command: `grep -r "password\\|secret\\|api_key" ${params.target} --include="*.ts" --include="*.js" -l`
        });
        if (grep.ok && grep.data.stdout) {
          findings.push({ type: 'secrets', files: grep.data.stdout.split('\n').filter(Boolean) });
        }
      }

      return { ok: true, data: { findings, count: findings.length } };
    }
  });

  // Register a custom room type
  context.rooms.registerType({
    type: 'security-audit',
    floor: 'integration',
    tables: [{ type: 'audit_table', seats: 2, label: 'Audit Station' }],
    tools: ['security-scan', 'read_file', 'bash', 'record_note'],
    exitRequirements: ['audit_report'],
    fileScope: 'read-only',
    systemPrompt: 'You are a security auditor. Scan the codebase for vulnerabilities and produce an audit report.'
  });

  return {
    onUnload: () => {
      context.log.info('Security Audit plugin unloaded');
    },
    onPhaseAdvance: ({ from, to }) => {
      if (to === 'deploy') {
        context.log.warn('Deploying — consider running a final security scan');
        context.bus.emit('security-audit:deploy-warning', { phase: to });
      }
    }
  };
};
```

**Manifest (`plugin.json`):**
```json
{
  "id": "security-audit",
  "name": "Security Audit",
  "version": "1.0.0",
  "description": "Automated security scanning and audit room",
  "author": "Overlord Team",
  "engine": "js",
  "entrypoint": "main.js",
  "permissions": ["room:write", "tool:execute", "bus:emit", "storage:write"],
  "provides": {
    "roomTypes": ["security-audit"],
    "tools": ["security-scan"]
  }
}
```

---

## Configuration

Plugins are enabled via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_PLUGINS` | `false` | Enable the plugin system |
| `ENABLE_LUA_SCRIPTING` | `false` | Enable Lua scripting engine |
| `PLUGIN_DIR` | `./plugins` | Directory to scan for plugins |

Plugins are loaded automatically on server start when `ENABLE_PLUGINS=true`.
