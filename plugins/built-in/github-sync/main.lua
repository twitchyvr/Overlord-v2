-- =============================================================================
-- GitHub Sync Plugin for Overlord v2
-- =============================================================================
-- Prepares sync payloads from Overlord's internal state (rooms, agents, phase
-- transitions, tool results) and emits github:sync-ready events. When the
-- net:http permission becomes available, this plugin will be extended to push
-- payloads directly to the GitHub API.
--
-- Current capabilities (without net:http):
--   - Collects state snapshots on phase advances and room exits
--   - Builds structured payloads suitable for GitHub Issues/Milestones
--   - Stores sync queue for deduplication (same state is not queued twice)
--   - Emits github:sync-ready events for external consumers
--
-- Future capabilities (with net:http):
--   - POST payloads to GitHub API (create/update issues, milestones)
--   - Sync agent assignments to GitHub issue assignees
--   - Map Overlord phases to GitHub milestone progress
--
-- NOTE: The net:http permission is declared in plugin.json but is NOT YET
-- IMPLEMENTED in the Overlord runtime. This plugin gracefully handles its
-- absence -- all HTTP-dependent code paths check for availability first and
-- log an informational message when the API is unavailable.
--
-- Configuration (via storage):
--   "github-sync:config" = {
--     enabled      = true,
--     repoOwner    = "",            -- GitHub owner (org or user)
--     repoName     = "",            -- GitHub repository name
--     syncOnPhase  = true,          -- Auto-sync on phase advance
--     syncOnExit   = true,          -- Auto-sync on room exit
--     labelPrefix  = "overlord:",   -- Prefix for auto-created labels
--   }
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
  enabled      = true,
  repoOwner    = "",
  repoName     = "",
  syncOnPhase  = true,
  syncOnExit   = true,
  labelPrefix  = "overlord:",
}

-- ---------------------------------------------------------------------------
-- Helper: load configuration
-- ---------------------------------------------------------------------------
local function loadConfig()
  local ok, stored = pcall(overlord.storage.get, "github-sync:config")
  if ok and stored then
    local cfg = {}
    for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
    for k, v in pairs(stored) do cfg[k] = v end
    return cfg
  end
  return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: check if net:http is available at runtime
-- ---------------------------------------------------------------------------
-- Since net:http is declared but not yet implemented, we check whether the
-- overlord.http table exists. If it does not, HTTP operations are skipped
-- with a clear log message.

local function isHttpAvailable()
  return type(overlord) == "table"
    and type(overlord.http) == "table"
    and type(overlord.http.post) == "function"
end

-- ---------------------------------------------------------------------------
-- Storage helpers: sync queue
-- ---------------------------------------------------------------------------
-- The sync queue holds payloads that are ready to be sent to GitHub.
-- Each entry: { payload = {...}, timestamp = N, synced = false, hash = "..." }

local function loadSyncQueue()
  local ok, queue = pcall(overlord.storage.get, "github-sync:queue")
  if ok and queue then return queue end
  return {}
end

local function saveSyncQueue(queue)
  -- Keep at most 200 entries to prevent unbounded growth
  while #queue > 200 do
    table.remove(queue, 1)
  end
  pcall(overlord.storage.set, "github-sync:queue", queue)
end

-- ---------------------------------------------------------------------------
-- Storage helpers: deduplication hashes
-- ---------------------------------------------------------------------------
-- We store a set of hashes of recently queued payloads so we do not queue
-- the exact same state snapshot twice in a row.

local function loadSyncHashes()
  local ok, hashes = pcall(overlord.storage.get, "github-sync:hashes")
  if ok and hashes then return hashes end
  return {}
end

local function saveSyncHashes(hashes)
  -- Keep the most recent 500 hashes
  while #hashes > 500 do
    table.remove(hashes, 1)
  end
  pcall(overlord.storage.set, "github-sync:hashes", hashes)
end

-- ---------------------------------------------------------------------------
-- Helper: simple string-based hash for deduplication
-- ---------------------------------------------------------------------------
-- This is NOT a cryptographic hash -- just a fast deduplication check.
-- We concatenate key fields and use their string representation.

local function computeHash(payload)
  local parts = {}
  table.insert(parts, tostring(payload.type or ""))
  table.insert(parts, tostring(payload.roomId or ""))
  table.insert(parts, tostring(payload.phase or ""))
  table.insert(parts, tostring(payload.agentCount or 0))
  table.insert(parts, tostring(payload.roomCount or 0))
  return table.concat(parts, "|")
end

local function isDuplicate(hash, hashes)
  for _, h in ipairs(hashes) do
    if h == hash then return true end
  end
  return false
end

-- ---------------------------------------------------------------------------
-- Core: gather current Overlord state into a sync payload
-- ---------------------------------------------------------------------------
local function gatherState(triggerType, extraData)
  local config = loadConfig()

  -- Gather rooms
  local rooms = {}
  local okRooms, roomList = pcall(overlord.rooms.list)
  if okRooms and roomList then
    for _, room in ipairs(roomList) do
      table.insert(rooms, {
        id   = room.id,
        name = room.name,
        type = room.type,
      })
    end
  end

  -- Gather agents
  local agents = {}
  local okAgents, agentList = pcall(overlord.agents.list, {})
  if okAgents and agentList then
    for _, agent in ipairs(agentList) do
      table.insert(agents, {
        id     = agent.id,
        name   = agent.name,
        role   = agent.role,
        status = agent.status,
      })
    end
  end

  local payload = {
    type        = triggerType,
    repoOwner   = config.repoOwner,
    repoName    = config.repoName,
    labelPrefix = config.labelPrefix,
    rooms       = rooms,
    roomCount   = #rooms,
    agents      = agents,
    agentCount  = #agents,
    timestamp   = os.time(),
    extra       = extraData or {},
  }

  return payload
