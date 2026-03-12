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

### `GET /api/status`
System status check. Reports whether this is a new user and lists existing buildings.

**Response:**
```json
{
  "isNewUser": false,
  "buildings": [
    { "id": "bld_abc123", "name": "My Project", "activePhase": "architecture" }
  ]
}
```

### `GET /` (Static Files)
Serves the web UI from the `public/` directory.

```typescript
app.use(express.static('public'));
```

**Note:** Most domain operations use Socket.IO events, not REST. See [Socket Events](Socket-Events.md) for the full real-time API.

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

Default: `http://localhost:4000`

**Full reference:** [`docs/api/rest-api.md`](../api/rest-api.md)
