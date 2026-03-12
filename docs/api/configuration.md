# Configuration Reference

All Overlord v2 configuration is managed through environment variables, validated
at startup with Zod schemas.

**Source:** `src/core/config.ts`

---

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP/WebSocket server port |
| `NODE_ENV` | `development` | Environment: `development`, `production`, `test` |
| `LOG_LEVEL` | `info` | Logging level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

---

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `./data/overlord.db` | Path to the SQLite database file |

The database is created automatically on first run. Schema migrations are applied
at startup via `src/storage/migrations/`.

---

## AI Providers

Overlord v2 is provider-agnostic. Configure one or more providers:

### Anthropic (Claude)

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Anthropic API key (required for Anthropic rooms) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Default model for Anthropic provider |

### MiniMax

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIMAX_API_KEY` | — | MiniMax API key |
| `MINIMAX_GROUP_ID` | — | MiniMax group ID |
| `MINIMAX_MODEL` | — | MiniMax model identifier |

### OpenAI

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_MODEL` | — | OpenAI model identifier |

### Ollama (Local)

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | — | Ollama model name |

---

## Provider Assignment

Each room type uses a specific AI provider. Override the default assignments:

| Variable | Default | Room Type |
|----------|---------|-----------|
| `PROVIDER_DISCOVERY` | `anthropic` | Discovery rooms |
| `PROVIDER_ARCHITECTURE` | `anthropic` | Architecture rooms |
| `PROVIDER_CODE_LAB` | `minimax` | Code lab rooms |
| `PROVIDER_TESTING_LAB` | `minimax` | Testing lab rooms |
| `PROVIDER_REVIEW` | `anthropic` | Review rooms |
| `PROVIDER_DEPLOY` | `anthropic` | Deploy rooms |

**Note:** The Strategist room always uses Anthropic. War rooms default to Anthropic.

---

## GitHub Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | — | GitHub personal access token |
| `GITHUB_OWNER` | — | GitHub repository owner |
| `GITHUB_REPO` | — | GitHub repository name |

Required for the `github` tool and `/deploy` command.

---

## MCP (Model Context Protocol)

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_SERVERS_CONFIG` | `./mcp-servers.json` | Path to MCP server configuration file |

MCP servers provide additional tools to agents. The config file defines available
MCP server connections.

---

## Security

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | `dev-secret-change-in-production` | Session signing secret |
| `CORS_ORIGIN` | `http://localhost:4000` | Allowed CORS origin |

**Production:** Always change `SESSION_SECRET` to a strong random value.

---

## Plugins

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_PLUGINS` | `false` | Enable the plugin system |
| `ENABLE_LUA_SCRIPTING` | `false` | Enable Lua scripting engine |
| `PLUGIN_DIR` | `./plugins` | Directory to scan for plugins |

---

## Example `.env` File

```env
# Server
PORT=4000
NODE_ENV=development
LOG_LEVEL=info

# Database
DB_PATH=./data/overlord.db

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

MINIMAX_API_KEY=...
MINIMAX_GROUP_ID=...
MINIMAX_MODEL=abab6.5s-chat

# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o

# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3

# Provider Assignment (per room type)
PROVIDER_DISCOVERY=anthropic
PROVIDER_ARCHITECTURE=anthropic
PROVIDER_CODE_LAB=minimax
PROVIDER_TESTING_LAB=minimax
PROVIDER_REVIEW=anthropic
PROVIDER_DEPLOY=anthropic

# GitHub
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=myorg
GITHUB_REPO=myproject

# MCP
MCP_SERVERS_CONFIG=./mcp-servers.json

# Security
SESSION_SECRET=change-this-in-production
CORS_ORIGIN=http://localhost:4000

# Plugins
ENABLE_PLUGINS=false
ENABLE_LUA_SCRIPTING=false
PLUGIN_DIR=./plugins
```

---

## Config Access in Code

```typescript
import { config } from './core/config.js';

const port = config.get('PORT');           // number
const dbPath = config.get('DB_PATH');      // string
const apiKey = config.get('ANTHROPIC_API_KEY'); // string | undefined
```

All config values are validated at startup. Missing required values (like API keys
for enabled providers) cause the server to exit with a descriptive error message.
