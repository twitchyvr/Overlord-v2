/**
 * Transport Layer — Zod Schemas
 *
 * Defines validation schemas for all socket event payloads.
 * Used by socket-handler.ts to validate incoming data before processing.
 */

import { z } from 'zod';

// ─── Field Length Limits ───

/** Max length for identifier fields (IDs, keys) */
const MAX_ID = 100;
/** Max length for short text fields (names, titles, statuses) */
const MAX_NAME = 500;
/** Max length for medium text fields (descriptions, summaries, rationale) */
const MAX_DESCRIPTION = 10_000;
/** Max length for long text fields (chat messages) */
const MAX_TEXT = 50_000;
/** Max number of items in array fields */
const MAX_ARRAY_ITEMS = 500;

// ─── Reusable field helpers ───

const id = () => z.string().min(1).max(MAX_ID);
const name = () => z.string().min(1).max(MAX_NAME);
const optionalId = () => z.string().max(MAX_ID).optional();
const optionalName = () => z.string().max(MAX_NAME).optional();
const optionalDescription = () => z.string().max(MAX_DESCRIPTION).optional();
const stringArray = () => z.array(z.string().max(MAX_NAME)).max(MAX_ARRAY_ITEMS);

// ─── Validation Helper ───

/**
 * Validate incoming socket data against a Zod schema.
 * Returns parsed (output-typed) data on success, or null on failure (after sending error ack).
 */
