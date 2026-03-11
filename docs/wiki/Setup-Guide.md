# Setup Guide

## Prerequisites

- **Node.js** 20+ (required for ESM support and native fetch)
- **npm** (included with Node.js)
- **Git** (for version control)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/twitchyvr/Overlord-v2.git
cd Overlord-v2

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Initialize database
npm run db:migrate
npm run db:seed

# Start development server
npm run dev
```

## Configuration

Copy `.env.example` to `.env` and configure:

### Required
```env
# At minimum, you need one AI provider API key
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Optional
```env
# Server
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# Database
DB_PATH=./data/overlord.db

# Additional providers
MINIMAX_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
```

See [[Configuration Reference]] for all variables.

## Database Initialization

### Migrate
Creates all tables and indexes:
```bash
npm run db:migrate
```

### Seed
Creates a default building with 7 floors and 6 default agents:
```bash
npm run db:seed
```

The database file is created at the path specified by `DB_PATH` (default: `./data/overlord.db`).

## Development Server

```bash
npm run dev
```

This starts the server with hot reload using `tsx watch`. The server listens on the configured `PORT` (default: 4000).

## Docker Development

Overlord v2 includes a dev container configuration for VS Code:

1. Open the project in VS Code
2. When prompted, click "Reopen in Container"
3. The container installs Node.js 20 and runs `npm install` automatically
4. Port 4000 is forwarded to your host machine

See `.devcontainer/` for the Docker Compose and devcontainer configuration.

## Verify Installation

After starting the dev server:

1. **Health check:**
   ```bash
   curl http://localhost:4000/health
   # {"status":"ok","version":"0.1.0","uptime":...}
   ```

2. **Run tests:**
   ```bash
   npm test
   ```

3. **Type check:**
   ```bash
   npm run typecheck
   ```

## Troubleshooting

### "Database not initialized"
Run `npm run db:migrate` before starting the server.

### "ANTHROPIC_API_KEY is required"
Copy `.env.example` to `.env` and add your API key.

### Port already in use
Change `PORT` in `.env` or kill the process using port 4000:
```bash
lsof -ti:4000 | xargs kill
```
