# Agent Mood System

**Category:** Agent Enhancement
**Version:** 1.0.0

## What It Does

This plugin gives your agents personality by tracking their "morale" -- a score from 0 to 100 that reflects how the project is going from their perspective. When things go well (tools execute successfully, phases advance), morale rises and agents feel happy. When things go wrong (tool failures), morale drops and agents feel stressed.

The mood system makes Overlord feel more alive. Agents are not just faceless workers -- they react to project progress with seven distinct mood states, from "ecstatic" to "frustrated." The UI can use these mood events to show visual indicators of agent sentiment.

## How It Works

**Morale goes up when:**
- An agent successfully uses a tool (+5 points, configurable)
- An agent is on a streak of consecutive successes (bonus points stack)
- A project phase advances (+15 points to ALL agents -- team celebration)
- An agent is assigned to a new room (+2 points -- feeling valued)

**Morale goes down when:**
- A tool execution fails (-8 points, configurable)
- A failure resets the agent's success streak back to zero
- Natural decay slowly pulls extreme moods back toward neutral over time

**Mood labels based on morale score:**

| Score Range | Mood |
|-------------|------|
| 90-100 | Ecstatic |
| 75-89 | Happy |
| 60-74 | Content |
| 45-59 | Neutral |
| 30-44 | Uneasy |
| 15-29 | Stressed |
| 0-14 | Frustrated |

## Configuration

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `config:base_morale` | `50` | Starting morale for new agents |
| `config:success_boost` | `5` | Morale gained per successful tool use |
| `config:failure_penalty` | `8` | Morale lost per tool failure |
| `config:phase_advance_boost` | `15` | Morale boost when a project phase advances |
| `config:streak_bonus_multiplier` | `1` | Extra points per consecutive success in a streak |
| `config:mood_decay_rate` | `1` | How fast extreme moods drift back toward neutral |

## Events Emitted

| Event | When | Data Included |
|-------|------|---------------|
| `plugin:mood-system:update` | Morale changes significantly or mood label changes | Agent ID, old/new morale, mood label, delta, reason, streak count |
| `plugin:mood-system:team-summary` | A phase advances (team-wide snapshot) | Trigger type, phase name, all agents with their morale and mood |

## Permissions Required

- `agent:read` -- to list agents for team-wide mood events
- `storage:read` -- to read morale scores and configuration
- `storage:write` -- to update morale scores and streaks
- `bus:emit` -- to send mood update and team summary events

## The Streak System

Consecutive successes build momentum. If an agent executes 5 tools in a row without a failure, each success is worth more than the last. This simulates the feeling of being "in the zone." A single failure resets the streak to zero, which makes the morale penalty feel more impactful -- reflecting the frustration of breaking a good run.

## Example

1. Agent "Code Lead" starts at morale 50 (neutral).
2. They execute 3 tools successfully: 50 -> 56 -> 63 -> 71. Mood shifts from "neutral" to "content."
3. A phase advances: 71 -> 86. Mood jumps to "happy."
4. A tool fails: 86 -> 78, streak resets. Still "happy" but dropping.
5. Two more successes: 78 -> 83 -> 89. Close to "ecstatic."
