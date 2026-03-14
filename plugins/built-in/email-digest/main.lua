-- =============================================================================
-- Email Digest Plugin for Overlord v2
-- =============================================================================
-- Compiles a daily digest of agent-to-agent communications by tracking tool
-- executions related to email and messaging. Stores per-agent message counts
-- and emits a digest:ready event with a formatted summary.
--
-- Configuration (via storage):
--   "email-digest:config" = {
--     digestIntervalHours = 24,       -- How often to compile a digest (hours)
--     trackPatterns       = {...},     -- Tool name patterns to track
--     enabled             = true       -- Master on/off switch
--   }
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
-- Users can override these defaults by writing a config table to storage
-- under the key "email-digest:config" before the plugin loads.

local DEFAULT_CONFIG = {
  digestIntervalHours = 24,
  trackPatterns = { "email", "message", "notify", "send", "chat", "communicate" },
  enabled = true,
}

-- ---------------------------------------------------------------------------
-- Helper: load configuration from storage, falling back to defaults
-- ---------------------------------------------------------------------------
local function loadConfig()
  local ok, stored = pcall(overlord.storage.get, "email-digest:config")
  if ok and stored then
    -- Merge stored values over defaults so new defaults are picked up
    local cfg = {}
    for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
    for k, v in pairs(stored) do cfg[k] = v end
    return cfg
  end
  return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: check if a tool name matches any of the tracking patterns
-- ---------------------------------------------------------------------------
-- We do a simple substring match — if the tool name contains any of the
-- configured patterns, we consider it a communication-related execution.

local function matchesPattern(toolName, patterns)
  if not toolName then return false end
  local lower = string.lower(toolName)
  for _, pattern in ipairs(patterns) do
    if string.find(lower, string.lower(pattern), 1, true) then
      return true
    end
  end
  return false
end

-- ---------------------------------------------------------------------------
-- Helper: get or initialize the running message counts table
-- ---------------------------------------------------------------------------
-- Structure stored under "email-digest:counts":
--   { ["agent-id"] = { sent = N, received = N, tools = { ["tool-name"] = N } } }

local function loadCounts()
  local ok, counts = pcall(overlord.storage.get, "email-digest:counts")
  if ok and counts then return counts end
  return {}
end

local function saveCounts(counts)
  local ok, err = pcall(overlord.storage.set, "email-digest:counts", counts)
  if not ok then
    overlord.log.error("Failed to save message counts", { error = err })
  end
end

-- ---------------------------------------------------------------------------
-- Helper: get or initialize the digest history
-- ---------------------------------------------------------------------------
-- We store the last N digests so users can review past summaries.

local function loadHistory()
  local ok, history = pcall(overlord.storage.get, "email-digest:history")
  if ok and history then return history end
  return {}
end

local function saveHistory(history)
  -- Keep the most recent 30 digests to avoid unbounded growth
  while #history > 30 do
    table.remove(history, 1)
  end
  local ok, err = pcall(overlord.storage.set, "email-digest:history", history)
  if not ok then
    overlord.log.error("Failed to save digest history", { error = err })
  end
end

-- ---------------------------------------------------------------------------
-- Helper: format the digest as a human-readable summary string
-- ---------------------------------------------------------------------------
local function formatDigest(counts, config)
  local lines = {}
  table.insert(lines, "=== Email Digest Summary ===")
  table.insert(lines, "")

  -- Count totals
  local totalSent = 0
  local totalReceived = 0
  local agentCount = 0

  for agentId, data in pairs(counts) do
    agentCount = agentCount + 1
    totalSent = totalSent + (data.sent or 0)
    totalReceived = totalReceived + (data.received or 0)
  end

  table.insert(lines, string.format("Agents active: %d", agentCount))
  table.insert(lines, string.format("Total messages sent: %d", totalSent))
  table.insert(lines, string.format("Total messages received: %d", totalReceived))
  table.insert(lines, "")

  -- Per-agent breakdown
  table.insert(lines, "--- Per-Agent Breakdown ---")
  for agentId, data in pairs(counts) do
    table.insert(lines, string.format(
      "  %s  |  sent: %d  |  received: %d",
      agentId, data.sent or 0, data.received or 0
    ))
    -- List the tools this agent triggered
    if data.tools then
      for toolName, execCount in pairs(data.tools) do
        table.insert(lines, string.format(
          "    -> %s (%d executions)", toolName, execCount
        ))
      end
    end
  end

  table.insert(lines, "")
  table.insert(lines, string.format(
    "Digest interval: every %d hour(s)", config.digestIntervalHours
  ))
  table.insert(lines, "=== End Digest ===")

  return table.concat(lines, "\n")
