# Phase Gates

## Overview

Phase Gates are **GO/NO-GO/CONDITIONAL checkpoints** between project phases. They **cannot be bypassed** — a gate requires a structured exit document, RAID log entries, and sign-off before a project can advance.

**Source:** `src/rooms/phase-gate.ts`

## Phase Order

```
strategy → discovery → architecture → execution → review → deploy
```

This order defines valid transitions. A building cannot skip phases or move backward (though scope changes can trigger re-entry to earlier phases via the [[RAID Log]]).

## Gate States

| State | Meaning |
|-------|---------|
| `pending` | Gate created, awaiting sign-off |
| `go` | Approved — next phase can begin |
| `no-go` | Rejected — must address issues |
| `conditional` | Approved with conditions that must be met |

## Gate Protocol

For a gate to be signed off, it requires:
1. **Exit Document** — structured evidence from the room's work
2. **RAID Entry** — any risks, assumptions, issues, or decisions must be logged
3. **Sign-off** — a reviewer submits a verdict with evidence

## API

### `createGate({ buildingId, phase })`
Create a new phase gate for a building at a specific phase.

Returns: `ok({ id, phase, status: 'pending' })`

### `signoffGate({ gateId, reviewer, verdict, conditions, exitDocId, nextPhaseInput })`
Submit a sign-off for a phase gate.

- `verdict`: `'GO'` | `'NO-GO'` | `'CONDITIONAL'`
- `conditions`: Array of strings (required for CONDITIONAL)
- `exitDocId`: Reference to the supporting exit document
- `nextPhaseInput`: Data to pass to the next phase

If verdict is GO, the building's `active_phase` automatically advances to the next phase.

Returns: `ok({ gateId, verdict, status })`

### `canAdvance(buildingId)`
Check if the current phase's gate allows advancement.

Returns: `ok({ canAdvance: boolean, reason?, currentPhase?, nextPhase? })`

### `getGates(buildingId)`
Get all gates for a building, ordered by creation time.

Returns: `ok([...gates])`

## Verdicts

### GO
The phase is complete. Work meets all requirements. The building advances to the next phase automatically.

```typescript
signoffGate({
  gateId: 'gate_123',
  reviewer: 'architect',
  verdict: 'GO',
  exitDocId: 'exitdoc_456',
  nextPhaseInput: { approvedMilestones: [...] }
});
```

### NO-GO
The phase is NOT complete. Issues must be addressed. The building remains in the current phase.

```typescript
signoffGate({
  gateId: 'gate_123',
  reviewer: 'architect',
  verdict: 'NO-GO',
  conditions: [
    'Test coverage below 80% threshold',
    'Critical security vulnerability in auth module'
  ]
});
```

### CONDITIONAL
The phase can advance, but specific conditions must be met. Work can proceed in parallel with condition resolution.

```typescript
signoffGate({
  gateId: 'gate_123',
  reviewer: 'architect',
  verdict: 'CONDITIONAL',
  conditions: [
    'Add integration tests for payment module before deploy',
    'Update API docs for new endpoints'
  ],
  exitDocId: 'exitdoc_456'
});
```

## Gate-Phase-Room Relationship

| Phase | Primary Room | Gate Owner |
|-------|-------------|------------|
| Strategy | Strategist Office | User |
| Discovery | Discovery Room | PM / Architect |
| Architecture | Architecture Room | Architect |
| Execution | Code Lab + Testing Lab | QA Lead |
| Review | Review Room | Architect + User |
| Deploy | Deploy Room | DevOps |

## Why Gates Matter

In v1, there was no phase discipline. Agents could jump from planning to deployment without verification. This led to:
- Untested code being deployed
- Architecture decisions made without documentation
- No audit trail for go/no-go decisions

v2's phase gates ensure:
- Every phase produces evidence
- Every transition is auditable
- Skipping quality gates is structurally impossible
