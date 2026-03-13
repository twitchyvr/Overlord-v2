-- =============================================================================
-- Agent Mood System Plugin
-- =============================================================================
-- Gives every agent a "morale" score that reflects how the project is going
-- from their perspective. When tools execute successfully and phases advance,
-- morale rises. When things go wrong, morale dips. The plugin emits mood
-- events so the UI can display agent sentiment — happy agents, stressed
-- agents, or frustrated agents.
--
-- Morale is clamped between 0 (miserable) and 100 (ecstatic). Each agent
-- starts at 50 (neutral). The mood label is derived from the numeric score.
--
-- Storage keys used:
--   "morale:<agentId>"                   — numeric morale score (0-100)
--   "streak:<agentId>"                   — consecutive success count
--   "config:base_morale"                 — starting morale for new agents (default: 50)
--   "config:success_boost"               — morale gained on success (default: 5)
--   "config:failure_penalty"             — morale lost on failure (default: 8)
--   "config:phase_advance_boost"         — morale gained on phase advance (default: 15)
--   "config:streak_bonus_multiplier"     — extra boost per consecutive success (default: 1)
--   "config:mood_decay_rate"             — morale decays toward neutral over time (default: 1)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Mood thresholds — maps a numeric morale score to a human-readable label
-- ---------------------------------------------------------------------------
local MOOD_LABELS = {
  { threshold = 90, label = "ecstatic",    emoji = "radiant" },
  { threshold = 75, label = "happy",       emoji = "smiling" },
  { threshold = 60, label = "content",     emoji = "calm" },
  { threshold = 45, label = "neutral",     emoji = "steady" },
  { threshold = 30, label = "uneasy",      emoji = "concerned" },
  { threshold = 15, label = "stressed",    emoji = "tense" },
  { threshold = 0,  label = "frustrated",  emoji = "struggling" }
}

-- ---------------------------------------------------------------------------
-- Helper: safely read a numeric value from storage
-- ---------------------------------------------------------------------------
local function get_number(key, default)
  local ok, raw = pcall(overlord.storage.get, key)
  if not ok or raw == nil then
    return default
  end
  return tonumber(raw) or default
end

-- ---------------------------------------------------------------------------
-- Helper: safely write to storage
-- ---------------------------------------------------------------------------
local function safe_set(key, value)
  local ok, err = pcall(overlord.storage.set, key, tostring(value))
  if not ok then
    overlord.log.error("Storage write failed", { key = key, error = tostring(err) })
  end
end

-- ---------------------------------------------------------------------------
-- Clamp a value between a minimum and maximum
-- ---------------------------------------------------------------------------
local function clamp(value, min_val, max_val)
  if value < min_val then return min_val end
  if value > max_val then return max_val end
  return value
end

-- ---------------------------------------------------------------------------
-- Determine the mood label for a given morale score
-- ---------------------------------------------------------------------------
local function get_mood(score)
  for _, entry in ipairs(MOOD_LABELS) do
    if score >= entry.threshold then
      return entry.label, entry.emoji
    end
  end
  return "frustrated", "struggling"
end

-- ---------------------------------------------------------------------------
-- Read an agent's current morale score from storage
-- ---------------------------------------------------------------------------
local function get_morale(agent_id)
  local base = get_number("config:base_morale", 50)
  return get_number("morale:" .. agent_id, base)
end

-- ---------------------------------------------------------------------------
-- Read an agent's current success streak
-- ---------------------------------------------------------------------------
local function get_streak(agent_id)
  return get_number("streak:" .. agent_id, 0)
end

-- ---------------------------------------------------------------------------
-- Update morale and emit a mood event. This is the core function that all
-- hooks call after computing a morale delta.
--
-- Parameters:
--   agent_id  — the agent whose morale changed
--   delta     — positive or negative change amount
--   reason    — human-readable explanation of why morale changed
-- ---------------------------------------------------------------------------
local function update_morale(agent_id, delta, reason)
  local old_morale = get_morale(agent_id)
  local new_morale = clamp(old_morale + delta, 0, 100)

  safe_set("morale:" .. agent_id, new_morale)

  local old_mood = get_mood(old_morale)
  local new_mood, new_emoji = get_mood(new_morale)

  -- Only emit an event if the mood actually changed or the delta was significant
  local mood_changed = (old_mood ~= new_mood)
  local significant_delta = math.abs(delta) >= 5

  if mood_changed or significant_delta then
    overlord.bus.emit("plugin:mood-system:update", {
      agentId = agent_id,
      oldMorale = old_morale,
      newMorale = new_morale,
      delta = delta,
      mood = new_mood,
      moodVisual = new_emoji,
      moodChanged = mood_changed,
      previousMood = old_mood,
      reason = reason,
      streak = get_streak(agent_id)
    })

    -- Log mood transitions at info level; minor changes at debug
    if mood_changed then
      overlord.log.info("Agent mood changed", {
        agent = agent_id,
        from = old_mood,
        to = new_mood,
        morale = new_morale,
        reason = reason
      })
    else
      overlord.log.debug("Agent morale updated", {
        agent = agent_id,
        morale = new_morale,
        delta = delta,
        mood = new_mood
      })
    end
  end

  return new_morale, new_mood
end

-- ===========================================================================
-- Lifecycle Hook: onLoad
-- ===========================================================================
registerHook("onLoad", function()
  overlord.log.info("Agent Mood System loaded", {
    version = overlord.manifest.version
  })

  -- Initialize default configuration
  local defaults = {
    ["config:base_morale"] = "50",
    ["config:success_boost"] = "5",
    ["config:failure_penalty"] = "8",
    ["config:phase_advance_boost"] = "15",
    ["config:streak_bonus_multiplier"] = "1",
    ["config:mood_decay_rate"] = "1"
  }

  for key, default_val in pairs(defaults) do
    local ok, existing = pcall(overlord.storage.get, key)
    if not ok or existing == nil then
      safe_set(key, default_val)
    end
  end

  overlord.log.debug("Mood System configuration initialized")
end)

