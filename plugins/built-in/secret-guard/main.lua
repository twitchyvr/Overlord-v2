-- Secret Guard — Post-Execution Security Hook Plugin
--
-- Scans tool output for leaked secrets (API keys, tokens, private keys)
-- and emits warnings when detected.

local SECRET_PATTERNS = {
  { pattern = "sk_live_[a-zA-Z0-9]",       name = "Stripe Secret Key" },
  { pattern = "sk_test_[a-zA-Z0-9]",       name = "Stripe Test Key" },
  { pattern = "ghp_[a-zA-Z0-9]",           name = "GitHub Personal Access Token" },
  { pattern = "gho_[a-zA-Z0-9]",           name = "GitHub OAuth Token" },
  { pattern = "AKIA[0-9A-Z]",              name = "AWS Access Key" },
  { pattern = "-----BEGIN.*PRIVATE KEY",    name = "Private Key" },
  { pattern = "xoxb%-[a-zA-Z0-9]",         name = "Slack Bot Token" },
  { pattern = "xoxp%-[a-zA-Z0-9]",         name = "Slack User Token" },
  { pattern = "eyJ[a-zA-Z0-9_%-]+%.[a-zA-Z0-9_%-]+%.", name = "JWT Token" },
}

registerHook("onPostToolUse", function(context)
  local output = tostring(context.result or "")

  for _, secret in ipairs(SECRET_PATTERNS) do
    if string.match(output, secret.pattern) then
      overlord.security.logEvent({
        type = "secret_leak",
        action = "warn",
        toolName = context.toolName or "",
        agentId = context.agentId or "",
        roomId = context.roomId or "",
        message = secret.name .. " detected in tool output — review before sharing"
      })
      return {
        action = "warn",
        message = secret.name .. " detected in output — review before sharing"
      }
    end
  end

  return { action = "allow" }
end)

overlord.log.info("Secret guard plugin loaded — " .. #SECRET_PATTERNS .. " secret patterns monitored")
