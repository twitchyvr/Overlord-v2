# Contributing

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `develop` | Integration branch |
| `feat/*` | Feature branches |
| `fix/*` | Bug fix branches |
| `docs/*` | Documentation branches |
| `stable/*` | Tagged stable milestones |

### Workflow

1. Create a feature branch from `develop`:
   ```bash
   git checkout develop
   git checkout -b feat/my-feature
   ```

2. Make changes, commit atomically

3. Open a PR against `develop`:
   ```bash
   gh pr create --base develop
   ```

4. CI must pass (lint, typecheck, test, architecture compliance)

5. After review, merge to `develop`

6. When `develop` is stable, merge to `main` and tag a release

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

body (optional)

footer (optional)
```

### Types

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure, no behavior change |
| `docs` | Documentation only |
| `test` | Test additions/changes |
| `chore` | Build, CI, tooling |
| `style` | Formatting, no logic change |

### Scopes

Use the layer name or module: `core`, `storage`, `ai`, `tools`, `agents`, `rooms`, `transport`, `ci`, `docs`.

### Examples

```
feat(rooms): add monitoring room type
fix(agents): badge validation allows wildcard access
refactor(tools): extract common tool execution logic
docs(wiki): add RAID log documentation
test(rooms): add phase gate integration tests
chore(ci): add Node 22 to test matrix
```

## Pull Request Requirements

Every PR must include:

- [ ] Summary of changes
- [ ] Phase this work belongs to (Phase 0-7)
- [ ] Layer(s) affected
- [ ] Test plan
- [ ] Architecture compliance (no layer violations)
- [ ] Linked issue (`Closes #N`)

See `.github/pull_request_template.md` for the full template.

## Issue Templates

| Template | When |
|----------|------|
| Bug Report | Something broken |
| Feature Request | New feature or improvement |
| Room Type | Proposing a new room type |
| Phase Work | Work within a specific implementation phase |

See `.github/ISSUE_TEMPLATE/` for all templates.

## Code Quality Standards

### TypeScript
- Strict mode enabled
- No `any` unless absolutely necessary
- Zod for runtime validation at boundaries

### Testing
- Vitest for all tests
- 80% coverage threshold (lines, branches, functions, statements)
- Unit tests per layer in `tests/unit/`
- Integration tests in `tests/integration/`
- E2E tests in `tests/e2e/`

### Architecture
- Strict layer ordering enforced by `check-layers.ts`
- No circular dependencies
- Universal I/O contracts (ok/err pattern)

### Labels

| Label | When |
|-------|------|
| `bug` | Something broken |
| `enhancement` | New feature or improvement |
| `ui` | Frontend / visual change |
| `backend` | Server / socket / module change |
| `refactor` | Code restructure, no behavior change |
| `blocked` | Waiting on something |
