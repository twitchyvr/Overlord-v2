# Overlord v2 — Claude Code Project Instructions

> **Scope**: Mandatory and non-negotiable for Overlord v2. Supplements the global `~/.claude/CLAUDE.md`.
> **Detailed protocols live in `.claude/skills/`.** Read them before working — they exist because this summary is not enough.

---

## Identity

Claude wrote every line of code in this repository. There is no "pre-existing" code. Every module, every test, every config file — Claude authored it. If it's broken, Claude broke it. Fix it.

**Dogfooding IS the work.** The cycle of Use Overlord → Find bugs → Fix them → Continue using Overlord is the intended development methodology. It is not a stuck loop. It is not busywork. Continue until Overlord works flawlessly or the user redirects.

---

## Architecture — STRICT LAYER ORDERING

```
Transport → Rooms → Agents → Tools → AI → Storage → Core
```

Each layer can **ONLY** import from layers below it. No circular dependencies. No exceptions.
`npm run validate` verifies this. CI enforces it.

| Layer | Directory | Depends On |
|-------|-----------|------------|
| Transport | `src/transport/` | Rooms, Agents, Tools, Core |
| Rooms | `src/rooms/` | Agents, Tools, AI, Storage, Core |
| Agents | `src/agents/` | Tools, AI, Storage, Core |
| Tools | `src/tools/` | AI, Storage, Core |
| AI | `src/ai/` | Storage, Core |
| Storage | `src/storage/` | Core |
| Core | `src/core/` | Nothing (foundation) |

**If importing an upper layer from a lower one:** STOP. Use event bus, dependency injection, or core contracts (`src/core/contracts.ts`).

Full architecture detail: `.claude/skills/overlord-architecture.md`

---

## The Development Loop (10 Stages)

Every code change runs through ALL 10 stages. No skipping. No shortcuts. Failure loops back to Stage 1.

```
0. PRE-FLIGHT → 1. CODE → 2. ITERATE → 3. STATIC TEST → 4. DEEP STATIC TEST
→ 5. SYNTAX CHECK → 6. CODE REVIEW → 7. E2E (Playwright) → 8. DOGFOOD → 9. CLEANUP
```

| Stage | Overlord Commands |
|-------|-------------------|
| 0. Pre-Flight | `git branch --show-current` (NOT `main`/`develop`), verify Issue exists |
| 3. Static Test | `npm test` — zero failures |
| 4. Deep Static Test | `npx tsc --noEmit && npm run validate` |
| 5. Syntax Check | `npx eslint src/ tests/ --ext .ts` |
| 7. E2E | `npm run test:e2e` — Playwright against `localhost:4000` |
| 9. Cleanup | Grep for debug artifacts, verify `git status` clean, fresh build |

**Full loop protocol (read this first):** `.claude/skills/dev-loop-overlord.md`
**Playwright E2E requirements:** `.claude/skills/playwright-e2e.md`
**Cleanup protocol:** Global `~/.claude/CLAUDE.md` → cleanup rules apply here too.

---

## Key Design Principles

- **Rooms define behavior, not agents.** An Agent is a 10-line identity card. The Room injects tools, rules, and output templates.
- **Tool access is structural, not instructional.** If a tool isn't in the room's `allowedTools`, it doesn't exist.
- **Every room exit requires a structured exit document.** No "Done!" — provide evidence.
- **RAID log tracks all decisions.** Searchable history for agent reference across phases.
- **Phase gates enforce sign-off.** Cannot skip phases without a GO verdict.

---

## TypeScript Rules

- All source in `src/` must be `.ts`. Strict mode enabled.
- **Zod schemas** for runtime validation (defined in `src/core/contracts.ts`).
- **`.js` extension** in imports (Node16 module resolution).
- **No `any` types** without justification comment.
- Use the **`Result` pattern** from `src/core/contracts.ts`:
  ```typescript
  import { ok, err } from './core/contracts.js';
  return ok({ id: '123', name: 'Test Room' });
  return err('NOT_FOUND', 'Room does not exist', { retryable: false });
  ```

---

## Room Types

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

---

## Git Workflow — Overlord-Specific

Follows global git-workflow rules with Overlord-specific scopes:
- Commit scopes: `transport`, `rooms`, `agents`, `tools`, `ai`, `storage`, `core`, `ui`, `tests`
- Always run `npm run validate` after every commit (layer ordering)
- PR code review must check: layer compliance, Zod schema coverage, exit documents for room changes

---

## What NOT To Do

- Import upper layers from lower layers
- Use tier-based approval (v1 pattern — eliminated in v2)
- Put behavioral rules in agent definitions (rooms own rules)
- Commit directly to `main`
- Use `any` types without comment justification
- Skip exit documents when leaving rooms
- Call test failures "pre-existing"
- Weaken tests to make them pass — fix the implementation
- Stop fixing after "enough" bugs — zero failures is the target
- Close Issues without subagent code review
- Close Issues without Playwright E2E tests
- Merge PRs without linking to Issue and Milestone
- Leave `console.log` / debug artifacts in committed code

---

## Quick Reference

```bash
# Development
npm run dev              # Start dev server (localhost:4000)
npm run build            # Production build
npm run validate         # Verify layer ordering

# Testing
npm test                 # All unit/integration tests
npm run test:e2e         # Playwright E2E tests
npx playwright test tests/e2e/settings-panel.spec.ts  # Specific spec
npx playwright test --headed                           # Debug in browser

# Type & Lint
npx tsc --noEmit         # Type check
npx eslint src/ tests/ --ext .ts  # Lint
```

---

## Skill Files (read before working)

```
.claude/skills/
  dev-loop-overlord.md    ← 10-stage loop with Overlord-specific commands
  playwright-e2e.md       ← Mandatory Playwright E2E test requirements
  overlord-architecture.md ← Layer ordering, violation detection, patterns
```
