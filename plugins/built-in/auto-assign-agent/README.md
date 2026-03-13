# Auto-Assign Agent

**Category:** Agent Enhancement
**Version:** 1.0.0

## What It Does

This plugin watches every time an agent enters a room and asks: "Is this the best agent for the job?" Over time, it learns which agents work best in which types of rooms by tracking an "affinity score" -- a simple number that goes up each time an agent successfully works in a room type.

When a room needs an agent, Auto-Assign checks if there is a better-suited agent available. If it finds one with a higher score, it sends out a suggestion so the system (or a human) can decide whether to swap agents.

Think of it like a manager who remembers that Sarah is great at code reviews and Tom excels at architecture work, and gently nudges the right person toward the right task.

## How It Works

1. **Agent enters a room** -- the plugin bumps that agent's affinity score for this room type.
2. **Plugin checks** -- are there any idle agents with a higher score for this room type?
3. **If yes** -- the plugin emits a suggestion event with the recommended agent.
4. **Over time** -- scores for unused agents slowly decay so the system stays current.

## Configuration

You can customize the plugin's behavior by setting these values in the plugin's storage:

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `config:auto_assign_enabled` | `true` | Turn the whole plugin on or off |
| `config:score_increment` | `10` | How many points an agent gains each time they enter a room |
| `config:score_decrement` | `3` | How much other agents' scores decay when they are not used |
| `config:min_score_threshold` | `0` | Minimum score an agent needs before being considered a candidate |

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `plugin:auto-assign:suggestion` | A better agent is found for a room | Room ID, current agent, suggested agent, both scores, reason |

## Permissions Required

- `room:read` -- to look up room details and types
- `agent:read` -- to list available agents and their status
- `storage:read` -- to read affinity scores and configuration
- `storage:write` -- to update affinity scores
- `bus:emit` -- to send suggestion events

## Example Scenario

1. Agent "Backend Lead" enters a `code-lab` room for the fifth time. Their affinity score for `code-lab` is now 50.
2. Agent "QA Lead" enters the same `code-lab` room. Their score is only 10.
3. The plugin notices that "Backend Lead" (score 50) is idle and better suited, so it emits a suggestion event recommending the swap.
4. The orchestrator or user can act on the suggestion or ignore it.
