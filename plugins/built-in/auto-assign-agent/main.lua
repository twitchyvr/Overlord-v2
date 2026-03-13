-- =============================================================================
-- Auto-Assign Agent Plugin
-- =============================================================================
-- Automatically assigns the best-suited agent to a room based on task type
-- and historical affinity scores. Each time an agent works in a room, the
-- plugin records how well that pairing performed. Over time, the system learns
-- which agents are best for which room types and suggests (or auto-assigns)
-- the ideal agent when a room is entered.
--
-- Storage keys used:
--   "affinity:<agentId>:<roomType>"  — numeric score (higher = better fit)
--   "config:auto_assign_enabled"     — "true" or "false" (default: "true")
--   "config:score_increment"         — points added per successful entry (default: 10)
--   "config:score_decrement"         — points removed on mismatch (default: 3)
--   "config:min_score_threshold"     — minimum score to consider (default: 0)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: safely read a numeric value from storage with a fallback default
-- ---------------------------------------------------------------------------
local function get_number(key, default)
  local ok, raw = pcall(overlord.storage.get, key)
  if not ok or raw == nil then
    return default
  end
  local num = tonumber(raw)
  return num or default
end

-- ---------------------------------------------------------------------------
-- Helper: safely read a string value from storage with a fallback default
-- ---------------------------------------------------------------------------
local function get_string(key, default)
  local ok, raw = pcall(overlord.storage.get, key)
  if not ok or raw == nil then
    return default
  end
  return tostring(raw)
end

-- ---------------------------------------------------------------------------
-- Build the storage key for an agent + room-type affinity score
-- ---------------------------------------------------------------------------
local function affinity_key(agent_id, room_type)
  return "affinity:" .. agent_id .. ":" .. room_type
end

-- ---------------------------------------------------------------------------
-- Read the current affinity score for an agent in a given room type
-- ---------------------------------------------------------------------------
local function get_affinity(agent_id, room_type)
  return get_number(affinity_key(agent_id, room_type), 0)
end

-- ---------------------------------------------------------------------------
-- Write an updated affinity score back to storage
-- ---------------------------------------------------------------------------
local function set_affinity(agent_id, room_type, score)
  local ok, write_err = pcall(overlord.storage.set, affinity_key(agent_id, room_type), tostring(score))
  if not ok then
    overlord.log.error("Failed to write affinity score", {
      agent = agent_id,
      roomType = room_type,
      error = tostring(write_err)
    })
  end
end

-- ---------------------------------------------------------------------------
-- Find the best agent for a room type by scanning all known agents and
-- comparing their affinity scores.
--
-- Returns: best_agent (object or nil), best_score (number)
-- ---------------------------------------------------------------------------
local function find_best_agent(room_type)
  -- Fetch all available agents
  local ok, agents = pcall(overlord.agents.list, { status = "idle" })
  if not ok or agents == nil then
    overlord.log.warn("Could not list agents for auto-assign", {
      roomType = room_type,
      error = tostring(agents)
    })
    return nil, 0
  end

  local min_threshold = get_number("config:min_score_threshold", 0)
  local best_agent = nil
  local best_score = min_threshold

  for _, agent in ipairs(agents) do
    local score = get_affinity(agent.id, room_type)
    if score > best_score then
      best_score = score
      best_agent = agent
    end
  end

  return best_agent, best_score
end

-- ===========================================================================
-- Lifecycle Hook: onLoad
-- ===========================================================================
-- Runs once when the plugin is first loaded. Sets default configuration
-- values in storage if they have not been set by the user yet.
-- ===========================================================================
registerHook("onLoad", function()
  overlord.log.info("Auto-Assign Agent plugin loaded", {
    version = overlord.manifest.version
  })

  -- Initialize default config values only if they are not already present
  if get_string("config:auto_assign_enabled", nil) == nil then
    overlord.storage.set("config:auto_assign_enabled", "true")
  end
  if get_string("config:score_increment", nil) == nil then
    overlord.storage.set("config:score_increment", "10")
  end
  if get_string("config:score_decrement", nil) == nil then
    overlord.storage.set("config:score_decrement", "3")
  end
  if get_string("config:min_score_threshold", nil) == nil then
    overlord.storage.set("config:min_score_threshold", "0")
  end

  overlord.log.debug("Default configuration initialized")
end)

