/**
 * Execution Signal — Building-level agent execution control (#966, #969)
 *
 * Provides a cooperative interrupt mechanism for the conversation loop.
 * Each building gets a shared signal that all agents check at safe yield
 * points (before AI calls, after tool execution).
 *
 * States:
 *   running → agents proceed normally
 *   paused  → agents wait (Promise-based, no CPU polling)
 *   aborted → agents exit cleanly
 */

import { logger } from './logger.js';

const log = logger.child({ module: 'execution-signal' });

/** Error thrown when a building is stopped and agents should exit */
export class ExecutionAbortedError extends Error {
  readonly code = 'EXECUTION_ABORTED';
  readonly retryable = false;
  constructor(buildingId: string) {
    super(`Building ${buildingId} execution stopped`);
    this.name = 'ExecutionAbortedError';
  }
}

/** Error thrown when a building is paused — conversation loop catches this
 *  and calls waitIfPaused() */
export class ExecutionPausedError extends Error {
  readonly code = 'EXECUTION_PAUSED';
  readonly retryable = false;
  constructor(buildingId: string) {
    super(`Building ${buildingId} execution paused`);
    this.name = 'ExecutionPausedError';
  }
}

export type ExecutionState = 'running' | 'paused' | 'aborted' | 'stopped';

export interface ExecutionSignal {
  /** Current execution state */
  readonly state: ExecutionState;
  /** The building this signal controls */
  readonly buildingId: string;
  /** Returns a Promise that resolves when resumed, or rejects if aborted.
   *  Returns immediately if state is 'running'. */
  waitIfPaused(): Promise<void>;
  /** Throws ExecutionAbortedError if state is 'aborted'. No-op otherwise. */
  throwIfAborted(): void;
  /** Check signal at a yield point — combines throwIfAborted + waitIfPaused.
   *  This is the main method agents call at safe yield points. */
  checkpoint(): Promise<void>;
}

/**
 * Internal mutable signal implementation.
 * The SignalRegistry holds these and exposes read-only ExecutionSignal
 * interfaces to consumers.
 */
class ExecutionSignalImpl implements ExecutionSignal {
  private _state: ExecutionState = 'running';
  private _resumeResolvers: Array<() => void> = [];
  private _resumeRejecters: Array<(err: Error) => void> = [];
  readonly buildingId: string;

  constructor(buildingId: string, initialState: ExecutionState = 'running') {
    this.buildingId = buildingId;
    this._state = initialState;
  }

  get state(): ExecutionState {
    return this._state;
  }

  /** Transition to a new state. Resolves/rejects waiters as appropriate. */
  transition(newState: ExecutionState): void {
    const oldState = this._state;
    if (oldState === newState) return;

    this._state = newState;
    log.info({ buildingId: this.buildingId, from: oldState, to: newState }, 'Execution state transition');

    if (newState === 'running') {
      // Resume all waiting agents
      for (const resolve of this._resumeResolvers) resolve();
      this._resumeResolvers = [];
      this._resumeRejecters = [];
    } else if (newState === 'aborted' || newState === 'stopped') {
      // Reject all waiting agents so they exit cleanly
      const error = new ExecutionAbortedError(this.buildingId);
      for (const reject of this._resumeRejecters) reject(error);
      this._resumeResolvers = [];
      this._resumeRejecters = [];
    }
  }

  async waitIfPaused(): Promise<void> {
    if (this._state === 'running') return;
    if (this._state === 'aborted' || this._state === 'stopped') throw new ExecutionAbortedError(this.buildingId);

    // State is 'paused' — wait for resume or abort
    log.debug({ buildingId: this.buildingId }, 'Agent waiting (building paused)');
    return new Promise<void>((resolve, reject) => {
      this._resumeResolvers.push(resolve);
      this._resumeRejecters.push(reject);
    });
  }

  throwIfAborted(): void {
    if (this._state === 'aborted' || this._state === 'stopped') {
      throw new ExecutionAbortedError(this.buildingId);
    }
  }

  async checkpoint(): Promise<void> {
    this.throwIfAborted();
    await this.waitIfPaused();
  }
}

// ─── Signal Registry ───
// Maps buildingId → signal. All agents in a building share the same signal.

const signals = new Map<string, ExecutionSignalImpl>();

/**
 * Get or create the execution signal for a building.
 * Returns a read-only ExecutionSignal interface.
 */
export function getExecutionSignal(buildingId: string): ExecutionSignal {
  let signal = signals.get(buildingId);
  if (!signal) {
    signal = new ExecutionSignalImpl(buildingId, 'stopped');
    signals.set(buildingId, signal);
  }
  return signal;
}

/**
 * Transition a building's execution state.
 * All agents sharing this signal are affected immediately.
 */
export function setBuildingExecutionState(buildingId: string, state: ExecutionState): void {
  let signal = signals.get(buildingId);
  if (!signal) {
    signal = new ExecutionSignalImpl(buildingId, state);
    signals.set(buildingId, signal);
    return;
  }
  signal.transition(state);
}

/**
 * Get the current execution state for a building.
 * Returns 'stopped' if no signal exists (default safe state).
 */
export function getBuildingExecutionState(buildingId: string): ExecutionState {
  const signal = signals.get(buildingId);
  return signal ? signal.state : 'stopped';
}

/**
 * Remove a building's signal (cleanup on building deletion).
 */
export function removeExecutionSignal(buildingId: string): void {
  const signal = signals.get(buildingId);
  if (signal) {
    signal.transition('aborted'); // Clean up any waiters
    signals.delete(buildingId);
  }
}

/**
 * Get a snapshot of all building execution states.
 * Useful for the live stats broadcast.
 */
export function getAllExecutionStates(): Map<string, ExecutionState> {
  const result = new Map<string, ExecutionState>();
  for (const [id, signal] of signals) {
    result.set(id, signal.state);
  }
  return result;
}
