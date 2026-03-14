# Auto Phase Advance

Automatically moves your project to the next phase when all the required work in the current room is done.

## What It Does

In Overlord, work moves through a series of rooms -- each room represents a phase (like Discovery, Architecture, Coding, etc.). Normally, someone has to manually decide "this phase is done, let's move on." This plugin watches for that moment automatically.

Every time a tool finishes running inside a room, this plugin checks: "Have all the exit requirements for this room been met?" If the answer is yes, it sends a signal to advance to the next phase -- no manual intervention needed.

Think of it like a checklist that checks itself off. Once every box is ticked, the project moves forward on its own.

## How It Works

1. An agent runs a tool inside a room (for example, generating a document or running tests).
2. This plugin checks the room's exit criteria -- the list of things that must be done before leaving.
3. If everything is complete, it emits a `phase:advance-request` event.
4. The system picks up that event and advances the workflow.

If a room is re-entered later, the plugin resets and will re-evaluate from scratch.

## Configuration

You can adjust settings through the plugin's storage. These are the available options:

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `auto_advance_enabled` | `true` | Master switch to turn the plugin on or off. Set to `false` to pause automatic advancing. |
| `cooldown_seconds` | `10` | Minimum number of seconds between advance requests for the same room. Prevents duplicate signals if multiple tools finish in quick succession. |

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `phase:advance-request` | All exit criteria for a room are satisfied | `roomId`, `roomName`, `roomType`, `triggeredBy`, `timestamp` |

## Permissions Used

- **room:read** -- To check room details and exit criteria.
- **agent:read** -- To identify which agents are active in the room.
- **tool:execute** -- To hook into tool completion events.
- **storage:read / storage:write** -- To remember which rooms have been completed and to read configuration.
- **bus:emit** -- To send the phase advance request event.
