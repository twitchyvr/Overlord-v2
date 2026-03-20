# Security Hooks Tutorial

> Build pre/post tool-use security plugins that protect your Overlord projects from dangerous operations.

---

## Overview

Security hooks intercept tool execution at two points:

1. **`onPreToolUse`** — Called **before** a tool runs. Can block, warn, or allow.
2. **`onPostToolUse`** — Called **after** a tool runs. Can inspect output, redact secrets, or log.

Both hooks return a `SecurityHookResult`:

```lua
{ action = "allow" }                                    -- Proceed normally
{ action = "warn", message = "This looks risky" }       -- Proceed with warning
{ action = "block", message = "Blocked for safety" }    -- Deny execution
```

---

## Part 1: Basic Pre-Tool-Use Hook

Block a specific tool entirely.

### plugin.json

```json
{
  "id": "no-shell",
  "name": "No Shell",
  "version": "1.0.0",
  "description": "Blocks all shell command execution",
  "engine": "lua",
  "entrypoint": "main.lua",
  "permissions": ["security:read", "security:write"]
}
```

### main.lua

```lua
registerHook("onPreToolUse", function(context)
    if context.toolName == "shell" or context.toolName == "execute" then
        overlord.security.logEvent({
            type = "no_shell",
            action = "block",
            toolName = context.toolName,
            agentId = context.agentId or "",
            roomId = context.roomId or "",
            message = "Shell execution is disabled by policy"
        })
        return { action = "block", message = "Shell execution is disabled" }
    end

    return { action = "allow" }
end)

overlord.log.info("No-shell security plugin loaded")
```

**Key points:**
- Always return `{ action = "allow" }` for tools you don't want to intercept
- Use `overlord.security.logEvent()` to record the decision for audit
- The `context` table contains `toolName`, `toolParams`, `agentId`, `roomId`, and `buildingId`

---

## Part 2: Pattern-Based Command Filtering

The built-in `shell-guard` plugin demonstrates pattern-based filtering. Here's how to build your own.

```lua
-- Define rules as a table of patterns
local RULES = {
    { pattern = "rm%s+%-rf%s+/",     action = "block", message = "Recursive delete at root blocked" },
    { pattern = "DROP%s+TABLE",      action = "block", message = "DROP TABLE blocked" },
    { pattern = "chmod%s+777",       action = "warn",  message = "World-writable permissions are risky" },
    { pattern = "git%s+push.*force", action = "warn",  message = "Force push detected — verify target" },
}

registerHook("onPreToolUse", function(context)
    -- Only check shell tools
    if context.toolName ~= "shell" and context.toolName ~= "execute" then
        return { action = "allow" }
    end

    -- Extract the command string
    local cmd = tostring(context.toolParams.command or context.toolParams.cmd or "")

    -- Check each rule
    for _, rule in ipairs(RULES) do
        if string.match(cmd, rule.pattern) then
            overlord.security.logEvent({
                type = "custom_guard",
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
```

**Pattern syntax:** These use **Lua patterns** (not regex). Key differences:
- `%s` matches whitespace (not `\s`)
- `%-` escapes a literal hyphen
- `.*` matches any characters (greedy)
- `%d` matches digits

---

## Part 3: Post-Tool-Use Inspection

Scan tool output for sensitive data after execution.

```lua
local SECRET_PATTERNS = {
    { pattern = "sk_live_[a-zA-Z0-9]",   name = "Stripe Secret Key" },
    { pattern = "ghp_[a-zA-Z0-9]",       name = "GitHub Token" },
    { pattern = "AKIA[0-9A-Z]",          name = "AWS Access Key" },
    { pattern = "-----BEGIN.*PRIVATE KEY", name = "Private Key" },
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
                message = secret.name .. " detected in tool output"
            })
            return {
                action = "warn",
                message = secret.name .. " detected in output — review before sharing"
            }
        end
    end

    return { action = "allow" }
end)
```

### PostToolUseHookData fields

| Field | Type | Description |
|-------|------|-------------|
| `toolName` | `string` | Name of the tool that ran |
| `toolParams` | `table` | Parameters passed to the tool |
| `agentId` | `string` | Agent that invoked the tool |
| `roomId` | `string` | Room where execution happened |
| `result` | `any` | The tool's return value |
| `success` | `boolean` | Whether the tool succeeded |

---

## Part 4: Code Vulnerability Scanning

Scan code being written for common vulnerabilities.

```lua
local CODE_RULES = {
    -- SQL injection
    { pattern = "SELECT.*%+%s*req%.",
      action = "warn",
      message = "SQL concatenation with user input — use parameterized queries" },

    -- XSS
    { pattern = "innerHTML%s*=%s*.*%$",
      action = "warn",
      message = "innerHTML with interpolation enables XSS" },

    -- Hardcoded credentials
    { pattern = "AKIA[0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z]",
      action = "block",
      message = "AWS Access Key ID detected — never commit credentials" },
}

registerHook("onPreToolUse", function(context)
    -- Only check file-writing tools
    if context.toolName ~= "write_file" and context.toolName ~= "patch_file" then
        return { action = "allow" }
    end

    local content = tostring(context.toolParams.content or context.toolParams.patch or "")

    for _, rule in ipairs(CODE_RULES) do
        if string.match(content, rule.pattern) then
            overlord.security.logEvent({
                type = "code_scanner",
                action = rule.action,
                toolName = context.toolName,
                message = rule.message,
                file = tostring(context.toolParams.path or "unknown")
            })
            return { action = rule.action, message = rule.message }
        end
    end

    return { action = "allow" }
end)
```

---

## Part 5: Using the Security Utility Functions

The `overlord.security` namespace provides helper functions for pattern matching that use JavaScript regex (more powerful than Lua patterns) with built-in ReDoS protection.

