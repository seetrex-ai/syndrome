// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pauliEquals } from "../../src/core";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import { DEFAULT_P } from "../../src/ui/model/noise-kinds";
import { gridReducer, initialGridState } from "../../src/ui/model/grid-reducer";
import {
  createTraceContext,
  decodeTrace,
  type ShotTrace,
} from "../../src/ui/model/trace";
import { LAST_STEP, STEP_INTERVAL_MS } from "../../src/ui/steps/step-machine";

/**
 * test_scenario_ui_step_through_shot
 *
 * The walkthrough of one shot end to end through the real App (tasks/plans/ui.md
 * §4, escenario B): a random shot at d = 3 and the App's DEFAULT_P (0.05; seed 34:
 * one X error next to the boundary; seed 62: three errors the decoder cannot
 * undo, logical X; the seeds were searched for at that p) → the
 * five steps reveal layers that only grow (errors, then defects, then the
 * matching edges, then the correction chains, then the residual and the verdict)
 * → back → repeat → the grid shows the very same trace (deep equality with a
 * decode done outside the UI) and the UI decoded that error exactly once.
 */

vi.mock("../../src/ui/model/trace", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/ui/model/trace")>();
  return { ...mod, decodeTrace: vi.fn(mod.decodeTrace) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const spy = vi.mocked(decodeTrace);

/** The trace the UI must show for `seed`, decoded here, outside React. */
function expectedTrace(seed: number): ShotTrace {
  const state = gridReducer(initialGridState(3), {
    type: "randomize",
    p: DEFAULT_P,
    seed,
  });
  return decodeTrace(createTraceContext(3), state.error);
}

function count(pauli: ShotTrace["error"]): number {
  let n = 0;
  for (let q = 0; q < pauli.n; q++) if (pauli.x[q]! | pauli.z[q]!) n++;
  return n;
}

function panel(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".panel--steps");
  if (el === null) throw new Error("steps panel not rendered");
  return el;
}

function button(key: string): HTMLButtonElement {
  const found = [...panel().querySelectorAll("button")].find(
    (b) => b.textContent === i18n.t(key),
  );
  if (found === undefined) throw new Error(`button ${key} not rendered`);
  return found;
}

/** What the steps grid currently draws. */
function visible() {
  const p = panel();
  return {
    step: Number(p.getAttribute("data-step")),
    errors: p.querySelectorAll('[data-qubit]:not([data-pauli="I"])').length,
    defects: p.querySelectorAll('[data-defect="1"]').length,
    matches: p.querySelectorAll("line[data-match]").length,
    chains: p.querySelectorAll("polyline[data-chain]").length,
    corrections: p.querySelectorAll('[data-qubit]:not([data-correction="I"])')
      .length,
    residuals: p.querySelectorAll('[data-qubit]:not([data-residual="I"])')
      .length,
    verdict: p.querySelector(".steps__verdict")?.textContent ?? null,
  };
}

function newShot(seed: number) {
  vi.spyOn(Math, "random").mockReturnValue(seed / 2 ** 53);
  fireEvent.click(button("steps.newShot"));
}

describe("test_scenario_ui_step_through_shot", () => {
  it("seed 34: five steps of growing layers, back, repeat, same trace, decoded once", () => {
    const expected = expectedTrace(34);
    const defects = [...expected.syndromes.Z, ...expected.syndromes.X].filter(
      (b) => b === 1,
    ).length;
    const chains = expected.chains.Z.length + expected.chains.X.length;
    expect(count(expected.error)).toBe(1);
    expect(defects).toBe(1);
    expect(chains).toBe(1);
    expect(expected.verdict).toBe(0);

    vi.useFakeTimers();
    render(<App />);
    spy.mockClear();
    newShot(34);

    // Step 0 — errors only.
    expect(visible()).toEqual({
      step: 0,
      errors: 1,
      defects: 0,
      matches: 0,
      chains: 0,
      corrections: 0,
      residuals: 0,
      verdict: null,
    });
    // Step 1 — defects appear, nothing else.
    fireEvent.click(button("steps.next"));
    expect(visible()).toMatchObject({
      step: 1,
      errors: 1,
      defects,
      matches: 0,
      chains: 0,
    });
    // Step 2 — the matching edges.
    fireEvent.click(button("steps.next"));
    expect(visible()).toMatchObject({
      step: 2,
      defects,
      matches: chains,
      chains: 0,
      corrections: 0,
    });
    // Step 3 — the correction chains, still no residual.
    fireEvent.click(button("steps.next"));
    expect(visible()).toMatchObject({
      step: 3,
      matches: chains,
      chains,
      corrections: count(expected.correction),
      residuals: 0,
      verdict: null,
    });
    // Step 4 — the residual and the verdict. "Corrected" does not mean "nothing
    // left": the X error sits on a border qubit and the decoder's chain reaches
    // the boundary through another qubit, so error · correction is a weight-2
    // boundary stabilizer (two residual qubits), which is harmless.
    fireEvent.click(button("steps.next"));
    expect(count(expected.residual)).toBe(2);
    expect(visible()).toMatchObject({
      step: LAST_STEP,
      chains,
      residuals: 2,
      verdict: i18n.t("grid.verdict.ok"),
    });
    expect(button("steps.next").disabled).toBe(true);

    // Back: the verdict goes, the chains stay.
    fireEvent.click(button("steps.prev"));
    expect(visible()).toMatchObject({ step: 3, chains, verdict: null });
    // Repeat: errors only again.
    fireEvent.click(button("steps.restart"));
    expect(visible()).toMatchObject({
      step: 0,
      errors: 1,
      defects: 0,
      chains: 0,
    });
    // Play all the way through.
    fireEvent.click(button("steps.play"));
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS * LAST_STEP);
    });
    expect(visible()).toMatchObject({
      step: LAST_STEP,
      verdict: i18n.t("grid.verdict.ok"),
    });

    // The UI decoded this error exactly once, and what it decoded is the
    // trace computed outside the UI (deep equality).
    const calls = spy.mock.calls
      .map((args, i) => ({ args, result: spy.mock.results[i]!.value }))
      .filter(({ args }) => pauliEquals(args[1], expected.error));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.result).toEqual(expected);
    expect(Object.isFrozen(calls[0]!.result)).toBe(true);
  });

  it("seed 62: a logical X error shows its residual at the verdict step", () => {
    const expected = expectedTrace(62);
    expect(expected.verdict).toBe(1);
    const residuals = count(expected.residual);
    expect(residuals).toBeGreaterThan(0);

    render(<App />);
    newShot(62);
    expect(visible()).toMatchObject({
      step: 0,
      errors: count(expected.error),
      residuals: 0,
    });
    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(button("steps.next"));
    expect(visible()).toMatchObject({
      step: LAST_STEP,
      chains: expected.chains.Z.length + expected.chains.X.length,
      residuals,
      verdict: i18n.t("grid.verdict.x"),
    });
    expect(
      panel().querySelector(".steps__verdict")?.getAttribute("data-verdict"),
    ).toBe("1");
    // The grid panel above is untouched by the steps panel's shot.
    const grid = document.querySelector(".panel--grid")!;
    expect(
      grid.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(0);
  });
});
