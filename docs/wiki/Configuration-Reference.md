# Configuration Reference

## Overview

All configuration is loaded from environment variables (`.env` file) and validated at startup using Zod schemas. Missing required fields cause the server to exit immediately.

**Source:** `src/core/config.ts`

## Server Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `4000` | HTTP server port |
| `NODE_ENV` | string | `'development'` | Environment: development, production, test |
| `CORS_ORIGIN` | string | `'http://localhost:5173'` | Allowed CORS origin |
| `LOG_LEVEL` | string | `'info'` | Pino log level: trace, debug, info, warn, error, fatal |

## Database Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DB_PATH` | string | `'./data/overlord.db'` | SQLite database file path |

## AI Provider Configuration

### Anthropic (Primary)
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ANTHROPIC_API_KEY` | string | — | API key (required for Anthropic provider) |
| `ANTHROPIC_MODEL` | string | `'claude-sonnet-4-20250514'` | Default model |

### MiniMax
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MINIMAX_API_KEY` | string | — | API key |
| `MINIMAX_MODEL` | string | — | Default model |
| `MINIMAX_GROUP_ID` | string | — | MiniMax group ID |

### OpenAI
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OPENAI_API_KEY` | string | — | API key |
| `OPENAI_MODEL` | string | — | Default model |

### Ollama (Local)
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OLLAMA_BASE_URL` | string | `'http://localhost:11434'` | Ollama server URL |
| `OLLAMA_MODEL` | string | — | Default model |

## Room Provider Assignment

Each room type can use a different AI provider:

| Variable | Type | Default | Room Type |
|----------|------|---------|-----------|
| `PROVIDER_DISCOVERY` | string | `'anthropic'` | Discovery rooms |
| `PROVIDER_ARCHITECTURE` | string | `'anthropic'` | Architecture rooms |
| `PROVIDER_CODE_LAB` | string | `'minimax'` | Code lab rooms |
| `PROVIDER_TESTING_LAB` | string | `'minimax'` | Testing lab rooms |
| `PROVIDER_REVIEW` | string | `'anthropic'` | Review rooms |
| `PROVIDER_DEPLOY` | string | `'anthropic'` | Deploy rooms |

The Strategist room always uses Anthropic. War rooms default to Anthropic.

## GitHub Integration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GITHUB_TOKEN` | string | — | GitHub personal access token |
| `GITHUB_OWNER` | string | — | GitHub repository owner |
| `GITHUB_REPO` | string | — | GitHub repository name |

## Security

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SESSION_SECRET` | string | `'dev-secret-change-in-production'` | Session signing secret |

## Plugins

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ENABLE_PLUGINS` | boolean | `false` | Enable the plugin system |
| `ENABLE_LUA_SCRIPTING` | boolean | `false` | Enable Lua scripting engine |
| `PLUGIN_DIR` | string | `'./plugins'` | Directory to scan for plugins |

## MCP

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MCP_SERVERS_CONFIG` | string | `'./mcp-servers.json'` | Path to MCP server config |

## Example `.env` File

```env
# Server
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:4000
LOG_LEVEL=info

# Database
DB_PATH=./data/overlord.db

# AI Providers
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-20250514

MINIMAX_API_KEY=your-minimax-key
MINIMAX_GROUP_ID=your-group-id

# OPENAI_API_KEY=sk-your-openai-key
# OLLAMA_BASE_URL=http://localhost:11434

# Room Provider Assignment
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

# Security
SESSION_SECRET=change-this-in-production

# Plugins
ENABLE_PLUGINS=false
PLUGIN_DIR=./plugins
```

## Config Validation

The config module uses Zod for runtime validation:

```typescript
config.validate(); // Throws if required fields are missing
config.get('PORT'); // Returns validated value
```

If validation fails, the server logs the specific validation errors and exits.