export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  event: string,
  ack?: (res: unknown) => void,
): z.output<S> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    if (ack) {
      ack({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid payload for "${event}": ${message}`,
          retryable: false,
        },
      });
    }
    return null;
  }
  return result.data as z.output<S>;
}

// ─── Building Schemas ───

export const BuildingCreateSchema = z.object({
  name: name(),
  projectId: optionalId(),
  description: optionalDescription(),
}).passthrough();

export const BuildingGetSchema = z.object({
  buildingId: id(),
});

export const BuildingListSchema = z.object({
  projectId: optionalId(),
}).optional().default({});

export const BuildingApplyBlueprintSchema = z.object({
  buildingId: id(),
  blueprint: z.record(z.unknown()),
  agentId: id(),
});

// ─── Building Update Schema ───

export const BuildingUpdateSchema = z.object({
  buildingId: id(),
  name: optionalName(),
  config: z.record(z.unknown()).optional(),
});

// ─── Floor Schemas ───

export const FloorListSchema = z.object({
  buildingId: id(),
});

export const FloorGetSchema = z.object({
  floorId: id(),
});

export const FloorCreateSchema = z.object({
  buildingId: id(),
  type: name(),
  name: name(),
  sortOrder: z.number().int().min(0).optional(),
  config: z.record(z.unknown()).optional(),
});

export const FloorUpdateSchema = z.object({
  floorId: id(),
  name: optionalName(),
  sortOrder: z.number().int().min(0).optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const FloorDeleteSchema = z.object({
  floorId: id(),
});

export const FloorSortSchema = z.object({
  buildingId: id(),
  floorIds: z.array(id()).min(1).max(MAX_ARRAY_ITEMS),
});

// ─── Room Schemas ───

export const RoomCreateSchema = z.object({
  type: name(),
  floorId: id(),
  name: optionalName(),
}).passthrough();

export const RoomGetSchema = z.object({
  roomId: id(),
});

export const RoomEnterSchema = z.object({
  roomId: id(),
  agentId: id(),
}).passthrough();

export const RoomExitSchema = z.object({
  roomId: id(),
  agentId: id(),
}).passthrough();

export const RoomUpdateSchema = z.object({
  roomId: id(),
  name: optionalName(),
  config: z.record(z.unknown()).optional(),
  allowedTools: stringArray().optional(),
  fileScope: z.enum(['assigned', 'read-only', 'full', 'none']).optional(),
  exitTemplate: z.record(z.unknown()).optional(),
  provider: optionalName(),
});

export const RoomDeleteSchema = z.object({
  roomId: id(),
});

// ─── Table Schemas ───

export const TableCreateSchema = z.object({
  roomId: id(),
  type: name(),
  chairs: z.number().int().min(1).max(20).optional().default(1),
  description: optionalDescription(),
});

export const TableListSchema = z.object({
  roomId: id(),
});

export const TableUpdateSchema = z.object({
  tableId: id(),
  type: optionalName(),
  chairs: z.number().int().min(1).max(20).optional(),
  description: optionalDescription(),
});

export const TableDeleteSchema = z.object({
  tableId: id(),
});

// ─── Agent Move Schema ───

export const AgentMoveSchema = z.object({
  agentId: id(),
  roomId: id(),
  tableType: z.string().max(100).optional().default('focus'),
});

// ─── Agent Schemas ───

export const AgentRegisterSchema = z.object({
  name: name(),
  role: optionalName(),
  firstName: optionalName(),
  lastName: optionalName(),
  displayName: optionalName(),
  bio: optionalDescription(),
  photoUrl: z.string().url().max(2000).optional(),
  specialization: optionalDescription(),
}).passthrough();

export const AgentGetSchema = z.object({
  agentId: id(),
});

export const AgentListSchema = z.object({}).passthrough().optional().default({});

export const AgentUpdateProfileSchema = z.object({
  agentId: id(),
  firstName: optionalName(),
  lastName: optionalName(),
  displayName: optionalName(),
  bio: optionalDescription(),
  photoUrl: z.string().url().max(2000).optional(),
  specialization: optionalDescription(),
  profileGenerated: z.boolean().optional(),
});

export const AgentGenerateProfileSchema = z.object({
  agentId: id(),
  /** Override the role used for generation (defaults to agent's registered role) */
  role: optionalName(),
  /** Additional capabilities to inform bio generation */
  capabilities: z.array(z.string().max(MAX_NAME)).max(MAX_ARRAY_ITEMS).optional(),
  /** Skip bio/name generation */
  skipBio: z.boolean().optional(),
  /** Skip photo generation */
  skipPhoto: z.boolean().optional(),
  /** Gender preference for name generation */
  gender: optionalName(),
  /** AI provider override (defaults to 'minimax') */
  provider: optionalName(),
});

// ─── Chat Schemas ───

export const ChatMessageSchema = z.object({
  text: z.string().max(MAX_TEXT).optional().default(''),
  tokens: z.array(z.object({
    id: z.string().max(MAX_ID).optional().default(''),
    type: z.string().max(MAX_NAME).optional().default(''),
    char: z.string().max(10).optional().default(''),
    label: z.string().max(MAX_NAME).optional().default(''),
    value: z.string().max(MAX_NAME).optional().default(''),
  }).passthrough()).max(MAX_ARRAY_ITEMS).optional().default([]),
  buildingId: z.string().max(MAX_ID).optional().default(''),
  roomId: z.string().max(MAX_ID).optional().default(''),
  agentId: z.string().max(MAX_ID).optional().default(''),
}).passthrough();

// ─── Read-only Event Schemas (no user data — reject unexpected fields) ───

/** system:status, room:list, command:list, phase:order, system:health accept no payload */
export const EmptyPayloadSchema = z.object({}).strict().optional().default({});

// ─── Phase Event Schemas (phase:status, phase:gate) ───

/** phase:status — client requests phase status for a building */
export const PhaseStatusSchema = z.object({
  buildingId: optionalId(),
});

/** phase:gate — client requests gate info for a building */
export const PhaseGateSchema = z.object({
  buildingId: optionalId(),
  phase: optionalName(),
});

// ─── Phase Schemas ───

export const PhaseGatesSchema = z.object({
  buildingId: id(),
});

export const PhaseCanAdvanceSchema = z.object({
  buildingId: id(),
});

export const PhasePendingGatesSchema = z.object({
  buildingId: optionalId(),
}).optional().default({});

export const PhaseResolveConditionsSchema = z.object({
  gateId: id(),
  resolvedConditions: stringArray().optional().default([]),
  resolver: z.string().max(MAX_NAME).optional().default('system'),
});

export const PhaseStaleGatesSchema = z.object({
  thresholdMs: z.number().positive().optional(),
}).optional().default({});

export const PhaseGateSignoffSchema = z.object({
  gateId: id(),
  reviewer: name(),
  verdict: z.enum(['GO', 'NO-GO', 'CONDITIONAL']),
  conditions: stringArray().optional().default([]),
  exitDocId: optionalId(),
  nextPhaseInput: z.record(z.unknown()).optional().default({}),
});

export const PhaseAdvanceSchema = z.object({
  buildingId: id(),
  reviewer: optionalName(),
  nextPhaseInput: z.record(z.unknown()).optional().default({}),
});

// ─── RAID Schemas ───

export const RaidSearchSchema = z.object({
  buildingId: optionalId(),
  type: optionalName(),
  status: optionalName(),
}).passthrough();

export const RaidListSchema = z.object({
  buildingId: id(),
});

export const RaidAddSchema = z.object({
  buildingId: id(),
  type: name(),
  phase: name(),
  summary: z.string().min(1).max(MAX_DESCRIPTION),
}).passthrough();

export const RaidUpdateSchema = z.object({
  id: id(),
  status: name(),
});

export const RaidEditSchema = z.object({
  id: id(),
  summary: optionalDescription(),
  rationale: optionalDescription(),
  decidedBy: optionalName(),
  affectedAreas: z.array(z.string().max(MAX_NAME)).max(MAX_ARRAY_ITEMS).optional(),
});

// ─── Task Schemas ───

export const TaskCreateSchema = z.object({
  buildingId: id(),
  title: name(),
  description: optionalDescription(),
  status: z.string().max(MAX_NAME).optional().default('pending'),
  parentId: optionalId(),
  milestoneId: optionalId(),
  assigneeId: optionalId(),
  roomId: optionalId(),
  tableId: optionalId(),
  phase: optionalName(),
  priority: z.string().max(MAX_NAME).optional().default('normal'),
});

export const TaskUpdateSchema = z.object({
  id: id(),
  title: optionalName(),
  description: optionalDescription(),
  status: optionalName(),
  parentId: optionalId(),
  milestoneId: optionalId(),
  assigneeId: optionalId(),
  roomId: optionalId(),
  tableId: optionalId(),
  phase: optionalName(),
  priority: optionalName(),
});

export const TaskListSchema = z.object({
  buildingId: id(),
  status: optionalName(),
  phase: optionalName(),
  assigneeId: optionalId(),
  tableId: optionalId(),
  roomId: optionalId(),
});

export const TaskGetSchema = z.object({
  id: id(),
});

export const TaskAssignTableSchema = z.object({
  taskId: id(),
  tableId: id(),
});

export const TaskUnassignTableSchema = z.object({
  taskId: id(),
});

// ─── TODO Schemas ───

export const TodoCreateSchema = z.object({
  taskId: id(),
  description: z.string().min(1).max(MAX_DESCRIPTION),
  agentId: optionalId(),
  roomId: optionalId(),
  status: z.string().max(MAX_NAME).optional().default('pending'),
  exitDocRef: optionalId(),
});

export const TodoToggleSchema = z.object({
  id: id(),
});

export const TodoListSchema = z.object({
  taskId: optionalId(),
  agentId: optionalId(),
}).refine((data) => data.taskId || data.agentId, {
  message: 'At least one of taskId or agentId must be provided',
});

export const TodoDeleteSchema = z.object({
  id: id(),
});

export const TodoAssignAgentSchema = z.object({
  todoId: id(),
  agentId: id(),
});

export const TodoUnassignAgentSchema = z.object({
  todoId: id(),
});

// ─── Exit Document Schemas ───

export const ExitDocSubmitSchema = z.object({
  roomId: id(),
  agentId: id(),
  document: z.record(z.unknown()).optional().default({}),
  buildingId: optionalId(),
  phase: optionalName(),
  roomType: optionalName(),
});

export const ExitDocGetSchema = z.object({
  roomId: id(),
});

export const ExitDocListSchema = z.object({
  buildingId: id(),
});

// ─── Agent Photo Generation ───

export const AgentGeneratePhotoSchema = z.object({
  agentId: id(),
});

// ─── Citations ───

export const CitationListSchema = z.object({
  roomId: id(),
});

export const CitationBacklinksSchema = z.object({
  roomId: id(),
  entryId: optionalId(),
});

// ─── Table Context Schemas (Fleet Coordination) ───

export const TableSetContextSchema = z.object({
  tableId: id(),
  key: z.string().min(1).max(MAX_NAME),
  value: z.unknown(),
});

export const TableGetContextSchema = z.object({
  tableId: id(),
});

export const TableClearContextSchema = z.object({
  tableId: id(),
});

// ─── Table Work Division Schemas (Fleet Coordination) ───

export const TableGetAssignmentsSchema = z.object({
  tableId: id(),
});

export const TableDivideWorkSchema = z.object({
  tableId: id(),
  taskId: id(),
  todoDescriptions: z.array(z.object({
    agentId: id(),
    description: z.string().min(1).max(MAX_DESCRIPTION),
  })).min(1).max(50),
});
