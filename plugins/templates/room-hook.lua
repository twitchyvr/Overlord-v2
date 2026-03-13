-- {{PLUGIN_NAME}} — Room Lifecycle Hook
-- {{PLUGIN_DESCRIPTION}}
--
-- Reacts to agents entering and exiting rooms.
-- Use this template to track room activity, enforce rules,
-- or trigger custom behavior on room transitions.

registerHook("onLoad", function()
  overlord.log.info("Room hook plugin loaded")
end)

registerHook("onRoomEnter", function(data)
  -- data.roomId   — the room that was entered
  -- data.roomType — the type of room (e.g. "code-lab", "discovery")
  -- data.agentId  — the agent who entered
  overlord.log.info("Agent entered room", {
    agentId = data.agentId,
    roomId = data.roomId,
    roomType = data.roomType,
  })

  -- Example: store entry timestamp
  local key = "entered:" .. data.agentId .. ":" .. data.roomId
  overlord.storage.set(key, os.time())
end)

registerHook("onRoomExit", function(data)
  -- data.roomId   — the room that was exited
  -- data.roomType — the type of room
  -- data.agentId  — the agent who exited
  overlord.log.info("Agent exited room", {
    agentId = data.agentId,
    roomId = data.roomId,
  })

  -- Example: calculate time spent in room
  local key = "entered:" .. data.agentId .. ":" .. data.roomId
  local entered = overlord.storage.get(key)
  if entered then
    local duration = os.time() - entered
    overlord.log.info("Time in room: " .. duration .. "s")
    overlord.storage.delete(key)
  end
end)

registerHook("onUnload", function()
  overlord.log.info("Room hook plugin unloaded")
end)
