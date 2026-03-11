# Plugin Development

## Overview

Overlord v2 supports plugins for extending the framework with custom room types, tools, AI providers, and integrations. The plugin system is planned for Phase 7.

**Source:** `src/plugins/` (scaffold only)

## Plugin Types

### Custom Room Types
Create new room types with specific tool sets, exit documents, and rules:

```typescript
import { BaseRoom } from 'overlord-v2/rooms/room-types/base-room';

export class SecurityAuditRoom extends BaseRoom {
  static contract = {
    roomType: 'security-audit',
    floor: 'governance',
    tables: {
      review: { chairs: 2, description: 'Security reviewer + architect' }
    },
    tools: ['read_file', 'list_dir', 'qa_audit_deps', 'security_scan'],
    fileScope: 'read-only',
    exitRequired: {
      type: 'security-report',
      fields: ['vulnerabilities', 'severity', 'recommendations', 'compliance']
    },
    provider: 'smart'
  };

  getRules() {
    return [
      'Review all code for OWASP Top 10 vulnerabilities.',
      'Check dependency audit results.',
      'Verify authentication and authorization patterns.',
    ];
  }
}
```

Register with the Room Manager:
```typescript
registerRoomType('security-audit', SecurityAuditRoom);
```

### Custom Tools
Add new tools that can be assigned to room contracts:

```typescript
import { registerTool } from 'overlord-v2/tools/tool-registry';

registerTool({
  name: 'security_scan',
  description: 'Run a security scan on the codebase',
  category: 'security',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string' },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
    },
    required: ['target']
  },
  execute: async (params, context) => {
    // Run security scan
    return { vulnerabilities: [], score: 100 };
  }
});
```

### Custom AI Providers
Add new AI provider adapters:

```typescript
import { registerAdapter } from 'overlord-v2/ai/ai-provider';

registerAdapter('my-provider', {
  name: 'my-provider',
  async sendMessage(messages, tools, options) {
    // Translate from Anthropic format → your provider
    // Call your provider's API
    // Translate response back to Anthropic format
    return response;
  },
  validateConfig: (config) => !!config.get('MY_PROVIDER_KEY')
});
```

## Plugin Structure

```
plugins/
  my-plugin/
    index.ts          # Plugin entry point
    rooms/            # Custom room types
    tools/            # Custom tools
    providers/        # Custom AI providers
    package.json      # Plugin metadata
```

## Plugin Entry Point

```typescript
// plugins/my-plugin/index.ts
export default function register({ rooms, tools, ai }) {
  // Register custom room types
  rooms.registerRoomType('security-audit', SecurityAuditRoom);

  // Register custom tools
  tools.registerTool(securityScanTool);

  // Register custom AI providers
  ai.registerAdapter('my-provider', myProviderAdapter);
}
```

## Scripting (Planned)

Phase 7 will add Lua and JavaScript scripting support for lightweight room customization without full plugin development:

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

## Safety

Plugins run in a sandboxed environment:
- No access to the host filesystem outside the workspace
- Network access controlled by room contract
- Tool access controlled by room contract (plugins can't bypass structural enforcement)
- Plugin crashes are isolated and don't affect the core system
