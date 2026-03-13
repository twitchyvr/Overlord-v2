-- =============================================================================
-- Escalation Notifier Plugin for Overlord v2
-- =============================================================================
-- Monitors the system for escalation patterns and emits escalation:detected
-- events with severity levels so that other plugins or UI components can
-- react -- for example by sending notifications, highlighting alerts, or
-- triggering automated responses.
--
-- Detected patterns:
--   1. Agent enters a war-room        -> severity: high
--   2. Tool execution fails/errors    -> severity: medium or high
--   3. Blocked tool detected          -> severity: medium
--   4. Rapid room transitions         -> severity: low (possible confusion)
--   5. Multiple errors in short window -> severity: critical (cascade)
--
-- Configuration (via storage):
--   "escalation-notifier:config" = {
--     enabled                = true,
--     warRoomTypes           = { "war-room" },
--     errorThresholdCritical = 5,      -- errors within window = critical
--     errorWindowSeconds     = 300,    -- 5-minute sliding window
--     roomHopThreshold       = 5,      -- room changes within window = flag
--     roomHopWindowSeconds   = 120,    -- 2-minute sliding window
--   }
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Severity constants (used in emitted events)
-- ---------------------------------------------------------------------------
local SEVERITY = {
  LOW      = "low",
  MEDIUM   = "medium",
  HIGH     = "high",
  CRITICAL = "critical",
}

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
local DEFAULT_CONFIG = {
  enabled                = true,
  warRoomTypes           = { "war-room" },
  errorThresholdCritical = 5,
  errorWindowSeconds     = 300,
  roomHopThreshold       = 5,
  roomHopWindowSeconds   = 120,
}

-- ---------------------------------------------------------------------------
-- Helper: load configuration from storage, merging with defaults
-- ---------------------------------------------------------------------------
local function loadConfig()
  local ok, stored = pcall(overlord.storage.get, "escalation-notifier:config")
  if ok and stored then
    local cfg = {}
    for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
    for k, v in pairs(stored) do cfg[k] = v end
    return cfg
  end
  return DEFAULT_CONFIG
end

-- ---------------------------------------------------------------------------
-- Helper: load and save the recent-errors list (sliding window)
-- ---------------------------------------------------------------------------
local function loadRecentErrors()
  local ok, errors = pcall(overlord.storage.get, "escalation-notifier:recent-errors")
  if ok and errors then return errors end
  return {}
end

local function saveRecentErrors(errors)
  pcall(overlord.storage.set, "escalation-notifier:recent-errors", errors)
end

-- ---------------------------------------------------------------------------
-- Helper: load and save the recent room-transition list (sliding window)
-- ---------------------------------------------------------------------------
local function loadRecentTransitions()
  local ok, transitions = pcall(overlord.storage.get, "escalation-notifier:recent-transitions")
  if ok and transitions then return transitions end
  return {}
end

local function saveRecentTransitions(transitions)
  pcall(overlord.storage.set, "escalation-notifier:recent-transitions", transitions)
end

-- ---------------------------------------------------------------------------
-- Helper: load and save the escalation history log
-- ---------------------------------------------------------------------------
local function loadHistory()
  local ok, history = pcall(overlord.storage.get, "escalation-notifier:history")
  if ok and history then return history end
  return {}
end

local function saveHistory(history)
  -- Keep the most recent 100 escalations
  while #history > 100 do
    table.remove(history, 1)
  end
  pcall(overlord.storage.set, "escalation-notifier:history", history)
end

-- ---------------------------------------------------------------------------
-- Helper: prune a timestamped list to only entries within a time window
-- ---------------------------------------------------------------------------
local function pruneWindow(list, windowSeconds)
  local cutoff = os.time() - windowSeconds
  local pruned = {}
  for _, entry in ipairs(list) do
    if entry.time and entry.time >= cutoff then
      table.insert(pruned, entry)
    end
  end
  return pruned
end

-- ---------------------------------------------------------------------------
-- Helper: check if a room type is a war-room type
-- ---------------------------------------------------------------------------
local function isWarRoom(roomType, warRoomTypes)
  if not roomType then return false end
  local lower = string.lower(roomType)
  for _, pattern in ipairs(warRoomTypes) do
    if string.find(lower, string.lower(pattern), 1, true) then
      return true
    end
  end
  return false
end

