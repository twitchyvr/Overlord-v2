# Philosophy

## Core Principle

> **Don't change the agent — change the framework.**

In v1, agent behavior was defined by bloated system prompts (200+ lines each). Changing how testing worked meant editing every test-related agent. In v2, **rooms** define behavior. When an agent enters a room, the room's rules, tools, and output templates merge into their context. Change the Testing Lab rules once — every agent that enters inherits them.

## Design Pillars

### 1. Structural Enforcement Over Instructional
If a tool isn't in a room's allowed list, it **doesn't exist** for agents in that room. This is binary access — no confidence scores, no tier registries, no escalation chains, no "pretty please don't use this." The Testing Lab literally cannot write files because `write_file` is not in its tools array.

### 2. Evidence-Based, Not Trust-Based
Exit Documents require concrete deliverables, not "Done!" assertions. Phase Gates require structured evidence with citations. The Review Room demands `file:line` references in assessments. RAID entries require rationale for every decision.

### 3. Framework-Centric Architecture
- **Agent = Who** (name, role, capabilities, badge)
- **Room = What they can do** (tools, file scope, rules, exit template)
- **Table = How they work** (focus/solo, collab/pair, boardroom/team)
- **Phase Gate = When they can advance** (GO/NO-GO with evidence)

### 4. Containment Over Coordination
v1 had 137 socket handlers and 48 modules communicating freely. v2 uses strict layer ordering with a thin event bus. Each layer only depends on layers below it. No circular dependencies. No spaghetti.

## Lessons from v1

| v1 Problem | v2 Solution |
|------------|-------------|
| 2300-line hub.js | 40-line event bus |
| 200-line agent system prompts | 10-line identity cards |
| 4-tier approval system | Structural tool access (binary) |
| 137 socket handlers | Domain-organized events |
| Monolithic module coupling | Strict layer ordering |
| Trust-based "don't use this tool" | Tool not in room = doesn't exist |
| No project context persistence | RAID Log (searchable decision database) |
| No phase discipline | Phase Gates with evidence requirements |
| Provider-specific code everywhere | Adapter pattern (quirks contained in adapter) |

## v1 Audit Summary

The v1 codebase contained:
- **48 modules** in a flat structure
- **137 socket event handlers** in a single hub.js
- **42 tools** with a 4-tier approval system
- **~15,000 lines** of JavaScript
- No TypeScript, no schema validation, no layer boundaries
