# Overlord v2 — Claude Code Project Instructions

> **Scope**: These rules are **mandatory and non-negotiable** for the Overlord v2 project. They supplement (never override) the global `~/.claude/CLAUDE.md`.

---

## 0. Context Integrity — Overlord-Specific

### ALL Code in This Repo Is Claude's Code

Claude wrote every line of code in the Overlord v2 repository. There is no "pre-existing" code. There is no "legacy" code from another developer. Every module, every test, every config file — Claude authored it.

**When tests fail after context compaction:**

1. Do NOT say "this appears to be pre-existing" or "this was likely written before my session."
2. Do NOT skip failures or treat them as out-of-scope.
3. DO re-read this file and the project memory in `~/.claude/projects/`.
4. DO run `npm test` to see the full picture.
5. DO fix every single failure — there is no threshold where "enough" failures are fixed.

**The rule is simple: if it's broken, Claude broke it. Fix it.**

### Dogfooding Protocol for Overlord

The process of exercising every feature, dialog, modal form, and interaction through the Overlord UI to find and fix bugs is exactly what the user wants.

- The cycle: **Use Overlord → Find bugs → Fix them → Continue using Overlord** — this is the intended development methodology.
- This is NOT a stuck loop. This is NOT busywork. This is the work.
- Continue until Overlord works flawlessly or the user redirects.
- After fixing a bug found via dogfooding, immediately continue exercising the next feature.

---

## 1. Architecture — STRICT LAYER ORDERING

```
Transport → Rooms → Agents → Tools → AI → Storage → Core
```

Each layer can **ONLY** import from layers below it. No circular dependencies. No exceptions.

Run `npm run validate` to verify. The CI pipeline enforces this.

### Layer Map

| Layer | Directory | Depends On |
|-------|-----------|------------|
| Transport | `src/transport/` | Rooms, Agents, Tools, Core |
| Rooms | `src/rooms/` | Agents, Tools, AI, Storage, Core |
| Agents | `src/agents/` | Tools, AI, Storage, Core |
| Tools | `src/tools/` | AI, Storage, Core |
| AI | `src/ai/` | Storage, Core |
| Storage | `src/storage/` | Core |
| Core | `src/core/` | Nothing (foundation) |

### Layer Violation Detection

If you find yourself importing from an upper layer into a lower one, STOP. Refactor using:

- **Event bus** (for lower layers to notify upper layers without importing them)
- **Dependency injection** (pass interfaces down, not concrete implementations up)
- **Core contracts** (shared types in `src/core/contracts.ts`)

---

## 2. Key Design Principles

- **Rooms define behavior, not agents.** An Agent is a 10-line identity card. The Room injects tools, rules, and output templates.
- **Tool access is structural, not instructional.** If a tool isn't in the room's `allowedTools`, it doesn't exist. Not "please don't use it" — it's simply not available.
- **Every room exit requires a structured exit document.** No "Done!" — provide evidence.
- **RAID log tracks all decisions.** Searchable history for agent reference across phases.
- **Phase gates enforce sign-off.** Cannot skip phases without a GO verdict.

---

## 3. TypeScript Rules

- All source code in `src/` must be TypeScript (`.ts`).
- Use **Zod schemas** for runtime validation (defined in `src/core/contracts.ts`).
- Use **strict mode** (`strict: true` in `tsconfig.json`).
- Import paths use **`.js` extension** (Node16 module resolution).
- **No `any` types** without justification in a comment explaining why.
- Use the `Result` pattern from `src/core/contracts.ts` for all module I/O:

```typescript
import { ok, err } from './core/contracts.js';

// Success
return ok({ id: '123', name: 'Test Room' });

// Error
return err('NOT_FOUND', 'Room does not exist', { retryable: false });
```

---

## 4. Git Workflow — Overlord-Specific

### Branch Strategy

| Branch | Purpose | Merges To |
|--------|---------|-----------|
| `main` | Stable, **protected** — no direct pushes, requires PR + review + passing CI | — |
| `develop` | Integration branch | `main` (via release PR) |
| `feat/*` | New features | `develop` |
| `fix/*` | Bug fixes | `develop` |
| `docs/*` | Documentation changes | `develop` |
| `refactor/*` | Code restructuring | `develop` |
| `release/*` | Release candidates | `main` |
| `hotfix/*` | Emergency production fixes | `main` and `develop` |
| `stable/v*` | Tagged milestones | — |

### Before Coding

1. **Create or identify a GitHub Issue** for the work. Every code change traces to an Issue.
2. **Create or switch to a feature branch** from `develop`.
3. **Assign the Issue** to a Milestone and the Overlord Project board.
4. **Apply labels** (`bug`, `feature`, `refactor`, `test`, priority labels, etc.).

### During Coding

5. **Commit atomically**: `type(scope): subject`
   - Scope should match Overlord layers: `transport`, `rooms`, `agents`, `tools`, `ai`, `storage`, `core`, `ui`, `tests`
   - Always include: `Co-Authored-By: Claude <noreply@anthropic.com>`
6. **Run `npm run validate`** after every commit to verify layer ordering.
7. **Run `npm test`** to verify zero failures.

### After Coding

8. **Open a Pull Request** — never push directly to `main` or `develop` without a PR.
9. **PR body must include**:
   - Summary of changes
   - Test plan and evidence of runtime execution
   - Link to Issue: `Closes #N`
   - Documentation updates (if applicable)
10. **Link the PR** to the GitHub Project board and Milestone.
11. **MANDATORY CODE REVIEW** — launch Claude subagents to review every PR:
    - Verify correctness, edge cases, integration
    - Check layer ordering compliance
    - Check Zod schema coverage
    - Verify exit documents for room changes
