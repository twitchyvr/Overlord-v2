# Changelog

All notable changes to Overlord v2 are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- **Multi-repo support (Epic #605)** — Link multiple GitHub repositories as building blocks during project creation:
  - **Phase 1: Data model + socket events** — `project_repos` and `repo_file_origins` tables with 5 relationship types (main, dependency, fork, reference, submodule); `repo:add`, `repo:remove`, `repo:list`, `repo:update` socket events with Zod validation (#638, PR #639)
  - **Phase 2: UI picker** — repo URL input with protocol validation in project creation wizard; relationship dropdown; pending repo list with remove; linked repos display in Settings Folders tab (#640, PR #641)
  - **Phase 3: AI analysis** — `repo:analyze` socket event calls AI to analyze repo relationships; renders suggestion cards with tech stack, key files, and override dropdowns; async `execFile` for shell-injection-safe GitHub CLI calls (#642, PR #643)
  - **Phase 4: Agent context injection** — agents receive "Repository Context" section in system prompt listing linked repos + file origins; `ToolContext` extended with `repoContext` for file-aware tools; DB relationship validation; file origins capped at 100 with truncation warning (#644, PR #645)
  - **Phase 5: Sync status detection** — `repo:sync-status` and `repo:sync-fetch` socket events check upstream commits via `gh api`; Settings UI shows per-repo sync badges (synced/behind/error), commit counts, timestamps, and individual Fetch buttons; bounded concurrency, regex-validated API paths (#649, PR #650)
- **Playwright screenshot + E2E tools** — real headless browser screenshots via Playwright (1280x720 PNG); dedicated `screenshot` tool for room access; `e2e_test` auto-detects Playwright/Cypress/Jest/Vitest; both tools added to Testing Lab and Code Lab rooms; URL validation on all browser commands; graceful curl fallback (#655, PR #656)
- **AI screenshot analysis** — `analyze_screenshot` tool reads PNG/JPG files and sends to MiniMax Coding Plan VLM API (`/v1/coding_plan/vlm`) for structured visual analysis (UI elements, issues, description); works with MiniMax API key only — no Anthropic/OpenAI required; 7.5MB file size pre-check; 30s timeout (#657)
- **Sidebar persistence** — sidebar collapsed state persists to localStorage across sessions (#636)
- **GNAP (Git-Native Agent Protocol) messaging** — dual-mode agent messaging with `MessagingPort` interface, bus adapter (real-time ephemeral) and GNAP adapter (git-backed persistent). Messages stored as JSON files in `.gnap/messages/` for full git audit trail. Dual-mode router sends via bus for latency + GNAP for durability. Settings UI toggle, GNAP status/test endpoints. Based on [GNAP](https://github.com/farol-team/gnap) by [Farol Labs](https://github.com/farol-team) — MIT License, Copyright 2026 Farol Labs. (#277, #372, #600)
- **Lua Scripting Platform** — in-browser code editor (IDE) with syntax highlighting, API reference sidebar, live console, save+hot-reload, validate, fork built-in scripts, create from 6 templates, import/export as `.overlord-script` bundles, drag-and-drop import with permission review, marketplace foundation with 26 built-in scripts (#476, #477, #478, #403, #404, #405, #406, PR #485, PR #490)
- **Scriptable Core Components** — `queryHook()` delegation pattern: Lua plugins can override phase gate decisions, exit document validation, agent assignment. 6 new hook types. TypeScript provides fallback when no script overrides (#478, PR #485)
- **Native Desktop & Mobile Templates** — 4 new Strategist templates: `desktop-app`, `tauri-app`, `mobile-app`, `macos-widget`. Stack selection rules prefer cross-platform and lighter frameworks (#486, PR #487)
- **4 New Room Types** — Research (requirements gathering), Documentation (user guides/API docs), Monitoring (observability/alerting), Security Review (vulnerability assessment/OWASP) (#440, #441, #442, #448, PR #490)
- **UI Overhauls** — Chat contextual suggestion pills, Task status progression bar + assignee display, Agent dashboard filter tabs + "Currently Working" section + sort dropdown, Activity feed filter pills + relative timestamps + event icons + load more (#481, #482, #483, #484, PR #490)
- **Progressive Web App (PWA)** — service worker with cache-first static/network-first API strategy, manifest.json, installable on desktop/mobile (#391, PR #490)
- **Tooltip & Jargon Glossary** — tooltip component with 21-term glossary translating technical terms to plain language for non-technical users (#426, PR #490)
- **Static Analysis Tools** — auto-detect project type (Node/Rust/Python/Go), run lint+typecheck, security scans, dependency audit, complexity metrics (#392, #393, PR #490)
- **Quality Defaults Config** — configurable quality gates: auto-lint, auto-typecheck, auto-test, auto-security-scan, min-coverage. Transport handlers for get/set (#398, PR #490)
- **Shell timeout increase** — default 120s to 300s, max output 500KB to 1MB for native build toolchains (#486, PR #487)
- **Smart Question Rules** — Discovery room uses assumption audit pattern instead of interrogating users; Architecture room plans native toolchain setup as first milestone (#389, #390, PR #490)
- **Auto-sign phase gates in EASY mode** — exit docs auto-submitted from AI prose trigger automatic GO verdict, enabling fully hands-off pipeline progression (#543, PR #544)
- **Code Lab quality pipeline enforcement** — agents forced to use tools (write_file, bash), run syntax/lint/test checks after writing code, iterate until clean (#548, #549, PR #550)
- **Dogfood-driven UX improvements** — unassigned agent guidance banner, task progress bar, email building filter, phase description tooltips, health score explanation, chat agent display, integration floor rooms (#505-#534, PR #533, #541, #542, #550)
- **One-shot project creation** — name extraction from description, prompt forwarding to chat, room mapping fixes (#517-#519, PR #533)
- **Context management and session notes** — token estimation, per-provider budget allocation, message pruning with anchor preservation, persistent agent scratchpad surviving context pruning (#385, PR #415)
- **Multi-folder permissions with git detection** — multi-folder workspace support, automatic git repo detection, per-folder settings UI (#410, #411, #412, PR #413)
- **Agent-to-agent interoffice email system** — agents can send structured messages to each other across rooms (#307)
- **File attachment and plan approval in chat** — attach files to chat messages, approve/reject agent plans inline (#306)
- **Agent stats tracking and enriched profiles** — activity log, task completion stats, performance metrics per agent (#305)
- **Gender-aware photo generation and nickname support** — MiniMax image generation respects agent gender, agents can have nicknames (#304)
- **Milestone tracking UI** — full CRUD for milestones with task assignment, progress bars, drawer detail views (#303)
- **Kanban board view** — drag-and-drop task status updates with swimlanes by phase (#301)
- **Conversation history persistence** — chat history persists across views, conversation switching and search (#293)
- **Settings AI tab with room-to-provider routing table** — configure which AI provider powers each room type (#290)
- **18 missing socket event handlers for real-time reactivity** — building, floor, room, table, agent, task, todo, RAID, milestone events (#291)
- **Loading spinners to task, activity, and RAID views** — visual feedback during data fetches (#282)
- **Floor count, agent count, and repo display on building cards** — richer dashboard cards (#280)
- **Room access badges and inline errors to assign agent modal** — shows which rooms an agent can access (#278)
- **Mobile bottom nav overflow menu** — access all views on mobile (#285)
- **Tablet sidebar hamburger toggle** — collapsible sidebar on tablet breakpoints (#286)
- **Agent status changes in Activity feed** — Agents tab in activity view shows real-time status updates (#287)

### Fixed (Dogfooding Session — Gardenly, March 2026)
- **CRITICAL: Project isolation** — Socket.IO events leaked between buildings; now scoped to building rooms via `io.to()` (#593)
- **Strategist can't read files** — added `read_file` and `search_files` to Strategist tool set (#587)
- **Agent timeout streaming** — tool execution progress now streamed to frontend ("Using read_file...") (#591)
- **Agent task drift** — strengthened Code Lab focus rules to follow only current message (#592)
- **Chat suggestion overlap** — hide suggestion pills while agent is actively streaming (#553)
- **Drawer dismiss broken** — mount drawer on document.body to escape stacking context; z-index 3000 (#552)
- **Code Lab write access** — verified working directory flows through to all file/shell tools (#590)
- **Chat suggestion auto-send** — suggestion pills now send immediately instead of just filling input (#564)

### Fixed
- **Room name truncation** — room names in sidebar truncated with tooltip and abbreviation for long names (#469, PR #469)
- **Chat empty state** — shows welcome message on initial mount instead of blank panel (#470, PR #473)
- **Kanban empty state guard** — prevents crash when kanban view has no data (#474, PR #474)
- **Socket reconnection view reset** — active view no longer resets to Dashboard on socket reconnect (#465, PR #471)
- **Raw UUIDs on task cards** — human-readable short IDs shown instead of UUIDs (#466, PR #472)
- **Loading spinner without building** — Tasks and Activity views show empty state instead of infinite spinner when no building selected (#467, PR #488)
- **Drawer close navigation** — closing detail drawer no longer navigates away from current view (#468, PR #488)
- **RAID Log raw errors and room IDs** — RAID queries now JOIN rooms table for human-readable names; error messages rewritten for non-technical users (#420, PR #433)
- **Raw UUIDs exposed across all views** — agent cards, detail drawers, phase gates, and table modals now show human-friendly labels instead of internal IDs (#421, PR #434)
- **Timestamps show only bare time** — all 18 formatTime() call sites now show contextual relative dates: "Just now", "3h ago", "Yesterday, 2:30 PM", "Mar 10, 2:30 PM" (#422, PR #435)
- **Task sorting improved** — sort by priority then status (active/blocked first), then newest; confirmation dialogs added for tool removal, task unassignment, and todo deletion (#423, #424, PR #436)
- **Missing favicon** — added SVG favicon and link tag, eliminates 404 on every page load (#427, PR #437)
- **Foundation floor display** — now has tooltip and icon for non-technical users (#428, PR #437)
- **RAID severity indicators** — auto-derived severity badges on RAID cards: risks=high, issues=medium, assumptions=low, decisions=info (#429, PR #437)
- **Dashboard KPI agent count always 0** — agents now fetched eagerly on mount with building-level aggregation fallback (#418, PR #430)
- **Chat defaults to Strategist Office** — auto-connects to a room on the floor matching the current phase instead of first-created room (#419, PR #431)
- **Chat room routing on room switch** — chat messages now route to the correct room when switching between rooms (PR #414)
- **Token-input history test timeout** — resolved jsdom getComputedStyle bottleneck in 50-entry history test (PR #416)
- **Systemic socket timeout protection** — all 40+ socket.emit methods now use `_emitWithTimeout` with 15s default; prevents stuck spinners and hanging promises on server disconnect (#341)
- **Agent Mail loading spinner stuck forever** — `_fetchData` now handles fetch failure and late agent hydration (#331, PR #332)
- **90 test failures across 10 test files** — DB schema counts, missing agent profile columns, config default, transport schema evolution, socket handler disconnect behavior, UI view CSS selectors and store subscriptions (#329, PR #330)
- **11 UI modal/form/toast bugs** — invalid modal sizes, misused Toast API, missing try/catch on async socket calls, shared modal IDs causing conflicts, missing null guards, silent error swallowing (#327, PR #328)
- **7 transport-layer data integrity bugs** — RAID duplicate entries, scope-change store corruption, duplicate forward, exit-doc JSON parsing, gate signoff data shape, RAID edit broadcast, drawer onClose (#323, PR #324)
- **14 bugs from system code reviews** — phase gate, RAID log, and exit document systems hardened (#316, #317, #318, PR #319)
- **7 room entry/exit validation bugs** — governance bypass, data-exchange JSON parse, room type enforcement (#320, #321, PR #322)
- **3 critical phase gate signoff bugs** — broken gate flow, missing phase advancement, stale gate detection (#315)
- **Milestone delete transaction safety** — wrap delete in transaction, refresh open drawer on CRUD (#313)
- **Stats hooks, kanban drag-click, agent gender persistence** — wire broken hooks, fix accidental navigation on drag (#311)
- **Sidebar floor name truncation** — long floor names no longer overflow (#302)
- **Agent profile context** — software engineering context added to AI profile generation prompt (#292)
- **Chat scroll position preservation** — new messages no longer jump scroll to top (#289)
- **Duplicate stream messages** — streaming element removed before store re-render (#295)
- **Conversation schema validation** — hardened transport validation for chat messages (#296)
- **Dashboard KPIs** — now show building-specific agent and RAID counts (#284)
- **Table ID resolution** — task view shows human-readable table names instead of IDs (#281)
- **JSON exit documents** — rendered as formatted code blocks in chat (#279)
- **Exit doc form structured fields** — missing field detection for structured exit documents (#276)
- **Room modal content refresh** — re-renders when already open (#274)
- **Sidebar phase badge update** — merge partial building:updated data to preserve state (#270)
- **Checklist null handling** — Add button sends null instead of undefined for optional fields (#268)
- **View scroll height and toast z-index** — agents view scroll, toast overlay ordering (#261)
- **Chat building hydration** — chat history persists across views, sidebar updates on phase advance (#259)
- **Dashboard hydration race condition** — buildings now show on initial load (#246)

### Changed
- **Consolidated all view CSS into external stylesheet** — removed inline styles from view JS files (#288)
- **Removed dead panel files from v1 sidebar system** — cleanup of unused code (#283)

---

## [0.9.0] - 2026-03-10

### Added
- **StatusOwl dogfood setup script** — `scripts/setup-statusowl.mjs` provisions a full building with 8 rooms, 10 tables, 6 agents, 18 tasks, todos, RAID entries, and table context (#232)
- **Playwright E2E test suite** — browser automation tests for core UI workflows (#232)
- **Todo management UI** — full CRUD, agent assignment, progress tracking for per-task checklists (#231)
- **Fleet coordination** — shared table context, work division, and team coordination views (#230, #224)
- **Task assignment UI** — assign tasks to tables, drag-to-assign, task detail drawer (#229)
- **Agent profile views and room config UI** — profile cards, room tool configuration, provider assignment (#229)
- **AI profile generation** — MiniMax image service generates agent headshots, Anthropic generates bios (#228)
- **Agent profiles schema** — first/last name, bio, photo_url, specialization fields on agents (#227)
- **Full-page views with contextual drawer** — replaced panel system with full-page views and slide-in drawer (#209)
- **Cross-panel entity navigation** — click an agent/room/task anywhere to navigate to its detail view (#207)
- **Agent room assignments and quick-assign** — agents panel shows current room, quick-assign for unassigned (#205)
- **Interactive room management** — add rooms, assign agents, create tables from the UI (#203)

### Changed
- **MiniMax as primary AI provider** — switched default from Anthropic to MiniMax for cost optimization (#233)

---

## [0.8.0] - 2026-03-04

### Added
- **Theme toggle** — dark/light mode with localStorage persistence (#98)
- **Structured client-side logger** — replaces raw console calls with leveled logger (#104)
- **ARIA attributes on interactive elements** — accessibility improvements (#105)
- **System log broadcasting** — server logs stream to frontend logs panel (#81)
- **RAID entry editing** — field-level updates for RAID entries (#77)
- **Chat token fuzzy matching** — debouncing and caching for @mention autocomplete (#78)
- **Enhanced room view** — agent roster, stats bar, activity feed per room (#91)
- **Security Badge system** — role-based access control for agents (#188)
- **MCP protocol integration** — JSON-RPC client and server manager (#190)
- **Lua scripting runtime** — wasmoon sandbox for plugin scripting (#193)
- **Enhanced building dashboard** — room cards with status badges, agent counts, activity (#195)
- **Citation tracking** — cross-room citation recording in reference resolution pipeline (#197)

### Fixed
- **Zod schema validation on all socket handlers** — runtime type safety for all 98 handlers (#106, #112, #113)
- **Disconnect handler cleanup** — socket state properly cleaned on disconnect (#110)
- **Tool existence validation** — conversation loop validates tool exists before execution (#111)
- **AI timeout configuration** — provider adapters respect configurable timeouts (#114)
- **Path traversal protection** — filesystem tools prevent directory escape (#120)
- **Command injection prevention** — shell tool registry blocks injection (#121)
- **JSON.parse guards** — agent-registry and room-manager handle corrupted data (#122)
- **SSRF protection** — web tools validate URLs and enforce bounds (#129)
- **Toast notification overflow** — capped queue prevents UI overflow (#100)
- **Dropdown keyboard navigation** — accessible keyboard nav for dropdowns (#99)
- **LogsPanel DOM thrashing** — debounced rendering prevents performance issues (#185)

### Changed
- **Extracted handle() utility** — reduced duplication in socket handler registration (#113)

---

## [0.7.0] - 2026-02-25

### Added
- **Chat orchestrator** — `chat:message` -> AI -> `chat:response` pipeline with streaming (#155)
- **Building onboarding** — auto-provisions Strategist agent and rooms on building creation (#155)
- **RAID log creation form** — UI for adding RAID entries (#161)
- **Exit document forms** — structured exit doc creation with field validation (#165)
- **Settings modal** — General/AI/Tools/Display configuration (#165)
- **Agent creation UI** — create agents from the frontend (#168)
- **Integration Floor tool providers** — data-exchange, provider-hub, plugin-bay tools (#176)
- **War Room auto-creation** — escalation handler creates war rooms on critical errors (#178)
- **Phase gate signoff enforcement** — condition tracking and stale gate detection (#62)
- **Task and RAID log views** — full CRUD workflows for tasks and RAID entries (#63)
- **Navigation toolbar** — view routing with connection indicator (#68)
- **Tasks right-sidebar panel** — status counts and sorted task list (#70)
- **Reconnection handling** — socket reconnection with operation error feedback (#71)
- **Todo broadcast handlers** — real-time todo synchronization (#83)

### Fixed
- **Streaming translation** — chat streaming events properly translated for frontend (#157)
- **Phase gate chicken-and-egg** — resolved circular dependency in phase advancement (#159)
- **Duplicate user messages** — prevented double-send and fixed role field (#163)
- **58 failing tests** — boot and socket-bridge test mocks updated (#174)
- **Room-manager error envelopes** — all DB operations wrapped in try/catch with Result pattern (#69)
- **Building view agent dots** — optimized with partial DOM patching (#80)
- **15 missing CSS class definitions** — found by automated audit (#82)
- **Validation and error handling** — Task and RAID create forms validate input (#84)

---

## [0.6.0] - 2026-02-20 (tag: `v0.6.0-phase-6-ui`)

### Added
- **Building-themed frontend** — full UI layer with engine, store, router, socket bridge, components, panels, and views (#34)
- **Phase 7: Plugin system** — plugin loader, sandbox, command parser, Integration Floor, Docker support (#38)
- **Frontend panels and views** — projects, tools, logs, team panels wired to live socket events (#42, #51)
- **API documentation** — comprehensive docs for socket events, commands, tools, plugins, and configuration (#46)

### Fixed
- **18 integration bugs** — UI-to-backend boundary issues resolved (#36)
- **51 missing CSS rules** — component class names added to stylesheet (#37)
- **Server init and socket handlers** — agent building_id FK, atomic updates (#44)
- **MiniMax thinking blocks** — normalize so content[0].type is always 'text' (#50)
- **Socket event wiring** — complete wiring between frontend and backend (#59)

---

## [0.5.0] - 2026-02-15

### Added
- **Phase 5: Phase Zero** — Strategist and Building Architect rooms with consultative workflows (#31)
- **Scope Change protocol** — detect and handle mid-project scope changes (#29)
- **Phase 4: Spatial model** — Building/Floor/Room/Table/Chair hierarchy (#29)
- **Phase 3: AI adapters** — real Anthropic, MiniMax, OpenAI, Ollama adapters with tool execution (#13)
- **Phase 2: Room behavioral logic** — rooms as active participants with lifecycle hooks (#27, #61)
- **Phase 1: TypeScript types** — full type coverage across codebase (#12)

### Fixed
- **Phase 5 audit** — 4 critical + 3 high-priority bugs with 31 new tests (#33)
- **Phase 4 gaps** — room unit tests, RAID-gate integration, lifecycle flow (#25)
- **Phase 3 gaps** — session persistence, real tools, adapter tests (#23)
- **Phase 2 gaps** — exit doc enforcement, table capacity, room registration (#21)
- **Phase 1 gaps** — config tests, db tests, bus namespace fix (#19)

---

## [0.1.0] - 2026-02-10

### Added
- Initial project structure
- TypeScript strict mode with Zod validation
- SQLite database via better-sqlite3
- Core event bus (EventEmitter3)
- Pino structured logging
- Result pattern (`ok`/`err`) for error handling
- Dev container configuration
- ESLint configuration