end

-- ---------------------------------------------------------------------------
-- Core: queue a payload and emit the sync-ready event
-- ---------------------------------------------------------------------------
local function queueSync(payload)
  local hash = computeHash(payload)
  local hashes = loadSyncHashes()

  -- Deduplication: skip if we already queued an identical state snapshot
  if isDuplicate(hash, hashes) then
    overlord.log.debug("GitHub sync payload deduplicated -- skipping", { hash = hash })
    return
  end

  -- Add to queue
  local queue = loadSyncQueue()
  table.insert(queue, {
    payload   = payload,
    timestamp = os.time(),
    synced    = false,
    hash      = hash,
  })
  saveSyncQueue(queue)

  -- Record hash
  table.insert(hashes, hash)
  saveSyncHashes(hashes)

  -- Emit the event so external systems or other plugins can pick it up
  local ok, err = pcall(overlord.bus.emit, "github:sync-ready", payload)
  if ok then
    overlord.log.info("GitHub sync payload queued and event emitted", {
      type       = payload.type,
      roomCount  = payload.roomCount,
      agentCount = payload.agentCount,
    })
  else
    overlord.log.error("Failed to emit github:sync-ready event", { error = err })
  end

  -- Attempt HTTP push if available (future functionality)
  if isHttpAvailable() then
    overlord.log.info("net:http is available -- attempting GitHub API sync")
    -- Future: overlord.http.post(url, headers, body)
    -- This code path will be implemented when net:http lands.
  else
    overlord.log.debug(
      "net:http is not yet available -- payload queued for future sync. " ..
      "When net:http is implemented, queued payloads will be pushed automatically."
    )
  end
end

-- ---------------------------------------------------------------------------
-- Hook: onLoad
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
  local config = loadConfig()

  if not config.enabled then
    overlord.log.info("GitHub Sync plugin is disabled via config")
    return
  end

  if not isHttpAvailable() then
    overlord.log.info(
      "GitHub Sync plugin loaded (net:http not yet available -- " ..
      "operating in queue-only mode, emitting github:sync-ready events)"
    )
  else
    overlord.log.info("GitHub Sync plugin loaded with full HTTP capability")
  end

  -- Log config state (without sensitive data)
  overlord.log.info("GitHub Sync config", {
    repoOwner   = config.repoOwner ~= "" and config.repoOwner or "(not set)",
    repoName    = config.repoName ~= "" and config.repoName or "(not set)",
    syncOnPhase = config.syncOnPhase,
    syncOnExit  = config.syncOnExit,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onUnload
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
  overlord.log.info("GitHub Sync plugin unloaded")

  -- Log how many unsynced payloads remain in the queue
  local queue = loadSyncQueue()
  local unsynced = 0
  for _, entry in ipairs(queue) do
    if not entry.synced then unsynced = unsynced + 1 end
  end
  if unsynced > 0 then
    overlord.log.warn("GitHub Sync has unsynced payloads in queue", { count = unsynced })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onPhaseAdvance — sync state when a project phase advances
-- ---------------------------------------------------------------------------
registerHook("onPhaseAdvance", function(data)
  local config = loadConfig()
  if not config.enabled or not config.syncOnPhase then return end

  overlord.log.info("Phase advance detected -- preparing GitHub sync", {
    phase = data and data.phase,
  })

  local payload = gatherState("phase-advance", {
    phase     = data and data.phase,
    fromPhase = data and data.fromPhase,
  })

  local ok, err = pcall(queueSync, payload)
  if not ok then
    overlord.log.error("Failed to queue GitHub sync on phase advance", { error = err })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomExit — sync state when an agent exits a room
-- ---------------------------------------------------------------------------
registerHook("onRoomExit", function(data)
  local config = loadConfig()
  if not config.enabled or not config.syncOnExit then return end

  local payload = gatherState("room-exit", {
    roomId   = data and data.roomId,
    agentId  = data and data.agentId,
    roomType = data and data.roomType,
  })

  local ok, err = pcall(queueSync, payload)
  if not ok then
    overlord.log.error("Failed to queue GitHub sync on room exit", { error = err })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onToolExecute — optionally track significant tool results
-- ---------------------------------------------------------------------------
registerHook("onToolExecute", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  -- Only sync on tool executions that look like milestone or task updates
  local toolName = data and data.toolName
  if not toolName then return end

  local lower = string.lower(toolName)
  local isSignificant = string.find(lower, "milestone", 1, true)
    or string.find(lower, "task", 1, true)
    or string.find(lower, "complete", 1, true)
    or string.find(lower, "close", 1, true)

  if not isSignificant then return end

  local payload = gatherState("tool-execute", {
    toolName = toolName,
    agentId  = data and data.agentId,
    status   = data and data.status,
  })

  local ok, err = pcall(queueSync, payload)
  if not ok then
    overlord.log.error("Failed to queue GitHub sync on tool execute", { error = err })
  end
end)
