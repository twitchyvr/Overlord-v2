-- Shell Guard — Security Hook Plugin
--
-- Blocks dangerous shell commands before execution.
-- Uses onPreToolUse to intercept shell/execute tools.

local DANGEROUS_PATTERNS = {
  { pattern = "rm%s+%-rf%s+[/~]",                action = "block", message = "Recursive delete at root/home blocked" },
  { pattern = "rm%s+%-rf%s+%.",                   action = "warn",  message = "Recursive delete in current directory — verify this is intended" },
  { pattern = "curl.*|%s*bash",                   action = "block", message = "Piping curl to shell blocked — download and review first" },
  { pattern = "curl.*|%s*sh",                     action = "block", message = "Piping curl to shell blocked" },
  { pattern = "wget.*|%s*bash",                   action = "block", message = "Piping wget to shell blocked" },
  { pattern = "wget.*|%s*sh",                     action = "block", message = "Piping wget to shell blocked" },
  { pattern = "chmod%s+777",                      action = "warn",  message = "World-writable permissions (777) are a security risk" },
  { pattern = "git%s+push.*%-%-force%s+main",     action = "block", message = "Force push to main blocked" },
  { pattern = "git%s+push.*%-%-force%s+master",   action = "block", message = "Force push to master blocked" },
  { pattern = "git%s+push.*%-f%s+main",           action = "block", message = "Force push to main blocked" },
  { pattern = "git%s+push.*%-f%s+master",         action = "block", message = "Force push to master blocked" },
  { pattern = "DROP%s+TABLE",                     action = "block", message = "DROP TABLE blocked — use migrations instead" },
  { pattern = "DROP%s+DATABASE",                  action = "block", message = "DROP DATABASE blocked — use migrations instead" },
  { pattern = "DELETE%s+FROM.*WHERE%s+1",         action = "block", message = "Bulk delete (WHERE 1) blocked" },
  { pattern = "TRUNCATE%s+TABLE",                 action = "block", message = "TRUNCATE TABLE blocked — use migrations instead" },
  { pattern = "shutdown",                         action = "warn",  message = "Shutdown command detected — verify this is necessary" },
  { pattern = "mkfs",                             action = "block", message = "Filesystem format command blocked" },
  { pattern = "dd%s+if=",                         action = "warn",  message = "dd can overwrite disk data — verify target carefully" },
  { pattern = ">%s*/dev/sd",                      action = "block", message = "Direct disk write blocked" },
  { pattern = "npm%s+install.*%-%-unsafe%-perm",  action = "warn",  message = "Installing with unsafe permissions" },
  { pattern = "sudo%s+rm",                        action = "block", message = "Elevated recursive delete blocked" },
  { pattern = ":(){ :|:& };:",                    action = "block", message = "Fork bomb detected and blocked" },
}

registerHook("onPreToolUse", function(context)
  -- Only check shell/execute tools
  if context.toolName ~= "shell" and context.toolName ~= "execute" then
    return { action = "allow" }
  end

  local cmd = tostring(context.toolParams.command or context.toolParams.cmd or "")

  for _, rule in ipairs(DANGEROUS_PATTERNS) do
    if string.match(cmd, rule.pattern) then
      overlord.security.logEvent({
        type = "shell_guard",
        action = rule.action,
        toolName = context.toolName,
        agentId = context.agentId or "",
        roomId = context.roomId or "",
        message = rule.message,
        command = cmd,
        pattern = rule.pattern
      })
      return { action = rule.action, message = rule.message }
    end
  end

  return { action = "allow" }
end)

overlord.log.info("Shell guard security plugin loaded — " .. #DANGEROUS_PATTERNS .. " rules active")