12. **Update `CHANGELOG.md`** with every PR merge.
13. **Update `README.md`** with every significant change.
14. **Update the GitHub Wiki** when architecture or workflow logic changes.

### Agent Fleet Workflow — Overlord

- **Use subagent fleets** for ALL work: coding, Issues, writing comments, commits, and code reviews.
- **Launch parallel research agents** to understand requirements before coding.
- **Launch code review agents** after every PR.
- **Verify end-to-end functionality** — tests passing is necessary but NOT sufficient. Run the actual Overlord UI.

### Versioning

- Follow **Semantic Versioning (SemVer)**: `vMAJOR.MINOR.PATCH`
- Tag every release on `main`: `git tag vMAJOR.MINOR.PATCH`
- Every tag must have a corresponding `CHANGELOG.md` entry.

---

## 5. Room Types (Built-In)

| Room | Floor | Key Constraint |
|------|-------|---------------|
| `strategist` | Strategy | Phase Zero setup, no code tools |
| `discovery` | Collaboration | Read-only, produce requirements |
| `architecture` | Collaboration | Read-only, produce task breakdown |
| `code-lab` | Execution | Full write access, scoped to assigned files |
| `testing-lab` | Execution | **NO `write_file`** — structurally enforced |
| `review` | Governance | Read-only, go/no-go decisions with evidence |
| `deploy` | Operations | Git/CI tools, requires Release sign-off |
| `war-room` | Collaboration | Elevated access, incident response |

### Room Rules Enforcement

- Agents entering a room receive ONLY the tools listed in that room's `allowedTools`.
- Agents cannot request tools outside their room's scope.
- Exiting a room without a structured exit document is a violation.
- Phase gates between rooms require a GO verdict with evidence before proceeding.

---

## 6. Testing Standards — Overlord-Specific

### Test Execution

```bash
# Run all tests
npm test

# Run specific test suite with verbose output
npm test -- --reporter=verbose tests/unit/transport/socket-handler.test.ts

# Run with failure details
npm test -- --reporter=verbose 2>&1 | grep -A8 "FAIL"

# Validate layer ordering
npm run validate
```

### Test Expectations

- **Zero failures is the only acceptable state.** If there are 47 failures, fix all 47.
- **Never skip or ignore test failures.** Every `FAIL` in the output is a bug to fix.
- **Never mock away the problem.** If a test fails because the implementation is wrong, fix the implementation — don't weaken the test.
- **After fixing failures, run the full suite again.** Fixing one thing can break another. Always verify the complete picture.

### Test Organization

| Directory | Coverage |
|-----------|----------|
| `tests/unit/transport/` | Socket handlers, schemas, protocol layer |
| `tests/unit/rooms/` | Room lifecycle, exit documents, phase gates |
| `tests/unit/agents/` | Agent identity, tool access, room assignment |
| `tests/unit/tools/` | Tool execution, permission enforcement |
| `tests/unit/ai/` | AI provider integration |
| `tests/unit/storage/` | Persistence, state management |
| `tests/unit/core/` | Contracts, shared utilities |
| `tests/unit/ui/` | Views, socket bridge, DOM rendering |

---

## 7. What NOT To Do — Overlord-Specific

- **Do NOT** import upper layers from lower layers (violates architecture).
- **Do NOT** use tier-based approval (v1 pattern — eliminated in v2).
- **Do NOT** put behavioral rules in agent definitions (rooms own rules).
- **Do NOT** commit to `main` directly.
- **Do NOT** use `any` types without comment justification.
- **Do NOT** skip exit documents when leaving rooms.
- **Do NOT** call test failures "pre-existing." They are Claude's bugs. Fix them.
- **Do NOT** weaken tests to make them pass. Fix the implementation instead.
- **Do NOT** stop fixing after "enough" bugs. Zero failures is the target.
- **Do NOT** assume dogfooding is a loop to break out of. It's the methodology.
- **Do NOT** close Issues without code review from a subagent.
- **Do NOT** merge PRs without linking to an Issue and Milestone.

---

## 8. CI/CD Pipeline — Overlord

### GitHub Actions Workflow

The CI pipeline runs on every PR and push to `develop`/`main`:

1. **Lint** — ESLint with strict TypeScript rules
2. **Type Check** — `tsc --noEmit` with strict mode
3. **Layer Validation** — `npm run validate` (architecture ordering)
4. **Unit Tests** — `npm test` with zero-failure requirement
5. **Build** — Production build verification

### Branch Protection for `main`

- Require PR reviews before merging (minimum 1 approval from code review agent)
- Require all status checks to pass (lint, types, layer validation, tests, build)
- Require branches to be up to date before merging
- No force pushes
- No deletions

---

## 9. Runtime Verification — Overlord-Specific

Beyond unit tests, Overlord requires interactive verification:

1. **Boot the server**: Verify Socket.IO transport initializes and accepts connections.
2. **Test room lifecycle**: Create room → enter agent → execute tools → produce exit document → exit room.
3. **Test RAID log**: Create entries, search, filter by type — verify persistence.
4. **Test phase gates**: Attempt phase transition without sign-off (should fail) → provide sign-off (should pass).
5. **Test UI**: Load dashboard → verify views render → interact with modals/forms → verify state updates via socket bridge.

Every bug found during runtime verification is a bug to fix immediately — not a "known issue" to document and move on from.

---

## 10. Quick Reference — Common Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Production build
npm run validate         # Verify layer ordering

# Testing
npm test                 # Run all tests
npm test -- --reporter=verbose tests/unit/<path>  # Run specific suite

# Git (via Copilot CLI)
ghcs "create feature branch feat/my-feature from develop"
ghcs "commit staged files with message 'fix(transport): repair socket handler ack'"
ghcs "open PR from feat/my-feature to develop"
ghcs "tag release v2.1.0 on main"
```