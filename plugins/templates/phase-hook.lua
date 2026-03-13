-- {{PLUGIN_NAME}} — Phase Gate Hook
-- {{PLUGIN_DESCRIPTION}}
--
-- Reacts when phase gates advance and can influence gate decisions.
-- Use this template to add custom phase gate logic, notifications,
-- or enforce additional criteria before phase transitions.

registerHook("onLoad", function()
  overlord.log.info("Phase hook plugin loaded")
end)

registerHook("onPhaseAdvance", function(data)
  -- data.buildingId — the building that advanced
  -- data.fromPhase  — the phase we came from
  -- data.toPhase    — the phase we moved to
  overlord.log.info("Phase advanced", {
    building = data.buildingId,
    from = data.fromPhase,
    to = data.toPhase,
  })

  -- Example: emit notification on critical phase transitions
  if data.toPhase == "deploy" then
    overlord.bus.emit("deploy-alert", {
      building = data.buildingId,
      message = "Entering deploy phase — all changes must be reviewed",
    })
  end
end)

-- Queryable hook: Influence phase gate evaluation
-- Return a table to override the default behavior, or nil to use default.
registerHook("onPhaseGateEvaluate", function(data)
  -- data.buildingId — the building being evaluated
  -- data.phase      — the current phase
  -- data.criteria   — the criteria being checked
  --
  -- Return { verdict = "GO" } to approve
  -- Return { verdict = "NO_GO", reason = "..." } to block
  -- Return nil to use the default TypeScript evaluation

  overlord.log.debug("Phase gate evaluation requested", {
    building = data.buildingId,
    phase = data.phase,
  })

  return nil -- Use default behavior
end)

registerHook("onUnload", function()
  overlord.log.info("Phase hook plugin unloaded")
end)
