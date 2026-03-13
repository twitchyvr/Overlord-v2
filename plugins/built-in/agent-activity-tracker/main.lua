-- =============================================================================
-- Agent Activity Tracker Plugin
-- =============================================================================
-- Tracks every significant agent action — room entries, room exits, and tool
-- executions — maintaining per-agent hourly counters in plugin storage. The
-- plugin periodically emits summary events so dashboards and other plugins
-- can display agent workload and productivity metrics.
--
-- Storage keys used:
--   "activity:<agentId>:<hour>"            — JSON-encoded counter object
--   "activity:last_summary_hour"           — last hour a summary was emitted
--   "config:summary_enabled"               — "true" or "false" (default: "true")
--   "config:retention_hours"               — hours of data to keep (default: 168 = 7 days)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: get current hour as a string key (YYYY-MM-DD-HH format)
-- We use os.date for a human-readable bucket key.
-- ---------------------------------------------------------------------------
local function current_hour_key()
  return os.date("%Y-%m-%d-%H")
end

-- ---------------------------------------------------------------------------
-- Helper: safely read from storage with a default
-- ---------------------------------------------------------------------------
local function safe_get(key, default)
  local ok, val = pcall(overlord.storage.get, key)
  if not ok or val == nil then
    return default
  end
  return val
end

-- ---------------------------------------------------------------------------
-- Helper: safely write to storage
-- ---------------------------------------------------------------------------
local function safe_set(key, value)
  local ok, write_err = pcall(overlord.storage.set, key, value)
  if not ok then
    overlord.log.error("Storage write failed", { key = key, error = tostring(write_err) })
  end
end

-- ---------------------------------------------------------------------------
-- Build the storage key for an agent's hourly activity bucket
-- ---------------------------------------------------------------------------
local function activity_key(agent_id, hour)
  return "activity:" .. agent_id .. ":" .. hour
end

-- ---------------------------------------------------------------------------
-- Read an agent's activity counters for a given hour. Returns a table with
-- numeric fields: room_enters, room_exits, tool_executions.
-- ---------------------------------------------------------------------------
local function get_counters(agent_id, hour)
  local key = activity_key(agent_id, hour)
  local raw = safe_get(key, nil)

  if raw == nil then
    -- No activity recorded yet for this agent+hour
    return { room_enters = 0, room_exits = 0, tool_executions = 0 }
  end

  -- Parse the stored JSON string back into a table
  -- We store as a simple delimited string: "enters:exits:tools"
  local enters, exits, tools = raw:match("^(%d+):(%d+):(%d+)$")
  if enters then
    return {
      room_enters = tonumber(enters),
      room_exits = tonumber(exits),
      tool_executions = tonumber(tools)
    }
  end

  -- If parsing fails, return zeroes and log a warning
  overlord.log.warn("Corrupted activity data, resetting", { key = key, raw = raw })
  return { room_enters = 0, room_exits = 0, tool_executions = 0 }
end

-- ---------------------------------------------------------------------------
-- Write an agent's activity counters for a given hour.
-- We store as "enters:exits:tools" for compact, parseable storage.
-- ---------------------------------------------------------------------------
local function save_counters(agent_id, hour, counters)
  local value = counters.room_enters .. ":" .. counters.room_exits .. ":" .. counters.tool_executions
  safe_set(activity_key(agent_id, hour), value)
end

-- ---------------------------------------------------------------------------
-- Increment a specific counter for the current agent and hour
-- ---------------------------------------------------------------------------
local function increment(agent_id, counter_name)
  local hour = current_hour_key()
  local counters = get_counters(agent_id, hour)

  counters[counter_name] = (counters[counter_name] or 0) + 1
  save_counters(agent_id, hour, counters)

  return counters
end

-- ---------------------------------------------------------------------------
-- Generate and emit a summary of all agent activity for the current hour.
-- This collects data from all known agents and packages it into a single
-- event so dashboards can render it.
-- ---------------------------------------------------------------------------
local function emit_summary()
  local summary_enabled = safe_get("config:summary_enabled", "true")
  if summary_enabled ~= "true" then
    return
  end

  local hour = current_hour_key()

  -- Avoid emitting duplicate summaries for the same hour
  local last_hour = safe_get("activity:last_summary_hour", "")
  if last_hour == hour then
    overlord.log.debug("Summary already emitted for this hour, skipping")
    return
  end

  -- Fetch all agents
  local ok, agents = pcall(overlord.agents.list, {})
  if not ok or agents == nil then
    overlord.log.warn("Could not list agents for summary", { error = tostring(agents) })
    return
  end

  -- Build a summary table with each agent's counters
  local agent_summaries = {}
  local total_enters = 0
  local total_exits = 0
  local total_tools = 0

  for _, agent in ipairs(agents) do
    local counters = get_counters(agent.id, hour)

    -- Only include agents that actually did something
    if counters.room_enters > 0 or counters.room_exits > 0 or counters.tool_executions > 0 then
      agent_summaries[#agent_summaries + 1] = {
        agentId = agent.id,
        agentName = agent.name,
        role = agent.role,
        roomEnters = counters.room_enters,
        roomExits = counters.room_exits,
        toolExecutions = counters.tool_executions
      }

      total_enters = total_enters + counters.room_enters
      total_exits = total_exits + counters.room_exits
      total_tools = total_tools + counters.tool_executions
    end
  end

  -- Emit the summary event
  overlord.bus.emit("plugin:activity-tracker:summary", {
    hour = hour,
    activeAgents = #agent_summaries,
    totalRoomEnters = total_enters,
    totalRoomExits = total_exits,
    totalToolExecutions = total_tools,
    agents = agent_summaries
  })

  -- Record that we emitted a summary for this hour
  safe_set("activity:last_summary_hour", hour)

  overlord.log.info("Activity summary emitted", {
    hour = hour,
    activeAgents = #agent_summaries,
    totalActions = total_enters + total_exits + total_tools
  })
