// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { qubitIndex } from "../../src/core";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";

/**
 * test_scenario_ui_inject_decode_verdict
 *
 * The first interaction of the product, end to end through the real App: inject
 * errors by clicking, see the defects the stabilizers raise, the correction the
 * decoder proposes and the verdict. Pins the d = 3 table of docs/spec.md §3
 * (X on the centre qubit lights the Z plaquettes (0,0) and (1,1)), the Y gesture
 * (Shift+click on an X makes a Y and lights four plaquettes) and the logical
 * error (X on a full column: null syndrome, verdict "logical X").
 */

afterEach(cleanup);

const down = { pointerId: 1, clientX: 0, clientY: 0, button: 0 };

function qubit(container: HTMLElement, row: number, col: number): Element {
  const el = container.querySelector(
    `[data-qubit="${qubitIndex(3, row, col)}"]`,
  );
  if (el === null) throw new Error(`qubit (${row}, ${col}) not rendered`);
  return el;
}

function click(el: Element, shift = false) {
  fireEvent.pointerDown(el, down);
  fireEvent.pointerUp(el, { pointerId: 1, shiftKey: shift });
}

function litPlaquettes(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-defect="1"]')].map(
    (el) =>
      `${el.getAttribute("data-type")}${el.getAttribute("data-plaquette")}`,
  );
}

describe("test_scenario_ui_inject_decode_verdict", () => {
  it("click → defects + chain; Shift+click → Y; column of X → logical error; clear → ok", () => {
    const { container: root } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    // The interactive panel only: the step-by-step panel mounts on a random
    // shot of its own, with errors of its own.
    const container = root.querySelector(".panel--grid") as HTMLElement;
    const status = () => screen.getByRole("status");
    expect(status().textContent).toBe(i18n.t("grid.verdict.ok"));

    // X on the centre: two Z plaquettes, one chain of one qubit, still corrected.
    click(qubit(container, 1, 1));
    expect(qubit(container, 1, 1).getAttribute("data-pauli")).toBe("X");
    const lit = litPlaquettes(container);
    expect(lit).toHaveLength(2);
    expect(lit.every((s) => s.startsWith("Z"))).toBe(true);
    const chains = container.querySelectorAll("polyline[data-chain]");
    expect(chains).toHaveLength(1);
    expect(chains[0]!.getAttribute("data-type")).toBe("Z");
    expect(status().textContent).toBe(i18n.t("grid.verdict.ok"));

    // Shift+click on the same qubit: Y, four plaquettes (two of each type).
    click(qubit(container, 1, 1), true);
    expect(qubit(container, 1, 1).getAttribute("data-pauli")).toBe("Y");
    const litY = litPlaquettes(container);
    expect(litY).toHaveLength(4);
    expect(litY.filter((s) => s.startsWith("Z"))).toHaveLength(2);
    expect(litY.filter((s) => s.startsWith("X"))).toHaveLength(2);
    expect(container.querySelectorAll("polyline[data-chain]")).toHaveLength(2);

    // Clear, then X on the whole column 0: no defect, nothing to correct, logical X.
    fireEvent.click(screen.getByText(i18n.t("grid.clear")));
    expect(litPlaquettes(container)).toHaveLength(0);
    for (const row of [0, 1, 2]) click(qubit(container, row, 0));
    expect(litPlaquettes(container)).toHaveLength(0);
    expect(container.querySelectorAll("polyline[data-chain]")).toHaveLength(0);
    expect(status().textContent).toBe(i18n.t("grid.verdict.x"));
    expect(status().getAttribute("data-verdict")).toBe("1");
    // The residual is drawn on the three qubits.
    expect(
      container.querySelectorAll('[data-qubit][data-residual="X"]'),
    ).toHaveLength(3);

    fireEvent.click(screen.getByText(i18n.t("grid.clear")));
    expect(status().textContent).toBe(i18n.t("grid.verdict.ok"));
    expect(
      container.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(0);
  });

  it("reads the same scenario in Spanish", async () => {
    await i18n.changeLanguage("es");
    try {
      const { container: root } = render(<App />);
      const container = root.querySelector(".panel--grid") as HTMLElement;
      for (const row of [0, 1, 2]) click(qubit(container, row, 0));
      expect(screen.getByRole("status").textContent).toBe(
        i18n.getFixedT("es")("grid.verdict.x"),
      );
      expect(screen.getByRole("status").textContent).not.toBe(
        i18n.getFixedT("en")("grid.verdict.x"),
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
