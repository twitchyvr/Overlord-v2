/**
 * Pipeline Orchestrator (#609)
 *
 * Auto-invokes QA tools for each pipeline stage and records evidence.
 * Listens for pipeline:evidence-recorded events and triggers the next
 * stage's tools when the current stage passes.
 *
 * Layer: Rooms (depends on Tools, Storage, Core)
 */

import { logger } from '../core/logger.js';
import { recordEvidence, loopBackToCode, PIPELINE_STAGES } from './pipeline-evidence.js';
import { getDb } from '../storage/db.js';
import type { PipelineStage } from './pipeline-evidence.js';
import type { Bus } from '../core/bus.js';
import type { Result } from '../core/contracts.js';

const log = logger.child({ module: 'pipeline-orchestrator' });

// ─── Stage → Tool Mapping ───

interface StageToolConfig {
  tools: string[];
  description: string;
  autoInvoke: boolean;
}

const STAGE_TOOLS: Record<string, StageToolConfig> = {
  'code':        { tools: [],                                   description: 'Agent-driven coding',       autoInvoke: false },
  'iterate':     { tools: [],                                   description: 'Agent reviews own work',    autoInvoke: false },
  'static-test': { tools: ['qa_run_tests'],                     description: 'Run test suite',             autoInvoke: true },
  'deep-test':   { tools: ['qa_check_types'],                   description: 'Type check + validation',    autoInvoke: true },
  'syntax':      { tools: ['qa_check_lint'],                    description: 'Lint and format check',      autoInvoke: true },
  'review':      { tools: ['code_review'],                      description: 'Subagent code review',       autoInvoke: true },
  'e2e':         { tools: ['dev_server', 'e2e_test'],           description: 'Runtime verification',       autoInvoke: true },
  'dogfood':     { tools: [],                                   description: 'Human/agent exercises feature', autoInvoke: false },
};

// ─── Orchestrator State ───

interface OrchestratorConfig {
  bus: Bus;
  executeTool?: (toolName: string, params: Record<string, unknown>, context?: Record<string, unknown>) => Promise<Result>;
}

let _bus: Bus | null = null;
let _executeTool: OrchestratorConfig['executeTool'] | null = null;

/**
 * Initialize the pipeline orchestrator.
 * Listens for pipeline events and auto-invokes stage tools.
 */
export function initPipelineOrchestrator(config: OrchestratorConfig): void {
  _bus = config.bus;
  _executeTool = config.executeTool || null;

  // When evidence is recorded, check if the stage passed and trigger next stage
  _bus.on('pipeline:evidence-recorded', (data: { taskId: string; stage: string; status: string }) => {
    if (data.status === 'passed') {
      const stageIndex = PIPELINE_STAGES.indexOf(data.stage as PipelineStage);
      if (stageIndex >= 0 && stageIndex < PIPELINE_STAGES.length - 1) {
        const nextStage = PIPELINE_STAGES[stageIndex + 1];
        log.info({ taskId: data.taskId, completedStage: data.stage, nextStage }, 'Stage passed — advancing pipeline');
        _bus!.emit('pipeline:stage-entered', { taskId: data.taskId, stage: nextStage });
      }
    }
  });

  // When a stage is entered, auto-invoke its tools
  _bus.on('pipeline:stage-entered', async (data: { taskId: string; stage: string; buildingId?: string }) => {
    const toolConfig = STAGE_TOOLS[data.stage];
    if (!toolConfig || !toolConfig.autoInvoke || toolConfig.tools.length === 0) {
      return; // Agent-driven stages — no auto-invocation
    }

    log.info({ taskId: data.taskId, stage: data.stage, tools: toolConfig.tools }, 'Auto-invoking stage tools');

    if (_executeTool) {
      const startTime = Date.now();

      for (const toolName of toolConfig.tools) {
        try {
          const result = await _executeTool(toolName, { taskId: data.taskId }, { buildingId: data.buildingId });
          const passed = result.ok;
          const durationMs = Date.now() - startTime;

          recordEvidence({
            taskId: data.taskId,
            buildingId: data.buildingId || '',
            stage: data.stage as PipelineStage,
            status: passed ? 'passed' : 'failed',
            evidenceData: { tool: toolName, result: result.ok ? result.data : result.error },
            durationMs,
          });

          if (!passed) {
            // Stage failed — loop back to code (loopBackToCode records evidence internally)
            const currentAttempt = getCurrentAttempt(data.taskId, data.stage as PipelineStage);
            loopBackToCode({
              taskId: data.taskId,
              buildingId: data.buildingId || '',
              failedStage: data.stage as PipelineStage,
              errors: [typeof result.error === 'string' ? result.error : JSON.stringify(result.error)],
              attempt: currentAttempt,
            });
            return;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error({ taskId: data.taskId, stage: data.stage, tool: toolName, err: msg }, 'Tool execution failed');

          // Exception path also loops back (review finding #1)
          const currentAttempt = getCurrentAttempt(data.taskId, data.stage as PipelineStage);
          loopBackToCode({
            taskId: data.taskId,
            buildingId: data.buildingId || '',
            failedStage: data.stage as PipelineStage,
            errors: [msg],
            attempt: currentAttempt,
          });
          return;
        }
      }
    }
  });

  log.info('Pipeline orchestrator initialized');
}

/**
 * Get the current attempt count for a task+stage from the DB (review finding #3).
 */
function getCurrentAttempt(taskId: string, stage: PipelineStage): number {
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT MAX(attempt) as maxAttempt FROM pipeline_evidence WHERE task_id = ? AND stage = ?',
    ).get(taskId, stage) as { maxAttempt: number | null } | undefined;
    return (row?.maxAttempt ?? 0) + 1;
  } catch {
    return 1;
  }
}

/**
 * Get the tool configuration for a pipeline stage.
 */
export function getStageTools(stage: string): StageToolConfig | null {
  return STAGE_TOOLS[stage] || null;
}

/**
 * Get the full stage-to-tool mapping.
 */
export function getAllStageTools(): Record<string, StageToolConfig> {
  return { ...STAGE_TOOLS };
}
