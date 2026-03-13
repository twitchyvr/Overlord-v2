# Overlord v2 -- AI Agent Orchestration Framework

A scriptable, scalable, provider-agnostic framework for orchestrating AI agents through structured project phases. Built on the **Building / Floor / Room / Table / Chair** spatial model, where rooms define behavior -- not agents.

> **Don't change the agent -- change the framework.**
>
> When an agent enters a room, the room's rules, tools, and output templates merge into their context. Change the testing room rules once and every agent that enters inherits them. Agents are 10-line identity cards. Rooms are the brains.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Layer Stack](#layer-stack)
- [Phase System](#phase-system)
- [Room Types](#room-types)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Docker Development](#docker-development)
- [Production Deployment](#production-deployment)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [License](#license)

---

## Architecture Overview

Overlord v2 uses a spatial metaphor to organize AI agent work. Every project is a **Building**, and within that building, work flows through purpose-built rooms on categorized floors.

```
Building (project)
  |
  +-- Floor (functional category)
  |     |
  |     +-- Room (bounded workspace with rules, tools, file scope)
  |           |
  |           +-- Table (work mode: focus, collaboration, boardroom)
  |                 |
  |                 +-- Chair (agent slot)
  |
  +-- Floor
  |     +-- Room
  |           +-- Table
  |                 +-- Chair
  ...
```

### Spatial Model

| Floor | Purpose | Rooms |
|-------|---------|-------|
| **Strategy** | Phase Zero setup -- defining goals and building layout | Strategist Office, Building Architect |
| **Collaboration** | Planning, requirements, and design | Discovery, Architecture, War Room |
| **Execution** | Implementation and verification | Code Lab, Testing Lab |
| **Governance** | Sign-off and quality gates | Review |
| **Operations** | Deployment and release management | Deploy |
| **Integration** | External I/O, plugins, provider management | Plugin Bay, Data Exchange, Provider Hub |

### Key Architectural Principles

- **Rooms define behavior, not agents.** An agent is a lightweight identity card (name, role, room access list). The room injects tools, rules, and output templates.
- **Tool access is structural, not instructional.** If a tool is not in the room's `allowedTools`, it does not exist for agents in that room. No "please don't use it" -- it is simply absent.
- **Every room exit requires a structured exit document.** No "Done!" -- agents must provide evidence and structured output.
- **RAID log tracks all decisions.** Searchable history (Risks, Assumptions, Issues, Decisions) for agent reference across phases.
- **Phase gates enforce sign-off.** Cannot skip phases without a GO verdict from a reviewer.

---

## Layer Stack

Each layer can **only** import from layers below it. No circular dependencies. This is enforced by `npm run validate` and CI.

```
  Transport        Socket.IO + Express HTTP handlers
      |
  Rooms            Room manager, room types, phase gates, RAID log, chat orchestrator
      |
  Agents           Agent registry, sessions, conversation loop, routing
      |
  Tools            Tool registry, room-scoped executor, tool providers
      |
  AI               Provider-agnostic adapters (Anthropic, MiniMax, OpenAI, Ollama)
      |
  Storage          SQLite database, models, migrations
      |
  Core             Event bus, config, logger, contracts, Result pattern
```

| Layer | Directory | Depends On |
|-------|-----------|------------|
| Transport | `src/transport/` | Rooms, Agents, Tools, Core |
| Rooms | `src/rooms/` | Agents, Tools, AI, Storage, Core |
| Agents | `src/agents/` | Tools, AI, Storage, Core |
| Tools | `src/tools/` | AI, Storage, Core |
| AI | `src/ai/` | Storage, Core |
| Storage | `src/storage/` | Core |
| Core | `src/core/` | Nothing (foundation layer) |

---

## Phase System

Every building progresses through a defined sequence of phases. Phase gates enforce go/no-go checkpoints between them -- you cannot skip a phase without a structured exit document, a RAID log entry, and a reviewer sign-off.

```
strategy --> discovery --> architecture --> execution --> review --> deploy
```

| Phase | Description | Gate Requirement |
|-------|-------------|-----------------|
| **Strategy** | Phase Zero. The Strategist asks consultative questions about goals, success criteria, and constraints. Produces a building blueprint that provisions all floors, rooms, and agents. | Building blueprint exit document |
| **Discovery** | Requirements gathering. Read-only access. Produces a requirements specification. | Requirements document |
| **Architecture** | System design and task breakdown. Read-only access. Produces architecture decisions and task decomposition. | Architecture document + task breakdown |
| **Execution** | Implementation. Code Lab has full write access (scoped to assigned files). Testing Lab has NO write access (structurally enforced). | Working implementation + passing tests |
| **Review** | Go/no-go quality gate. Read-only access. Reviewer provides verdict: GO, NO-GO, or CONDITIONAL. | Reviewer sign-off with evidence |
| **Deploy** | Release management. Git/CI tools available. Requires Release sign-off before deployment. | Deployment confirmation |

### Gate Verdicts

- **GO** -- Phase passes. Building advances to the next phase automatically.
- **NO-GO** -- Phase fails. Work returns to the current phase for remediation.
- **CONDITIONAL** -- Phase passes with conditions. Conditions must be resolved before the gate auto-advances to GO.

---

## Room Types

Overlord v2 ships with 12 built-in room types. Custom room types can be registered via the plugin system.

| Room Type | Floor | File Scope | Key Tools | Constraint |
|-----------|-------|------------|-----------|------------|
| `strategist` | Strategy | Read-only | `web_search`, `record_note`, `recall_notes`, `list_dir` | No code tools. Consultation only. |
| `building-architect` | Strategy | Read-only | `record_note`, `recall_notes`, `list_dir` | Custom floor/room layout design. |
| `discovery` | Collaboration | Read-only | `web_search`, `read_file`, `list_dir`, `record_note`, `recall_notes` | Produce requirements. No writes. |
| `architecture` | Collaboration | Read-only | `read_file`, `list_dir`, `record_note`, `recall_notes` | Produce task breakdown. No writes. |
| `code-lab` | Execution | Read-write | `read_file`, `write_file`, `patch_file`, `bash`, `list_dir`, `record_note` | Full write access, scoped to assigned files. |
| `testing-lab` | Execution | Read-only | `read_file`, `bash`, `list_dir`, `record_note`, `recall_notes` | NO `write_file` -- structurally enforced. |
| `review` | Governance | Read-only | `read_file`, `list_dir`, `recall_notes` | Go/no-go decisions with evidence. |
| `deploy` | Operations | Read-only | `bash`, `list_dir`, `recall_notes` | Git/CI tools. Requires Release sign-off. |
| `war-room` | Collaboration | Read-write | `read_file`, `write_file`, `bash`, `list_dir`, `record_note`, `recall_notes` | Elevated access for incident response. Available at any phase. |
| `data-exchange` | Integration | Varies | Data import/export tools | External data I/O. |
| `provider-hub` | Integration | Read-only | Provider management tools | AI provider configuration. |
| `plugin-bay` | Integration | Read-only | Plugin management tools | Plugin lifecycle management. |

### Quick Start Templates

The Strategist Office offers predefined templates for common project types:

| Template | Description | Rooms Provisioned |
|----------|-------------|-------------------|
| `web-app` | Full-stack web application | Discovery, Architecture, Code Lab, Testing Lab, Review, Deploy |
| `microservices` | Distributed system with integration testing | Discovery, Architecture, Code Lab, Testing Lab, Review, Deploy + Integration Floor |
| `data-pipeline` | ETL/data processing pipeline | Discovery, Architecture, Code Lab, Testing Lab, Review, Deploy |
| `cli-tool` | Command-line application (focused scope) | Discovery, Architecture, Code Lab, Testing Lab, Review |
| `api-service` | REST/GraphQL API with auth and docs | Discovery, Architecture, Code Lab, Testing Lab, Review, Deploy |

---

## Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** (included with Node.js)
- At least one AI provider API key (Anthropic, MiniMax, OpenAI) or a running Ollama instance

### Install and Run

```bash
# Clone the repository
git clone https://github.com/twitchyvr/Overlord-v2.git
cd Overlord-v2

# Install dependencies
npm install

# Copy the example environment file and add your API keys
cp .env.example .env
# Edit .env -- at minimum, set one AI provider API key

# Initialize the database
npm run db:migrate
npm run db:seed

# Start the development server (hot reload via tsx)
npm run dev
```

The server starts on `http://localhost:4000` by default. Visit `/health` to verify:

```json
{ "status": "ok", "version": "0.1.0", "uptime": 1.234 }
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production server |
| `npm test` | Run test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with V8 coverage |
| `npm run lint` | Lint with ESLint |
| `npm run lint:fix` | Lint and auto-fix |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run validate` | Full validation: typecheck + lint + test |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed development data |

---

## Environment Variables

All configuration is loaded and validated via Zod schemas in `src/core/config.ts`. Copy `.env.example` to `.env` and set your values.

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `NODE_ENV` | `development` | Environment: `development`, `production`, `test` |
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `./data/overlord.db` | Path to SQLite database file |

### AI Providers

At least one provider must be configured for the system to function.

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | -- | Anthropic API key |
| `ANTHROPIC_BASE_URL` | -- | Custom Anthropic API base URL (optional) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Anthropic model identifier |
| `MINIMAX_API_KEY` | -- | MiniMax API key |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/anthropic` | MiniMax API base URL |
| `MINIMAX_GROUP_ID` | -- | MiniMax group ID |
| `MINIMAX_MODEL` | `MiniMax-M2.5` | MiniMax model identifier |
| `OPENAI_API_KEY` | -- | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model identifier |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL (no API key needed) |
| `OLLAMA_MODEL` | `llama3` | Ollama model identifier |

### Provider Assignments per Room Type

Control which AI provider powers each room type. Defaults reflect a cost-optimized strategy: Anthropic for reasoning-heavy rooms, MiniMax for coding tasks.

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER_DISCOVERY` | `anthropic` | AI provider for Discovery rooms |
| `PROVIDER_ARCHITECTURE` | `anthropic` | AI provider for Architecture rooms |
| `PROVIDER_CODE_LAB` | `minimax` | AI provider for Code Lab rooms |
| `PROVIDER_TESTING_LAB` | `minimax` | AI provider for Testing Lab rooms |
| `PROVIDER_REVIEW` | `anthropic` | AI provider for Review rooms |
| `PROVIDER_DEPLOY` | `anthropic` | AI provider for Deploy rooms |

### GitHub Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | -- | GitHub personal access token |
| `GITHUB_OWNER` | -- | GitHub repository owner |
| `GITHUB_REPO` | -- | GitHub repository name |

### MCP (Model Context Protocol)

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_SERVERS_CONFIG` | `./mcp-servers.json` | Path to MCP servers configuration file |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | `dev-secret-change-in-production` | Session signing secret (change in production) |
| `CORS_ORIGIN` | `http://localhost:4000` | Allowed CORS origin |

### AI Request Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_REQUEST_TIMEOUT_MS` | `60000` | AI request timeout in milliseconds |

### Features

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_PLUGINS` | `false` | Enable the plugin system |
| `ENABLE_LUA_SCRIPTING` | `false` | Enable Lua scripting support |
| `PLUGIN_DIR` | `./plugins` | Directory for plugin files |

---

## Docker Development

Overlord v2 includes full Docker support for both development and production.

### Dev Container (VS Code)

The project ships with a `.devcontainer/` configuration for VS Code Dev Containers. This provides a fully isolated development environment with all dependencies pre-installed.

1. Open the project in VS Code
2. When prompted, click **"Reopen in Container"**
3. The container installs dependencies, builds native modules, and forwards port 4000

The dev container uses `mcr.microsoft.com/devcontainers/javascript-node:20` and includes Git, GitHub CLI, ESLint, Prettier, GitLens, and Vitest Explorer.

**`.devcontainer/docker-compose.yml`** mounts the project directory, isolates `node_modules` in a Docker volume, and exposes port 4000.

### Production Docker

Build and run the production image:

```bash
# Build the multi-stage production image
docker build -t overlord-v2 .

# Run with environment variables
docker run -d \
  --name overlord-v2 \
  -p 4000:4000 \
  -v overlord_data:/app/data \
  -e ANTHROPIC_API_KEY=your-key-here \
  -e SESSION_SECRET=your-secret-here \
  overlord-v2
```

Or use Docker Compose for production:

```bash
# Set environment variables in .env, then:
docker compose -f docker-compose.prod.yml up -d
```

The production image is a multi-stage build on `node:20-alpine`. It compiles TypeScript in the builder stage, installs only production dependencies in the runner stage, runs as a non-root user, and includes a health check against `/health`.

---

## Testing

Overlord v2 uses [Vitest](https://vitest.dev/) for testing with V8 coverage.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Structure

Tests are organized by layer, mirroring the source code structure:

```
tests/
  unit/
    core/           # Bus, config, contracts, logger
    storage/        # Database operations
    ai/             # AI provider + adapter tests
    tools/          # Tool registry, executor, providers (filesystem, notes, shell, web)
    agents/         # Agent registry, router, session, conversation loop
    rooms/          # Room manager, all room types, phase gates, RAID log, scope change
    commands/       # Command registry, built-in commands, mentions, references
    plugins/        # Plugin loader, sandbox, system
    transport/      # Socket handler, schemas
    ui/             # UI components (boot, engine, store, router, panels, modals, etc.)
  integration/
    ai-providers.test.ts       # Cross-provider integration
    full-lifecycle.test.ts     # End-to-end project lifecycle
    room-tool-scoping.test.ts  # Tool scoping enforcement across rooms
```

### Full Validation

Run all checks in sequence (this is what CI runs):

```bash
npm run validate
# Equivalent to: npm run typecheck && npm run lint && npm run test
```

---

## Project Structure

```
Overlord-v2/
|
+-- src/
|   +-- core/                   # Foundation layer (no dependencies)
|   |   +-- bus.ts              #   EventEmitter3-based event bus
|   |   +-- config.ts           #   Zod-validated configuration
|   |   +-- contracts.ts        #   Shared types, Result pattern, Zod schemas
|   |   +-- logger.ts           #   Pino structured logger
|   |
|   +-- storage/                # Database layer
|   |   +-- db.ts               #   SQLite via better-sqlite3, migrations
|   |
|   +-- ai/                     # AI provider layer
|   |   +-- ai-provider.ts      #   Provider-agnostic adapter registry
|   |   +-- adapters/
|   |       +-- anthropic.ts    #   Anthropic Claude adapter
|   |       +-- minimax.ts      #   MiniMax adapter
|   |       +-- openai.ts       #   OpenAI adapter
|   |       +-- ollama.ts       #   Ollama (local) adapter
|   |
|   +-- tools/                  # Tool layer
|   |   +-- tool-registry.ts    #   Tool registration and lookup
|   |   +-- tool-executor.ts    #   Room-scoped tool execution
|   |   +-- providers/
|   |       +-- filesystem.ts   #   read_file, write_file, patch_file, list_dir
|   |       +-- notes.ts        #   record_note, recall_notes (RAID log)
|   |       +-- shell.ts        #   bash command execution
|   |       +-- web.ts          #   web_search
|   |
|   +-- agents/                 # Agent layer
|   |   +-- agent-registry.ts   #   Agent CRUD, room access management
|   |   +-- agent-router.ts     #   Route messages to appropriate agents
|   |   +-- agent-session.ts    #   Conversation state per agent
|   |   +-- conversation-loop.ts#   AI message -> tool call -> response loop
|   |
|   +-- rooms/                  # Room layer
|   |   +-- room-manager.ts     #   Room lifecycle, type registry
|   |   +-- building-manager.ts #   Building + Floor CRUD (spatial model top levels)
|   |   +-- building-onboarding.ts # Auto-provisions Strategist on building creation
|   |   +-- chat-orchestrator.ts#   chat:message -> AI -> chat:response pipeline
|   |   +-- phase-gate.ts       #   Go/no-go checkpoints between phases
|   |   +-- phase-zero.ts       #   Phase Zero (Strategist) bus handlers
|   |   +-- scope-change.ts     #   Scope change request handling
|   |   +-- raid-log.ts         #   RAID log (Risks, Assumptions, Issues, Decisions)
|   |   +-- citation-tracker.ts #   Track citations and references
|   |   +-- room-types/
|   |       +-- base-room.ts    #   Abstract base room class
|   |       +-- index.ts        #   Built-in room type registry (12 types)
|   |       +-- strategist.ts   #   Strategy Floor -- Phase Zero setup
|   |       +-- building-architect.ts # Strategy Floor -- custom layout design
|   |       +-- discovery.ts    #   Collaboration Floor -- requirements
|   |       +-- architecture.ts #   Collaboration Floor -- system design
|   |       +-- code-lab.ts     #   Execution Floor -- implementation
|   |       +-- testing-lab.ts  #   Execution Floor -- verification
|   |       +-- review.ts       #   Governance Floor -- sign-off
|   |       +-- deploy.ts       #   Operations Floor -- release
|   |       +-- war-room.ts     #   Collaboration Floor -- incident response
|   |       +-- data-exchange.ts#   Integration Floor -- external data I/O
|   |       +-- provider-hub.ts #   Integration Floor -- provider management
|   |       +-- plugin-bay.ts   #   Integration Floor -- plugin lifecycle
|   |
|   +-- commands/               # Command system
|   |   +-- index.ts            #   Command initialization
|   |   +-- command-registry.ts #   Slash command registration
|   |   +-- builtin-commands.ts #   Built-in commands
|   |   +-- mention-handler.ts  #   @mention processing
|   |   +-- reference-resolver.ts # Reference resolution (#issue, etc.)
|   |   +-- contracts.ts        #   Command type definitions
|   |
|   +-- plugins/                # Plugin system
|   |   +-- index.ts            #   Plugin initialization
|   |   +-- plugin-loader.ts    #   Plugin discovery and loading
|   |   +-- plugin-sandbox.ts   #   Sandboxed plugin execution
|   |   +-- contracts.ts        #   Plugin type definitions
|   |
|   +-- transport/              # Transport layer
|   |   +-- socket-handler.ts   #   Socket.IO event wiring
|   |   +-- schemas.ts          #   Zod schemas for socket messages
|   |
|   +-- server.ts               # Entry point -- bootstraps all layers bottom-up
|
+-- tests/                      # Test suite (unit + integration)
+-- scripts/                    # Migration, seeding scripts
+-- public/                     # Static frontend assets
+-- data/                       # SQLite database (auto-created)
+-- docs/                       # Architecture documentation
+-- .devcontainer/              # VS Code Dev Container config
+-- .github/                    # Actions, issue templates, PR template
+-- Dockerfile                  # Multi-stage production build
+-- docker-compose.prod.yml     # Production Compose config
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed history of all changes, organized by version.

Overlord v2 follows [Semantic Versioning](https://semver.org/) (SemVer). Every release is tagged with `vMAJOR.MINOR.PATCH` (e.g., `v0.9.0`).

---

## Contributing

### Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable, protected. All changes go through PRs. |
| `develop` | Integration branch. Feature branches merge here first. |
| `feat/*` | New features |
| `fix/*` | Bug fixes |
| `docs/*` | Documentation changes |
| `refactor/*` | Code restructuring (no behavior change) |
| `stable/v*` | Tagged milestones |
| `release/*` | Release candidates |

### Workflow

1. **Create a branch** from `develop`:
   ```bash
   git checkout -b feat/my-feature develop
   ```

2. **Create a GitHub Issue** for the work:
   ```bash
   gh issue create --title "feat: my feature" --body "Description..."
   ```

3. **Commit atomically** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   type(scope): subject

   Body explaining the why.

   Closes #42
   ```
   Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`

4. **Open a Pull Request**:
   ```bash
   gh pr create --title "feat(scope): description" --body "Summary, test plan, closes #42"
   ```

5. **Pass validation**: All PRs must pass `npm run validate` (typecheck + lint + test).

6. **Never push directly to `main`.**

7. **Tag releases** with SemVer: `git tag vMAJOR.MINOR.PATCH` after merging to `main`. Update `CHANGELOG.md` with every release.

### Code Standards

- All source code must be TypeScript (`.ts`) with strict mode
- Use Zod schemas for runtime validation (defined in `src/core/contracts.ts`)
- Import paths use `.js` extension (Node16 module resolution)
- No `any` types without justification in a comment
- Every module follows the Result pattern: `ok(data)` / `err(code, message)`

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript 5.7+ (strict mode) |
| Runtime | Node.js 20+ |
| Database | SQLite via better-sqlite3 |
| AI Providers | Anthropic, MiniMax, OpenAI, Ollama |
| Transport | Socket.IO 4 + Express 5 |
| Validation | Zod 3 |
| Event System | EventEmitter3 |
| Logging | Pino |
| Testing | Vitest 3 + V8 coverage |
| Linting | ESLint 9 + typescript-eslint |
| CI/CD | GitHub Actions |
| Containerization | Docker (multi-stage Alpine build) |

---

## License

[MIT](LICENSE) -- Copyright (c) 2026 Matt Rogers