end

-- ---------------------------------------------------------------------------
-- Core: compile and emit the digest
-- ---------------------------------------------------------------------------
local function compileDigest()
  local config = loadConfig()
  local counts = loadCounts()

  local summary = formatDigest(counts, config)

  -- Emit the digest:ready event so other plugins or the UI can consume it
  local ok, err = pcall(overlord.bus.emit, "digest:ready", {
    summary = summary,
    counts = counts,
    timestamp = os.time(),
  })

  if ok then
    overlord.log.info("Email digest compiled and emitted", {
      agentCount = 0, -- will be filled below
      timestamp = os.time(),
    })
  else
    overlord.log.error("Failed to emit digest:ready event", { error = err })
  end

  -- Archive this digest
  local history = loadHistory()
  table.insert(history, {
    summary = summary,
    counts = counts,
    timestamp = os.time(),
  })
  saveHistory(history)

  -- Reset counts for the next interval
  saveCounts({})
end

-- ---------------------------------------------------------------------------
-- Hook: onLoad — initialize storage and log startup
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
  local config = loadConfig()

  if not config.enabled then
    overlord.log.info("Email Digest plugin is disabled via config")
    return
  end

  -- Ensure storage keys exist
  local ok, counts = pcall(overlord.storage.get, "email-digest:counts")
  if not ok or not counts then
    saveCounts({})
  end

  overlord.log.info("Email Digest plugin loaded", {
    interval = config.digestIntervalHours,
    patterns = config.trackPatterns,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onUnload — compile a final digest before shutting down
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
  overlord.log.info("Email Digest plugin unloading — compiling final digest")
  local okCompile, errCompile = pcall(compileDigest)
  if not okCompile then
    overlord.log.error("Failed to compile final digest on unload", { error = errCompile })
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onToolExecute — track communication-related tool executions
-- ---------------------------------------------------------------------------
-- Every time a tool is executed, we check whether its name matches one of
-- our tracking patterns. If so, we increment the executing agent's counters.

registerHook("onToolExecute", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  -- data is expected to contain: toolName, agentId, roomId, result, etc.
  local toolName = data and data.toolName
  local agentId = data and data.agentId

  if not toolName or not agentId then
    overlord.log.debug("onToolExecute missing toolName or agentId", { data = data })
    return
  end

  -- Only track tools that match our communication patterns
  if not matchesPattern(toolName, config.trackPatterns) then
    return
  end

  overlord.log.debug("Tracking communication tool execution", {
    tool = toolName,
    agent = agentId,
  })

  local counts = loadCounts()

  -- Initialize agent entry if needed
  if not counts[agentId] then
    counts[agentId] = { sent = 0, received = 0, tools = {} }
  end

  -- Increment sent count (the executing agent is the "sender")
  counts[agentId].sent = (counts[agentId].sent or 0) + 1

  -- Track which tools this agent used
  if not counts[agentId].tools then
    counts[agentId].tools = {}
  end
  counts[agentId].tools[toolName] = (counts[agentId].tools[toolName] or 0) + 1

  -- If the tool data includes a target/recipient agent, increment their received
  if data.targetAgentId then
    if not counts[data.targetAgentId] then
      counts[data.targetAgentId] = { sent = 0, received = 0, tools = {} }
    end
    counts[data.targetAgentId].received = (counts[data.targetAgentId].received or 0) + 1
  end

  saveCounts(counts)
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomEnter — check if it is time to compile a digest
-- ---------------------------------------------------------------------------
-- We use room-enter events as a lightweight trigger to check whether the
-- digest interval has elapsed. This avoids needing a background timer.

registerHook("onRoomEnter", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  local ok, lastDigest = pcall(overlord.storage.get, "email-digest:last-digest-time")
  local lastTime = (ok and lastDigest) or 0
  local now = os.time()
  local intervalSeconds = (config.digestIntervalHours or 24) * 3600

  if (now - lastTime) >= intervalSeconds then
    overlord.log.info("Digest interval elapsed — compiling digest")
    local okCompile, errCompile = pcall(compileDigest)
    if okCompile then
      pcall(overlord.storage.set, "email-digest:last-digest-time", now)
    else
      overlord.log.error("Failed to compile scheduled digest", { error = errCompile })
    end
  end
end)
