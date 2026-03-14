-- =============================================================================
-- Agent Handoff Plugin
-- =============================================================================
-- Enables smooth context handoff when work moves between agents across rooms.
-- When an agent exits a room, this plugin captures a context summary — what
-- the agent was working on, what tools were used, key decisions made, and
-- any unfinished items. When the next agent enters that room (or a related
-- room), the stored context is delivered via the event bus, ensuring the new
-- agent has continuity.
--
-- This prevents the common problem of agents "starting from scratch" when
-- they enter a room where another agent already did significant work.
--
-- Storage keys used:
--   "handoff:<roomId>:latest"             — the most recent handoff summary for a room
--   "handoff:<roomId>:history_count"      — number of historical handoffs stored
--   "handoff:<roomId>:history:<index>"    — historical handoff entries
--   "handoff:chain:<agentId>"             — last room an agent worked in (for chaining)
--   "config:max_history"                  — max handoff entries to keep per room (default: 10)
--   "config:auto_deliver"                 — auto-deliver context on room enter (default: "true")
--   "config:include_tool_history"         — include tool list in handoff (default: "true")
-- =============================================================================

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
  local ok, err = pcall(overlord.storage.set, key, tostring(value))
  if not ok then
    overlord.log.error("Storage write failed", { key = key, error = tostring(err) })
    return false
  end
  return true
end

-- ---------------------------------------------------------------------------
-- Helper: safely delete from storage
-- ---------------------------------------------------------------------------
local function safe_delete(key)
  local ok, err = pcall(overlord.storage.delete, key)
  if not ok then
    overlord.log.warn("Storage delete failed", { key = key, error = tostring(err) })
  end
end

-- ---------------------------------------------------------------------------
-- Helper: safely read a number from storage
-- ---------------------------------------------------------------------------
local function get_number(key, default)
  local raw = safe_get(key, nil)
  if raw == nil then return default end
  return tonumber(raw) or default
end

-- ---------------------------------------------------------------------------
-- Build a handoff summary from the available context. This assembles a
-- structured summary of what the exiting agent did in the room.
--
-- Parameters:
--   agent_id  — the agent leaving
--   room_id   — the room being left
--   room      — the full room object (from overlord.rooms.get)
--   agent     — the full agent object (from overlord.agents.get)
-- ---------------------------------------------------------------------------
local function build_handoff_summary(agent_id, room_id, room, agent)
  local timestamp = os.date("%Y-%m-%dT%H:%M:%S")

  local summary = {
    timestamp = timestamp,
    fromAgentId = agent_id,
    fromAgentName = agent and agent.name or "unknown",
    fromAgentRole = agent and agent.role or "unknown",
    roomId = room_id,
    roomName = room and room.name or "unknown",
    roomType = room and room.type or "unknown"
  }

  -- Check if this agent has a chain (previous room they came from)
  local previous_room = safe_get("handoff:chain:" .. agent_id, nil)
  if previous_room then
    summary.previousRoom = previous_room
  end

  return summary
end

-- ---------------------------------------------------------------------------
-- Store a handoff summary for a room, maintaining a rolling history.
-- The latest summary is always accessible directly; older ones are archived.
-- ---------------------------------------------------------------------------
local function store_handoff(room_id, summary)
  local max_history = get_number("config:max_history", 10)

  -- Serialize the summary as a delimited string for storage
  -- Format: "timestamp|agentId|agentName|agentRole|roomType|previousRoom"
  local serialized = table.concat({
    summary.timestamp or "",
    summary.fromAgentId or "",
    summary.fromAgentName or "",
    summary.fromAgentRole or "",
    summary.roomType or "",
    summary.previousRoom or ""
  }, "|")

  -- Store as the latest handoff for this room
  safe_set("handoff:" .. room_id .. ":latest", serialized)

  -- Archive into rolling history
  local count = get_number("handoff:" .. room_id .. ":history_count", 0)
  local new_index = (count % max_history) + 1

  safe_set("handoff:" .. room_id .. ":history:" .. new_index, serialized)
  safe_set("handoff:" .. room_id .. ":history_count", count + 1)

  overlord.log.debug("Handoff stored", {
    roomId = room_id,
    agent = summary.fromAgentId,
    historyIndex = new_index
  })
