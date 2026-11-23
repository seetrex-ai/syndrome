// State of the interactive grid (tasks/plans/ui.md D1): one reducer, an
// immutable Pauli by convention (every action returns a fresh copy; a toggle
// never writes into the previous state) and the decoded trace as a derived
// value. React 19 runs reducers twice under StrictMode in development: an
// in-place `error.x[q] ^= 1` would cancel itself there and pass in production
// (tests/intent/ui-conventions.test.ts pins this).

import { useMemo, useReducer, useState } from "react";
import {
  copyPauli,
  createRng,
  identity,
  independentNoise,
  sampleNoise,
  type ReadonlyPauli,
} from "../../core";
import { createTraceContext, decodeTrace, type ShotTrace } from "./trace";

export interface GridState {
  readonly d: number;
  readonly error: ReadonlyPauli;
  /** Increments on every change; lets effects distinguish "same error again" from "nothing happened". */
  readonly revision: number;
}

/** A random shot: the noise probability and the seed of the error it draws. */
export interface Shot {
  readonly p: number;
  readonly seed: number;
}

export type GridAction =
  | { readonly type: "toggleX"; readonly q: number }
  | { readonly type: "toggleZ"; readonly q: number }
  | { readonly type: "clear" }
  | ({ readonly type: "randomize" } & Shot)
  | { readonly type: "setDistance"; readonly d: number; readonly shot?: Shot };

function randomError(n: number, shot: Shot): ReadonlyPauli {
  const error = identity(n);
  sampleNoise(independentNoise(shot.p), createRng(shot.seed), error);
  return error;
}

/** The empty grid of distance `d`, or, with `shot`, that random error on it. */
export function initialGridState(d: number, shot?: Shot): GridState {
  return Object.freeze({
    d,
    error: Object.freeze(
      shot === undefined ? identity(d * d) : randomError(d * d, shot),
    ),
    revision: 0,
  });
}

// A toggle on a qubit the code does not have is ignored, not thrown: a press
// that outlives a distance change (the gesture cancels it, but a reducer must
// not blank the app if one ever gets through) names a qubit of another grid.
function hasQubit(state: GridState, q: number): boolean {
  return Number.isInteger(q) && q >= 0 && q < state.error.n;
}

function withError(state: GridState, error: ReadonlyPauli): GridState {
  return Object.freeze({
    d: state.d,
    error: Object.freeze(error),
    revision: state.revision + 1,
  });
}

/** Pure: never mutates `state` or its masks. */
export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case "toggleX": {
      if (!hasQubit(state, action.q)) return state;
      const error = copyPauli(state.error);
      error.x[action.q] = error.x[action.q]! ^ 1;
      return withError(state, error);
    }
    case "toggleZ": {
      if (!hasQubit(state, action.q)) return state;
      const error = copyPauli(state.error);
      error.z[action.q] = error.z[action.q]! ^ 1;
      return withError(state, error);
    }
    case "clear":
      return withError(state, identity(state.error.n));
    case "randomize":
      return withError(state, randomError(state.error.n, action));
    case "setDistance":
      return action.d === state.d
        ? state
        : initialGridState(action.d, action.shot);
  }
}

/**
 * The grid state of distance `d` plus its decoded trace. Changing `d` resets
 * the grid: to the empty error, or, with `shotFor`, to a fresh random shot
 * (the step-by-step panel never shows an empty board when p > 0; the
 * interactive one starts clean). `shotFor` is called on mount and on a
 * distance change, never on a plain re-render; under StrictMode in development
 * React double-invokes initializers and reducers, so each of those is two
 * calls (two seeds drawn), with the state settled on one of them.
 */
export function useGridState(
  d: number,
  shotFor?: () => Shot,
): {
  state: GridState;
  trace: ShotTrace;
  dispatch: (action: GridAction) => void;
} {
  const [state, dispatch] = useReducer(gridReducer, d, (d0) =>
    initialGridState(d0, shotFor?.()),
  );
  // Adjust state when the prop changes, during render (React's documented
  // pattern): no stale grid is ever painted for the new distance.
  const [syncedD, setSyncedD] = useState(d);
  if (syncedD !== d) {
    setSyncedD(d);
    dispatch({ type: "setDistance", d, shot: shotFor?.() });
  }
  const ctx = useMemo(() => createTraceContext(state.d), [state.d]);
  const trace = useMemo(
    () => decodeTrace(ctx, state.error),
    [ctx, state.error],
  );
  return { state, trace, dispatch };
}
