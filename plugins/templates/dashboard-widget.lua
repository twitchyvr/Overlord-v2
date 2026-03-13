-- {{PLUGIN_NAME}} — Dashboard Widget
-- {{PLUGIN_DESCRIPTION}}
--
-- Emits data via the event bus that the Overlord dashboard can render.
-- Use this template to create custom metrics, counters, or status widgets.

local refresh_interval = 30 -- seconds

registerHook("onLoad", function()
  overlord.log.info("Dashboard widget loaded")

  -- Emit initial widget data
  emitWidgetData()
end)

function emitWidgetData()
  -- Gather your data
  local rooms = overlord.rooms.listRooms()
  local agents = overlord.agents.listAgents({})

  local roomCount = 0
  local agentCount = 0

  if rooms and rooms.ok then
    roomCount = #rooms.data
  end
  if agents and agents.ok then
    agentCount = #agents.data
  end

  -- Emit via bus — the UI can subscribe to this event
  overlord.bus.emit("widget-update", {
    widgetId = "{{PLUGIN_ID}}",
    title = "{{PLUGIN_NAME}}",
    data = {
      rooms = roomCount,
      agents = agentCount,
      lastUpdated = os.time(),
    },
  })
end

-- Update widget data when rooms change
registerHook("onRoomEnter", function(data)
  emitWidgetData()
end)

registerHook("onRoomExit", function(data)
  emitWidgetData()
end)

registerHook("onUnload", function()
  overlord.log.info("Dashboard widget unloaded")
end)
