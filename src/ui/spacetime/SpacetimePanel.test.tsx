// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpacetimeHistory,
  rotatedSurfaceCode,
  type Distance,
} from "../../core";
import i18n from "../../i18n";
import {
  centralCycle,
  centralQubit,
  createSpacetimeTraceContext,
  decodeSpacetimeTrace,
  presetCheck,
  presetHistory,
  randomHistory,
} from "../model/spacetime-trace";
import { STEP_INTERVAL_MS } from "../steps/step-machine";
import { VIEWER_DEFAULT_P } from "./draw";
import { decodeHistory, encodeHistory } from "./link";
import {
  GAP_DEFAULT,
  GAP_MAX,
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  viewBoxOf,
} from "./projection";
import { SpacetimePanel } from "./SpacetimePanel";
import { VIEWER_LAST_STEP, VIEWER_STEPS } from "./viewer-steps";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

const button = (key: string) =>
  screen.getByRole("button", { name: i18n.t(key) }) as HTMLButtonElement;
const panel = () =>
  document.querySelector(".panel--spacetime") as HTMLElement | null;
const stepIndex = () => Number(panel()?.getAttribute("data-step"));
const svg = () => document.querySelector(".spacetime__svg") as SVGSVGElement;
// A wrapped title is one <tspan> per line (projection.ts titleLines).
const titles = () =>
  Array.from(svg().querySelectorAll("text.st-layer__title")).map((t) =>
    Array.from(t.querySelectorAll("tspan"))
      .map((s) => s.textContent ?? "")
      .join(" "),
  );
const count = (selector: string) =>
  panel()?.querySelectorAll(selector).length ?? 0;
const explain = () =>
  document.querySelector(".spacetime__explain")?.textContent ?? "";

/** Math.random → seed, so the next random shot is reproducible (seed < 2^53). */
function nextSeed(seed: number) {
  vi.spyOn(Math, "random").mockReturnValue(seed / 2 ** 53);
}

/** What the stack currently draws, by the hooks of D8: the readings on the planes, the story in the overlay. */
function visible() {
  return {
    step: stepIndex(),
    layers: count('[role="img"][data-layer]'),
    errors: count('[data-overlay] [data-qubit]:not([data-pauli="I"])'),
    fresh: count('[data-overlay] [data-new="1"]'),
    flips: count('[data-overlay] [data-flip="1"]'),
    measured: count('[role="img"] [data-measured="1"]'),
    defects: count('[data-overlay] [data-defect="1"]'),
    space: count('[data-overlay] [data-edge="space"]'),
    time: count('[data-overlay] [data-edge="time"]'),
    corrections: count(
      '[data-overlay] [data-qubit]:not([data-correction="I"])',
    ),
    residuals: count('[data-overlay] [data-qubit]:not([data-residual="I"])'),
    verdict: document.querySelector(".spacetime__verdict")?.textContent ?? null,
  };
}

/** The DOM order of `selectors` inside `root`: every match of selectors[i] precedes every match of selectors[i + 1]. */
function inOrder(root: Element, selectors: readonly string[]): boolean {
  const all = [...root.querySelectorAll("*")];
  let floor = -1;
  for (const selector of selectors) {
    const positions = [...root.querySelectorAll(selector)].map((el) =>
      all.indexOf(el),
    );
    if (positions.length === 0) continue;
    if (Math.min(...positions) <= floor) return false;
    floor = Math.max(...positions);
  }
  return true;
}

