-- Shell Guard — Security Hook Plugin
--
-- Blocks dangerous shell commands before execution.
-- Uses onPreToolUse to intercept shell/execute tools.
-- Respects building security level (#882):
--   permissive: warn only (never block)
--   standard:   block destructive, warn risky (default)
--   strict:     allowlist-only mode — block anything not explicitly safe
--   paranoid:   block ALL shell commands

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

-- Safe commands allowed in strict mode (allowlist)
local STRICT_ALLOWLIST = {
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "date",
  "wc", "sort", "uniq", "diff", "tree", "file", "which", "whoami",
  "git status", "git log", "git diff", "git branch", "git show",
  "npm test", "npm run", "npm list", "npx tsc",
  "node ", "python ", "cargo ", "go ",
}

local function getFirstWord(cmd)
  return string.match(cmd, "^%s*(%S+)")
end

local function isAllowlisted(cmd)
  for _, safe in ipairs(STRICT_ALLOWLIST) do
    if string.sub(cmd, 1, #safe) == safe then
      return true
    end
  end
  return false
end

registerHook("onPreToolUse", function(context)
  -- Only check shell/execute tools
  if context.toolName ~= "shell" and context.toolName ~= "execute" then
    return { action = "allow" }
  end

  local cmd = tostring(context.toolParams.command or context.toolParams.cmd or "")
  local level = context.securityLevel or "standard"

  -- Paranoid: block ALL shell commands
  if level == "paranoid" then
    overlord.security.logEvent({
      type = "shell_guard",
      action = "block",
      toolName = context.toolName,
      agentId = context.agentId or "",
      roomId = context.roomId or "",
      message = "All shell commands blocked (paranoid security level)",
      command = cmd,
    })
    return {
      action = "block",
      message = "All shell commands blocked (paranoid security level)",
      suggestion = "Lower the security level to 'strict' or 'standard' to allow shell commands"
    }
  end

  -- Strict: allowlist-only mode
  if level == "strict" then
    if not isAllowlisted(cmd) then
      overlord.security.logEvent({
        type = "shell_guard",
        action = "block",
        toolName = context.toolName,
        agentId = context.agentId or "",
        roomId = context.roomId or "",
        message = "Command not in allowlist (strict security level)",
        command = cmd,
      })
      return {
        action = "block",
        message = "Command not in allowlist (strict security level): " .. (getFirstWord(cmd) or "unknown"),
        suggestion = "Only read-only and build commands are allowed in strict mode"
      }
    end
  end

  -- Standard & Permissive: check dangerous patterns
  for _, rule in ipairs(DANGEROUS_PATTERNS) do
    if string.match(cmd, rule.pattern) then
      -- In permissive mode, downgrade all blocks to warns
      local effectiveAction = rule.action
      if level == "permissive" and effectiveAction == "block" then
        effectiveAction = "warn"
      end

      overlord.security.logEvent({
        type = "shell_guard",
        action = effectiveAction,
        toolName = context.toolName,
        agentId = context.agentId or "",
        roomId = context.roomId or "",
        message = rule.message,
        command = cmd,
        pattern = rule.pattern
      })
      return { action = effectiveAction, message = rule.message }
    end
  end

  return { action = "allow" }
end)

overlord.log.info("Shell guard security plugin loaded — " .. #DANGEROUS_PATTERNS .. " rules active")
