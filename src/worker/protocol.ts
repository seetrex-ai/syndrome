// Typed messages between the main thread and the simulation Worker (docs/spec.md
// §5 "Web Worker con postMessage tipado"; tasks/plans/ui.md D3). No imports
// beyond core types: this file is the contract both sides read. Every message
// carries the runId of the run it belongs to; the main thread drops anything
// with a foreign runId (a terminated run whose last message was in flight).

import type { PointEstimate, StopRule } from "../core/index";

/**
 * The noise models the chart offers (tasks/plans/phase2.md D10): the phase 1
 * model (independent X/Z, perfect measurements, one cycle) and the
 * phenomenological one (measurement failures with q = p, d cycles, perfect
 * final readout). The same names key the base curves (src/ui/chart/baseline),
 * the default p (src/ui/App) and the i18n branches `chart.model.*` and
 * `chart.modelSelect.*`. The runtime list lives in src/ui/model/noise-kinds
 * (the App reaches it statically; this directory is deferred).
 */
export type NoiseKind = "independent" | "phenomenological";

export interface StartMessage {
  readonly type: "start";
  readonly runId: number;
  /** The noise model every lane of the run samples (the core's ModelSpec by name). */
  readonly model: NoiseKind;
  /** Code distances of the chart, ascending. */
  readonly distances: readonly number[];
  /** Physical error probabilities of the grid, ascending (the base curves' p). */
  readonly probabilities: readonly number[];
  /** The user's p: one extra point per distance, simulated first (Λ appears early). */
  readonly userP: number;
  /** Base seed of pointSeed: an integer in [0, 2⁵²), fresh per run (ui.md R11). */
  readonly seedBase: number;
  readonly rule: StopRule;
  /** Wall-clock budget of the run; every point still sampling stops by "budget". */
  readonly budgetMs: number;
  /** Target duration of one batch of one point; the batch size follows the measured rate. */
  readonly targetBatchMs: number;
}

export interface SetUserPMessage {
  readonly type: "setUserP";
  readonly runId: number;
  readonly p: number;
}

export interface StopMessage {
  readonly type: "stop";
  readonly runId: number;
}

export type MainToWorker = StartMessage | SetUserPMessage | StopMessage;

/** PointEstimate of the core plus the throughput the Worker measured on its last batch. */
export interface LivePoint extends PointEstimate {
  /** Shots per second of this point's last batch; 0 until the first batch completes. */
  readonly rate: number;
}

export interface ProgressMessage {
  readonly type: "progress";
  readonly runId: number;
  /** One estimate per lane, user lanes first, then the grid with p outer and d inner. */
  readonly points: readonly LivePoint[];
}

export interface DoneMessage {
  readonly type: "done";
  readonly runId: number;
  readonly elapsedMs: number;
}

export interface ErrorMessage {
  readonly type: "error";
  readonly runId: number;
  readonly message: string;
}

export type WorkerToMain = ProgressMessage | DoneMessage | ErrorMessage;

/** Stop rule of the live curves: ≥ 100 failures and ≥ 1 000 shots, cap 10⁶ (ui.md D3). */
export const BROWSER_STOP_RULE: StopRule = Object.freeze({
  minFailures: 100,
  minShots: 1_000,
  maxShots: 1_000_000,
});

/** docs/spec.md §7: the chart is complete in < 60 s or stops. */
export const DEFAULT_BUDGET_MS = 60_000;

/** ≈ 27 lanes × 5 ms = one progress message every ≈ 135 ms when every lane is active. */
export const DEFAULT_TARGET_BATCH_MS = 5;

/** Largest base seed pointSeed accepts, exclusive. */
export const MAX_SEED_BASE = 2 ** 52;

/**
 * Resolution of a lane's p. pointSeed rounds p·10⁶ (src/core/sim/stats.ts), so
 * two p closer than 10⁻⁶ get the same seed: a user p of 0.030000000000000002
 * next to the grid's 0.03 would be the same shots twice under two keys. Both
 * sides key their lanes by this value (the Worker when it builds or reuses a
 * lane, the main thread before it compares p with a live point).
 */
export const P_RESOLUTION = 1e6;

export function normalizeP(p: number): number {
  return Math.round(p * P_RESOLUTION) / P_RESOLUTION;
}

// Constructors: the main thread builds its messages here so the protocol tags
// live in one file (and src/ui carries no protocol literals).

export function startMessage(fields: Omit<StartMessage, "type">): StartMessage {
  return { type: "start", ...fields };
}

export function setUserPMessage(runId: number, p: number): SetUserPMessage {
  return { type: "setUserP", runId, p };
}

export function stopMessage(runId: number): StopMessage {
  return { type: "stop", runId };
}
