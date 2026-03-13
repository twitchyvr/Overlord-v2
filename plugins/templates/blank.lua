-- {{PLUGIN_NAME}}
-- {{PLUGIN_DESCRIPTION}}
--
-- Available APIs:
--   overlord.log.info/warn/error/debug(msg, data?)
--   overlord.bus.emit/on/off(event, data?)
--   overlord.rooms.listRooms/getRoom(roomId)
--   overlord.agents.listAgents/getAgent(agentId)
--   overlord.storage.get/set/delete/keys()
--   registerHook(hookName, handler)

registerHook("onLoad", function()
  overlord.log.info("Plugin loaded")
end)

registerHook("onUnload", function()
  overlord.log.info("Plugin unloaded")
end)
