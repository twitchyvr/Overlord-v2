/**
 * Universal I/O Contracts
 *
 * Every module, room, tool, agent, and plugin follows this pattern.
 * "Content can change. Hierarchy stays consistent."
 */

import { z } from 'zod';

// ─── Base Result Envelope ───
export const ResultSchema = z.object({
  ok: z.boolean(),
  data: z.any().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().default(false),
      context: z.record(z.any()).optional(),
    })
    .optional(),
  metadata: z
    .object({
      duration: z.number().optional(),
      roomId: z.string().optional(),
      agentId: z.string().optional(),
      phase: z.string().optional(),
    })
    .optional(),
});

/**
 * Create a success result
 * @param {any} data
 * @param {object} [metadata]
 */
export function ok(data, metadata) {
  return { ok: true, data, metadata };
}

/**
 * Create an error result
 * @param {string} code
 * @param {string} message
 * @param {object} [options]
 */
export function err(code, message, { retryable = false, context } = {}) {
  return { ok: false, error: { code, message, retryable, context } };
}

// ─── Room Contract Schema ───
export const RoomContractSchema = z.object({
  roomType: z.string(),
  floor: z.string(),
  tables: z.record(
    z.object({
      chairs: z.number().int().positive(),
      description: z.string(),
    })
  ),
  tools: z.array(z.string()),
  fileScope: z.enum(['assigned', 'read-only', 'full']).default('assigned'),
  exitRequired: z.object({
    type: z.string(),
    fields: z.array(z.string()),
  }),
  escalation: z.record(z.string()).optional(),
  provider: z.string().default('configurable'),
});

// ─── Agent Identity Schema ───
export const AgentIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  capabilities: z.array(z.string()),
  roomAccess: z.array(z.string()),
  badge: z.string().optional(),
});

// ─── RAID Entry Schema ───
export const RaidEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['risk', 'assumption', 'issue', 'decision']),
  phase: z.string(),
  roomId: z.string(),
  summary: z.string(),
  rationale: z.string().optional(),
  decidedBy: z.string(),
  approvedBy: z.string().optional(),
  affectedAreas: z.array(z.string()).default([]),
  timestamp: z.string().datetime(),
  status: z.enum(['active', 'superseded', 'closed']).default('active'),
});

// ─── Exit Document Schema ───
export const ExitDocumentSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  type: z.string(),
  completedBy: z.string(),
  fields: z.record(z.any()),
  artifacts: z.array(z.string()).default([]),
  raidEntries: z.array(z.string()).default([]),
  timestamp: z.string().datetime(),
});

// ─── Phase Gate Schema ───
export const PhaseGateSchema = z.object({
  id: z.string(),
  phase: z.string(),
  status: z.enum(['pending', 'go', 'no-go', 'conditional']),
  exitDocId: z.string().optional(),
  raidEntries: z.array(z.string()).default([]),
  signoff: z
    .object({
      reviewer: z.string(),
      verdict: z.enum(['GO', 'NO-GO', 'CONDITIONAL']),
      conditions: z.array(z.string()).default([]),
      timestamp: z.string().datetime(),
    })
    .optional(),
  nextPhaseInput: z.record(z.any()).optional(),
});
