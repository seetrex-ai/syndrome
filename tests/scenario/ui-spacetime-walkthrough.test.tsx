// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SpacetimeShotContext } from "../../src/core";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import {
  createSpacetimeTraceContext,
  decodeSpacetimeTrace,
  presetHistory,
  randomHistory,
  type SpacetimeTrace,
} from "../../src/ui/model/spacetime-trace";
import { VIEWER_DEFAULT_P } from "../../src/ui/spacetime/draw";
import { decodeHistory, encodeHistory } from "../../src/ui/spacetime/link";
import { VIEWER_LAST_STEP } from "../../src/ui/spacetime/viewer-steps";
import { fakeWorkerFactory } from "../helpers/fake-worker";

/**
 * test_scenario_ui_spacetime_walkthrough
 *
 * The spacetime viewer end to end through the real App (tasks/plans/phase2-g.md
 * T-S-G1): the page opens on a `#v=` link of a d = 3 history built outside
 * React (the "both" preset: one measurement failure of an X check and one X
 * error on the centre, central cycle) → the viewer shows that very history (its
 * trace equals a decode done outside the UI) → six steps with the layers only
 * growing → "flip" gives two consecutive defects on one plaquette and no
 * correction; "data" gives detectors in one layer and a one-qubit correction;
 * both verdict 0 → a new random shot at the viewer's p (seeded) → copy link:
 * the clipboard's `#v=` decodes to the shown history → a `#c=` link pasted
 * afterwards opens nothing in the viewer and the challenge still reads it; a
 * bad `#v=` is the viewer's note only. The mounted panel decoded each shown
 * history exactly once.
 *
 * Measured while writing it: under the App's Suspense, React 19 renders the
 * lazy panel a second time with a throw-away instance (a fresh context and a
 * fresh draw of the same seed) at mount and again during the async copy; the
 * committed panel (same <section>, same context) is not re-decoded. The
 * counts below are therefore per CONTEXT: the committed context decodes once
 * per shown history and never on a step, a copy or a foreign link; the panel
 * alone has no such extra render (tests/intent/viewer-conventions).
 */

vi.mock("../../src/ui/model/spacetime-trace", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../src/ui/model/spacetime-trace")>();
  return { ...mod, decodeSpacetimeTrace: vi.fn(mod.decodeSpacetimeTrace) };
});

// The lazy chunks of the App, loaded once here so the findByRole below waits
// for a render, not for a cold import().
beforeAll(async () => {
  await import("../../src/ui/spacetime/SpacetimePanel");
  await import("../../src/ui/chart/ChartPanel");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.location.hash = "";
  window.localStorage.clear();
});

const spy = vi.mocked(decodeSpacetimeTrace);

/** Decode calls made with `ctx`, in order. */
function callsWith(ctx: SpacetimeShotContext) {
  return spy.mock.calls
    .map((call, i) => ({
      ctx: call[0],
      history: call[1],
      result: spy.mock.results[i]!.value,
    }))
    .filter((c) => c.ctx === ctx);
}

function panel(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".panel--spacetime");
  if (el === null) throw new Error("spacetime panel not rendered");
  return el;
}

function button(key: string): HTMLButtonElement {
  const found = [...panel().querySelectorAll("button")].find(
    (b) => b.textContent === i18n.t(key),
  );
  if (found === undefined) throw new Error(`button ${key} not rendered`);
  return found;
}

function visible() {
  const p = panel();
  const n = (selector: string) => p.querySelectorAll(selector).length;
  return {
    step: Number(p.getAttribute("data-step")),
    // The story lives in the overlay; the planes carry readings and rest
    // qubits only.
    errors: n('[data-overlay] [data-qubit]:not([data-pauli="I"])'),
    flips: n('[data-overlay] [data-flip="1"]'),
    measured: n('[role="img"] [data-measured="1"]'),
    defects: n('[data-overlay] [data-defect="1"]'),
    edges: n("[data-overlay] [data-edge]"),
    corrections: n('[data-overlay] [data-qubit]:not([data-correction="I"])'),
    residuals: n('[data-overlay] [data-qubit]:not([data-residual="I"])'),
    verdict: p.querySelector(".spacetime__verdict")?.textContent ?? null,
  };
}

