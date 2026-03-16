# Multi-Repo Support

## Overview

Overlord v2 allows linking multiple GitHub repositories to a building (project). This enables agents to understand the broader codebase context, track where files originated, and make informed decisions about cross-repo dependencies.

**Epic:** [#605](https://github.com/twitchyvr/Overlord-v2/issues/605)

## Architecture

### Data Model

Two tables support multi-repo:

- **`project_repos`** — Links repos to buildings with relationship types and sync metadata
- **`repo_file_origins`** — Tracks which local files were copied from linked repos

See [[Database Schema]] for full column details.

### Relationship Types

| Type | Meaning | Example |
|------|---------|---------|
| `main` | The primary repo being built | The project's own GitHub repo |
| `dependency` | A library or service this project depends on | A shared utilities package |
| `fork` | A forked version of another repo | A customized open-source library |
| `reference` | Used for reference/inspiration only | A similar project for patterns |
| `submodule` | A git submodule within the project | An embedded third-party module |

### Agent Context Injection

When an agent processes a chat message, the chat orchestrator:

1. Queries `project_repos` for all repos linked to the building
2. Queries `repo_file_origins` (capped at 100 entries) for file provenance
3. Injects a **"Repository Context"** section into the agent's system prompt:
   - Lists each repo with name, relationship, URL, local path, and branch
   - Shows file origins with source repo, source path, and local modification status
4. Passes `repoContext` to `ToolContext` so tools can check file provenance

### AI Analysis

The `repo:analyze` socket event triggers AI analysis of linked repos:

1. Fetches repo metadata via GitHub CLI (`gh repo view`) using async `execFile` (no shell — prevents injection)
2. Sends metadata + project context to the AI provider
3. Returns suggestions with relationship types, tech stacks, key files, and recommended actions
4. UI renders suggestion cards with override dropdowns for manual relationship adjustment

## Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `repo:add` | Client -> Server | Link a repo to a building |
| `repo:remove` | Client -> Server | Unlink a repo |
| `repo:list` | Client -> Server | List linked repos |
| `repo:update` | Client -> Server | Update repo settings |
| `repo:analyze` | Client -> Server | AI analysis of repos |

All events use Zod schema validation. URLs must use HTTPS protocol.

See [[Socket Events]] for full event signatures.

## UI Integration

### Project Creation Wizard (Strategist View)

During the "Configure" step of project creation:
- URL input field with protocol validation (HTTP/HTTPS only)
- Relationship dropdown (main, dependency, fork, reference, submodule)
- Pending repos list with remove capability
- "Analyze with AI" button for relationship suggestions
- AI analysis results rendered as cards with override dropdowns

### Settings Panel (Folders Tab)

The Folders tab in Settings shows:
- "Linked Repositories" section listing all repos for the current building
- Each repo shows name, relationship badge, URL, and remove button
- Remove buttons are disabled on click to prevent double-fire

## Security

- **URL validation**: Both client-side (protocol check) and server-side (Zod `.url().refine()`) enforce HTTPS
- **Shell injection prevention**: GitHub CLI calls use `execFile` (no shell), not `execSync`
- **DB queries**: All parameterized with `?` placeholders
- **Relationship validation**: DB values validated against allowed set before injection into agent prompts
- **File origins cap**: Limited to 100 entries per building to prevent prompt size explosion

## Implementation Phases

| Phase | Issue | PR | Status |
|-------|-------|----|--------|
| 1. Data model + socket events | #638 | #639 | Merged |
| 2. UI picker in creation wizard | #640 | #641 | Merged |
| 3. AI analysis service | #642 | #643 | Merged |
| 4. Agent context injection | #644 | #645 | Merged |
| 5. Sync & upstream tracking | — | — | Planned |
