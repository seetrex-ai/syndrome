// Step-by-step mode (tasks/plans/ui.md D5): a pure state machine over a
// trace that was decoded once. The steps only decide which layers of the same
// frozen trace are shown; nothing is recomputed between steps
// (tests/intent/ui-conventions.test.tsx, test_intent_trace_computed_once).
//
// Generalised for the spacetime viewer (tasks/plans/phase2-g.md D6): a
// `StepPlan` is a list of step names, the layers each one shows and the
// reducer bound to its last step. The 2D exports below (STEPS, LAST_STEP,
// layersOf, stepReducer, initialStepState, Step) keep their values; the viewer
// builds its own plan (spacetime/viewer-steps.ts) with six steps.

import type { Layer, ShotTrace } from "../model/trace";

export type Step = "errors" | "defects" | "matching" | "correction" | "verdict";

/** errors → defects → matching → correction → verdict (docs/spec.md §4, phase 1, point 5). */
export const STEPS: readonly Step[] = [
  "errors",
  "defects",
  "matching",
  "correction",
  "verdict",
];

/** Delay between two automatic steps while playing. */
export const STEP_INTERVAL_MS = 1200;

export interface StepState<T = ShotTrace> {
  readonly trace: T;
  /** 0 … last step of the plan. */
  readonly index: number;
  readonly playing: boolean;
}

export type StepAction<T = ShotTrace> =
  | { readonly type: "next" }
  | { readonly type: "prev" }
  | { readonly type: "play" }
  | { readonly type: "pause" }
  | { readonly type: "restart" }
  | { readonly type: "load"; readonly trace: T };

export function initialStepState<T>(trace: T): StepState<T> {
  return Object.freeze({ trace, index: 0, playing: false });
}

function at<T>(state: StepState<T>, index: number, playing: boolean) {
  return Object.freeze({ trace: state.trace, index, playing });
}

/**
 * The pure reducer of a plan whose last step is `lastStep`: `next` saturates
 * there and pauses; `play` on the last step replays from the first.
 */
export function createStepReducer<T>(
  lastStep: number,
): (state: StepState<T>, action: StepAction<T>) => StepState<T> {
  return (state, action) => {
    switch (action.type) {
      case "next": {
        const index = Math.min(state.index + 1, lastStep);
        return at(state, index, state.playing && index < lastStep);
      }
      case "prev":
        return at(state, Math.max(state.index - 1, 0), state.playing);
      case "play":
        return at(state, state.index === lastStep ? 0 : state.index, true);
      case "pause":
        return at(state, state.index, false);
      case "restart":
        return at(state, 0, state.playing);
      case "load":
        return initialStepState(action.trace);
    }
  };
}

export interface StepPlan<S extends string, L extends string, T> {
  readonly STEPS: readonly S[];
  readonly LAST_STEP: number;
  /** The layers visible at step `index` (clamped to the valid range). */
  readonly layersOf: (index: number) => ReadonlySet<L>;
  readonly reducer: (
    state: StepState<T>,
    action: StepAction<T>,
  ) => StepState<T>;
}

/** A plan: one set of layers per step, in order. RangeError unless the two lists match and are not empty. */
export function createStepPlan<S extends string, L extends string, T>(
  steps: readonly S[],
  layersByStep: readonly ReadonlySet<L>[],
): StepPlan<S, L, T> {
  if (steps.length === 0 || steps.length !== layersByStep.length) {
    throw new RangeError(
      `a step plan needs one layer set per step, got ${steps.length} steps and ${layersByStep.length} sets`,
    );
  }
  const lastStep = steps.length - 1;
  return Object.freeze({
    STEPS: steps,
    LAST_STEP: lastStep,
    layersOf: (index: number) =>
      layersByStep[Math.min(Math.max(Math.trunc(index), 0), lastStep)]!,
    reducer: createStepReducer<T>(lastStep),
  });
}

// Each step adds layers and never removes one: what the viewer has already
// understood stays on screen while the next idea is drawn on top.
const LAYERS_BY_STEP: readonly ReadonlySet<Layer>[] = [
  new Set<Layer>(["errors"]),
  new Set<Layer>(["errors", "defects"]),
  new Set<Layer>(["errors", "defects", "matching"]),
  new Set<Layer>(["errors", "defects", "matching", "correction"]),
  new Set<Layer>(["errors", "defects", "matching", "correction", "residual"]),
];

const PLAN_2D = createStepPlan<Step, Layer, ShotTrace>(STEPS, LAYERS_BY_STEP);

export const LAST_STEP = PLAN_2D.LAST_STEP;

/** The grid layers visible at step `index` (clamped to the valid range). */
export const layersOf = PLAN_2D.layersOf;

/** Pure. `next` saturates at the last step and pauses there; `play` on the last step replays from the first. */
export const stepReducer = PLAN_2D.reducer;
