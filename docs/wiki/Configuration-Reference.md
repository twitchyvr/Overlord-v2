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
| `ANTHROPIC_MODEL` | string | `'claude-3-sonnet-20240229'` | Default model |

### MiniMax
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MINIMAX_API_KEY` | string | — | API key |
| `MINIMAX_MODEL` | string | `'abab6.5-chat'` | Default model |
| `MINIMAX_GROUP_ID` | string | — | MiniMax group ID |

### OpenAI
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OPENAI_API_KEY` | string | — | API key |
| `OPENAI_MODEL` | string | `'gpt-4-turbo'` | Default model |

### Ollama (Local)
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OLLAMA_BASE_URL` | string | `'http://localhost:11434'` | Ollama server URL |
| `OLLAMA_MODEL` | string | `'llama3'` | Default model |

## Room Provider Assignment

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PROVIDER_SMART` | string | `'anthropic'` | Provider for `smart` rooms |
| `MODEL_SMART` | string | — | Model for `smart` rooms |
| `PROVIDER_CHEAP` | string | `'anthropic'` | Provider for `cheap` rooms |
| `MODEL_CHEAP` | string | — | Model for `cheap` rooms |
| `PROVIDER_DEFAULT` | string | `'anthropic'` | Default provider for `configurable` rooms |
| `MODEL_DEFAULT` | string | — | Default model for `configurable` rooms |

## Example `.env` File

```env
# Server
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info

# Database
DB_PATH=./data/overlord.db

# AI Providers
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-3-sonnet-20240229

MINIMAX_API_KEY=your-minimax-key
MINIMAX_MODEL=abab6.5-chat
MINIMAX_GROUP_ID=your-group-id

OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4-turbo

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Room Provider Assignment
PROVIDER_SMART=anthropic
MODEL_SMART=claude-3-opus-20240229
PROVIDER_CHEAP=anthropic
MODEL_CHEAP=claude-3-haiku-20240307
PROVIDER_DEFAULT=anthropic
MODEL_DEFAULT=claude-3-sonnet-20240229
```

## Config Validation

The config module uses Zod for runtime validation:

```typescript
config.validate(); // Throws if required fields are missing
config.get('PORT'); // Returns validated value
```

If validation fails, the server logs the specific validation errors and exits.
