# REST API — Complete Reference

Overlord v2 uses Socket.IO for real-time communication but exposes a minimal
REST API for health checks, status, and static file serving.

**Source:** `src/server.ts`

---

## Endpoints

### `GET /health`

Server health check endpoint. Returns uptime and version.

**Request:**
```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 1234.567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` if server is running |
| `version` | `string` | Server version from `package.json` |
| `uptime` | `number` | Server uptime in seconds |

---

### `GET /api/status`

System status check. Reports whether this is a new user (no buildings) and lists
existing buildings.

**Request:**
```
GET /api/status
```

**Response:**
```json
{
  "isNewUser": false,
  "buildings": [
    {
      "id": "bld_abc123",
      "name": "My Project",
      "activePhase": "architecture"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `isNewUser` | `boolean` | `true` if no buildings exist |
| `buildings` | `array` | List of buildings with id, name, and active phase |

---

### `GET /` (Static Files)

Serves the web UI from the `public/` directory.

```typescript
app.use(express.static('public'));
```

The UI is a vanilla ES-module SPA served from `public/index.html`.

---

## Middleware

| Middleware | Purpose |
|------------|---------|
| `express.json()` | Parse JSON request bodies |
| `express.static('public')` | Serve frontend static files |

---

## CORS

CORS is configured at the Socket.IO level via the `CORS_ORIGIN` environment variable:

```typescript
const io = new SocketServer(httpServer, {
  cors: { origin: config.get('CORS_ORIGIN') }
});
```

Default: `http://localhost:4000`

---

## Why Minimal REST?

Overlord v2 is designed as a real-time system. All domain operations (building management,
room lifecycle, agent coordination, phase advancement, RAID log, tasks) use Socket.IO
events with acknowledgment callbacks. This provides:

- Bidirectional communication (server pushes events to clients)
- Request/response with callbacks (similar to REST but over WebSocket)
- Streaming support (chat:stream events for LLM token streaming)

The REST endpoints exist for infrastructure needs (health checks, load balancer probes)
and the initial page load (static files, new-user detection).
