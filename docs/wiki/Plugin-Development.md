# Plugin Development

## Overview

Overlord v2 supports plugins for extending the framework with custom room types, tools, AI providers, and integrations. The plugin system is planned for Phase 7.

**Source:** `src/plugins/contracts.ts`, `src/plugins/plugin-loader.ts`, `src/plugins/plugin-sandbox.ts`
**Full reference:** [`docs/api/plugins.md`](../api/plugins.md)

## Plugin Structure

A plugin is a directory containing a manifest and an entrypoint script:

```
plugins/
  my-plugin/
    plugin.json          ← Manifest (required)
    main.js              ← JavaScript entrypoint
    main.lua             ← Lua entrypoint (if engine: "lua")
```

## Manifest (`plugin.json`)

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

## Permissions

| Permission | Description | Risk |
|------------|-------------|------|
| `room:read` | List/get rooms | Low |
| `room:write` | Create/modify rooms | Medium |
| `tool:execute` | Execute tools | Medium |
| `agent:read` | List/get agents | Low |
| `bus:emit` | Emit events on the bus | Medium |
| `storage:read` | Read plugin-scoped storage | Low |
| `storage:write` | Write plugin-scoped storage | Low |
| `fs:read` | Filesystem read access | High |
| `fs:write` | Filesystem write access | High |
| `net:http` | Outbound HTTP requests | High |

## Plugin Context API

When loaded, a plugin receives a sandboxed context:

- `context.manifest` — Read-only plugin manifest
- `context.log` — Scoped logger (`info`, `warn`, `error`)
- `context.bus` — Event bus (requires `bus:emit`)
- `context.rooms` — Room management (requires `room:read`/`room:write`)
- `context.agents` — Agent info (requires `agent:read`)
- `context.tools` — Register/execute tools (requires `tool:execute`)
- `context.storage` — Key-value storage (requires `storage:read`/`storage:write`)

## Plugin Entry Point

```javascript
// plugins/my-plugin/main.js
module.exports = function(context) {
  context.log.info('Plugin loaded');

  // Register a custom tool
  context.tools.register({
    name: 'security-scan',
    description: 'Scan codebase for vulnerabilities',
    category: 'security',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target']
    },
    execute: async (params, ctx) => {
      return { ok: true, data: { findings: [] } };
    }
  });

  // Register a custom room type
  context.rooms.registerType({
    type: 'security-audit',
    floor: 'integration',
    tables: [{ type: 'audit_table', seats: 2 }],
    tools: ['security-scan', 'read_file', 'bash'],
    exitRequirements: ['audit_report'],
    fileScope: 'read-only'
  });

  // Return lifecycle hooks
  return {
    onUnload: () => { /* cleanup */ },
    onRoomEnter: (data) => { /* agent entered */ },
    onRoomExit: (data) => { /* agent exited */ },
    onToolExecute: (data) => { /* tool ran */ },
    onPhaseAdvance: (data) => { /* phase changed */ }
  };
};
```

## Scripting

Lua scripting is also supported when `ENABLE_LUA_SCRIPTING=true`:

```lua
-- rooms/custom-review.lua
room.rules = {
  "Always check for SQL injection",
  "Verify input validation on all endpoints"
}

room.on_enter = function(agent)
  agent.context.add("security-checklist", load_checklist())
end
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_PLUGINS` | `false` | Enable the plugin system |
| `ENABLE_LUA_SCRIPTING` | `false` | Enable Lua scripting engine |
| `PLUGIN_DIR` | `./plugins` | Directory to scan for plugins |

## Safety

Plugins run in a sandboxed environment:
- Only granted permissions are available — ungrantable APIs are not exposed
- Plugin-scoped storage prevents cross-plugin data access
- Tool access controlled by room contract (plugins can't bypass structural enforcement)
- Plugin crashes are isolated and don't affect the core system
