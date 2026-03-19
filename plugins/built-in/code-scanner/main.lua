-- Code Scanner — Security Hook Plugin
--
-- Scans code being written for common vulnerabilities:
--   - Command injection patterns
--   - SQL injection (string concatenation with user input)
--   - XSS (innerHTML with interpolation)
--   - Hardcoded secrets (API keys, tokens)

local CODE_PATTERNS = {
  -- SQL injection
  { pattern = "SELECT.*%+%s*req%.", action = "warn",
    message = "SQL string concatenation with user input — use parameterized queries" },
  { pattern = "INSERT.*%+%s*req%.", action = "warn",
    message = "SQL string concatenation with user input — use parameterized queries" },

  -- XSS
  { pattern = "innerHTML%s*=%s*.*%$", action = "warn",
    message = "innerHTML with interpolation enables XSS" },
  { pattern = "dangerouslySetInnerHTML", action = "warn",
    message = "dangerouslySetInnerHTML can introduce XSS vulnerabilities" },

  -- Hardcoded secrets
  { pattern = "AKIA[0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z]", action = "block",
    message = "AWS Access Key ID detected in code — never commit credentials" },

  -- Code injection
  { pattern = "new%s+Function%s*%(", action = "warn",
    message = "new Function() is equivalent to eval — code injection risk" },
}

registerHook("onPreToolUse", function(context)
  -- Only check file-writing tools
  if context.toolName ~= "write_file" and context.toolName ~= "patch_file" then
    return { action = "allow" }
  end

  local content = tostring(context.toolParams.content or context.toolParams.patch or "")

  for _, rule in ipairs(CODE_PATTERNS) do
    if string.match(content, rule.pattern) then
      overlord.security.logEvent({
        type = "code_scanner",
        action = rule.action,
        toolName = context.toolName,
        agentId = context.agentId or "",
        roomId = context.roomId or "",
        message = rule.message,
        file = tostring(context.toolParams.path or context.toolParams.filePath or "unknown"),
        pattern = rule.pattern
      })
      return {
        action = rule.action,
        message = rule.message,
        suggestion = rule.suggestion
      }
    end
  end

  return { action = "allow" }
end)

overlord.log.info("Code scanner security plugin loaded — " .. #CODE_PATTERNS .. " rules active")
