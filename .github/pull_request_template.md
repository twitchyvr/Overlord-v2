## Summary

<!-- 1-3 bullet points describing what this PR does -->

-

## Related Issues

<!-- Link issues: Closes #N, Fixes #N, Related to #N -->

Closes #

## Milestone

<!-- Which milestone does this PR target? -->

- [ ] v2.4.0 — UX Quality & Feature Completeness
- [ ] v2.5.0 — Cloud Deployment & Hybrid Execution
- [ ] v2.6.0 — Pipeline Enforcement & Quality Automation
- [ ] v3.0.0 — Overlord as a Service

## Layer(s) Changed

<!-- Check all that apply -->

- [ ] Core (bus, config, contracts)
- [ ] Transport (socket, schemas, API)
- [ ] Rooms (room-manager, room-types, phase-gates, pipeline)
- [ ] Agents (registry, conversation-loop, session)
- [ ] Tools (registry, executor, providers)
- [ ] AI (providers, adapters, streaming)
- [ ] Storage (database, migrations)
- [ ] Plugins (loader, sandbox, scripting)
- [ ] UI (views, components, CSS, socket-bridge)
- [ ] E2E Tests (Playwright specs)
- [ ] CI/CD (GitHub Actions)
- [ ] Documentation

## Architecture Compliance

<!-- Verify these constraints -->

- [ ] No circular dependencies introduced (`npx madge --circular src/`)
- [ ] Layer ordering preserved — layers only depend downward (`npm run validate`)
- [ ] Result pattern used for module I/O (`ok()` / `err()`)
- [ ] Zod schemas defined for any new data structures
- [ ] Room-scoped tool access enforced structurally (not instructionally)
- [ ] Exit document templates defined for any new room types

## 8-Stage CDL Checklist

<!-- Every PR must pass ALL 8 stages. Check each as you complete it. -->

### Stage 1: Code
- [ ] Code written / modified

### Stage 2: Iterate
- [ ] Re-read all changes, checked edge cases, refined logic

### Stage 3: Static Test
- [ ] `npm test` — all tests pass, zero failures

### Stage 4: Deep Static Test
- [ ] `npm run typecheck` (`tsc --noEmit`) — zero type errors
- [ ] `npm run validate` — architecture layer ordering verified

### Stage 5: Check Syntax
- [ ] `npm run lint` — zero ESLint errors

### Stage 6: Code Review
- [ ] Subagent code review performed (reviewer ≠ author)
- [ ] Correctness, security, and edge cases verified
- [ ] No weakened tests or suppressed errors

### Stage 7: E2E
- [ ] Server boots successfully (`npm run dev`)
- [ ] **Playwright E2E test written** in `tests/e2e/` for this change
- [ ] Playwright test passes (`npm run test:e2e`)
- [ ] Runtime behavior verified (not just static checks)

### Stage 8: Dogfood
- [ ] Feature exercised through the Overlord UI as a real user
- [ ] Specific interactions tested (described below)
- [ ] No new bugs found (or new bugs filed as separate Issues)

## Dogfood Evidence

<!-- Describe what you tested through the UI. What did you click? What did you see? -->

-

## Test Plan

<!-- Summarize testing performed -->

- [ ] Unit tests added/updated: `tests/unit/...`
- [ ] Playwright E2E tests added/updated: `tests/e2e/...`
- [ ] Manual verification: (describe)
- [ ] No regressions in existing test suite

## Screenshots / Recordings

<!-- If UI changes, include before/after screenshots -->

## Checklist

- [ ] All 8 CDL stages completed above
- [ ] CHANGELOG.md updated
- [ ] Documentation updated if needed
- [ ] No secrets or credentials committed
- [ ] Commit messages follow Conventional Commits format
- [ ] Co-Authored-By footer included
