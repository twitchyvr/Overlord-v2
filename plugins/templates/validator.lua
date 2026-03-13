-- {{PLUGIN_NAME}} — Exit Document Validator
-- {{PLUGIN_DESCRIPTION}}
--
-- Validates exit documents when agents leave rooms.
-- Use this template to enforce custom validation rules
-- beyond the built-in schema validation.

registerHook("onLoad", function()
  overlord.log.info("Validator plugin loaded")
end)

-- Queryable hook: Custom exit document validation
-- Return a table to override the default behavior, or nil to use default.
registerHook("onExitDocValidate", function(data)
  -- data.roomId     — the room being exited
  -- data.roomType   — the type of room
  -- data.agentId    — the agent exiting
  -- data.exitDoc    — the exit document being validated
  --
  -- Return { valid = true } to approve
  -- Return { valid = false, reason = "..." } to reject
  -- Return nil to use the default TypeScript validation

  local doc = data.exitDoc
  if not doc then
    return { valid = false, reason = "Exit document is required" }
  end

  -- Example: require a summary field with minimum length
  if doc.summary and #doc.summary < 20 then
    return {
      valid = false,
      reason = "Summary must be at least 20 characters",
    }
  end

  -- Example: require evidence links for review rooms
  if data.roomType == "review" then
    if not doc.evidence or #doc.evidence == 0 then
      return {
        valid = false,
        reason = "Review exit documents must include evidence links",
      }
    end
  end

  -- Pass — use default validation for anything not checked above
  return nil
end)

registerHook("onUnload", function()
  overlord.log.info("Validator plugin unloaded")
end)