function sameTrace(a: SpacetimeTrace, b: SpacetimeTrace): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe("test_scenario_ui_spacetime_walkthrough", () => {
  it("link → six steps → presets → new shot → copy link → the challenge link leaves the viewer alone; one decode per shown history", async () => {
    const linked = presetHistory(3, "both");
    const link = `#v=${encodeHistory(3, linked)}`;
    window.location.hash = link;
    const expected = decodeSpacetimeTrace(
      createSpacetimeTraceContext(3),
      linked,
    );
    const factory = fakeWorkerFactory();
    spy.mockClear();
    render(<App createWorker={factory.create} />);
    // "Copy link to this shot" exists only in the viewer ("New random shot"
    // is also the 2D walkthrough's button and would match before the chunk).
    await screen.findByRole(
      "button",
      { name: i18n.t("spacetime.copy") },
      { timeout: 10_000 },
    );
    // Every mount render decoded the linked history (see the docstring).
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const result of spy.mock.results) {
      expect(sameTrace(result.value, expected)).toBe(true);
    }
    expect(panel().getAttribute("data-from-link")).toBe("1");
    expect(panel().textContent).toContain(i18n.t("spacetime.fromLink"));
    const section = panel();

    // Six steps: layers only grow.
    const frames = [visible()];
    for (let i = 0; i < VIEWER_LAST_STEP; i++) {
      fireEvent.click(button("spacetime.next"));
      frames.push(visible());
    }
    expect(frames.map((f) => f.step)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(frames[0]).toMatchObject({
      errors: 3,
      flips: 1,
      measured: 0,
      defects: 0,
      edges: 0,
      corrections: 0,
      residuals: 0,
      verdict: null,
    });
    expect(frames[1]!.measured).toBeGreaterThan(0);
    expect(frames[1]!.defects).toBe(0);
    expect(frames[2]!.defects).toBe(4);
    expect(frames[2]!.edges).toBe(0);
    expect(frames[3]!.edges).toBeGreaterThan(0);
    expect(frames[3]!.corrections).toBe(0);
    expect(frames[4]!.corrections).toBe(1);
    expect(frames[4]!.verdict).toBeNull();
    expect(frames[5]!.residuals).toBe(0);
    expect(frames[5]!.verdict).toBe(i18n.t("grid.verdict.ok"));
    for (let i = 1; i < frames.length; i++) {
      for (const key of [
        "measured",
        "defects",
        "edges",
        "corrections",
      ] as const) {
        expect(frames[i]![key]).toBeGreaterThanOrEqual(frames[i - 1]![key]);
      }
    }
    const afterSteps = spy.mock.calls.length;

    // "flip": two defects a cycle apart on one plaquette, no correction. The
    // context of this decode is the committed panel's; from here on every
    // count is on that context.
    fireEvent.click(button("spacetime.preset.flip"));
    expect(spy.mock.calls.length).toBe(afterSteps + 1);
    const ctx = spy.mock.calls[afterSteps]![0];
    expect(callsWith(ctx).map((c) => c.history)).toHaveLength(2); // linked, flip
    expect(sameTrace(callsWith(ctx)[0]!.result, expected)).toBe(true);
    expect(panel().getAttribute("data-step")).toBe("0");
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      fireEvent.click(button("spacetime.next"));
    const flip = visible();
    expect(flip.errors).toBe(0);
    expect(flip.defects).toBe(2);
    expect(flip.measured).toBe(1);
    expect(flip.corrections).toBe(0);
    expect(flip.verdict).toBe(i18n.t("grid.verdict.ok"));
    const defectLayers = [...panel().querySelectorAll('[data-defect="1"]')].map(
      (el) => Number(el.closest("[data-layer]")!.getAttribute("data-layer")),
    );
    expect(defectLayers).toEqual([2, 3]);
    expect(callsWith(ctx)).toHaveLength(2);

    // "data": detectors in one layer, a one-qubit correction.
    fireEvent.click(button("spacetime.preset.data"));
    expect(callsWith(ctx)).toHaveLength(3);
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      fireEvent.click(button("spacetime.next"));
    const data = visible();
    expect(data.flips).toBe(0);
    expect(data.defects).toBe(2);
    expect(
      new Set(
        [...panel().querySelectorAll('[data-defect="1"]')].map((el) =>
          el.closest("[data-layer]")!.getAttribute("data-layer"),
        ),
      ).size,
    ).toBe(1);
    expect(data.corrections).toBe(1);
    expect(data.verdict).toBe(i18n.t("grid.verdict.ok"));

    // A new random shot at the viewer's own p (0.01), seeded: the history of
    // that seed.
    vi.spyOn(Math, "random").mockReturnValue(5 / 2 ** 53);
    fireEvent.click(button("spacetime.newShot"));
    expect(callsWith(ctx)).toHaveLength(4);
    expect(panel().getAttribute("data-from-link")).toBe("0");
    const drawn = decodeSpacetimeTrace(
      createSpacetimeTraceContext(3),
      randomHistory(3, VIEWER_DEFAULT_P, 5),
    );
    expect(sameTrace(callsWith(ctx)[3]!.result, drawn)).toBe(true);

    // Copy link: the clipboard's #v= decodes to the shown history.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => {
      fireEvent.click(button("spacetime.copy"));
    });
    const url = writeText.mock.calls[0]![0] as string;
    const hash = url.slice(url.indexOf("#"));
    expect(decodeHistory(hash.slice(3))!.history).toEqual(
      randomHistory(3, VIEWER_DEFAULT_P, 5),
    );
    expect(panel().textContent).toContain(i18n.t("spacetime.copied"));
    expect(panel()).toBe(section);
    expect(callsWith(ctx)).toHaveLength(4);

    // A challenge link pasted into the open page: the challenge opens it, the
    // viewer keeps its shot and decodes nothing.
    act(() => {
      window.location.hash = "#c=i3.gAA";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(callsWith(ctx)).toHaveLength(4);
    expect(panel()).toBe(section);
    expect(panel().textContent).not.toContain(i18n.t("spacetime.badLink"));
    expect(document.querySelector(".panel--challenge")?.textContent).toContain(
      i18n.t("challenge.fromLink"),
    );
    // And a bad viewer link pasted afterwards is the viewer's note only: the
    // challenge's puzzle stays.
    act(() => {
      window.location.hash = "#v=f3.zzz";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(panel().textContent).toContain(i18n.t("spacetime.badLink"));
    expect(
      document.querySelector(".panel--challenge")?.textContent,
    ).not.toContain(i18n.t("challenge.badLink"));
    expect(callsWith(ctx)).toHaveLength(4);
  });
});
