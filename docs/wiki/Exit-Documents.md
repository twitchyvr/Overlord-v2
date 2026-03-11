# Exit Documents

## Overview

Exit Documents are **structured outputs** that agents must submit to leave a room. They replace v1's unstructured "Done!" responses with evidence-based deliverables.

> No exit document = no exit.

## How It Works

1. Agent enters a room
2. Room's contract defines `exitRequired: { type, fields }`
3. Agent works within the room's constraints
4. Agent submits an exit document with all required fields
5. Room validates the document (`validateExitDocument()`)
6. If valid, agent exits and the document is stored for downstream rooms

## Validation

The `BaseRoom.validateExitDocument()` method checks that all required fields are present:

```typescript
validateExitDocument(document) {
  const required = this.config.exitRequired;
  const missing = required.fields.filter(field => !(field in document));
  if (missing.length > 0) {
    return err('EXIT_DOC_INCOMPLETE', `Missing required fields: ${missing.join(', ')}`);
  }
  return ok(document);
}
```

## Exit Document Types by Room

### `building-blueprint` (Strategist Office)
```typescript
{
  projectGoals: ['string'],
  successCriteria: ['string'],
  floorsNeeded: ['string'],
  roomConfig: [{ floor: 'string', rooms: ['string'] }],
  agentRoster: [{ name: 'string', role: 'string', rooms: ['string'] }],
  estimatedPhases: ['string']
}
```

### `requirements-document` (Discovery Room)
```typescript
{
  businessOutcomes: ['string'],
  constraints: ['string'],
  unknowns: ['string'],
  gapAnalysis: { current: 'string', target: 'string', gaps: ['string'] },
  riskAssessment: [{ risk: 'string', analysis: 'string', citation: 'string' }],
  acceptanceCriteria: ['string']
}
```

### `architecture-document` (Architecture Room)
```typescript
{
  milestones: [{ name: 'string', criteria: ['string'], dependencies: ['string'] }],
  taskBreakdown: [{ id: 'string', title: 'string', scope: { files: ['string'] }, assignee: 'string' }],
  dependencyGraph: object,
  techDecisions: [{ decision: 'string', reasoning: 'string', alternatives: ['string'] }],
  fileAssignments: object
}
```

### `implementation-report` (Code Lab)
```typescript
{
  filesModified: ['string'],
  testsAdded: ['string'],
  changesDescription: 'string',
  riskAssessment: 'string'
}
```

### `test-report` (Testing Lab)
```typescript
{
  testsRun: number,
  testsPassed: number,
  testsFailed: number,
  failures: [{ test: 'string', expected: 'string', actual: 'string', file: 'string' }],
  coverage: { lines: number, branches: number },
  lintErrors: number,
  recommendations: ['string']
}
```

### `gate-review` (Review Room)
```typescript
{
  verdict: 'GO' | 'NO-GO' | 'CONDITIONAL',
  evidence: [{ claim: 'string', proof: 'string', citation: 'string' }],
  conditions: ['string'],
  riskQuestionnaire: [{ question: 'string', answer: 'string', risk: 'low' | 'medium' | 'high' }]
}
```

### `deployment-report` (Deploy Room)
```typescript
{
  environment: 'string',
  version: 'string',
  deployedAt: 'string',
  healthCheck: { status: 'string', endpoints: ['string'] },
  rollbackPlan: 'string'
}
```

### `incident-report` (War Room)
```typescript
{
  incidentSummary: 'string',
  rootCause: 'string',
  resolution: 'string',
  preventionPlan: ['string'],
  timeToResolve: 'string'
}
```

## Database Storage

Exit documents are stored in the `exit_documents` table:

```sql
CREATE TABLE exit_documents (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  type TEXT NOT NULL,
  completed_by TEXT NOT NULL,
  fields TEXT DEFAULT '{}',         -- JSON document content
  artifacts TEXT DEFAULT '[]',      -- JSON array of artifact references
  raid_entry_ids TEXT DEFAULT '[]', -- JSON array of related RAID entries
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Document Flow

Exit documents from one phase become **input** for the next:

```
Strategist → Building Blueprint → configures building
Discovery → Requirements Doc → feeds Architecture Room
Architecture → Architecture Doc → feeds Code Lab (task assignments)
Code Lab → Implementation Report → feeds Testing Lab
Testing Lab → Test Report → feeds Review Room
Review Room → Gate Review (GO) → feeds Deploy Room
Deploy Room → Deployment Report → project complete
```