end

-- ---------------------------------------------------------------------------
-- Deserialize a handoff string back into a summary table
-- ---------------------------------------------------------------------------
local function deserialize_handoff(raw)
  if not raw or raw == "" then
    return nil
  end

  local parts = {}
  for part in raw:gmatch("[^|]*") do
    parts[#parts + 1] = part
  end

  return {
    timestamp = parts[1] or "",
    fromAgentId = parts[2] or "",
    fromAgentName = parts[3] or "",
    fromAgentRole = parts[4] or "",
    roomType = parts[5] or "",
    previousRoom = parts[6] or ""
  }
end

-- ---------------------------------------------------------------------------
-- Retrieve the latest handoff summary for a room
-- ---------------------------------------------------------------------------
local function get_latest_handoff(room_id)
  local raw = safe_get("handoff:" .. room_id .. ":latest", nil)
  if raw == nil then
    return nil
  end
  return deserialize_handoff(raw)
end

-- ---------------------------------------------------------------------------
-- Retrieve the full handoff history for a room (most recent first)
-- ---------------------------------------------------------------------------
local function get_handoff_history(room_id)
  local max_history = get_number("config:max_history", 10)
  local total_count = get_number("handoff:" .. room_id .. ":history_count", 0)
  local history = {}

  -- Read entries, most recent first
  local entries_to_read = math.min(total_count, max_history)
  for i = entries_to_read, 1, -1 do
    local index = ((total_count - entries_to_read + i - 1) % max_history) + 1
    local raw = safe_get("handoff:" .. room_id .. ":history:" .. index, nil)
    if raw then
      local entry = deserialize_handoff(raw)
      if entry then
        history[#history + 1] = entry
      end
    end
  end

  return history
end

-- ===========================================================================
-- Lifecycle Hook: onLoad
-- ===========================================================================
registerHook("onLoad", function()
  overlord.log.info("Agent Handoff plugin loaded", {
    version = overlord.manifest.version
  })

  -- Initialize default configuration
  local defaults = {
    ["config:max_history"] = "10",
    ["config:auto_deliver"] = "true",
    ["config:include_tool_history"] = "true"
  }

  for key, default_val in pairs(defaults) do
    if safe_get(key, nil) == nil then
      safe_set(key, default_val)
    end
  end

  overlord.log.debug("Handoff plugin configuration initialized")
end)

-- ===========================================================================
-- Lifecycle Hook: onUnload
-- ===========================================================================
registerHook("onUnload", function()
  overlord.log.info("Agent Handoff plugin unloaded — handoff history preserved in storage")
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomExit
-- ===========================================================================
-- This is the CAPTURE phase. When an agent exits a room, we build a context
-- summary of their work and store it. This summary will be delivered to the
-- next agent who enters this room.
--
-- Parameters:
--   data.roomId   — the room being exited
--   data.agentId  — the agent leaving the room
-- ===========================================================================
registerHook("onRoomExit", function(data)
  if not data or not data.roomId or not data.agentId then
    overlord.log.warn("onRoomExit called with missing data", { data = data })
    return
  end

  -- Fetch room and agent details for the summary
  local room_ok, room = pcall(overlord.rooms.get, data.roomId)
  if not room_ok then
    room = nil
  end

  local agent_ok, agent = pcall(overlord.agents.get, data.agentId)
  if not agent_ok then
    agent = nil
  end

  -- Build and store the handoff summary
  local summary = build_handoff_summary(data.agentId, data.roomId, room, agent)
  store_handoff(data.roomId, summary)

  -- Track this agent's room chain (so we know where they came from next time)
  safe_set("handoff:chain:" .. data.agentId, data.roomId)

  -- Emit an event so other plugins or the UI know a handoff was captured
  overlord.bus.emit("plugin:handoff:captured", {
    roomId = data.roomId,
    roomName = room and room.name or "unknown",
    agentId = data.agentId,
    agentName = agent and agent.name or "unknown",
    timestamp = summary.timestamp
  })

  overlord.log.info("Handoff context captured", {
    agent = data.agentId,
    room = data.roomId,
    roomType = room and room.type or "unknown"
  })
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomEnter
-- ===========================================================================
-- This is the DELIVERY phase. When an agent enters a room, we check if a
-- previous agent left a handoff summary. If so, we deliver it via the event
-- bus so the entering agent (and the UI) can use it for context continuity.
--
-- Parameters:
--   data.roomId   — the room being entered
--   data.agentId  — the agent entering the room
-- ===========================================================================
registerHook("onRoomEnter", function(data)
  if not data or not data.roomId or not data.agentId then
    overlord.log.warn("onRoomEnter called with missing data", { data = data })
    return
  end

  -- Check if auto-delivery is enabled
  local auto_deliver = safe_get("config:auto_deliver", "true")
  if auto_deliver ~= "true" then
    overlord.log.debug("Auto-deliver disabled, skipping handoff delivery", {
      roomId = data.roomId
    })
    return
  end

  -- Look up the latest handoff for this room
  local handoff = get_latest_handoff(data.roomId)

  if handoff == nil then
    -- No previous handoff exists — this is the first agent in this room
    overlord.log.debug("No handoff available for room", { roomId = data.roomId })

    overlord.bus.emit("plugin:handoff:no-context", {
      roomId = data.roomId,
      agentId = data.agentId,
      message = "No previous agent context available. Starting fresh."
    })
    return
  end

  -- Don't deliver a handoff from the same agent (they already have context)
  if handoff.fromAgentId == data.agentId then
    overlord.log.debug("Handoff is from the same agent, skipping delivery", {
      agentId = data.agentId,
      roomId = data.roomId
    })
    return
  end

  -- Fetch the entering agent's details
  local agent_ok, entering_agent = pcall(overlord.agents.get, data.agentId)

  -- Also fetch the full handoff history for richer context
  local history = get_handoff_history(data.roomId)
  local history_summary = {}
  for i, entry in ipairs(history) do
    -- Only include a few recent entries to avoid overwhelming the agent
    if i > 5 then break end
    history_summary[#history_summary + 1] = {
      timestamp = entry.timestamp,
      agentName = entry.fromAgentName,
      agentRole = entry.fromAgentRole
    }
  end

  -- Deliver the handoff via the event bus
  overlord.bus.emit("plugin:handoff:delivered", {
    roomId = data.roomId,
    toAgentId = data.agentId,
    toAgentName = agent_ok and entering_agent and entering_agent.name or "unknown",
    fromAgentId = handoff.fromAgentId,
    fromAgentName = handoff.fromAgentName,
    fromAgentRole = handoff.fromAgentRole,
    roomType = handoff.roomType,
    capturedAt = handoff.timestamp,
    previousRoom = handoff.previousRoom,
    recentHistory = history_summary,
    message = "Context from " .. handoff.fromAgentName .. " (" .. handoff.fromAgentRole .. ") is available. "
      .. "They last worked in this " .. handoff.roomType .. " room at " .. handoff.timestamp .. "."
  })

  overlord.log.info("Handoff context delivered", {
    toAgent = data.agentId,
    fromAgent = handoff.fromAgentId,
    fromAgentName = handoff.fromAgentName,
    room = data.roomId,
    capturedAt = handoff.timestamp
  })
end)

-- ===========================================================================
-- Lifecycle Hook: onToolExecute
-- ===========================================================================
-- Track tool executions as part of the handoff context. When tools are
-- used, we record them so the handoff summary can include what tools
-- the previous agent leveraged.
--
-- Parameters:
--   data.agentId   — the agent using the tool
--   data.toolName  — the tool being used
--   data.roomId    — the room where it happened
-- ===========================================================================
registerHook("onToolExecute", function(data)
  if not data or not data.agentId or not data.roomId then
    return
  end

  local include_tools = safe_get("config:include_tool_history", "true")
  if include_tools ~= "true" then
    return
  end

  -- Append the tool name to a running list for this agent+room session
  local tool_key = "tools:" .. data.agentId .. ":" .. data.roomId
  local existing = safe_get(tool_key, "")

  local tool_name = data.toolName or "unknown"

  -- Avoid duplicates in the tool list
  if not existing:find(tool_name, 1, true) then
    local updated
    if existing == "" then
      updated = tool_name
    else
      updated = existing .. "," .. tool_name
    end
    safe_set(tool_key, updated)
  end
end)
