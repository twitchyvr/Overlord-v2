# Tool Registry — Complete Reference

Tools are the capabilities available to AI agents within rooms. The registry defines
tools globally, but agents can only use tools allowed by their current room's contract.

**Source:** `src/tools/tool-registry.ts`

---

## Structural Access Control

Tools are **room-scoped** — a room's contract specifies which tools are available:

```typescript
// Room contract excerpt
{
  type: 'code-lab',
  tools: ['bash', 'read_file', 'write_file', 'patch_file', 'list_dir']
}
```

An agent in this room can only use these 5 tools. All other tools are invisible.
This is enforced at the `executeInRoom()` level — blocked tools return:

```typescript
{ ok: false, error: { code: 'TOOL_NOT_AVAILABLE', message: '...', retryable: false } }
```

---

## Built-in Tools

### Shell Tools

#### `bash`
Execute a bash command in the server's shell.

| Property | Value |
|----------|-------|
| **Category** | `shell` |
| **Input Schema** | `{ command: string, timeout?: number }` |
| **Context** | `roomId`, `agentId` |

```typescript
// Input
{ command: "npm test -- --coverage", timeout: 30000 }

// Output (Result)
{ ok: true, data: { stdout: "...", stderr: "...", exitCode: 0 } }
```

---

### File Tools

#### `read_file`
Read the contents of a file from the filesystem.

| Property | Value |
|----------|-------|
| **Category** | `file` |
| **Input Schema** | `{ path: string }` |
| **Access** | File scope must allow reads |

#### `write_file`
Write content to a file (creates or overwrites).

| Property | Value |
|----------|-------|
| **Category** | `file` |
| **Input Schema** | `{ path: string, content: string }` |
| **Access** | File scope must allow writes |

#### `patch_file`
Apply a search/replace edit to a file.

| Property | Value |
|----------|-------|
| **Category** | `file` |
| **Input Schema** | `{ path: string, search: string, replace: string }` |
| **Access** | File scope must allow writes |

#### `list_dir`
List the contents of a directory.

| Property | Value |
|----------|-------|
| **Category** | `file` |
| **Input Schema** | `{ path: string }` |
| **Access** | File scope must allow reads |

---

### Web Tools

#### `web_search`
Search the web using DuckDuckGo.

| Property | Value |
|----------|-------|
| **Category** | `web` |
| **Input Schema** | `{ query: string, maxResults?: number }` |

#### `fetch_webpage`
Fetch a webpage and extract its content as clean text/markdown.

| Property | Value |
|----------|-------|
| **Category** | `web` |
| **Input Schema** | `{ url: string, maxLength?: number }` |

---

### QA Tools

#### `qa_run_tests`
Run the project's test suite (`npm test`).

| Property | Value |
|----------|-------|
| **Category** | `qa` |
| **Input Schema** | `{ args?: string }` |

#### `qa_check_lint`
Run the project's linter (`npm run lint`).

| Property | Value |
|----------|-------|
| **Category** | `qa` |
| **Input Schema** | `{ args?: string }` |

#### `qa_check_types`
Run TypeScript type checking (`npm run typecheck` or `tsc --noEmit`).

| Property | Value |
|----------|-------|
| **Category** | `qa` |
| **Input Schema** | `{ args?: string }` |

#### `qa_check_coverage`
Run tests with coverage reporting (`npm run test:coverage`).

| Property | Value |
|----------|-------|
| **Category** | `qa` |
| **Input Schema** | `{ args?: string }` |

#### `qa_audit_deps`
Audit npm dependencies for known vulnerabilities.

| Property | Value |
|----------|-------|
| **Category** | `qa` |
| **Input Schema** | `{ args?: string }` |

---

### GitHub Tools

#### `github`
Execute GitHub CLI operations (commit, PR, issues, etc.).

| Property | Value |
|----------|-------|
| **Category** | `github` |
| **Input Schema** | `{ action: string, args?: object }` |
| **Requires** | `GITHUB_TOKEN` environment variable |

---

### Notes Tools

#### `record_note`
Save a session note to the database, scoped to the agent and room.

| Property | Value |
|----------|-------|
| **Category** | `notes` |
| **Input Schema** | `{ content: string, tags?: string[] }` |
| **Context** | `agentId`, `roomId` |

#### `recall_notes`
Search and retrieve previously saved session notes.

| Property | Value |
|----------|-------|
| **Category** | `notes` |
| **Input Schema** | `{ query?: string, tag?: string, limit?: number }` |
| **Context** | `agentId` |

---

### System Tools

#### `ask_user`
Ask the user a question and wait for a response. Emits a bus event that surfaces
in the chat UI.

| Property | Value |
|----------|-------|
| **Category** | `system` |
| **Input Schema** | `{ question: string, context?: string }` |
| **Emits** | `ask_user:request` bus event |

---

## Room-Tool Access Matrix

| Tool | Strategist | Discovery | Architecture | Code Lab | Testing Lab | Review | Deploy | War Room |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `bash` | — | — | — | Y | Y | — | Y | Y |
| `read_file` | — | Y | Y | Y | Y | Y | Y | Y |
| `write_file` | Y | — | — | Y | — | — | — | Y |
| `patch_file` | — | — | — | Y | — | — | — | Y |
| `list_dir` | Y | Y | Y | Y | Y | Y | Y | Y |
| `web_search` | Y | Y | Y | Y | — | Y | — | Y |
| `fetch_webpage` | — | Y | Y | Y | — | — | — | Y |
| `qa_run_tests` | — | — | — | — | Y | Y | Y | Y |
| `qa_check_lint` | — | — | — | — | Y | Y | — | Y |
| `qa_check_types` | — | — | — | — | Y | — | — | — |
| `qa_check_coverage` | — | — | — | — | Y | — | — | — |
| `qa_audit_deps` | — | — | — | — | Y | — | — | — |
| `github` | — | — | — | — | — | — | Y | Y |
| `record_note` | Y | Y | Y | — | — | — | — | — |
| `recall_notes` | Y | Y | Y | — | — | Y | — | — |
| `ask_user` | Y | Y | Y | Y | Y | Y | Y | Y |

---

## Tool Execution Flow

```
Agent Request         Room Contract         Tool Registry         Tool Implementation
     |                      |                     |                        |
     |── "use bash" ───────>|                     |                        |
     |                      |── is bash allowed? ─>|                        |
     |                      |<── yes ──────────────|                        |
     |                      |                     |── execute(params) ─────>|
     |                      |                     |<── Result ──────────────|
     |<── Result ───────────|                     |                        |
     |                      |                     |                        |
     |                      |                     |── bus: tool:executed ──>|
     |                      |                     |                        |
```

---

## Registering Custom Tools

Plugins can register custom tools:

```typescript
import { registerTool } from './tools/tool-registry.js';

registerTool({
  name: 'my_custom_tool',
  description: 'Performs a custom operation',
  category: 'custom',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The input to process' },
      options: {
        type: 'object',
        properties: {
          verbose: { type: 'boolean', default: false }
        }
      }
    },
    required: ['input']
  },
  execute: async (params, context) => {
    // context: { roomId, agentId, buildingId }
    const result = doSomething(params.input);
    return { ok: true, data: { output: result } };
  }
});
```

Then add the tool to a room contract's `tools` array to make it available in that room.
