# ═══════════════════════════════════════════════════════
# Overlord v2 — Production Multi-Stage Build
# ═══════════════════════════════════════════════════════

# ─── Stage 1: Builder ───
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

# Install ALL dependencies (including devDependencies for TypeScript compilation)
RUN npm ci --include=dev

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# ─── Stage 2: Runner ───
FROM node:20-alpine AS runner

WORKDIR /app

# Install build dependencies needed for native module rebuild
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json* ./

# Install production-only dependencies
RUN npm ci --omit=dev

# Rebuild better-sqlite3 for this exact Alpine/musl environment
RUN npm rebuild better-sqlite3

# Remove build tools after native compilation to keep image small
RUN apk del python3 make g++

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy public assets if they exist
COPY public/ ./public/

# Create data directory for SQLite and set ownership
RUN mkdir -p /app/data && chown -R node:node /app/data

# Switch to non-root user
USER node

# Expose server port
EXPOSE 4000

# Health check against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start the server
CMD ["node", "dist/server.js"]
