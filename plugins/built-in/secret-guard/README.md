# Secret Guard

A security plugin that monitors tool output for accidentally leaked secrets and credentials.

## What It Does

Secret Guard uses the `onPostToolUse` hook to scan the results of every tool call after execution. If the output contains patterns matching known secret formats, it emits a warning so the agent and user are alerted.

### Detected Secret Types

- Stripe keys (live and test)
- GitHub personal access tokens and OAuth tokens
- AWS access keys
- Private keys (PEM format)
- Slack bot and user tokens
- JWT tokens

### Behavior

All detections trigger a **warning** — the tool result is still returned to the agent, but a security event is logged and the user is notified. This allows agents to continue working while ensuring sensitive data exposure is visible.

## Permissions Required

- `security:read` — Read security state
- `security:write` — Log security events
- `storage:read` / `storage:write` — Plugin state persistence
