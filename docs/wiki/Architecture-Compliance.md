# Architecture Compliance

## Overview

Overlord v2 enforces strict layer ordering through an automated compliance checker that runs in CI. This prevents the circular dependency problems that plagued v1.

**Source:** `scripts/check-layers.ts`

## Layer Order

```
Transport (6) → Rooms (5) → Agents (4) → Tools (3) → AI (2) → Storage (1) → Core (0)
```

Each layer is assigned a numeric level. A file in layer N may only import from layers with level < N.

## How It Works

The compliance checker:
1. Walks all `.ts` files in `src/`
2. Determines each file's layer from its path (e.g., `src/rooms/` → layer 5)
3. Parses all `import` statements
4. Resolves import targets to their layer
5. Flags any import where the target layer level >= source layer level

## Example Violation

```typescript
// src/core/bus.ts (layer 0)
import { getDb } from '../storage/db.js'; // VIOLATION! Core (0) importing from Storage (1)
```

The checker would output:
```
VIOLATION: src/core/bus.ts (core/0) imports src/storage/db.ts (storage/1)
  Core layer cannot import from Storage layer
```

## Running the Checker

```bash
npm run check:layers
```

This exits with code 1 if violations are found, causing CI to fail.

## Allowed Imports

| Layer | Can Import From |
|-------|----------------|
| Core (0) | Nothing (no internal imports) |
| Storage (1) | Core |
| AI (2) | Core, Storage |
| Tools (3) | Core, Storage, AI |
| Agents (4) | Core, Storage, AI, Tools |
| Rooms (5) | Core, Storage, AI, Tools, Agents |
| Transport (6) | All layers |

## CI Integration

The compliance check runs as part of the CI workflow:

```yaml
# .github/workflows/ci.yml
- name: Architecture compliance
  run: npm run check:layers
```

It runs alongside lint, typecheck, and test — all four must pass.

## Exceptions

There are no exceptions. If the compliance checker flags a violation, the code must be restructured. Common fixes:
- **Move shared logic down** — if both Rooms and Agents need it, put it in Tools or Core
- **Use the event bus** — instead of importing up, emit an event and let the higher layer listen
- **Use dependency injection** — pass dependencies as parameters instead of importing
