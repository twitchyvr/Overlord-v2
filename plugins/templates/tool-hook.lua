-- {{PLUGIN_NAME}} — Tool Execution Hook
-- {{PLUGIN_DESCRIPTION}}
--
-- Reacts when tools are executed in rooms.
-- Use this template to audit tool usage, enforce limits,
-- or add custom logging around tool execution.

local tool_counts = {}

registerHook("onLoad", function()
  overlord.log.info("Tool hook plugin loaded")

  -- Load persisted counts
  local saved = overlord.storage.get("tool_counts")
  if saved then
    tool_counts = saved
  end
end)

registerHook("onToolExecute", function(data)
  -- data.toolName — the tool that was executed
  -- data.agentId  — the agent who ran the tool
  -- data.roomId   — the room where the tool ran
  -- data.result   — the result of the tool execution
  local name = data.toolName or "unknown"

  -- Track execution count
  tool_counts[name] = (tool_counts[name] or 0) + 1
  overlord.storage.set("tool_counts", tool_counts)

  overlord.log.info("Tool executed", {
    tool = name,
    agent = data.agentId,
    room = data.roomId,
    totalUses = tool_counts[name],
  })

  -- Example: emit event when a tool has been used many times
  if tool_counts[name] == 100 then
    overlord.bus.emit("tool-milestone", {
      tool = name,
      count = tool_counts[name],
    })
  end
end)

registerHook("onUnload", function()
  -- Persist counts before unloading
  overlord.storage.set("tool_counts", tool_counts)
  overlord.log.info("Tool hook plugin unloaded")
end)
