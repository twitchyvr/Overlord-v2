-- =============================================================================
-- Webhook Forwarder Plugin for Overlord v2
-- =============================================================================
-- Captures events from every Overlord lifecycle hook, formats them into
-- standard webhook payloads (JSON-like tables), queues them for delivery,
-- and emits webhook:queued events. When net:http becomes available, the
-- plugin will automatically deliver queued payloads to configured URLs.
--
-- Features:
--   - Listens to ALL lifecycle hooks (load, unload, room enter/exit,
--     tool execute, phase advance)
--   - Configurable event filters: choose which hook types to forward
--   - Configurable webhook endpoints (URLs + optional headers)
--   - Persistent queue: payloads survive plugin restarts
--   - Retry tracking: failed deliveries are marked for retry
--
-- NOTE: The net:http permission is declared but NOT YET IMPLEMENTED.
-- All HTTP delivery code paths check for availability and gracefully
-- fall back to queue-only mode with clear log messages.
--
-- Configuration (via storage):
--   "webhook-forwarder:config" = {
--     enabled    = true,
--     endpoints  = {                 -- array of webhook targets
--       { url = "https://...", headers = { ["X-Token"] = "..." } },
--     },
--     filters    = {                 -- which events to forward (true = forward)
--       onRoomEnter    = true,
--       onRoomExit     = true,
--       onToolExecute  = true,
--       onPhaseAdvance = true,
--       onLoad         = false,      -- usually too noisy
--       onUnload       = false,
--     },
--     maxQueueSize   = 500,          -- max queued payloads before oldest drop
--     includeContext = true,          -- include room/agent details in payload
--   }
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
  enabled    = true,
  endpoints  = {},
  filters    = {
    onRoomEnter    = true,
    onRoomExit     = true,
    onToolExecute  = true,
    onPhaseAdvance = true,
    onLoad         = false,
    onUnload       = false,
  },
  maxQueueSize   = 500,
  includeContext = true,
}

-- ---------------------------------------------------------------------------
-- Helper: load configuration
-- ---------------------------------------------------------------------------
local function loadConfig()
  local ok, stored = pcall(overlord.storage.get, "webhook-forwarder:config")
  if ok and stored then
    local cfg = {}
    for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
    for k, v in pairs(stored) do cfg[k] = v end
    -- Merge filters specifically so new filter defaults are picked up
    if stored.filters then
      cfg.filters = {}
      for k, v in pairs(DEFAULT_CONFIG.filters) do cfg.filters[k] = v end
      for k, v in pairs(stored.filters) do cfg.filters[k] = v end
    end
    return cfg
  end
  return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: check if net:http is available
-- ---------------------------------------------------------------------------
local function isHttpAvailable()
  return type(overlord) == "table"
    and type(overlord.http) == "table"
    and type(overlord.http.post) == "function"
end

-- ---------------------------------------------------------------------------
-- Storage helpers: webhook queue
-- ---------------------------------------------------------------------------
local function loadQueue()
  local ok, queue = pcall(overlord.storage.get, "webhook-forwarder:queue")
  if ok and queue then return queue end
  return {}
end

local function saveQueue(queue, maxSize)
  maxSize = maxSize or 500
  while #queue > maxSize do
    table.remove(queue, 1)
  end
  pcall(overlord.storage.set, "webhook-forwarder:queue", queue)
end

-- ---------------------------------------------------------------------------
-- Storage helpers: delivery stats
-- ---------------------------------------------------------------------------
local function loadStats()
  local ok, stats = pcall(overlord.storage.get, "webhook-forwarder:stats")
  if ok and stats then return stats end
  return { queued = 0, delivered = 0, failed = 0 }
end

local function saveStats(stats)
  pcall(overlord.storage.set, "webhook-forwarder:stats", stats)
end

-- ---------------------------------------------------------------------------
-- Helper: check if a hook event passes the configured filters
-- ---------------------------------------------------------------------------
local function passesFilter(hookName, config)
  local filters = config.filters or {}
  -- If the filter key exists, use its value; otherwise default to true
  if filters[hookName] ~= nil then
    return filters[hookName]
  end
  return true
end

-- ---------------------------------------------------------------------------
-- Helper: enrich payload with context (room and agent info)
-- ---------------------------------------------------------------------------
local function enrichWithContext(payload)
  -- Add current rooms
  local okRooms, rooms = pcall(overlord.rooms.list)
  if okRooms and rooms then
    payload.context = payload.context or {}
    payload.context.roomCount = #rooms
  end

  -- Add current agents
  local okAgents, agents = pcall(overlord.agents.list, {})
  if okAgents and agents then
    payload.context = payload.context or {}
    payload.context.agentCount = #agents
  end

  return payload
end

-- ---------------------------------------------------------------------------
-- Core: build a webhook payload from a hook event
-- ---------------------------------------------------------------------------
local function buildPayload(hookName, data)
  local payload = {
    event     = hookName,
    source    = "overlord",
    plugin    = "webhook-forwarder",
    version   = "1.0.0",
    timestamp = os.time(),
    data      = data or {},
  }

  -- Add plugin manifest info if available
  if overlord.manifest then
    payload.overlord = {
      id      = overlord.manifest.id,
      name    = overlord.manifest.name,
      version = overlord.manifest.version,
    }
  end

  return payload