-- ===========================================================================
-- Lifecycle Hook: onUnload
-- ===========================================================================
-- Runs when the plugin is disabled or the system shuts down. Affinity data
-- persists in storage so it survives restarts.
-- ===========================================================================
registerHook("onUnload", function()
  overlord.log.info("Auto-Assign Agent plugin unloaded — affinity data preserved in storage")
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomEnter
-- ===========================================================================
-- Fires every time any agent enters a room. This is where the core logic
-- lives:
--   1. Boost the entering agent's affinity score for this room type.
--   2. Check if a better-suited agent exists.
--   3. If yes, emit a "plugin:auto-assign:suggestion" event so the UI or
--      orchestrator can act on it.
--
-- Parameters (via data table):
--   data.roomId   — the ID of the room being entered
--   data.agentId  — the ID of the agent entering the room
-- ===========================================================================
registerHook("onRoomEnter", function(data)
  -- Guard: make sure we have the data we need
  if not data or not data.roomId or not data.agentId then
    overlord.log.warn("onRoomEnter called with missing data", { data = data })
    return
  end

  -- Check if auto-assign is enabled
  local enabled = get_string("config:auto_assign_enabled", "true")
  if enabled ~= "true" then
    overlord.log.debug("Auto-assign is disabled, skipping", { roomId = data.roomId })
    return
  end

  -- Look up the room to get its type
  local ok, room = pcall(overlord.rooms.get, data.roomId)
  if not ok or room == nil then
    overlord.log.warn("Could not fetch room details", {
      roomId = data.roomId,
      error = tostring(room)
    })
    return
  end

  local room_type = room.type or "unknown"

  -- Increase the current agent's affinity for this room type
  local increment = get_number("config:score_increment", 10)
  local current_score = get_affinity(data.agentId, room_type)
  local new_score = current_score + increment
  set_affinity(data.agentId, room_type, new_score)

  overlord.log.debug("Affinity score updated", {
    agent = data.agentId,
    roomType = room_type,
    oldScore = current_score,
    newScore = new_score
  })

  -- Now check: is there a better-suited idle agent for this room type?
  local best_agent, best_score = find_best_agent(room_type)

  if best_agent and best_agent.id ~= data.agentId and best_score > new_score then
    -- A better candidate exists — emit a suggestion event
    overlord.log.info("Better agent found for room", {
      currentAgent = data.agentId,
      suggestedAgent = best_agent.id,
      suggestedAgentName = best_agent.name,
      roomType = room_type,
      currentScore = new_score,
      suggestedScore = best_score
    })

    overlord.bus.emit("plugin:auto-assign:suggestion", {
      roomId = data.roomId,
      roomType = room_type,
      currentAgentId = data.agentId,
      suggestedAgentId = best_agent.id,
      suggestedAgentName = best_agent.name,
      currentScore = new_score,
      suggestedScore = best_score,
      reason = best_agent.name .. " has a higher affinity (" .. best_score .. ") for " .. room_type .. " rooms"
    })
  else
    overlord.log.debug("Current agent is the best fit or no better candidate available", {
      agent = data.agentId,
      roomType = room_type,
      score = new_score
    })
  end
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomExit
-- ===========================================================================
-- When an agent leaves a room, we slightly reduce the affinity score of
-- other agents for that room type. This ensures that scores do not inflate
-- endlessly for agents that are never used — a gentle form of score decay.
--
-- Parameters (via data table):
--   data.roomId   — the ID of the room being exited
--   data.agentId  — the ID of the agent exiting the room
-- ===========================================================================
registerHook("onRoomExit", function(data)
  if not data or not data.roomId or not data.agentId then
    return
  end

  local ok, room = pcall(overlord.rooms.get, data.roomId)
  if not ok or room == nil then
    return
  end

  local room_type = room.type or "unknown"
  local decrement = get_number("config:score_decrement", 3)

  -- Apply a small decay to all OTHER agents' scores for this room type
  local list_ok, agents = pcall(overlord.agents.list, {})
  if not list_ok or agents == nil then
    return
  end

  for _, agent in ipairs(agents) do
    if agent.id ~= data.agentId then
      local score = get_affinity(agent.id, room_type)
      if score > 0 then
        local decayed = math.max(0, score - decrement)
        set_affinity(agent.id, room_type, decayed)
      end
    end
  end
end)