-- ===========================================================================
-- Lifecycle Hook: onUnload
-- ===========================================================================
registerHook("onUnload", function()
  overlord.log.info("Agent Mood System unloaded — morale data preserved in storage")
end)

-- ===========================================================================
-- Lifecycle Hook: onToolExecute
-- ===========================================================================
-- Tool executions are the primary morale driver. We treat every tool
-- execution as a "success" (the agent is doing work). A consecutive
-- streak of tool executions builds momentum, amplifying the morale boost.
--
-- The streak bonus means an agent on a roll (3, 4, 5 tools in a row) gets
-- increasingly happy — simulating the feeling of being "in the zone."
--
-- Parameters:
--   data.agentId   — the agent executing the tool
--   data.toolName  — name of the tool (for logging)
--   data.success   — boolean, true if the tool succeeded (optional, default true)
-- ===========================================================================
registerHook("onToolExecute", function(data)
  if not data or not data.agentId then
    return
  end

  local success = true
  if data.success == false then
    success = false
  end

  if success then
    -- Increase streak and compute morale boost
    local streak = get_streak(data.agentId) + 1
    safe_set("streak:" .. data.agentId, streak)

    local base_boost = get_number("config:success_boost", 5)
    local streak_multiplier = get_number("config:streak_bonus_multiplier", 1)

    -- Streak bonus: each consecutive success adds a small extra boost
    -- e.g., base 5 + (streak 3 * multiplier 1) = 8 points
    local total_boost = base_boost + (streak * streak_multiplier)

    -- Cap the streak bonus so it doesn't go to infinity
    total_boost = math.min(total_boost, base_boost * 3)

    update_morale(
      data.agentId,
      total_boost,
      "Tool '" .. (data.toolName or "unknown") .. "' executed successfully (streak: " .. streak .. ")"
    )
  else
    -- Failure: reset streak and apply penalty
    safe_set("streak:" .. data.agentId, 0)

    local penalty = get_number("config:failure_penalty", 8)
    update_morale(
      data.agentId,
      -penalty,
      "Tool '" .. (data.toolName or "unknown") .. "' failed"
    )
  end
end)

-- ===========================================================================
-- Lifecycle Hook: onPhaseAdvance
-- ===========================================================================
-- Phase advances are big wins — they mean the project moved forward through
-- a gate. This gives a substantial morale boost to all agents currently
-- known to the system, reflecting team-wide celebration.
--
-- Parameters:
--   data.phase      — the name/number of the new phase
--   data.roomId     — the room where the phase advanced (optional)
-- ===========================================================================
registerHook("onPhaseAdvance", function(data)
  local phase_boost = get_number("config:phase_advance_boost", 15)
  local phase_name = (data and data.phase) or "unknown"

  overlord.log.info("Phase advanced — boosting all agent morale", {
    phase = phase_name,
    boost = phase_boost
  })

  -- Fetch all agents and give everyone the phase boost
  local ok, agents = pcall(overlord.agents.list, {})
  if not ok or agents == nil then
    overlord.log.warn("Could not list agents for phase boost", { error = tostring(agents) })
    return
  end

  for _, agent in ipairs(agents) do
    update_morale(
      agent.id,
      phase_boost,
      "Phase advanced to '" .. phase_name .. "' — team milestone reached"
    )
  end

  -- Emit a team-wide mood summary after the phase advance
  local mood_summary = {}
  for _, agent in ipairs(agents) do
    local morale = get_morale(agent.id)
    local mood = get_mood(morale)
    mood_summary[#mood_summary + 1] = {
      agentId = agent.id,
      agentName = agent.name,
      morale = morale,
      mood = mood
    }
  end

  overlord.bus.emit("plugin:mood-system:team-summary", {
    trigger = "phase_advance",
    phase = phase_name,
    agents = mood_summary
  })
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomEnter
-- ===========================================================================
-- Entering a room is a minor positive event — the agent is being assigned
-- work, which is a vote of confidence. Small morale bump.
--
-- Parameters:
--   data.agentId  — the agent entering
--   data.roomId   — the room being entered
-- ===========================================================================
registerHook("onRoomEnter", function(data)
  if not data or not data.agentId then
    return
  end

  -- Small boost for being assigned to a room (agent feels valued)
  update_morale(data.agentId, 2, "Assigned to room " .. (data.roomId or "unknown"))
end)

-- ===========================================================================
-- Lifecycle Hook: onRoomExit
-- ===========================================================================
-- Exiting a room applies a gentle decay toward neutral. If the agent's
-- morale is above 50 it ticks down slightly; if below 50 it ticks up.
-- This prevents extreme moods from persisting forever.
--
-- Parameters:
--   data.agentId  — the agent exiting
--   data.roomId   — the room being exited
-- ===========================================================================
registerHook("onRoomExit", function(data)
  if not data or not data.agentId then
    return
  end

  local decay_rate = get_number("config:mood_decay_rate", 1)
  local morale = get_morale(data.agentId)
  local base = get_number("config:base_morale", 50)

  -- Decay toward neutral baseline
  if morale > base then
    update_morale(data.agentId, -decay_rate, "Natural mood decay on room exit")
  elseif morale < base then
    update_morale(data.agentId, decay_rate, "Natural mood recovery on room exit")
  end
end)