-- ---------------------------------------------------------------------------
-- Core: emit an escalation event and record it in history
-- ---------------------------------------------------------------------------
local function emitEscalation(severity, reason, context)
  local escalation = {
    severity  = severity,
    reason    = reason,
    context   = context or {},
    timestamp = os.time(),
  }

  local ok, err = pcall(overlord.bus.emit, "escalation:detected", escalation)
  if ok then
    overlord.log.warn("Escalation detected", {
      severity = severity,
      reason   = reason,
    })
  else
    overlord.log.error("Failed to emit escalation:detected event", { error = err })
  end

  -- Archive
  local history = loadHistory()
  table.insert(history, escalation)
  saveHistory(history)
end

-- ---------------------------------------------------------------------------
-- Hook: onLoad
-- ---------------------------------------------------------------------------
registerHook("onLoad", function()
  local config = loadConfig()

  if not config.enabled then
    overlord.log.info("Escalation Notifier plugin is disabled via config")
    return
  end

  -- Initialize storage keys if they do not exist
  local ok1, _ = pcall(overlord.storage.get, "escalation-notifier:recent-errors")
  if not ok1 then saveRecentErrors({}) end

  local ok2, _ = pcall(overlord.storage.get, "escalation-notifier:recent-transitions")
  if not ok2 then saveRecentTransitions({}) end

  overlord.log.info("Escalation Notifier plugin loaded", {
    errorThreshold = config.errorThresholdCritical,
    errorWindow    = config.errorWindowSeconds,
  })
end)

-- ---------------------------------------------------------------------------
-- Hook: onUnload
-- ---------------------------------------------------------------------------
registerHook("onUnload", function()
  overlord.log.info("Escalation Notifier plugin unloaded")
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomEnter — detect war-room entry and rapid room-hopping
-- ---------------------------------------------------------------------------
registerHook("onRoomEnter", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  local roomId   = data and data.roomId
  local agentId  = data and data.agentId
  local roomType = data and data.roomType

  -- Pattern 1: War-room entry
  if isWarRoom(roomType, config.warRoomTypes) then
    emitEscalation(SEVERITY.HIGH, "Agent entered war-room", {
      agentId  = agentId,
      roomId   = roomId,
      roomType = roomType,
    })
  end

  -- Pattern 4: Rapid room transitions (agent hopping between rooms quickly)
  if agentId then
    local transitions = loadRecentTransitions()
    table.insert(transitions, { time = os.time(), agentId = agentId, roomId = roomId })
    transitions = pruneWindow(transitions, config.roomHopWindowSeconds)
    saveRecentTransitions(transitions)

    -- Count transitions for this specific agent within the window
    local agentHops = 0
    for _, t in ipairs(transitions) do
      if t.agentId == agentId then
        agentHops = agentHops + 1
      end
    end

    if agentHops >= config.roomHopThreshold then
      emitEscalation(SEVERITY.LOW, "Rapid room transitions detected", {
        agentId     = agentId,
        transitions = agentHops,
        window      = config.roomHopWindowSeconds,
      })
    end
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onToolExecute — detect error states and blocked tools
-- ---------------------------------------------------------------------------
registerHook("onToolExecute", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  local toolName = data and data.toolName
  local agentId  = data and data.agentId
  local status   = data and data.status
  local result   = data and data.result

  -- Pattern 3: Blocked tool
  if status == "blocked" or status == "denied" then
    emitEscalation(SEVERITY.MEDIUM, "Blocked tool execution detected", {
      toolName = toolName,
      agentId  = agentId,
      status   = status,
    })
    return
  end

  -- Pattern 2: Tool execution error
  if status == "error" or status == "failed" then
    emitEscalation(SEVERITY.MEDIUM, "Tool execution failed", {
      toolName = toolName,
      agentId  = agentId,
      status   = status,
      result   = result,
    })

    -- Pattern 5: Error cascade detection (multiple errors in short window)
    local recentErrors = loadRecentErrors()
    table.insert(recentErrors, { time = os.time(), toolName = toolName, agentId = agentId })
    recentErrors = pruneWindow(recentErrors, config.errorWindowSeconds)
    saveRecentErrors(recentErrors)

    if #recentErrors >= config.errorThresholdCritical then
      emitEscalation(SEVERITY.CRITICAL, "Error cascade detected", {
        errorCount = #recentErrors,
        window     = config.errorWindowSeconds,
        recentTools = recentErrors,
      })
    end
  end
end)

-- ---------------------------------------------------------------------------
-- Hook: onRoomExit — track exits for context (no escalation by default)
-- ---------------------------------------------------------------------------
registerHook("onRoomExit", function(data)
  local config = loadConfig()
  if not config.enabled then return end

  overlord.log.debug("Agent exited room", {
    agentId = data and data.agentId,
    roomId  = data and data.roomId,
  })
end)
