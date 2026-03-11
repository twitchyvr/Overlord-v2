# Overlord v2

A scriptable, scalable agentic framework built on the **Building / Room / Table** paradigm.

## Core Concept

> **Don't change the agent — change the framework.**

Rooms define behavior, not agents. When an agent enters a room, the room's rules, tools, and output templates merge into their context. Change the testing room rules once — every agent that enters inherits them.

## Architecture

```
Building
  └── Floor (category of rooms)
       └── Room (bounded workspace with rules + tools)
            └── Table (work mode: focus, collab, boardroom)
                 └── Chair (agent slot)
```

### Spatial Model

| Floor | Purpose | Rooms |
|-------|---------|-------|
| Strategy | Phase Zero setup | Strategist Office, Building Architect |
| Collaboration | Planning | Discovery, Architecture, War Room |
| Execution | Building | Code Lab, Testing Lab, Integration Room |
| Operations | Deployment | Deploy Room, Monitoring Room |
| Governance | Sign-off | Review Room, Audit Room, Release Lounge |
| Integration | External I/O | Plugin Bay, Data Exchange, Provider Hub |
| Lobby | Dashboard | Main Chat, Dashboard, Project Gallery, Security Desk |

### Layer Stack (strict ordering — no circular deps)

```
Transport → Rooms → Agents → Tools → AI → Storage → Core
```

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 20+
- **Database**: SQLite (local) / PostgreSQL via Supabase (production)
- **AI Providers**: Anthropic, MiniMax, OpenAI, Ollama (provider-agnostic adapter)
- **Transport**: Socket.IO + Express
- **Validation**: Zod schemas
- **Testing**: Vitest
- **CI/CD**: GitHub Actions

## Quick Start

```bash
# Clone
git clone https://github.com/twitchyvr/Overlord-v2.git
cd Overlord-v2

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Initialize database
npm run db:migrate
npm run db:seed

# Start development server
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Run compiled production server |
| `npm test` | Run test suite |
| `npm run test:coverage` | Run tests with coverage |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run validate` | Full validation (typecheck + lint + test) |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed development data |

## Project Structure

```
src/
  core/          # Event bus, config, logger, contracts (foundation)
  storage/       # Database, models (SQLite/Postgres)
  ai/            # Provider-agnostic AI adapters
  tools/         # Tool registry + room-scoped executor
  agents/        # Agent registry, sessions, router
  rooms/         # Room manager, room types, phase gates, RAID log
    room-types/  # Built-in room implementations
  transport/     # Socket.IO + API handlers
  plugins/       # Plugin loader + sandbox

tests/
  unit/          # Unit tests per layer
  integration/   # Cross-layer integration tests
  e2e/           # End-to-end tests

scripts/         # Migration, seeding, architecture check
.github/         # Actions, issue templates, PR template
docs/            # Architecture docs, API docs, guides
```

## Implementation Phases

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Stabilize v1, tag baseline | Planned |
| 1 | Foundation (Bus + Storage + Config) | **Current** |
| 2 | Rooms (Room Manager + Testing Lab + Exit Protocol) | Planned |
| 3 | Agents + AI (Registry + Providers + Tool Executor) | Planned |
| 4 | All Rooms + RAID (Remaining Rooms + Phase Gates) | Planned |
| 5 | Phase Zero (Strategist + Building Architect) | Planned |
| 6 | UI (Building-Themed Frontend) | Planned |
| 7 | Plugins + Polish (Scripting + Integration) | Planned |

## License

MIT
