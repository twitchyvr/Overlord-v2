# Universal I/O Contracts

## Overview

Every module, room, tool, agent, and plugin in Overlord v2 follows the same I/O pattern:

> **"Content can change. Hierarchy stays consistent."**

All operations return a **Result envelope** — either `ok(data, metadata)` or `err(code, message, options)`. This eliminates ad-hoc error handling and gives every caller a consistent interface.

## Result Envelope

```typescript
// Success
{
  ok: true,
  data: { /* operation-specific payload */ },
  metadata: {
    duration?: number,
    roomId?: string,
    agentId?: string,
    phase?: string
  }
}

// Error
{
  ok: false,
  error: {
    code: string,          // Machine-readable error code
    message: string,       // Human-readable description
    retryable: boolean,    // Can the caller retry?
    context?: Record       // Additional error context
  }
}
```

## Helper Functions

**Source:** `src/core/contracts.ts`

```typescript
import { ok, err } from './core/contracts.js';

// Success
return ok({ id: 'room_123', name: 'Code Lab' });

// Success with metadata
return ok({ id: 'room_123' }, { roomId: 'room_123', duration: 42 });

// Error (not retryable)
return err('ROOM_NOT_FOUND', 'Room room_123 does not exist');

// Error (retryable, with context)
return err('AI_ERROR', 'Provider timeout', {
  retryable: true,
  context: { provider: 'anthropic', model: 'claude-3' }
});
```

## Zod Schemas

All contracts are validated at runtime using Zod:

### ResultSchema
Validates the base result envelope (ok/error structure).

### RoomContractSchema
```typescript
{
  roomType: string,
  floor: string,
  tables: Record<string, { chairs: number, description: string }>,
  tools: string[],
  fileScope: 'assigned' | 'read-only' | 'full',
  exitRequired: { type: string, fields: string[] },
  escalation?: Record<string, string>,
  provider: string
}
```

### AgentIdentitySchema
```typescript
{
  id: string,
  name: string,
  role: string,
  capabilities: string[],
  roomAccess: string[],
  badge?: string
}
```

### RaidEntrySchema
```typescript
{
  id: string,
  type: 'risk' | 'assumption' | 'issue' | 'decision',
  phase: string,
  roomId: string,
  summary: string,
  rationale?: string,
  decidedBy: string,
  approvedBy?: string,
  affectedAreas: string[],
  timestamp: string (datetime),
  status: 'active' | 'superseded' | 'closed'
}
```

### ExitDocumentSchema
```typescript
{
  id: string,
  roomId: string,
  type: string,
  completedBy: string,
  fields: Record<string, any>,
  artifacts: string[],
  raidEntries: string[],
  timestamp: string (datetime)
}
```

### PhaseGateSchema
```typescript
{
  id: string,
  phase: string,
  status: 'pending' | 'go' | 'no-go' | 'conditional',
  exitDocId?: string,
  raidEntries: string[],
  signoff?: {
    reviewer: string,
    verdict: 'GO' | 'NO-GO' | 'CONDITIONAL',
    conditions: string[],
    timestamp: string (datetime)
  },
  nextPhaseInput?: Record<string, any>
}
```

## Usage Pattern

Every function across the codebase follows this pattern:

```typescript
export function doSomething(params) {
  // Validate inputs
  if (!params.id) {
    return err('MISSING_ID', 'ID is required');
  }

  // Do work
  const result = db.prepare('SELECT...').get(params.id);
  if (!result) {
    return err('NOT_FOUND', `Item ${params.id} does not exist`);
  }

  // Return success
  return ok(result);
}
```

Callers check the result:
```typescript
const result = doSomething({ id: '123' });
if (!result.ok) {
  log.error(result.error);
  return result; // Propagate error
}
// Use result.data
```
