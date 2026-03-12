/**
 * Transport Layer — Zod Schemas
 *
 * Defines validation schemas for all socket event payloads.
 * Used by socket-handler.ts to validate incoming data before processing.
 */

import { z } from 'zod';

// ─── Validation Helper ───

/**
 * Validate incoming socket data against a Zod schema.
 * Returns parsed data on success, or null on failure (after sending error ack).
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  event: string,
  ack?: (res: unknown) => void,
): T | null {
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
  return result.data;
}

// ─── Building Schemas ───

export const BuildingCreateSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

export const BuildingGetSchema = z.object({
  buildingId: z.string().min(1),
});

export const BuildingListSchema = z.object({
  projectId: z.string().optional(),
}).optional().default({});

export const BuildingApplyBlueprintSchema = z.object({
  buildingId: z.string().min(1),
  blueprint: z.record(z.unknown()),
  agentId: z.string().min(1),
});

// ─── Floor Schemas ───

export const FloorListSchema = z.object({
  buildingId: z.string().min(1),
});

export const FloorGetSchema = z.object({
  floorId: z.string().min(1),
});

// ─── Room Schemas ───

export const RoomCreateSchema = z.object({
  type: z.string().min(1),
  floorId: z.string().min(1),
  name: z.string().optional(),
}).passthrough();

export const RoomGetSchema = z.object({
  roomId: z.string().min(1),
});

export const RoomEnterSchema = z.object({
  roomId: z.string().min(1),
  agentId: z.string().min(1),
}).passthrough();

export const RoomExitSchema = z.object({
  roomId: z.string().min(1),
  agentId: z.string().min(1),
}).passthrough();

// ─── Agent Schemas ───

export const AgentRegisterSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
}).passthrough();

export const AgentGetSchema = z.object({
  agentId: z.string().min(1),
});

export const AgentListSchema = z.object({}).passthrough().optional().default({});

// ─── Chat Schemas ───

export const ChatMessageSchema = z.object({
  text: z.string().optional().default(''),
  tokens: z.array(z.object({
    id: z.string().optional(),
    type: z.string().optional(),
    char: z.string().optional(),
    value: z.string().optional(),
  }).passthrough()).optional().default([]),
  buildingId: z.string().optional(),
  roomId: z.string().optional(),
  agentId: z.string().optional(),
}).passthrough();

// ─── Phase Schemas ───

export const PhaseGatesSchema = z.object({
  buildingId: z.string().min(1),
});

export const PhaseCanAdvanceSchema = z.object({
  buildingId: z.string().min(1),
});

export const PhasePendingGatesSchema = z.object({
  buildingId: z.string().optional(),
}).optional().default({});

export const PhaseResolveConditionsSchema = z.object({
  gateId: z.string().min(1),
  resolvedConditions: z.array(z.string()).optional().default([]),
  resolver: z.string().optional().default('system'),
});

export const PhaseStaleGatesSchema = z.object({
  thresholdMs: z.number().positive().optional(),
}).optional().default({});

export const PhaseGateSignoffSchema = z.object({
  gateId: z.string().min(1),
  reviewer: z.string().min(1),
  verdict: z.enum(['GO', 'NO-GO', 'CONDITIONAL']),
  conditions: z.array(z.string()).optional().default([]),
  exitDocId: z.string().optional(),
  nextPhaseInput: z.record(z.unknown()).optional().default({}),
});

export const PhaseAdvanceSchema = z.object({
  buildingId: z.string().min(1),
  reviewer: z.string().optional(),
  nextPhaseInput: z.record(z.unknown()).optional().default({}),
});

// ─── RAID Schemas ───

export const RaidSearchSchema = z.object({
  buildingId: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

export const RaidListSchema = z.object({
  buildingId: z.string().min(1),
});

export const RaidAddSchema = z.object({
  buildingId: z.string().min(1),
  type: z.string().min(1),
  summary: z.string().min(1),
}).passthrough();

export const RaidUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
});

export const RaidEditSchema = z.object({
  id: z.string().min(1),
  summary: z.string().optional(),
  rationale: z.string().optional(),
  decidedBy: z.string().optional(),
  affectedAreas: z.array(z.string()).optional(),
});

// ─── Task Schemas ───

export const TaskCreateSchema = z.object({
  buildingId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional().default('pending'),
  parentId: z.string().optional(),
  milestoneId: z.string().optional(),
  assigneeId: z.string().optional(),
  roomId: z.string().optional(),
  phase: z.string().optional(),
  priority: z.string().optional().default('normal'),
});

export const TaskUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  parentId: z.string().optional(),
  milestoneId: z.string().optional(),
  assigneeId: z.string().optional(),
  roomId: z.string().optional(),
  phase: z.string().optional(),
  priority: z.string().optional(),
});

export const TaskListSchema = z.object({
  buildingId: z.string().min(1),
  status: z.string().optional(),
  phase: z.string().optional(),
  assigneeId: z.string().optional(),
});

export const TaskGetSchema = z.object({
  id: z.string().min(1),
});

// ─── TODO Schemas ───

export const TodoCreateSchema = z.object({
  taskId: z.string().min(1),
  description: z.string().min(1),
  agentId: z.string().optional(),
  roomId: z.string().optional(),
  status: z.string().optional().default('pending'),
  exitDocRef: z.string().optional(),
});

export const TodoToggleSchema = z.object({
  id: z.string().min(1),
});

export const TodoListSchema = z.object({
  taskId: z.string().min(1),
});

export const TodoDeleteSchema = z.object({
  id: z.string().min(1),
});

// ─── Exit Document Schemas ───

export const ExitDocSubmitSchema = z.object({
  roomId: z.string().min(1),
  agentId: z.string().min(1),
  document: z.record(z.unknown()).optional().default({}),
  buildingId: z.string().optional(),
  phase: z.string().optional(),
  roomType: z.string().optional(),
});

export const ExitDocGetSchema = z.object({
  roomId: z.string().min(1),
});

export const ExitDocListSchema = z.object({
  buildingId: z.string().min(1),
});
