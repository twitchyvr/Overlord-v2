# REST API

## Overview

Overlord v2 exposes a minimal REST API alongside the Socket.IO real-time transport. The REST API is primarily for health checks and static file serving.

## Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 123.456
}
```

### `GET /` (Static Files)
Serves the web UI from the `public/` directory.

```typescript
app.use(express.static('public'));
```

## Future REST Endpoints

The following REST endpoints are planned for Phase 6 (UI):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/buildings` | List buildings |
| `GET` | `/api/buildings/:id` | Get building details |
| `GET` | `/api/buildings/:id/rooms` | List rooms in building |
| `GET` | `/api/buildings/:id/agents` | List agents in building |
| `GET` | `/api/buildings/:id/raid` | Get RAID log |
| `GET` | `/api/buildings/:id/gates` | Get phase gates |

## Middleware

```typescript
app.use(express.json());      // JSON body parsing
app.use(express.static('public'));  // Static file serving
```

## CORS

Configured via the `CORS_ORIGIN` environment variable:

```typescript
const io = new SocketServer(http, {
  cors: { origin: config.get('CORS_ORIGIN') }
});
```

Default: `http://localhost:5173` (Vite dev server)
