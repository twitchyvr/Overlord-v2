# Room Types

## Overview

Room types are the building blocks of Overlord v2. Each room type defines a **static contract** that specifies allowed tools, file scope, exit requirements, escalation rules, and AI provider preference.

All room types extend `BaseRoom` (`src/rooms/room-types/base-room.ts`).

## Implemented Room Types

### Strategist Office
**Floor:** Strategy | **Type:** `strategist` | **Provider:** `smart`

Phase Zero room. The Strategist guides users through project setup via consultative questions.

| Property | Value |
|----------|-------|
| **Tables** | Consultation (2 chairs: Strategist + User) |
| **Tools** | `web_search`, `record_note`, `recall_notes`, `list_dir` |
| **File Scope** | `read-only` |
| **Exit Type** | `building-blueprint` |
| **Exit Fields** | projectGoals, successCriteria, floorsNeeded, roomConfig, agentRoster, estimatedPhases |

**Modes:**
- **Quick Start** — Accept suggested template
- **Advanced** — Drag-and-drop rooms into floors, custom agents

**Rules:**
1. Guide the user through project setup
2. Ask consultative questions: goals, success criteria, constraints
3. Suggest a building layout based on answers
4. Offer Quick Start or Advanced mode
5. Exit document configures the entire building

---

### Discovery Room
**Floor:** Collaboration | **Type:** `discovery` | **Provider:** `smart`

Phase 1 room. Define outcomes, constraints, unknowns. Read-only.

| Property | Value |
|----------|-------|
| **Tables** | Collab (4 chairs: PM + SMEs + User) |
| **Tools** | `read_file`, `list_dir`, `web_search`, `fetch_webpage`, `record_note`, `recall_notes` |
| **File Scope** | `read-only` |
| **Exit Type** | `requirements-document` |
| **Exit Fields** | businessOutcomes, constraints, unknowns, gapAnalysis, riskAssessment, acceptanceCriteria |
| **Escalation** | On complete → Architecture Room |

**Rules:**
1. Define what needs to be built — NO code changes
2. Research, analyze, document
3. Identify business outcomes, constraints, and unknowns
4. Produce a gap analysis between current and target state
5. All risks must include independent analysis and citations

---

### Architecture Room
**Floor:** Collaboration | **Type:** `architecture` | **Provider:** `smart`

Phase 2 room. Break requirements into milestones, tasks, dependency graph, tech decisions.

| Property | Value |
|----------|-------|
| **Tables** | Collab (4 chairs: Architect + PM) |
| **Tools** | `read_file`, `list_dir`, `web_search`, `fetch_webpage`, `record_note`, `recall_notes` |
| **File Scope** | `read-only` |
| **Exit Type** | `architecture-document` |
| **Exit Fields** | milestones, taskBreakdown, dependencyGraph, techDecisions, fileAssignments |
| **Escalation** | On complete → Code Lab, On scope change → Discovery |

**Rules:**
1. Design the implementation plan — NO code changes
2. Break requirements into milestones and tasks
3. Define dependency graph between tasks
4. Make and document tech decisions with rationale
5. Assign files to tasks for scoped execution

---

### Code Lab
**Floor:** Execution | **Type:** `code-lab` | **Provider:** `configurable`

Full implementation workspace with write access.

| Property | Value |
|----------|-------|
| **Tables** | Focus (1 chair), Collab (4 chairs), Boardroom (8 chairs) |
| **Tools** | `read_file`, `write_file`, `patch_file`, `list_dir`, `bash`, `web_search`, `fetch_webpage` |
| **File Scope** | `assigned` (task files only) |
| **Exit Type** | `implementation-report` |
| **Exit Fields** | filesModified, testsAdded, changesDescription, riskAssessment |
| **Escalation** | On error → War Room, On scope change → Discovery |

**Rules:**
1. Implement the assigned task
2. Only modify files within assigned scope
3. Write tests for any new functionality
4. If scope creep, escalate to Discovery Room
5. Exit document must list all modified files and tests added

