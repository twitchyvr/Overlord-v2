# Testing Guide

## Overview

Overlord v2 uses **Vitest** for all testing. Tests are organized by layer to match the architecture.

## Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

## Test Structure

```
tests/
  unit/
    core/
      bus.test.ts        — Event bus tests
      contracts.test.ts  — I/O contract tests
    rooms/
      base-room.test.ts  — Room types, structural enforcement
  integration/
    (Phase 2+)
  e2e/
    (Phase 6+)
```

## Coverage Requirements

Configured in `vitest.config.ts`:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  thresholds: {
    lines: 80,
    branches: 80,
    functions: 80,
    statements: 80
  }
}
```

## Existing Tests

### `tests/unit/core/bus.test.ts`
- Structured event envelope (event name, timestamp)
- Multiple listener support
- Namespace-based subscriptions

### `tests/unit/core/contracts.test.ts`
- `ok()` helper returns correct structure
- `err()` helper with retryable and context
- `RoomContractSchema` validation
- `AgentIdentitySchema` validation
- `RaidEntrySchema` validation

### `tests/unit/rooms/base-room.test.ts`
The most important test file — verifies structural enforcement:

```typescript
test('TestingLab does NOT have write_file', () => {
  const lab = new TestingLab('test-id');
  expect(lab.hasTool('write_file')).toBe(false);
});

test('CodeLab HAS write_file', () => {
  const lab = new CodeLab('test-id');
  expect(lab.hasTool('write_file')).toBe(true);
});
```

Also tests:
- BaseRoom default contract
- Room-specific rules
- Exit document validation
- Context injection building

## Writing Tests

### Unit Test Pattern

```typescript
import { describe, test, expect } from 'vitest';
import { ok, err } from '../../../src/core/contracts.js';

describe('myModule', () => {
  test('should return ok for valid input', () => {
    const result = ok({ id: '123' });
    expect(result.ok).toBe(true);
    expect(result.data.id).toBe('123');
  });

  test('should return err for invalid input', () => {
    const result = err('INVALID', 'Bad input');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID');
  });
});
```

### Testing Room Types

```typescript
import { MyRoom } from '../../src/rooms/room-types/my-room.js';

test('MyRoom has correct tools', () => {
  const room = new MyRoom('test-id');
  expect(room.hasTool('read_file')).toBe(true);
  expect(room.hasTool('write_file')).toBe(false);
});

test('MyRoom validates exit document', () => {
  const room = new MyRoom('test-id');
  const result = room.validateExitDocument({ /* missing fields */ });
  expect(result.ok).toBe(false);
  expect(result.error.code).toBe('EXIT_DOC_INCOMPLETE');
});
```

## Integration Tests (Phase 2+)

Integration tests will verify cross-layer interactions:
- Room Manager + Agent Registry + Tool Registry
- Phase Gate + Exit Document + RAID Log
- Transport + Room Manager (end-to-end event flow)

## E2E Tests (Phase 6+)

End-to-end tests will verify the full user workflow:
- Connect via Socket.IO
- Create building → enter rooms → submit exit docs → advance phases
- Verify database state after each step