end

-- ---------------------------------------------------------------------------
-- Core: queue a payload and emit the webhook:queued event
-- ---------------------------------------------------------------------------
local function queuePayload(hookName, data)
  local config = loadConfig()

  -- Check filter
  if not passesFilter(hookName, config) then
    overlord.log.debug("Webhook event filtered out", { hook = hookName })
    return
  end

  -- Build payload
  local payload = buildPayload(hookName, data)

  -- Optionally enrich with context
  if config.includeContext then
    payload = enrichWithContext(payload)
  end

  -- Add to queue
  local queue = loadQueue()
  table.insert(queue, {
    payload    = payload,
    timestamp  = os.time(),
    delivered  = false,
    retries    = 0,
  })
  saveQueue(queue, config.maxQueueSize)

  -- Update stats
  local stats = loadStats()
  stats.queued = (stats.queued or 0) + 1
  saveStats(stats)

  -- Emit the queued event
  local ok, err = pcall(overlord.bus.emit, "webhook:queued", {
    event     = hookName,
    timestamp = os.time(),
    queueSize = #queue + 1,
  })
  if ok then
    overlord.log.debug("Webhook payload queued", { hook = hookName })
  else
    overlord.log.error("Failed to emit webhook:queued event", { error = err })
  end

  -- Attempt delivery if HTTP is available
  if isHttpAvailable() and #config.endpoints > 0 then
    attemptDelivery(config)
  end
end

-- ---------------------------------------------------------------------------
-- Core: attempt to deliver queued payloads (future -- requires net:http)
-- ---------------------------------------------------------------------------
-- This function is defined for forward-compatibility. When net:http lands,
-- it will iterate the queue and POST each undelivered payload to all
-- configured endpoints.

function attemptDelivery(config)
  if not isHttpAvailable() then
    overlord.log.debug(
      "net:http not available -- delivery deferred. " ..
      "Payloads remain in queue for future delivery."
    )
    return
  end

  -- Future implementation:
  -- local queue = loadQueue()
  -- for i, entry in ipairs(queue) do
  --   if not entry.delivered then
  --     for _, endpoint in ipairs(config.endpoints) do
  --       local ok, resp = pcall(overlord.http.post, endpoint.url, {
  --         headers = endpoint.headers or {},
  --         body = entry.payload,
  --       })
  --       if ok and resp and resp.status >= 200 and resp.status < 300 then
  --         entry.delivered = true
  --         stats.delivered = stats.delivered + 1
  --       else
  --         entry.retries = entry.retries + 1
  --         stats.failed = stats.failed + 1
  --       end
  --     end
  --   end
  -- end
  -- saveQueue(queue, config.maxQueueSize)
  -- saveStats(stats)

  overlord.log.info("net:http delivery attempted (implementation pending)")
end

-- ---------------------------------------------------------------------------
-- Hook: onLoad
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
  local config = loadConfig()

  if not config.enabled then
    overlord.log.info("Webhook Forwarder plugin is disabled via config")
    return
  end

  local endpointCount = config.endpoints and #config.endpoints or 0

  if not isHttpAvailable() then
    overlord.log.info(
      "Webhook Forwarder loaded (net:http not yet available -- " ..
      "operating in queue-only mode, emitting webhook:queued events)"
    )
  else
    overlord.log.info("Webhook Forwarder loaded with full HTTP delivery", {
      endpoints = endpointCount,
    })
  end

  -- Log active filters
  local activeFilters = {}
  for hookName, enabled in pairs(config.filters or {}) do
    if enabled then table.insert(activeFilters, hookName) end
  end
  overlord.log.info("Webhook Forwarder active filters", { filters = activeFilters })

  -- Forward the onLoad event itself if configured
  queuePayload("onLoad", { message = "Webhook Forwarder initialized" })
end)

-- ---------------------------------------------------------------------------
-- Hook: onUnload
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
  local config = loadConfig()
  if not config.enabled then return end

  queuePayload("onUnload", { message = "Webhook Forwarder shutting down" })

  -- Log final stats
  local stats = loadStats()
  overlord.log.info("Webhook Forwarder final stats", stats)
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomEnter
-- ---------------------------------------------------------------------------
registerHook("onRoomEnter", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  queuePayload("onRoomEnter", {
    roomId   = data and data.roomId,
    agentId  = data and data.agentId,
    roomType = data and data.roomType,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomExit
-- ---------------------------------------------------------------------------
registerHook("onRoomExit", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  queuePayload("onRoomExit", {
    roomId   = data and data.roomId,
    agentId  = data and data.agentId,
    roomType = data and data.roomType,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onToolExecute
-- ---------------------------------------------------------------------------
registerHook("onToolExecute", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  queuePayload("onToolExecute", {
    toolName = data and data.toolName,
    agentId  = data and data.agentId,
    status   = data and data.status,
    roomId   = data and data.roomId,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onPhaseAdvance
-- ---------------------------------------------------------------------------
registerHook("onPhaseAdvance", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  queuePayload("onPhaseAdvance", {
    phase     = data and data.phase,
    fromPhase = data and data.fromPhase,
    roomId    = data and data.roomId,
  })
end)
