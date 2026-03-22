# Contributing to Overlord v2

Thank you for your interest in contributing to Overlord v2! This guide will help you get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Making Changes](#making-changes)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Reporting Issues](#reporting-issues)

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/Overlord-v2.git`
3. Add upstream remote: `git remote add upstream https://github.com/twitchyvr/Overlord-v2.git`
4. Create a feature branch: `git checkout -b feat/your-feature`

## Development Setup

### Prerequisites

- Node.js 20+ (recommended: use `nvm`)
- npm 10+
- Git

### Install & Run

```bash
npm install                  # Install dependencies
npm run dev                  # Start dev server (localhost:4000)
npm test                     # Run all tests
npx tsc --noEmit             # Type check
npx eslint src/ tests/       # Lint
npm run validate             # Verify layer ordering
```

### Project Structure

```
src/
  core/         # Foundation — config, bus, contracts, logger (imports nothing)
  storage/      # Database layer (imports: core)
  ai/           # AI provider adapters (imports: storage, core)
  tools/        # Tool definitions and execution (imports: ai, storage, core)
  agents/       # Agent registry, sessions, stats (imports: tools, ai, storage, core)
  rooms/        # Room types, phase gates, orchestration (imports: agents, tools, ai, storage, core)
  transport/    # Socket.IO handlers, HTTP (imports: all above)
public/
  ui/           # Frontend — vanilla JS, no framework
tests/
  unit/         # Unit tests (Vitest)
  e2e/          # E2E tests (Playwright)
```

## Architecture Overview

Overlord v2 uses a strict **layer ordering** architecture:

```
Transport → Rooms → Agents → Tools → AI → Storage → Core
```

Each layer can ONLY import from layers below it. No circular dependencies. This is enforced by `npm run validate` and CI.

Key concepts:
- **Buildings** = projects (each has a git repo working directory)
- **Floors** = workflow phases (strategy, collaboration, execution, governance, operations)
- **Rooms** = workspaces where agents operate (strategist office, code lab, testing lab, etc.)
- **Agents** = AI team members with roles and capabilities
- **Tools** = actions agents can perform (read files, write code, run tests, etc.)

## Making Changes

1. **Check for existing issues** — search before filing a new one
2. **Create/claim an issue** — every change traces to a GitHub Issue
3. **Create a feature branch** from `main`:
   - `feat/description` for new features
   - `fix/description` for bug fixes
   - `docs/description` for documentation
   - `refactor/description` for restructuring
4. **Write your code** following the coding standards below
5. **Test thoroughly** — all tests must pass
6. **Open a PR** linking the issue

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

Body explaining what and why (not how).

Co-Authored-By: Your Name <your@email.com>
Closes #issue-number
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`

**Scopes**: `transport`, `rooms`, `agents`, `tools`, `ai`, `storage`, `core`, `ui`, `tests`

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure type check passes: `npx tsc --noEmit`
3. Ensure lint passes: `npx eslint src/ tests/ --ext .ts`
4. Ensure layer ordering passes: `npm run validate`
5. Update documentation if you changed features
6. Link the PR to an Issue (`Closes #N`)
7. Request review
8. Address all review feedback

### PR Requirements

- All CI checks must pass (lint, typecheck, tests, architecture, build)
- At least 1 approval required
- No unresolved conversations
- Branch must be up to date with main

## Coding Standards

### TypeScript

- All source in `src/` must be `.ts` with strict mode
- Use `.js` extensions in imports (Node16 module resolution)
- No `any` types without justification comment
- Use the `Result` pattern from `src/core/contracts.ts`:
  ```typescript
  import { ok, err } from './core/contracts.js';
  return ok({ data: 'value' });
  return err('ERROR_CODE', 'Human-readable message');
  ```
- Use **Zod schemas** for runtime validation

### Frontend

- Vanilla JavaScript (no framework)
- ES modules with import/export
- Use the `h()` helper for DOM creation
- Subscribe to store changes for reactive updates
- Follow existing component patterns (Card, Modal, Drawer, Toast)

### General

- Keep functions focused and small
- Write self-documenting code — comments for "why", not "what"
- Don't over-engineer — solve the current problem
- Follow existing patterns in the codebase

## Testing

### Running Tests

```bash
npm test                                          # All unit/integration tests
npm run test:e2e                                  # Playwright E2E tests
npx vitest run tests/unit/path/to/test.ts         # Specific test file
npx playwright test tests/e2e/specific.spec.ts    # Specific E2E test
```

### Writing Tests

- Place unit tests in `tests/unit/` mirroring the `src/` structure
- Place E2E tests in `tests/e2e/`
- Use Vitest for unit tests, Playwright for E2E
- Test behavior, not implementation
- Mock external dependencies (DB, AI providers, file system)
- Aim for meaningful coverage, not 100% line coverage

## Reporting Issues

Use our issue templates:

- **Bug Report**: Something isn't working as expected
- **Feature Request**: Suggest a new feature or enhancement

Include:
- Clear title: `[type]: concise description`
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Screenshots if relevant
- Environment details (OS, Node version, browser)

## Questions?

- Open a [Discussion](https://github.com/twitchyvr/Overlord-v2/discussions) for questions
- Check the [Wiki](https://github.com/twitchyvr/Overlord-v2/wiki) for documentation
- Join the conversation in existing discussions

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](LICENSE)).