end

-- ===========================================================================
-- Lifecycle Hook: onLoad
-- ===========================================================================
registerHook("onLoad", function()
  overlord.log.info("Agent Activity Tracker loaded", {
    version = overlord.manifest.version
  })

  -- Set default configuration if not already configured
  if safe_get("config:summary_enabled", nil) == nil then
    safe_set("config:summary_enabled", "true")
  end
  if safe_get("config:retention_hours", nil) == nil then
    safe_set("config:retention_hours", "168")
  end

  overlord.log.debug("Activity Tracker configuration initialized")
end)

-- ===========================================================================
-- Lifecycle Hook: onUnload
-- ===========================================================================
registerHook("onUnload", function()
  -- Emit a final summary before shutting down
  local ok, summary_err = pcall(emit_summary)
  if not ok then
    overlord.log.warn("Failed to emit final summary on unload", { error = tostring(summary_err) })
  end

  overlord.log.info("Agent Activity Tracker unloaded — historical data preserved in storage")
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomEnter
-- ===========================================================================
-- Increment the room-enter counter for the agent entering the room.
-- After incrementing, attempt to emit a summary (will only fire once per hour).
--
-- Parameters:
--   data.roomId   — ID of the room
--   data.agentId  — ID of the entering agent
-- ===========================================================================
registerHook("onRoomEnter", function(data)
  if not data or not data.agentId then
    overlord.log.warn("onRoomEnter missing agentId", { data = data })
    return
  end

  local counters = increment(data.agentId, "room_enters")

  overlord.log.debug("Room enter tracked", {
    agent = data.agentId,
    room = data.roomId,
    totalEntersThisHour = counters.room_enters
  })

  -- Emit a per-action event for real-time dashboards
  overlord.bus.emit("plugin:activity-tracker:action", {
    type = "room_enter",
    agentId = data.agentId,
    roomId = data.roomId,
    hour = current_hour_key()
  })

  -- Try to emit an hourly summary
  pcall(emit_summary)
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomExit
-- ===========================================================================
-- Increment the room-exit counter for the agent leaving the room.
--
-- Parameters:
--   data.roomId   — ID of the room
--   data.agentId  — ID of the exiting agent
-- ===========================================================================
registerHook("onRoomExit", function(data)
  if not data or not data.agentId then
    overlord.log.warn("onRoomExit missing agentId", { data = data })
    return
  end

  local counters = increment(data.agentId, "room_exits")

  overlord.log.debug("Room exit tracked", {
    agent = data.agentId,
    room = data.roomId,
    totalExitsThisHour = counters.room_exits
  })

  overlord.bus.emit("plugin:activity-tracker:action", {
    type = "room_exit",
    agentId = data.agentId,
    roomId = data.roomId,
    hour = current_hour_key()
  })

  pcall(emit_summary)
end)

-- ===========================================================================
-- Lifecycle Hook: onToolExecute
-- ===========================================================================
-- Increment the tool-execution counter each time any agent uses a tool.
--
-- Parameters:
--   data.agentId  — ID of the agent using the tool
--   data.toolName — name of the tool being executed
--   data.roomId   — ID of the room where execution happens (optional)
-- ===========================================================================
registerHook("onToolExecute", function(data)
  if not data or not data.agentId then
    overlord.log.warn("onToolExecute missing agentId", { data = data })
    return
  end

  local counters = increment(data.agentId, "tool_executions")

  overlord.log.debug("Tool execution tracked", {
    agent = data.agentId,
    tool = data.toolName,
    totalToolsThisHour = counters.tool_executions
  })

  overlord.bus.emit("plugin:activity-tracker:action", {
    type = "tool_execute",
    agentId = data.agentId,
    toolName = data.toolName,
    roomId = data.roomId,
    hour = current_hour_key()
  })

  pcall(emit_summary)
end)
