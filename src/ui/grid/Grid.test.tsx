// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOUNDARY,
  LOGICAL_X,
  LOGICAL_Z,
  createRng,
  identity,
  independentNoise,
  logicalEffect,
  multiplyInto,
  pauliFrom,
  qubitIndex,
  rotatedSurfaceCode,
  sampleNoise,
  type StabilizerType,
} from "../../core";
import i18n from "../../i18n";
import { LONG_PRESS_MS } from "../model/gesture";
import { createTraceContext, decodeTrace, type Layer } from "../model/trace";
import { UNIT, pauliName, plaquettePoint, qubitPoint } from "./geometry";
import { Grid } from "./Grid";

afterEach(cleanup);

const code3 = rotatedSurfaceCode(3);

function traceOf(d: number, xQubits: number[], zQubits: number[] = []) {
  return decodeTrace(createTraceContext(d), pauliFrom(d * d, xQubits, zQubits));
}

function qubitEl(container: HTMLElement, q: number): Element {
  const el = container.querySelector(`[data-qubit="${q}"]`);
  if (el === null) throw new Error(`qubit ${q} not rendered`);
  return el;
}

function numbers(attribute: string | null | undefined): number[] {
  return (attribute ?? "").split(/[ ,]/).map(Number);
}

function typeIndexAt(row: number, col: number): number {
  const s = code3.stabilizers.find((x) => x.row === row && x.col === col);
  if (s === undefined) throw new Error(`no plaquette at (${row}, ${col})`);
  return s.typeIndex;
}

