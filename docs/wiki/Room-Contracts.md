# Room Contracts

## Overview

Every room type defines a **static contract** — a declarative specification of what the room allows, requires, and enforces. The contract is the single source of truth for all room behavior.

## Contract Schema

```typescript
{
  roomType: string,          // Unique room type identifier
  floor: string,             // Which floor this room belongs to
  tables: {                  // Available work modes
    [tableName]: {
      chairs: number,        // Max concurrent agents
      description: string    // What this table is for
    }
  },
  tools: string[],           // Allowed tool names (structural access control)
  fileScope: 'assigned' | 'read-only' | 'full',
  exitRequired: {
    type: string,            // Exit document type name
    fields: string[]         // Required fields in the document
  },
  escalation: {              // Where to go on various conditions
    [condition]: string      // Condition → target room type
  },
  provider: string           // AI provider preference
}
```

## Contract Properties

### `tools` — Structural Access Control
The most important property. This array defines which tools exist in the room. If a tool name is not in this array, it **does not exist** for any agent in the room.

This is **structural enforcement**, not instructional. There is no "please don't use this" — the tool literally cannot be called.

```typescript
// Testing Lab contract
tools: ['read_file', 'list_dir', 'bash', 'qa_run_tests', ...]
// Note: write_file is NOT here = impossible to modify source code
```

### `fileScope` — File Access Level

| Value | Meaning |
|-------|---------|
| `assigned` | Agent can only access files assigned to their current task |
| `read-only` | Agent can read any file but cannot modify |
| `full` | Agent can read and write any file (War Room only) |

### `exitRequired` — Exit Document Template
Defines the structured document an agent must submit to leave the room. See [[Exit Documents]] for details.

### `escalation` — Routing on Events
Maps conditions to target room types:

```typescript
escalation: {
  onFailure: 'code-lab',     // Test failures → back to Code Lab
  onCritical: 'war-room',    // Critical issues → War Room
  onScopeChange: 'discovery' // Scope creep → back to Discovery
}
```

### `provider` — AI Model Selection
Determines which AI provider/model to use:

| Value | Meaning |
|-------|---------|
| `smart` | Best model available (Claude, GPT-4, etc.) |
| `cheap` | Cost-effective model for repetitive tasks |
| `configurable` | Uses the room-specific or building-level config |

## Contract Inheritance

Room types extend `BaseRoom` and override the `static contract` property:

```typescript
export class TestingLab extends BaseRoom {
  static contract = {
    roomType: 'testing-lab',
    floor: 'execution',
    tools: ['read_file', 'list_dir', 'bash', ...],
    // ...
  };
}
```

The `BaseRoom` provides default implementations for:
- `getAllowedTools()` — returns `config.tools`
- `hasTool(name)` — checks if tool is in the list
- `validateExitDocument(doc)` — validates required fields are present
- `buildContextInjection()` — builds the context object injected on room entry
- `getRules()` — override for room-specific rules
- `getOutputFormat()` — override for structured output format

## Context Injection

When an agent enters a room, `buildContextInjection()` creates a context object that merges into the agent's prompt:

```typescript
{
  roomType: 'testing-lab',
  rules: [
    'You are in the Testing Lab. You CANNOT modify source code.',
    'Run tests, analyze results, and report findings.',
    ...
  ],
  tools: ['read_file', 'list_dir', 'bash', ...],
  fileScope: 'read-only',
  exitTemplate: { type: 'test-report', fields: [...] },
  outputFormat: { testsRun: 'number', ... }
}
```

This replaces v1's 200-line agent system prompts with a room-defined context that any agent inherits on entry.
