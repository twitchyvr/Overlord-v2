# Contributing to Overlord v2

Thank you for your interest in contributing to Overlord v2! This guide will help you get started.

## Development Setup

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/twitchyvr/Overlord-v2.git
   cd Overlord-v2
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Run the test suite:
   ```bash
   npm test
   ```

## Branch Strategy

| Branch | Purpose | Merges To |
|--------|---------|-----------|
| `main` | Stable, protected | -- |
| `develop` | Integration | `main` (via release PR) |
| `feat/*` | New features | `develop` |
| `fix/*` | Bug fixes | `develop` |
| `docs/*` | Documentation | `develop` |
| `refactor/*` | Restructuring | `develop` |

**Never push directly to `main`.** All changes go through pull requests.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

Body explaining what and why.

Co-Authored-By: Your Name <your@email.com>
Closes #<issue-number>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`

Scopes match the architecture layers: `transport`, `rooms`, `agents`, `tools`, `ai`, `storage`, `core`, `ui`, `tests`

## Architecture

Overlord v2 follows a strict layered architecture:

```
Transport -> Rooms -> Agents -> Tools -> AI -> Storage -> Core
```

Each layer can only import from layers below it. Run `npm run validate` to verify.

## Testing

- Run all tests: `npm test`
- Type check: `npx tsc --noEmit`
- Lint: `npx eslint src/ tests/ --ext .ts`
- Layer validation: `npm run validate`

Zero test failures is the only acceptable state.

## Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] Type check clean (`npx tsc --noEmit`)
- [ ] Layer validation clean (`npm run validate`)
- [ ] Lint clean (`npx eslint src/ tests/ --ext .ts`)
- [ ] PR links to a GitHub Issue
- [ ] Conventional commit message format

## Reporting Issues

Use the GitHub issue templates:
- **Bug Report** for something that's broken
- **Feature Request** for new functionality

## Code of Conduct

Be respectful, constructive, and collaborative.