describe("Grid", () => {
  it.each([3, 5, 7, 9])(
    "d = %i draws d² qubits and d² − 1 plaquettes, half of each type",
    (d) => {
      const { container } = render(<Grid trace={traceOf(d, [])} />);
      expect(container.querySelectorAll("[data-qubit]")).toHaveLength(d * d);
      expect(container.querySelectorAll("[data-plaquette]")).toHaveLength(
        d * d - 1,
      );
      for (const type of ["Z", "X"]) {
        expect(
          container.querySelectorAll(`[data-plaquette][data-type="${type}"]`),
        ).toHaveLength((d * d - 1) / 2);
      }
      expect(
        container.querySelector("svg")?.getAttribute("data-distance"),
      ).toBe(String(d));
    },
  );

  it("lights exactly the plaquettes of the syndrome", () => {
    const { container } = render(
      <Grid trace={traceOf(3, [qubitIndex(3, 1, 1)])} />,
    );
    const lit = [...container.querySelectorAll('[data-defect="1"]')].map(
      (el) => [el.getAttribute("data-type"), el.getAttribute("data-plaquette")],
    );
    expect(lit).toEqual([
      ["Z", String(typeIndexAt(0, 0))],
      ["Z", String(typeIndexAt(1, 1))],
    ]);
    expect(
      container
        .querySelector(`[data-qubit="${qubitIndex(3, 1, 1)}"]`)
        ?.getAttribute("data-pauli"),
    ).toBe("X");
  });

  it("draws one matching edge and one chain polyline per pair", () => {
    const { container } = render(
      <Grid trace={traceOf(3, [qubitIndex(3, 1, 1)], [qubitIndex(3, 0, 0)])} />,
    );
    const chains = container.querySelectorAll("polyline[data-chain]");
    const matches = container.querySelectorAll("line[data-match]");
    expect(chains).toHaveLength(2);
    expect(matches).toHaveLength(2);
    expect([...chains].map((c) => c.getAttribute("data-type")).sort()).toEqual([
      "X",
      "Z",
    ]);
    for (const chain of chains) {
      expect(
        chain.getAttribute("points")?.split(" ").length,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  // What the grid draws is pinned to the physics, not to the trace's own fields:
  // the correction on a qubit is the union of the chains, the residual is
  // error · correction (recomputed here with the core), and the verdict is the
  // logical effect of that residual.
  it.each([3, 5, 7])(
    "d = %i: correction = union of the chains, residual = error · correction, verdict = its logical effect",
    (d) => {
      const code = rotatedSurfaceCode(d);
      const ctx = createTraceContext(d);
      const noise = independentNoise(0.12);
      let logical = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const error = sampleNoise(noise, createRng(seed), identity(d * d));
        const trace = decodeTrace(ctx, error);
        const correction = identity(d * d);
        for (const chain of trace.chains.Z)
          for (const q of chain.qubits) correction.x[q] = correction.x[q]! ^ 1;
        for (const chain of trace.chains.X)
          for (const q of chain.qubits) correction.z[q] = correction.z[q]! ^ 1;
        const residual = multiplyInto(identity(d * d), error, correction);
        const { container, unmount } = render(<Grid trace={trace} />);
        for (let q = 0; q < d * d; q++) {
          const el = container.querySelector(`[data-qubit="${q}"]`);
          expect(el?.getAttribute("data-pauli")).toBe(
            pauliName(error.x[q]!, error.z[q]!),
          );
          expect(el?.getAttribute("data-correction")).toBe(
            pauliName(correction.x[q]!, correction.z[q]!),
          );
          expect(el?.getAttribute("data-residual")).toBe(
            pauliName(residual.x[q]!, residual.z[q]!),
          );
        }
        const effect = logicalEffect(code, residual);
        expect(trace.verdict).toBe(
          (effect.x ? LOGICAL_X : 0) | (effect.z ? LOGICAL_Z : 0),
        );
        if (trace.verdict !== 0) logical++;
        unmount();
      }
      // p = 0.12 is above threshold: some shots must end in a logical error.
      expect(logical).toBeGreaterThan(0);
    },
  );

  it.each([3, 5, 7])(
    "d = %i: every chain polyline starts at the centre of a lit plaquette of its own type",
    (d) => {
      const code = rotatedSurfaceCode(d);
      const ctx = createTraceContext(d);
      const noise = independentNoise(0.1);
      let chains = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const error = sampleNoise(noise, createRng(seed), identity(d * d));
        const trace = decodeTrace(ctx, error);
        const { container, unmount } = render(<Grid trace={trace} />);
        const litCentres = new Set(
          [
            ...container.querySelectorAll('[data-plaquette][data-defect="1"]'),
          ].map((el) => {
            const type = el.getAttribute("data-type") as StabilizerType;
            const s =
              code.stabilizersByType[type][
                Number(el.getAttribute("data-plaquette"))
              ]!;
            return `${type}:${plaquettePoint(s).join(",")}`;
          }),
        );
        for (const polyline of container.querySelectorAll(
          "polyline[data-chain]",
        )) {
          const first = polyline.getAttribute("points")?.split(" ")[0];
          expect(
            litCentres.has(`${polyline.getAttribute("data-type")}:${first}`),
          ).toBe(true);
          chains++;
        }
        unmount();
      }
      expect(chains).toBeGreaterThan(0);
    },
  );

  it("hides what the layers prop leaves out", () => {
    const trace = traceOf(3, [qubitIndex(3, 1, 1)]);
    const only = (...layers: Layer[]) => new Set<Layer>(layers);
    const errorsOnly = render(<Grid trace={trace} layers={only("errors")} />);
    expect(
      errorsOnly.container.querySelectorAll('[data-defect="1"]'),
    ).toHaveLength(0);
    expect(
      errorsOnly.container.querySelectorAll("polyline[data-chain]"),
    ).toHaveLength(0);
    expect(
      errorsOnly.container.querySelectorAll("line[data-match]"),
    ).toHaveLength(0);
    expect(
      errorsOnly.container.querySelectorAll('[data-qubit][data-pauli="X"]'),
    ).toHaveLength(1);
    cleanup();

    const defectsOnly = render(<Grid trace={trace} layers={only("defects")} />);
    expect(
      defectsOnly.container.querySelectorAll('[data-defect="1"]'),
    ).toHaveLength(2);
    expect(
      defectsOnly.container.querySelectorAll(
        '[data-qubit]:not([data-pauli="I"])',
      ),
    ).toHaveLength(0);
    cleanup();

    const matchingOnly = render(
      <Grid trace={trace} layers={only("matching")} />,
    );
    expect(
      matchingOnly.container.querySelectorAll("line[data-match]"),
    ).toHaveLength(1);
    expect(
      matchingOnly.container.querySelectorAll("polyline[data-chain]"),
    ).toHaveLength(0);
  });

  it("is read-only without toggle callbacks and a set of buttons with them", () => {
    const trace = traceOf(3, []);
    const readOnly = render(<Grid trace={trace} />);
    expect(readOnly.container.querySelectorAll('[role="button"]')).toHaveLength(
      0,
    );
    cleanup();
    const onToggleX = vi.fn();
    const { container } = render(<Grid trace={trace} onToggleX={onToggleX} />);
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(9);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      i18n.t("grid.title"),
    );
  });

  it("names every qubit on a role (button or image): a sentence without an error, the Pauli letter with one", () => {
    const q = qubitIndex(3, 1, 1);
    const trace = traceOf(3, [q]);
    const { container } = render(<Grid trace={trace} />);
    const qubits = [...container.querySelectorAll("[data-qubit]")];
    expect(qubits).toHaveLength(9);
    for (const el of qubits) {
      expect(el.getAttribute("role")).toBe("img");
      expect(el.getAttribute("aria-label")).toBeTruthy();
    }
    expect(
      container.querySelector('[data-qubit="0"]')?.getAttribute("aria-label"),
    ).toBe(i18n.t("grid.qubitNoError", { row: 0, col: 0 }));
    expect(
      container
        .querySelector(`[data-qubit="${q}"]`)
        ?.getAttribute("aria-label"),
    ).toBe(i18n.t("grid.qubit", { row: 1, col: 1, pauli: "X" }));
    expect(i18n.t("grid.qubitNoError", { row: 0, col: 0 })).not.toMatch(
      /\bI\b/,
    );
  });

  it("with the errors layer hidden a qubit's name claims nothing about its error", () => {
    const q = qubitIndex(3, 1, 1);
    const { container } = render(
      <Grid trace={traceOf(3, [q])} layers={new Set<Layer>(["defects"])} />,
    );
    const name = qubitEl(container, q).getAttribute("aria-label");
    expect(name).toBe(i18n.t("grid.qubitHidden", { row: 1, col: 1 }));
    expect(name).not.toBe(i18n.t("grid.qubitNoError", { row: 1, col: 1 }));
    expect(name).not.toBe(i18n.t("grid.qubit", { row: 1, col: 1, pauli: "X" }));
    expect(qubitEl(container, q).getAttribute("data-pauli")).toBe("I");
  });

  // Every polyline is pinned point by point to its chain: a → its qubits in
  // walking order → b, or half a unit past the last qubit for a boundary chain;
  // the matching edge joins the same two ends.
  it.each([3, 5, 7])(
    "d = %i: each chain polyline runs a → qubits → b (or off the board), and its matching edge joins its ends",
    (d) => {
      const code = rotatedSurfaceCode(d);
      const ctx = createTraceContext(d);
      const noise = independentNoise(0.1);
      const board = (d - 1) * UNIT;
      let toBoundary = 0;
      let toDefect = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const error = sampleNoise(noise, createRng(seed), identity(d * d));
        const trace = decodeTrace(ctx, error);
        const { container, unmount } = render(<Grid trace={trace} />);
        const lit = (type: StabilizerType, typeIndex: number) =>
          container
            .querySelector(
              `[data-plaquette="${typeIndex}"][data-type="${type}"]`,
            )
            ?.getAttribute("data-defect") === "1";
        for (const type of ["Z", "X"] as const) {
          const stabilizers = code.stabilizersByType[type];
          trace.chains[type].forEach((chain, i) => {
            const polyline = container.querySelector(
              `polyline[data-chain="${i}"][data-type="${type}"]`,
            );
            const flat = numbers(polyline?.getAttribute("points"));
            const points: number[][] = [];
            for (let k = 0; k < flat.length; k += 2)
              points.push([flat[k]!, flat[k + 1]!]);
            expect(points).toHaveLength(chain.qubits.length + 2);
            expect(points[0]).toEqual([
              ...plaquettePoint(stabilizers[chain.a]!),
            ]);
            expect(lit(type, chain.a)).toBe(true);
            chain.qubits.forEach((q, k) => {
              expect(points[k + 1]).toEqual([...qubitPoint(d, q)]);
            });
            const last = points[points.length - 1]!;
            if (chain.b !== BOUNDARY) {
              expect(last).toEqual([...plaquettePoint(stabilizers[chain.b]!)]);
              expect(lit(type, chain.b)).toBe(true);
              toDefect++;
            } else {
              const [x, y] = last as [number, number];
              expect(x < 0 || y < 0 || x > board || y > board).toBe(true);
              const [lx, ly] = qubitPoint(d, chain.qubits.at(-1)!);
              expect(Math.hypot(x - lx, y - ly)).toBeCloseTo(UNIT / 2);
              toBoundary++;
            }
            const line = container.querySelector(
              `line[data-match="${i}"][data-type="${type}"]`,
            );
            expect(
              numbers(
                `${line?.getAttribute("x1")},${line?.getAttribute("y1")}`,
              ),
            ).toEqual(points[0]);
            expect(
              numbers(
                `${line?.getAttribute("x2")},${line?.getAttribute("y2")}`,
              ),
            ).toEqual(last);
          });
        }
        unmount();
      }
      expect(toBoundary).toBeGreaterThan(0);
      expect(toDefect).toBeGreaterThan(0);
    },
  );

  it("a long press on a qubit toggles Z once and never X (positive control of §4.2)", () => {
    vi.useFakeTimers();
    try {
      const onToggleX = vi.fn();
      const onToggleZ = vi.fn();
      const { container } = render(
        <Grid
          trace={traceOf(3, [])}
          onToggleX={onToggleX}
          onToggleZ={onToggleZ}
        />,
      );
      fireEvent.pointerDown(qubitEl(container, 4), {
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        button: 0,
      });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      });
      fireEvent.pointerUp(qubitEl(container, 4), { pointerId: 1 });
      expect(onToggleZ).toHaveBeenCalledTimes(1);
      expect(onToggleZ).toHaveBeenCalledWith(4);
      expect(onToggleX).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a press pending when d changes does not fire into the new grid", () => {
    vi.useFakeTimers();
    try {
      const onToggleX = vi.fn();
      const onToggleZ = vi.fn();
      const grid = (d: number) => (
        <Grid
          trace={traceOf(d, [])}
          onToggleX={onToggleX}
          onToggleZ={onToggleZ}
        />
      );
      const { container, rerender } = render(grid(3));
      fireEvent.pointerDown(qubitEl(container, 8), {
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        button: 0,
      });
      rerender(grid(5));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      });
      fireEvent.pointerUp(qubitEl(container, 8), { pointerId: 1 });
      expect(onToggleZ).not.toHaveBeenCalled();
      expect(onToggleX).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Grid plaquettes on a distance change", () => {
  it("a new distance mounts new plaquette nodes (no fill transition from another code's plaquette); the same distance keeps them", () => {
    const { container, rerender } = render(<Grid trace={traceOf(3, [])} />);
    const before = [...container.querySelectorAll(".plaquette")];
    expect(before).toHaveLength(8);
    rerender(<Grid trace={traceOf(5, [])} />);
    const after = new Set(container.querySelectorAll(".plaquette"));
    expect(after.size).toBe(24);
    for (const node of before) expect(after.has(node)).toBe(false);
    rerender(<Grid trace={traceOf(5, [0])} />);
    const again = new Set(container.querySelectorAll(".plaquette"));
    for (const node of after) expect(again.has(node)).toBe(true);
  });
});