### matchPattern — Single pattern test

```lua
registerHook("onPreToolUse", function(context)
    if context.toolName ~= "shell" then
        return { action = "allow" }
    end

    local cmd = tostring(context.toolParams.command or "")

    -- JavaScript regex (not Lua patterns)
    if overlord.security.matchPattern(cmd, "curl.*\\|.*bash") then
        return { action = "block", message = "Piping curl to bash blocked" }
    end

    return { action = "allow" }
end)
```

### matchAny — Multiple pattern test

```lua
local DANGEROUS = {
    "rm\\s+-rf\\s+/",
    "mkfs\\.",
    "dd\\s+if=",
    ":\\(\\)\\{.*\\|.*&\\}",
}

registerHook("onPreToolUse", function(context)
    if context.toolName ~= "shell" then return { action = "allow" } end

    local cmd = tostring(context.toolParams.command or "")
    local match = overlord.security.matchAny(cmd, DANGEROUS)

    if match then
        overlord.security.logEvent({
            type = "danger_scan",
            action = "block",
            message = "Matched dangerous pattern: " .. match,
            toolName = context.toolName
        })
        return { action = "block", message = "Dangerous command pattern detected" }
    end

    return { action = "allow" }
end)
```

### redact — Sanitize output

```lua
registerHook("onPostToolUse", function(context)
    local output = tostring(context.result or "")

    local redacted = overlord.security.redact(output, {
        "sk_live_[a-zA-Z0-9]+",
        "sk_test_[a-zA-Z0-9]+",
        "ghp_[a-zA-Z0-9]+",
        "AKIA[0-9A-Z]+"
    })

    if redacted ~= output then
        overlord.security.logEvent({
            type = "secret_redaction",
            action = "warn",
            message = "Secrets redacted from tool output",
            toolName = context.toolName
        })
        return { action = "warn", message = "Sensitive data was detected and redacted" }
    end

    return { action = "allow" }
end)
```

**Pattern safety:** All patterns passed to `matchPattern`, `matchAny`, and `redact` are:
- Limited to 200 characters
- Checked for ReDoS-prone constructs (nested quantifiers)
- Compiled with case-insensitive flag by default

Invalid patterns silently return `false`/`nil` — they never throw.

---

## Part 6: Querying Security History

Build a plugin that reacts to patterns in security events.

```lua
registerHook("onPreToolUse", function(context)
    -- Check if this agent has been blocked recently
    local recentBlocks = overlord.security.getEvents({
        action = "block",
        limit = 5
    })

    local agentBlocks = 0
    for _, event in ipairs(recentBlocks) do
        if event.agentId == context.agentId then
            agentBlocks = agentBlocks + 1
        end
    end

    -- If agent has 3+ recent blocks, escalate all actions to block
    if agentBlocks >= 3 then
        overlord.security.logEvent({
            type = "escalation",
            action = "block",
            agentId = context.agentId or "",
            message = "Agent has " .. agentBlocks .. " recent blocks — escalating to full block"
        })
        return { action = "block", message = "Agent temporarily restricted due to repeated violations" }
    end

    return { action = "allow" }
end)

-- Report stats on load
registerHook("onLoad", function()
    local stats = overlord.security.getStats()
    if stats then
        overlord.log.info("Security stats on load", {
            total = stats.total,
            blocked = stats.blocked,
            warned = stats.warned,
            allowed = stats.allowed
        })
    end
end)
```

---

## Part 7: Combining Pre and Post Hooks

A complete security plugin often uses both hooks:

```lua
-- Pre-hook: validate before execution
registerHook("onPreToolUse", function(context)
    -- Block dangerous commands
    if context.toolName == "shell" then
        local cmd = tostring(context.toolParams.command or "")
        if string.match(cmd, "rm%s+%-rf%s+/") then
            overlord.security.logEvent({
                type = "full_guard",
                action = "block",
                toolName = "shell",
                message = "Recursive root delete blocked"
            })
            return { action = "block", message = "Cannot delete root filesystem" }
        end
    end
    return { action = "allow" }
end)

-- Post-hook: audit after execution
registerHook("onPostToolUse", function(context)
    -- Log all tool executions for audit trail
    if context.success then
        overlord.security.logEvent({
            type = "audit_trail",
            action = "allow",
            toolName = context.toolName or "",
            agentId = context.agentId or "",
            roomId = context.roomId or "",
            message = "Tool executed successfully: " .. (context.toolName or "unknown")
        })
    else
        overlord.security.logEvent({
            type = "audit_trail",
            action = "warn",
            toolName = context.toolName or "",
            agentId = context.agentId or "",
            message = "Tool execution failed: " .. (context.toolName or "unknown")
        })
    end
    return { action = "allow" }
end)

overlord.log.info("Full guard + audit trail plugin loaded")
```

---

## Built-In Security Plugins

Overlord ships with three security plugins in `plugins/built-in/`:

| Plugin | Hook | Purpose |
|--------|------|---------|
| `shell-guard` | `onPreToolUse` | Blocks dangerous shell commands (rm -rf, curl\|bash, force push, DROP TABLE) |
| `code-scanner` | `onPreToolUse` | Scans code for SQL injection, XSS, hardcoded secrets |
| `secret-guard` | `onPostToolUse` | Detects leaked secrets in tool output (API keys, tokens, private keys) |

These serve as reference implementations. Study their source at `plugins/built-in/*/main.lua`.

---

## Next Steps

- [API Reference](./api-reference.md) — Complete `overlord.security.*` documentation
- [Code Examples](./examples.md) — More security plugin patterns
- [Plugin Developer Guide](./developer-guide.md) — Testing and deployment
