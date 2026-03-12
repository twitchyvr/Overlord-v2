# ═══════════════════════════════════════════════════════
# Overlord v2 — Production Multi-Stage Build
# ═══════════════════════════════════════════════════════
#
# Build:  docker build -t overlord-v2 .
# Run:    docker run -p 4000:4000 --env-file .env overlord-v2
#
# Stages:
#   1. builder  — install all deps, compile TypeScript
#   2. runner   — production image with only what's needed
# ═══════════════════════════════════════════════════════

# ─── Stage 1: Builder ───────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build toolchain for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package manifests first for optimal layer caching
COPY package.json package-lock.json* ./

# Install ALL dependencies (devDeps needed for tsc)
RUN npm ci --include=dev

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# ─── Stage 2: Runner ────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Install build tools needed to compile better-sqlite3 for this platform
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ wget \
  && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package.json package-lock.json* ./

# Install production-only dependencies
RUN npm ci --omit=dev

# Rebuild better-sqlite3 for this exact runtime environment
RUN npm rebuild better-sqlite3

# Remove build tools to keep the final image lean
RUN apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Copy public assets (static frontend files)
COPY public/ ./public/

# Copy any scripts needed at runtime
COPY scripts/ ./scripts/

# Create data directory for SQLite, owned by non-root user
RUN mkdir -p /app/data && chown -R node:node /app/data /app/dist /app/public

# Switch to non-root user for security
USER node

# Expose server port
EXPOSE 4000

# Health check against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start the production server
CMD ["node", "dist/server.js"]