describe("SpacetimePanel (T-G7)", () => {
  // Seed 5 at d = 3, p = 0.01 has an event (measured with randomHistory).
  beforeEach(() => nextSeed(5));

  it("mounts on a random shot at its own p (0.01) with d + 1 layers, step 0, errors only; a new distance draws another shot", () => {
    const { rerender } = render(<SpacetimePanel d={3} />);
    expect(VIEWER_DEFAULT_P).toBe(0.01);
    const slider = panel()!.querySelector(
      ".spacetime__p input",
    ) as HTMLInputElement;
    expect(Number(slider.value)).toBe(0.01);
    const seen = visible();
    expect(seen.step).toBe(0);
    expect(seen.layers).toBe(4);
    expect(seen.errors + seen.flips).toBeGreaterThan(0);
    expect(seen.measured).toBe(0);
    expect(seen.defects).toBe(0);
    expect(seen.space + seen.time).toBe(0);
    expect(svg().getAttribute("data-distance")).toBe("3");
    expect(svg().getAttribute("viewBox")).toBe(
      viewBoxOf(3, 4, GAP_DEFAULT, titles()),
    );
    // The titles grow leftwards from their layer (text-anchor end) and carry
    // their size, face and weight inline, so no stylesheet can widen them
    // past the gutter.
    expect(titles()).toEqual([
      i18n.t("spacetime.cycle", { cycle: 1 }),
      i18n.t("spacetime.cycle", { cycle: 2 }),
      i18n.t("spacetime.cycle", { cycle: 3 }),
      i18n.t("spacetime.finalReadout"),
    ]);
    for (const t of Array.from(
      svg().querySelectorAll<SVGTextElement>("text.st-layer__title"),
    )) {
      expect(t.getAttribute("text-anchor")).toBe("end");
      expect(t.style.fontSize).toBe(`${TITLE_FONT_SIZE}px`);
      expect(t.style.fontFamily).toBe("var(--font-display)");
      expect(t.style.fontWeight).toBe(String(TITLE_FONT_WEIGHT));
    }
    fireEvent.click(button("spacetime.next"));
    expect(stepIndex()).toBe(1);
    rerender(<SpacetimePanel d={5} />);
    expect(visible().layers).toBe(6);
    expect(stepIndex()).toBe(0);
    expect(svg().getAttribute("data-distance")).toBe("5");
  });

  it("redraws an empty shot while p > 0 (seed 1 is empty at d = 3, p = 0.01; seed 5 is not), at most 32 draws", () => {
    // Probe (randomHistory + hasEvent): seeds 1, 7, 11 empty at
    // d = 3, p = 0.01; 0, 2, 3, 4, 5 have an event. Mutant: no redraw → 0 → red.
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(1 / 2 ** 53)
      .mockReturnValueOnce(7 / 2 ** 53)
      .mockReturnValue(5 / 2 ** 53);
    render(<SpacetimePanel d={3} />);
    const seen = visible();
    expect(seen.errors + seen.flips).toBeGreaterThan(0);
    expect(random).toHaveBeenCalledTimes(3);
  });

  it("lists the six steps in order, the first current; the layer list under the figure matches the trace's counts", () => {
    render(<SpacetimePanel d={3} />);
    const items = [...document.querySelectorAll(".spacetime__step")].map(
      (el) => el.textContent,
    );
    expect(items).toEqual(VIEWER_STEPS.map((s) => i18n.t(`spacetime.${s}`)));
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe(
      i18n.t("spacetime.errors"),
    );
    expect(explain()).toContain(i18n.t("spacetime.explain.errors"));
    // The accessible name of each layer <g> is the list item's text.
    const groups = [...panel()!.querySelectorAll('[role="img"][data-layer]')];
    const list = [...panel()!.querySelectorAll("[data-layer-summary]")];
    expect(groups).toHaveLength(4);
    expect(list.map((li) => li.textContent)).toEqual(
      groups.map((g) => g.getAttribute("aria-label")),
    );
    // The counts are the trace's, whatever the step shows: seed 5's history
    // decoded outside React.
    const trace = decodeSpacetimeTrace(
      createSpacetimeTraceContext(3),
      randomHistory(3, VIEWER_DEFAULT_P, 5),
    );
    const m = 4;
    const defectsIn = (layer: number) => {
      let n = 0;
      for (let s = 0; s < m; s++)
        n +=
          trace.detectors.Z[(layer - 1) * m + s]! +
          trace.detectors.X[(layer - 1) * m + s]!;
      return n;
    };
    expect(list[3]!.textContent).toBe(
      i18n.t("spacetime.finalLayerLabel", {
        defects: i18n.t("spacetime.count.finalDefects", {
          count: defectsIn(4),
        }),
      }),
    );
    expect(list[0]!.textContent).toContain(
      i18n.t("spacetime.cycle", { cycle: 1 }),
    );
    expect(list[0]!.textContent).toContain(`${defectsIn(1)} `);
  });

  it("the layer labels pluralise every count and the final readout never says 'perfect' beside its defects", () => {
    const d = 3;
    // Cycle 3: one flip, one new data error, 3 defects; final readout: 1 defect.
    const history = createSpacetimeHistory(rotatedSurfaceCode(d), d);
    history.flips[d - 1]!.X[presetCheck(d)] = 1;
    history.cycleErrors[d - 1]!.x[centralQubit(d)] = 1;
    render(<SpacetimePanel d={3} link={`#v=${encodeHistory(d, history)}`} />);
    const list = [...panel()!.querySelectorAll("[data-layer-summary]")].map(
      (li) => li.textContent,
    );
    expect(list[0]).toBe(
      "Cycle 1: 0 defects, 0 measurement failures, 0 new data errors",
    );
    expect(list[2]).toBe(
      "Cycle 3: 3 defects, 1 measurement failure, 1 new data error",
    );
    expect(list[3]).toBe(
      "Final readout, its readings perfect: 1 defect, from a measurement failure in the last cycle",
    );
    expect(list[3]).not.toMatch(/perfect\)/);
    fireEvent.click(button("spacetime.preset.data"));
    const after = [...panel()!.querySelectorAll("[data-layer-summary]")].map(
      (li) => li.textContent,
    );
    expect(after[3]).toBe("Final readout, its readings perfect: no defects");
    expect(after[1]).toBe(
      "Cycle 2: 2 defects, 0 measurement failures, 1 new data error",
    );
  });

  it("the six steps add layers: readings at 1, detectors at 2, edges at 3, correction on the final plane at 4, residual and verdict at 5", () => {
    render(<SpacetimePanel d={3} />);
    fireEvent.click(button("spacetime.preset.both"));
    const trace = decodeSpacetimeTrace(
      createSpacetimeTraceContext(3),
      presetHistory(3, "both"),
    );
    const defects = [...trace.detectors.Z, ...trace.detectors.X].filter(
      (b) => b === 1,
    ).length;
    const measured = [...trace.readings.Z, ...trace.readings.X].filter(
      (b) => b === 1,
    ).length;
    expect(defects).toBe(4);
    const at: ReturnType<typeof visible>[] = [visible()];
    for (let i = 0; i < VIEWER_LAST_STEP; i++) {
      fireEvent.click(button("spacetime.next"));
      at.push(visible());
    }
    expect(at.map((v) => v.step)).toEqual([0, 1, 2, 3, 4, 5]);
    // Errors from step 0: the cumulative X on the centre in layers ≥ 2 (d = 3,
    // central cycle 2) plus the final plane: 3 of 4 layers; one fresh ring;
    // one flip mark.
    expect(at[0]!.errors).toBe(3);
    expect(at[0]!.fresh).toBe(1);
    expect(at[0]!.flips).toBe(1);
    expect(at.map((v) => v.measured)).toEqual([
      0,
      measured,
      measured,
      measured,
      measured,
      measured,
    ]);
    expect(at.map((v) => v.defects)).toEqual([0, 0, 4, 4, 4, 4]);
    expect(at.map((v) => v.space > 0)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(at.map((v) => v.time)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(at.map((v) => v.corrections)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(at.map((v) => v.residuals)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(at.map((v) => v.verdict)).toEqual([
      null,
      null,
      null,
      null,
      null,
      i18n.t("grid.verdict.ok"),
    ]);
    expect(panel()!.getAttribute("data-verdict")).toBe("0");
    // The correction sits on the final plane only, and layers are painted in
    // order: the final layer is the last [data-layer] plane, and the overlay
    // that tells the story (flips, errors, defects, edges, correction) is the
    // SVG's last child, above every plane.
    expect(
      panel()!.querySelectorAll(
        '[data-overlay] [data-layer="4"] [data-qubit]:not([data-correction="I"])',
      ),
    ).toHaveLength(1);
    // The planes' qubits are at rest: position hooks only, no history (a
    // fixed data-pauli="I" on a plane was a false value).
    const rest = panel()!.querySelectorAll('[role="img"] [data-qubit]');
    expect(rest).toHaveLength(4 * 9);
    for (const el of rest) {
      expect([...el.attributes].map((a) => a.name).sort()).toEqual([
        "class",
        "data-col",
        "data-qubit",
        "data-rest",
        "data-row",
        "transform",
      ]);
      expect(el.getAttribute("data-rest")).toBe("1");
    }
    expect(
      panel()!.querySelector(
        '[role="img"] [data-pauli], [role="img"] [data-new], [role="img"] [data-correction], [role="img"] [data-residual], [role="img"] [data-defect], [role="img"] [data-flip], [role="img"] [data-edge]',
      ),
    ).toBeNull();
    const children = [...svg().children];
    expect(
      children.map((g) => g.getAttribute("data-layer") ?? "overlay"),
    ).toEqual(["1", "2", "3", "4", "overlay"]);
    expect(children.at(-1)!.hasAttribute("data-overlay")).toBe(true);
  });

  it("everything of the last cycle is drawn above the final plane: a flip and a data error in cycle d give [data-between=d] with a time edge and layer-d defects, all after the final plane in the DOM", () => {
    // The first occlusion case: with the final plane
    // opaque and the edges of layer d painted before it, 70 % of cycle 7 was
    // hidden at d = 7. Here d = 3: a flip of X check 0 and an X error on the
    // central qubit, both in cycle 3.
    const d = 3;
    const history = createSpacetimeHistory(rotatedSurfaceCode(d), d);
    history.flips[d - 1]!.X[presetCheck(d)] = 1;
    history.cycleErrors[d - 1]!.x[centralQubit(d)] = 1;
    render(<SpacetimePanel d={3} link={`#v=${encodeHistory(d, history)}`} />);
    fireEvent.click(button("spacetime.next"));
    fireEvent.click(button("spacetime.next"));
    fireEvent.click(button("spacetime.next"));
    expect(stepIndex()).toBe(3);
    const finalPlane = panel()!.querySelector(
      `[role="img"][data-layer="${d + 1}"]`,
    )!;
    const after = (el: Element) =>
      (finalPlane.compareDocumentPosition(el) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    const between = panel()!.querySelector(`[data-between="${d}"]`);
    expect(between).not.toBeNull();
    expect(between!.querySelector('[data-edge="time"]')).not.toBeNull();
    expect(after(between!)).toBe(true);
    const defects = [...panel()!.querySelectorAll('[data-defect="1"]')];
    const inLastCycle = defects.filter(
      (el) => el.closest("[data-layer]")!.getAttribute("data-layer") === "3",
    );
    expect(inLastCycle).toHaveLength(3); // X check flipped + the 2 Z checks of the centre
    expect(defects.filter(after)).toHaveLength(defects.length);
    const flip = panel()!.querySelector('[data-flip="1"]')!;
    expect(after(flip)).toBe(true);
    expect(
      [...panel()!.querySelectorAll('[data-qubit][data-pauli="X"]')].every(
        after,
      ),
    ).toBe(true);
    // The final plane itself carries no story: it is below everything.
    expect(finalPlane.querySelector("[data-defect], [data-edge]")).toBeNull();
    expect(finalPlane.querySelectorAll("[data-measured]").length).toBe(8);
  });

  it("the defects of every layer come first in the overlay, then per layer the flip marks, the qubits with errors and the edges; the correction and residual rings of the final plane come after every defect", () => {
    // The later occlusion cases: with the defects painted last in
    // their layer, the opaque defect polygon hid the flip mark and the error
    // disc that caused it; painted first in their layer, the defects
    // of layer ℓ + 1 still covered the marks, discs and edges of layer ℓ
    // (with gap 1.75 the plaquette (i − 2, j − 2) of ℓ + 1 projects
    // onto (i, j) of ℓ). Hence a first pass with the defects of every layer.
    // Same history as the first occlusion case (a flip and an X error in cycle d),
    // walked to the verdict, plus the "both" preset at d = 5.
    const STORY = ["[data-flip]", "[data-pauli]", "[data-between]"];
    const check = (expectedFull: number, finalDefects: number, L: number) => {
      const overlay = panel()!.querySelector("[data-overlay]")!;
      // First pass: the overlay's first child holds every defect, grouped per
      // layer in ascending order, and nothing else.
      const pass = overlay.firstElementChild!;
      expect(pass.hasAttribute("data-defects")).toBe(true);
      const defectGroups = [...pass.children];
      expect(defectGroups.length).toBeGreaterThan(0);
      const defectLayers = defectGroups.map((g) =>
        Number(g.getAttribute("data-layer")),
      );
      expect(defectLayers).toEqual([...defectLayers].sort((a, b) => a - b));
      for (const g of defectGroups) {
        expect(g.querySelectorAll("[data-defect]").length).toBeGreaterThan(0);
        expect(g.querySelector(STORY.join(", "))).toBeNull();
      }
      expect(pass.querySelectorAll("[data-defect]")).toHaveLength(
        overlay.querySelectorAll("[data-defect]").length,
      );
      expect(
        pass.querySelectorAll(`[data-layer="${L}"] [data-defect]`),
      ).toHaveLength(finalDefects);
      // Every defect, of any layer, precedes every mark, disc and edge, of any
      // layer; in particular the final plane's rings come after every defect.
      expect(inOrder(overlay, ["[data-defect]", STORY.join(", ")])).toBe(true);
      expect(inOrder(overlay, ["[data-defect]", "[data-correction]"])).toBe(
        true,
      );
      expect(inOrder(overlay, ["[data-defect]", "[data-residual]"])).toBe(true);
      // Second pass: one story group per layer, ascending, each in the order
      // flips → qubits → edges and without defects.
      const stories = [...overlay.children].slice(1);
      expect(stories.length).toBeGreaterThan(0);
      const storyLayers = stories.map((g) =>
        Number(g.getAttribute("data-layer")),
      );
      expect(storyLayers).toEqual([...storyLayers].sort((a, b) => a - b));
      let full = 0;
      for (const g of stories) {
        expect(g.hasAttribute("data-defects")).toBe(false);
        expect(g.querySelector("[data-defect]")).toBeNull();
        expect(inOrder(g, STORY), g.getAttribute("data-layer")!).toBe(true);
        if (STORY.every((s) => g.querySelector(s) !== null)) full++;
      }
      expect(full).toBe(expectedFull);
      const last = stories.at(-1)!;
      expect(last.getAttribute("data-layer")).toBe(String(L));
      expect(
        last.querySelector('[data-qubit]:not([data-correction="I"])'),
      ).not.toBeNull();
      expect(last.querySelector("[data-residual]")).not.toBeNull();
    };
    const d = 3;
    const history = createSpacetimeHistory(rotatedSurfaceCode(d), d);
    history.flips[d - 1]!.X[presetCheck(d)] = 1;
    history.cycleErrors[d - 1]!.x[centralQubit(d)] = 1;
    render(<SpacetimePanel d={3} link={`#v=${encodeHistory(d, history)}`} />);
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      fireEvent.click(button("spacetime.next"));
    expect(stepIndex()).toBe(VIEWER_LAST_STEP);
    check(1, 1, d + 1); // layer 3 has the three kinds; layer 4: the flip's second defect, then the correction
    // The round-3 case in miniature: the final plane's defect (layer 4) is
    // painted before the flip mark and the error disc of layer 3.
    const overlay = panel()!.querySelector("[data-overlay]")!;
    expect(
      inOrder(overlay, [
        '[data-defects] [data-layer="4"] [data-defect]',
        '[data-layer="3"] [data-flip], [data-layer="3"] [data-pauli]',
      ]),
    ).toBe(true);
    cleanup();
    render(<SpacetimePanel d={5} />);
    fireEvent.click(button("spacetime.preset.both"));
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      fireEvent.click(button("spacetime.next"));
    check(1, 0, 6); // the central cycle; the final readout has no defect here
  });

  it('preset "flip": two defects on one plaquette in consecutive layers, one reading lit, no correction, verdict 0', () => {
    render(<SpacetimePanel d={5} />);
    fireEvent.click(button("spacetime.preset.flip"));
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      fireEvent.click(button("spacetime.next"));
    const seen = visible();
    expect(seen.errors).toBe(0);
    expect(seen.flips).toBe(1);
    expect(seen.measured).toBe(1);
    expect(seen.defects).toBe(2);
    expect(seen.space).toBe(0);
    expect(seen.time).toBe(1);
    expect(seen.corrections).toBe(0);
    expect(seen.residuals).toBe(0);
    expect(seen.verdict).toBe(i18n.t("grid.verdict.ok"));
    const defects = [...panel()!.querySelectorAll('[data-defect="1"]')];
    const plaquettes = new Set(
      defects.map((el) => el.getAttribute("data-plaquette")),
    );
    expect(plaquettes.size).toBe(1);
    const layers = defects.map((el) =>
      Number(el.closest("[data-layer]")!.getAttribute("data-layer")),
    );
    const r = centralCycle(5);
    expect(layers).toEqual([r, r + 1]);
    expect(
      panel()!
        .querySelector('[data-measured="1"]')!
        .closest("[data-layer]")!
        .getAttribute("data-layer"),
    ).toBe(String(r));
  });

  it('preset "data": readings lit in every layer from the central one, detectors in one layer, correction on one qubit', () => {
    render(<SpacetimePanel d={5} />);
    fireEvent.click(button("spacetime.preset.data"));
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      fireEvent.click(button("spacetime.next"));
    const seen = visible();
    const r = centralCycle(5);
    expect(seen.flips).toBe(0);
    expect(seen.errors).toBe(6 - r + 1); // layers r … 6 show the cumulative X
    expect(seen.fresh).toBe(1);
    const measuredLayers = [
      ...panel()!.querySelectorAll('[data-measured="1"]'),
    ].map((el) =>
      Number(el.closest("[data-layer]")!.getAttribute("data-layer")),
    );
    expect([...new Set(measuredLayers)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 6 - r + 1 }, (_, i) => r + i),
    );
    const defectLayers = [
      ...panel()!.querySelectorAll('[data-defect="1"]'),
    ].map((el) =>
      Number(el.closest("[data-layer]")!.getAttribute("data-layer")),
    );
    expect(defectLayers).toEqual([r, r]);
    expect(seen.corrections).toBe(1);
    expect(seen.time).toBe(0);
    expect(seen.verdict).toBe(i18n.t("grid.verdict.ok"));
  });

  it("back, repeat and play: play advances every 1 200 ms and stops on the last step", () => {
    vi.useFakeTimers();
    render(<SpacetimePanel d={3} />);
    fireEvent.click(button("spacetime.next"));
    fireEvent.click(button("spacetime.next"));
    expect(stepIndex()).toBe(2);
    fireEvent.click(button("spacetime.prev"));
    expect(stepIndex()).toBe(1);
    fireEvent.click(button("spacetime.restart"));
    expect(stepIndex()).toBe(0);
    expect(button("spacetime.prev").disabled).toBe(true);
    expect(button("spacetime.restart").disabled).toBe(true);
    fireEvent.click(button("spacetime.play"));
    expect(
      screen.queryByRole("button", { name: i18n.t("spacetime.pause") }),
    ).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS);
    });
    expect(stepIndex()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS * 10);
    });
    expect(stepIndex()).toBe(VIEWER_LAST_STEP);
    expect(button("spacetime.next").disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: i18n.t("spacetime.pause") }),
    ).toBeNull();
  });

  it("the view radios change data-view and move the points; the gap slider changes data-gap and the viewBox; both persist", () => {
    render(<SpacetimePanel d={3} />);
    const before = svg()
      .querySelector('[data-qubit="0"]')!
      .getAttribute("transform");
    expect(panel()!.getAttribute("data-view")).toBe("0");
    fireEvent.click(screen.getByLabelText(i18n.t("spacetime.view.right")));
    expect(panel()!.getAttribute("data-view")).toBe("1");
    expect(svg().getAttribute("data-view")).toBe("1");
    expect(
      svg().querySelector('[data-qubit="0"]')!.getAttribute("transform"),
    ).not.toBe(before);
    expect(window.localStorage.getItem("syndrome.spacetime.view")).toBe("1");
    const gap = panel()!.querySelector(
      ".spacetime__gap input",
    ) as HTMLInputElement;
    expect(Number(gap.value)).toBe(GAP_DEFAULT);
    fireEvent.change(gap, { target: { value: String(GAP_MAX) } });
    expect(panel()!.getAttribute("data-gap")).toBe(String(GAP_MAX));
    expect(svg().getAttribute("viewBox")).toBe(
      viewBoxOf(3, 4, GAP_MAX, titles()),
    );
    expect(window.localStorage.getItem("syndrome.spacetime.gap")).toBe(
      String(GAP_MAX),
    );
    cleanup();
    render(<SpacetimePanel d={3} />);
    expect(panel()!.getAttribute("data-view")).toBe("1");
    expect(panel()!.getAttribute("data-gap")).toBe(String(GAP_MAX));
  });

  it("a valid #v= link loads that history (equal to decodeHistory outside React) at the link's distance; a bad one shows spacetime.badLink", () => {
    const history = randomHistory(5, 0.05, 77);
    const text = encodeHistory(5, history);
    render(<SpacetimePanel d={3} link={`#v=${text}`} />);
    expect(svg().getAttribute("data-distance")).toBe("5");
    expect(panel()!.getAttribute("data-from-link")).toBe("1");
    expect(panel()!.textContent).toContain(i18n.t("spacetime.fromLink"));
    const expected = decodeSpacetimeTrace(
      createSpacetimeTraceContext(5),
      decodeHistory(text)!.history,
    );
    const flips = [...expected.history.flips].reduce(
      (n, f) => n + [...f.Z, ...f.X].filter((b) => b === 1).length,
      0,
    );
    expect(visible().flips).toBe(flips);
    cleanup();
    render(<SpacetimePanel d={3} link="#v=f3.zzz" />);
    expect(panel()!.textContent).toContain(i18n.t("spacetime.badLink"));
    expect(panel()!.getAttribute("data-from-link")).toBe("0");
    cleanup();
    render(<SpacetimePanel d={3} link="#c=i3.gAA" />);
    expect(panel()!.textContent).not.toContain(i18n.t("spacetime.badLink"));
  });

  it("the bad-link note goes away with any shot started afterwards (preset, new shot, new distance) while the hash stays; a new bad link brings it back", () => {
    const { rerender } = render(<SpacetimePanel d={3} link="#v=f3.zzz" />);
    const note = () =>
      panel()!.textContent!.includes(i18n.t("spacetime.badLink"));
    expect(note()).toBe(true);
    fireEvent.click(button("spacetime.preset.flip"));
    expect(note()).toBe(false);
    rerender(<SpacetimePanel d={3} link="#v=f3.yyy" />);
    expect(note()).toBe(true);
    fireEvent.click(button("spacetime.newShot"));
    expect(note()).toBe(false);
    rerender(<SpacetimePanel d={3} link="#v=f5.zzz" />);
    expect(note()).toBe(true);
    rerender(<SpacetimePanel d={5} link="#v=f5.zzz" />);
    expect(note()).toBe(false);
  });

  it("a link that arrives after mount (hashchange) replaces the shot", () => {
    const { rerender } = render(<SpacetimePanel d={3} />);
    expect(svg().getAttribute("data-distance")).toBe("3");
    rerender(
      <SpacetimePanel
        d={3}
        link={`#v=${encodeHistory(7, randomHistory(7, 0.02, 1))}`}
      />,
    );
    expect(svg().getAttribute("data-distance")).toBe("7");
    expect(visible().layers).toBe(8);
  });

  it("copying the link writes the current shot's #v= URL to the clipboard and says so; a failure says so too", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SpacetimePanel d={3} />);
    fireEvent.click(button("spacetime.preset.flip"));
    await act(async () => {
      fireEvent.click(button("spacetime.copy"));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0]![0] as string;
    const hash = url.slice(url.indexOf("#"));
    expect(hash.startsWith("#v=f3.")).toBe(true);
    expect(decodeHistory(hash.slice(3))!.history).toEqual(
      presetHistory(3, "flip"),
    );
    expect(panel()!.textContent).toContain(i18n.t("spacetime.copied"));
    writeText.mockRejectedValue(new Error("denied"));
    await act(async () => {
      fireEvent.click(button("spacetime.copy"));
    });
    expect(panel()!.textContent).toContain(i18n.t("spacetime.copyFailed"));
    // A new shot clears the message.
    fireEvent.click(button("spacetime.preset.data"));
    expect(panel()!.textContent).not.toContain(i18n.t("spacetime.copyFailed"));
  });

  it("the p slider does not resample; a new random shot uses the current p (the slider's top, 0.2: the history of that seed at p = 0.2)", () => {
    render(<SpacetimePanel d={3} />);
    const before = visible();
    const slider = panel()!.querySelector(
      ".spacetime__p input",
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.2" } });
    expect(Number(slider.value)).toBe(0.2);
    expect(visible()).toEqual(before);
    nextSeed(21);
    fireEvent.click(button("spacetime.newShot"));
    const expected = randomHistory(3, 0.2, 21);
    const flips = expected.flips.reduce(
      (n, f) => n + [...f.Z, ...f.X].filter((b) => b === 1).length,
      0,
    );
    const fresh = expected.cycleErrors.reduce(
      (n, e) => n + [...e.x].filter((b, q) => (b | e.z[q]!) === 1).length,
      0,
    );
    expect(flips + fresh).toBeGreaterThan(3);
    expect(visible().flips).toBe(flips);
    expect(visible().fresh).toBe(fresh);
    // At p = 0.01 the same seed would show far less.
    const low = randomHistory(3, 0.01, 21);
    expect(
      low.flips.reduce(
        (n, f) => n + [...f.Z, ...f.X].filter((b) => b === 1).length,
        0,
      ),
    ).toBeLessThan(flips);
  });

  it("d = 9 shows the density note; d = 7 does not", () => {
    render(<SpacetimePanel d={9 as Distance} />);
    expect(panel()!.textContent).toContain(i18n.t("spacetime.largeDistance"));
    expect(visible().layers).toBe(10);
    cleanup();
    render(<SpacetimePanel d={7} />);
    expect(panel()!.textContent).not.toContain(
      i18n.t("spacetime.largeDistance"),
    );
  });

  it("renders in Spanish", async () => {
    await i18n.changeLanguage("es");
    try {
      render(<SpacetimePanel d={3} />);
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Espacio y tiempo",
      );
      expect(button("spacetime.newShot").textContent).toBe(
        "Nueva tirada aleatoria",
      );
      expect(explain()).toContain("En cada ciclo el ruido golpea");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
