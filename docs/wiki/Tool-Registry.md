# Tool Registry

## Overview

The Tool Registry defines all available tools globally but only exposes them to agents through their current room's allowed list. This is the **structural access control** mechanism.

**Source:** `src/tools/tool-registry.ts`

## Built-in Tools

### Shell Tools

| Tool | Description | Category |
|------|-------------|----------|
| `bash` | Execute a bash command | shell |

### File Tools

| Tool | Description | Category |
|------|-------------|----------|
| `read_file` | Read a file from the filesystem | file |
| `write_file` | Write content to a file | file |
| `patch_file` | Apply a patch/edit to a file (search/replace) | file |
| `list_dir` | List contents of a directory | file |

### Web Tools

| Tool | Description | Category |
|------|-------------|----------|
| `web_search` | Search the web | web |
| `fetch_webpage` | Fetch and parse a webpage | web |

### QA Tools

| Tool | Description | Category |
|------|-------------|----------|
| `qa_run_tests` | Run the test suite | qa |
| `qa_check_lint` | Run the linter | qa |
| `qa_check_types` | Run type checking | qa |
| `qa_check_coverage` | Check test coverage | qa |
| `qa_audit_deps` | Audit dependencies for vulnerabilities | qa |

### GitHub Tools

| Tool | Description | Category |
|------|-------------|----------|
| `github` | GitHub CLI operations (commit, PR, issues) | github |

### Notes Tools

| Tool | Description | Category |
|------|-------------|----------|
| `record_note` | Record a session note | notes |
| `recall_notes` | Recall session notes | notes |

### System Tools

| Tool | Description | Category |
|------|-------------|----------|
| `ask_user` | Ask the user a question | system |

## Tool Definition Schema

```typescript
{
  name: string,              // Unique tool identifier
  description: string,       // Human-readable description
  category: string,          // Tool category for organization
  inputSchema: JSONSchema,   // JSON Schema for parameters
  execute: (params, context) => Promise<Result>
}
```

## API

### `registerTool(definition)`
Register a new tool (built-in or plugin).

### `getTool(name)`
Get a tool definition by name.

### `getToolsForRoom(allowedToolNames)`
Get tool definitions filtered by a room's allowed list. This is how structural access control works:

```typescript
// Room's contract says: tools: ['read_file', 'bash', 'qa_run_tests']
const tools = getToolsForRoom(['read_file', 'bash', 'qa_run_tests']);
// Returns only those 3 tool definitions — nothing else exists
```

### `executeInRoom({ toolName, params, roomAllowedTools, context })`
Execute a tool within a room context. Validates the tool is in the room's allowed list before executing:

```typescript
if (!roomAllowedTools.includes(toolName)) {
  return err('TOOL_NOT_AVAILABLE',
    `Tool "${toolName}" is not available in this room. Available: ${roomAllowedTools.join(', ')}`
  );
}
```

## Room-Tool Matrix

| Tool | Strategist | Discovery | Architecture | Code Lab | Testing Lab | Review | Deploy | War Room |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| read_file | - | Y | Y | Y | Y | Y | Y | Y |
| write_file | - | - | - | Y | - | - | - | Y |
| patch_file | - | - | - | Y | - | - | - | Y |
| list_dir | Y | Y | Y | Y | Y | Y | Y | Y |
| bash | - | - | - | Y | Y | - | Y | Y |
| web_search | Y | Y | Y | Y | - | Y | - | Y |
| fetch_webpage | - | Y | Y | Y | - | - | - | Y |
| qa_run_tests | - | - | - | - | Y | Y | Y | Y |
| qa_check_lint | - | - | - | - | Y | Y | - | Y |
| qa_check_types | - | - | - | - | Y | - | - | - |
| qa_check_coverage | - | - | - | - | Y | - | - | - |
| qa_audit_deps | - | - | - | - | Y | - | - | - |
| github | - | - | - | - | - | - | Y | Y |
| record_note | Y | Y | Y | - | - | - | - | - |
| recall_notes | Y | Y | Y | - | - | Y | - | - |

## Adding Custom Tools

```typescript
import { registerTool } from './tools/tool-registry.js';

registerTool({
  name: 'my_custom_tool',
  description: 'Does something custom',
  category: 'custom',
  inputSchema: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input']
  },
  execute: async (params, context) => {
    // Implementation
    return { output: 'result' };
  }
});
```

Then add the tool name to a room's contract `tools` array to make it available.
