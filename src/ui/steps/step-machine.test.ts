import { describe, expect, it } from "vitest";
import { pauliFrom, qubitIndex } from "../../core";
import { ALL_LAYERS } from "../model/trace";
import { createTraceContext, decodeTrace } from "../model/trace";
import {
  createStepPlan,
  initialStepState,
  LAST_STEP,
  layersOf,
  STEPS,
  stepReducer,
  type StepAction,
  type StepState,
} from "./step-machine";

describe("createStepPlan (phase2-g.md D6): the 2D plan is one instance; a six-step plan saturates at 5", () => {
  it("builds a plan from steps and layer sets, clamps layersOf and rejects mismatched lists", () => {
    const plan = createStepPlan<"a" | "b" | "c", "x" | "y", number>(
      ["a", "b", "c"],
      [new Set(["x"]), new Set(["x", "y"]), new Set(["x", "y"])],
    );
    expect(plan.STEPS).toEqual(["a", "b", "c"]);
    expect(plan.LAST_STEP).toBe(2);
    expect([...plan.layersOf(-1)]).toEqual(["x"]);
    expect([...plan.layersOf(1)]).toEqual(["x", "y"]);
    expect([...plan.layersOf(9)]).toEqual(["x", "y"]);
    let state = initialStepState(7);
    for (let i = 0; i < 5; i++) state = plan.reducer(state, { type: "next" });
    expect(state).toEqual({ trace: 7, index: 2, playing: false });
    state = plan.reducer(state, { type: "play" });
    expect(state.index).toBe(0);
    expect(state.playing).toBe(true);
    state = plan.reducer(state, { type: "load", trace: 8 });
    expect(state).toEqual({ trace: 8, index: 0, playing: false });
    expect(() => createStepPlan([], [])).toThrow(RangeError);
    expect(() => createStepPlan(["a"], [])).toThrow(RangeError);
  });

  it("a six-step plan: next from 4 reaches 5 and stops; play on 5 restarts", () => {
    const six = createStepPlan<string, string, string>(
      ["1", "2", "3", "4", "5", "6"],
      Array.from({ length: 6 }, () => new Set<string>()),
    );
    expect(six.LAST_STEP).toBe(5);
    let state = initialStepState("t");
    state = six.reducer(state, { type: "play" });
    const indices: number[] = [];
    for (let i = 0; i < 7; i++) {
      state = six.reducer(state, { type: "next" });
      indices.push(state.index);
    }
    expect(indices).toEqual([1, 2, 3, 4, 5, 5, 5]);
    expect(state.playing).toBe(false);
    expect(six.reducer(state, { type: "play" }).index).toBe(0);
  });
});

const trace = decodeTrace(
  createTraceContext(3),
  pauliFrom(9, [qubitIndex(3, 1, 1)], []),
);

function run(state: StepState, ...actions: StepAction[]): StepState {
  return actions.reduce(stepReducer, state);
}

describe("stepReducer", () => {
  const start = initialStepState(trace);

  it("has five steps in the order of docs/spec.md §4 and starts at the first, paused", () => {
    expect(STEPS).toEqual([
      "errors",
      "defects",
      "matching",
      "correction",
      "verdict",
    ]);
    expect(LAST_STEP).toBe(4);
    expect(start).toEqual({ trace, index: 0, playing: false });
    expect(Object.isFrozen(start)).toBe(true);
  });

  it("next saturates at the last step", () => {
    const indices: number[] = [];
    let state = start;
    for (let i = 0; i < 7; i++) {
      state = stepReducer(state, { type: "next" });
      indices.push(state.index);
    }
    expect(indices).toEqual([1, 2, 3, 4, 4, 4, 4]);
  });

  it("prev saturates at the first step", () => {
    const atTwo = run(start, { type: "next" }, { type: "next" });
    expect(run(atTwo, { type: "prev" }).index).toBe(1);
    expect(run(atTwo, { type: "prev" }, { type: "prev" }).index).toBe(0);
    expect(
      run(atTwo, { type: "prev" }, { type: "prev" }, { type: "prev" }).index,
    ).toBe(0);
  });

  it("restart goes back to the first step and keeps the same trace object", () => {
    const end = run(
      start,
      { type: "next" },
      { type: "next" },
      { type: "next" },
    );
    const restarted = stepReducer(end, { type: "restart" });
    expect(restarted.index).toBe(0);
    expect(restarted.trace).toBe(trace);
  });

  it("play then next: playing pauses by itself when the last step is reached", () => {
    let state = stepReducer(start, { type: "play" });
    expect(state.playing).toBe(true);
    for (let i = 0; i < LAST_STEP - 1; i++) {
      state = stepReducer(state, { type: "next" });
      expect(state.playing).toBe(true);
    }
    state = stepReducer(state, { type: "next" });
    expect(state.index).toBe(LAST_STEP);
    expect(state.playing).toBe(false);
  });

  it("pause stops without moving; restart while playing keeps playing from the first step", () => {
    const playing = run(start, { type: "play" }, { type: "next" });
    expect(stepReducer(playing, { type: "pause" })).toEqual({
      trace,
      index: 1,
      playing: false,
    });
    expect(stepReducer(playing, { type: "restart" })).toEqual({
      trace,
      index: 0,
      playing: true,
    });
  });

  it("play on the last step replays from the first", () => {
    const end = run(
      start,
      ...Array.from({ length: 4 }, () => ({ type: "next" }) as const),
    );
    expect(end.index).toBe(LAST_STEP);
    expect(stepReducer(end, { type: "play" })).toEqual({
      trace,
      index: 0,
      playing: true,
    });
  });

  it("load swaps the trace and resets to the first step, paused", () => {
    const other = decodeTrace(createTraceContext(3), pauliFrom(9, [], []));
    const midway = run(start, { type: "play" }, { type: "next" });
    expect(stepReducer(midway, { type: "load", trace: other })).toEqual({
      trace: other,
      index: 0,
      playing: false,
    });
  });

  it("never mutates the previous state", () => {
    const before = { ...start };
    run(start, { type: "next" }, { type: "play" }, { type: "restart" });
    expect(start).toEqual(before);
  });
});

describe("layersOf", () => {
  it("grows monotonically: every step keeps the layers of the previous one and adds at least one", () => {
    for (let i = 1; i <= LAST_STEP; i++) {
      const prev = layersOf(i - 1);
      const next = layersOf(i);
      for (const layer of prev) expect(next.has(layer)).toBe(true);
      expect(next.size).toBeGreaterThan(prev.size);
    }
  });

  it("shows only the errors at the first step and everything at the verdict", () => {
    expect([...layersOf(0)]).toEqual(["errors"]);
    expect(layersOf(LAST_STEP)).toEqual(ALL_LAYERS);
  });

  it("reveals the layer named by each step on that step (defects, matching, correction) and the residual with the verdict", () => {
    expect(layersOf(0).has("defects")).toBe(false);
    expect(layersOf(1).has("defects")).toBe(true);
    expect(layersOf(1).has("matching")).toBe(false);
    expect(layersOf(2).has("matching")).toBe(true);
    expect(layersOf(2).has("correction")).toBe(false);
    expect(layersOf(3).has("correction")).toBe(true);
    expect(layersOf(3).has("residual")).toBe(false);
    expect(layersOf(4).has("residual")).toBe(true);
  });

  it("clamps out-of-range indices", () => {
    expect(layersOf(-3)).toBe(layersOf(0));
    expect(layersOf(99)).toBe(layersOf(LAST_STEP));
  });
});
