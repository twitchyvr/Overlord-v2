# Shell Guard

A security plugin that intercepts shell commands before execution and blocks or warns about dangerous operations.

## What It Does

Shell Guard uses the `onPreToolUse` hook to inspect every shell command before it runs. It checks the command against a library of dangerous patterns and either blocks the command entirely or issues a warning.

### Blocked Commands

Commands that are blocked will not execute. The agent receives an error message explaining why:

- `rm -rf /` or `rm -rf ~` (recursive delete at root/home)
- `curl ... | bash` or `wget ... | sh` (piping downloads to shell)
- `git push --force main` (force push to protected branches)
- `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE` (destructive SQL)
- `mkfs`, `sudo rm`, fork bombs

### Warned Commands

Commands that trigger warnings will still execute, but a security event is logged:

- `chmod 777` (world-writable permissions)
- `dd if=` (disk operations)
- `rm -rf .` (recursive delete in current directory)
- `shutdown` (system shutdown)
- `npm install --unsafe-perm`

## Permissions Required

- `security:read` — Read security state
- `security:write` — Log security events
- `storage:read` / `storage:write` — Plugin state persistence