---

### Testing Lab
**Floor:** Execution | **Type:** `testing-lab` | **Provider:** `cheap`

Test-only workspace. **Cannot modify source code** — `write_file` and `patch_file` are NOT in the tools list.

| Property | Value |
|----------|-------|
| **Tables** | Focus (1 chair), Collab (3 chairs) |
| **Tools** | `read_file`, `list_dir`, `bash`, `qa_run_tests`, `qa_check_lint`, `qa_check_types`, `qa_check_coverage`, `qa_audit_deps` |
| **File Scope** | `read-only` |
| **Exit Type** | `test-report` |
| **Exit Fields** | testsRun, testsPassed, testsFailed, coverage, lintErrors, recommendations |
| **Escalation** | On failure → Code Lab, On critical → War Room |

**Rules:**
1. You CANNOT modify source code
2. Run tests, analyze results, and report findings
3. If tests fail, document failures with file paths and line numbers
4. Do NOT attempt to fix code — escalate to Code Lab
5. Exit document must include concrete evidence

**Key invariant:** `TestingLab.hasTool('write_file') === false` — this is the structural enforcement test.

---

### Review Room
**Floor:** Governance | **Type:** `review` | **Provider:** `smart`

Go/no-go decisions. Risk questionnaire with independent analysis.

| Property | Value |
|----------|-------|
| **Tables** | Review (3 chairs: PM + Architect + Reviewer) |
| **Tools** | `read_file`, `list_dir`, `web_search`, `recall_notes`, `qa_run_tests`, `qa_check_lint` |
| **File Scope** | `read-only` |
| **Exit Type** | `gate-review` |
| **Exit Fields** | verdict, evidence, conditions, riskQuestionnaire |
| **Escalation** | On NO-GO → Code Lab, On critical → War Room |

**Gate Protocol:**
- Requires exit document
- Requires RAID entry
- Requires sign-off from architect and user

**Rules:**
1. Make a go/no-go decision — review ALL evidence
2. Do not rubber-stamp
3. Cite specific code (`file:line`) in assessments
4. Fill risk questionnaire with independent analysis
5. Verdict must be GO, NO-GO, or CONDITIONAL

---

### Deploy Room
**Floor:** Operations | **Type:** `deploy` | **Provider:** `configurable`

Git operations, CI/CD triggers, verification.

| Property | Value |
|----------|-------|
| **Tables** | Focus (1 chair) |
| **Tools** | `read_file`, `list_dir`, `bash`, `github`, `qa_run_tests` |
| **File Scope** | `read-only` |
| **Exit Type** | `deployment-report` |
| **Exit Fields** | environment, version, deployedAt, healthCheck, rollbackPlan |
| **Escalation** | On failure → War Room, On rollback → War Room |

**Rules:**
1. Execute the deployment plan
2. Verify Release Lounge sign-off before proceeding
3. Run health checks after deployment
4. Document rollback plan in exit document
5. If deployment fails, escalate to War Room immediately

---

### War Room
**Floor:** Collaboration | **Type:** `war-room` | **Provider:** `smart`

Incident response. All-hands troubleshooting. Elevated access. Time-boxed.

| Property | Value |
|----------|-------|
| **Tables** | Boardroom (8 chairs) |
| **Tools** | `read_file`, `write_file`, `patch_file`, `list_dir`, `bash`, `web_search`, `fetch_webpage`, `qa_run_tests`, `qa_check_lint`, `github` |
| **File Scope** | `full` (elevated access) |
| **Exit Type** | `incident-report` |
| **Exit Fields** | incidentSummary, rootCause, resolution, preventionPlan, timeToResolve |

**Rules:**
1. This is incident response — focus on resolving the incident
2. Not long-term fixes
3. Document root cause as you investigate
4. Time-boxed: escalate to user if not resolved quickly
5. Exit document must include prevention plan

## Creating Custom Room Types

See [[Plugin Development]] for creating custom room types via the plugin system.
