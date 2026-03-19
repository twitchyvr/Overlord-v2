# Code Scanner

A security plugin that scans code being written by agents for common vulnerabilities before the file is saved.

## What It Does

Code Scanner uses the `onPreToolUse` hook to inspect the content of `write_file` and `patch_file` tool calls. It checks for dangerous code patterns that could introduce security vulnerabilities.

### Detected Patterns

- **SQL injection**: String concatenation with `req.` in SQL queries
- **XSS**: `innerHTML` with interpolation, `dangerouslySetInnerHTML`
- **Hardcoded secrets**: AWS access keys (AKIA pattern)
- **Code injection**: `new Function()` constructor

### Behavior

Most patterns trigger a warning. AWS access keys trigger a block.

## Permissions Required

- `security:read` / `security:write` — Security event logging
- `storage:read` / `storage:write` — Plugin state persistence
