# Exit Doc Validator

Adds custom quality checks to exit documents, making sure they contain real substance before a phase can move forward.

## What It Does

When a phase of work finishes in Overlord, the agent produces an "exit document" -- a summary of what was accomplished, what decisions were made, and what comes next. Overlord already checks that the document has the right structure, but this plugin goes further. It checks the **quality** of the content:

- Are all the important sections actually filled in?
- Is the summary long enough to be meaningful (not just "done")?
- Does the document include evidence -- a link to a pull request, an issue number, a file path -- proving that work actually happened?
- Are room-specific requirements met (e.g., architecture documents include design decisions)?

If any check fails, the plugin raises a flag with specific details about what needs to be fixed. This prevents shallow, rubber-stamp exit documents from slipping through.

## How It Works

1. An agent submits an exit document via the exit document tool.
2. This plugin intercepts the submission and runs its validation rules.
3. If everything checks out, the document passes through normally.
4. If something is missing or too short, the plugin emits an `exitdoc:validation-failed` event listing every issue found.

The plugin does not block the submission outright -- it raises an event that other parts of the system (or other plugins) can act on, such as displaying a warning or preventing phase advancement.

## Configuration

Adjust these settings through plugin storage:

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| `validator_enabled` | `true` | Master switch to turn validation on or off. |
| `min_summary_length` | `50` | Minimum number of characters required in the "summary" field. Prevents one-word summaries. |
| `min_section_length` | `20` | Minimum number of characters for other required fields like "status" and "next_steps". |
| `require_evidence_links` | `true` | Whether the document must contain at least one URL, issue reference (like #123), or file path. |
| `extra_required_fields` | `["summary", "status", "next_steps"]` | The list of fields that must be present in every exit document. |
| `room_rules` | `{}` | Per-room-type overrides. Lets you set stricter (or looser) rules for specific room types. |

### Example: Stricter Rules for Architecture Rooms

Set `room_rules` to:
```
{
  "architecture": {
    "extra_required_fields": ["summary", "status", "next_steps", "diagrams", "decisions"],
    "min_summary_length": 100
  }
}
```

This means architecture exit documents need two extra sections ("diagrams" and "decisions") and a longer summary, while all other rooms use the defaults.

## Events Emitted

| Event | When | Key Payload Fields |
|-------|------|--------------------|
| `exitdoc:validation-failed` | An exit document does not meet the configured quality rules | `roomId`, `roomType`, `errors` (array of specific issues), `errorCount` |

## Permissions Used

- **room:read** -- To look up the room type for room-specific rules.
- **tool:execute** -- To hook into exit document tool submissions.
- **storage:read / storage:write** -- To read configuration and track validation statistics.
- **bus:emit** -- To send the validation-failed event.
