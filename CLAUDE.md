# Overlord v2 — Claude Code Project Instructions

These rules are **mandatory and non-negotiable**.

---

## 1. Architecture — STRICT LAYER ORDERING

```
Transport → Rooms → Agents → Tools → AI → Storage → Core
```

Each layer can ONLY import from layers below it. No circular dependencies.
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

---

## 2. Key Principles

- **Rooms define behavior, not agents.** Agent is a 10-line identity card. Room injects tools, rules, and output templates.
- **Tool access is structural, not instructional.** If a tool isn't in the room's `allowedTools`, it doesn't exist. No "please don't use it" — it's simply not there.
- **Every room exit requires a structured exit document.** No "Done!" — provide evidence.
- **RAID log tracks all decisions.** Searchable history for agent reference across phases.
- **Phase gates enforce sign-off.** Cannot skip phases without GO verdict.

---

## 3. TypeScript Rules

- All source code in `src/` must be TypeScript (`.ts`)
- Use Zod schemas for runtime validation (defined in `src/core/contracts.ts`)
- Use strict mode (`strict: true` in tsconfig)
- Import paths use `.js` extension (Node16 module resolution)
- No `any` types without justification in a comment

---

## 4. Git Workflow — MANDATORY

### Before coding
1. Create or switch to a feature branch: `feat/`, `fix/`, `docs/`, `refactor/`
2. Create a GitHub Issue for the work

### After coding
3. Commit atomically: `type(scope): subject`
   - Always include: `Co-Authored-By: Claude <noreply@anthropic.com>`
4. Open a PR — never push directly to `main`
5. PR body: Summary, Test Plan, link to Issue (`Closes #N`)

### Branch Strategy
- `main` — stable, protected
- `develop` — integration branch
- `feat/*`, `fix/*`, `docs/*` — work branches off `develop`
- `stable/v*` — tagged milestones
- `release/*` — release candidates

---

## 5. Room Types (built-in)

| Room | Floor | Key Constraint |
|------|-------|---------------|
| `strategist` | Strategy | Phase Zero setup, no code tools |
| `discovery` | Collaboration | Read-only, produce requirements |
| `architecture` | Collaboration | Read-only, produce task breakdown |
| `code-lab` | Execution | Full write access, scoped to assigned files |
| `testing-lab` | Execution | NO write_file — structurally enforced |
| `review` | Governance | Read-only, go/no-go decisions with evidence |
| `deploy` | Operations | Git/CI tools, requires Release sign-off |
| `war-room` | Collaboration | Elevated access, incident response |

---

## 6. Universal I/O Contract

Every module follows the Result pattern from `src/core/contracts.ts`:

```typescript
import { ok, err } from './core/contracts.js';

// Success
return ok({ id: '123', name: 'Test Room' });

// Error
return err('NOT_FOUND', 'Room does not exist', { retryable: false });
```

---

## 7. What NOT to do

- Do NOT import upper layers from lower layers (violates architecture)
- Do NOT use tier-based approval (v1 pattern — eliminated in v2)
- Do NOT put behavioral rules in agent definitions (rooms own rules)
- Do NOT commit to `main` directly
- Do NOT use `any` types without comment justification
- Do NOT skip exit documents when leaving rooms
