## Summary

<!-- 1-3 bullet points describing what this PR does -->

-

## Related Issues

<!-- Link issues: Closes #N, Fixes #N, Related to #N -->

Closes #

## Implementation Phase

<!-- Which phase does this belong to? -->

- [ ] Phase 0: Stabilize
- [ ] Phase 1: Foundation
- [ ] Phase 2: Rooms
- [ ] Phase 3: Agents + AI
- [ ] Phase 4: All Rooms + RAID
- [ ] Phase 5: Phase Zero
- [ ] Phase 6: UI
- [ ] Phase 7: Plugins + Polish

## Layer(s) Changed

<!-- Check all that apply -->

- [ ] Core (bus, config)
- [ ] Transport (socket, API)
- [ ] Rooms (room-manager, room-types, phase-gates)
- [ ] Agents (registry, session, router)
- [ ] Tools (registry, executor, providers)
- [ ] AI (providers, streaming)
- [ ] Storage (database, models)
- [ ] Plugins (loader, sandbox)
- [ ] UI (frontend)
- [ ] Tests
- [ ] Documentation

## Architecture Compliance

<!-- Verify these constraints -->

- [ ] No circular dependencies introduced (layers only depend downward)
- [ ] New modules follow Universal I/O Contract pattern
- [ ] Room-scoped tool access enforced structurally (not instructionally)
- [ ] Exit document templates defined for any new room types
- [ ] RAID log entries created for architectural decisions

## Test Plan

<!-- How was this tested? -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual verification performed
- [ ] No regressions in existing tests

## Checklist

- [ ] Code follows project conventions
- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Documentation updated if needed
- [ ] No secrets or credentials committed
