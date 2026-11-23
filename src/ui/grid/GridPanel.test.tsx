// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qubitIndex, type Distance } from "../../core";
import i18n from "../../i18n";
import { LONG_PRESS_MS } from "../model/gesture";
import { GridPanel } from "./GridPanel";

afterEach(cleanup);

/** The panel as App mounts it: d and p held above it. */
function Host({
  d0 = 3 as Distance,
  p0 = 0.1,
}: {
  d0?: Distance;
  p0?: number;
}) {
  const [d, setD] = useState<Distance>(d0);
  const [p, setP] = useState(p0);
  return <GridPanel d={d} onDistanceChange={setD} p={p} onPChange={setP} />;
}

function qubit(container: HTMLElement, q: number): Element {
  const el = container.querySelector(`[data-qubit="${q}"]`);
  if (el === null) throw new Error(`qubit ${q} not rendered`);
  return el;
}

function click(el: Element, shift = false) {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
  });
  fireEvent.pointerUp(el, { pointerId: 1, shiftKey: shift });
}

describe("GridPanel", () => {
  it("starts clean with the corrected verdict and the hint", () => {
    render(<Host />);
    expect(screen.getByRole("status").textContent).toBe(
      i18n.t("grid.verdict.ok"),
    );
    expect(screen.getByText(i18n.t("grid.hint"))).toBeTruthy();
  });

  it("a click toggles X, a Shift+click toggles Z, clear resets", () => {
    const { container } = render(<Host />);
    const q = qubitIndex(3, 1, 1);
    click(qubit(container, q));
    expect(qubit(container, q).getAttribute("data-pauli")).toBe("X");
    click(qubit(container, q), true);
    expect(qubit(container, q).getAttribute("data-pauli")).toBe("Y");
    fireEvent.click(screen.getByText(i18n.t("grid.clear")));
    expect(qubit(container, q).getAttribute("data-pauli")).toBe("I");
    expect(container.querySelectorAll('[data-defect="1"]')).toHaveLength(0);
  });

  it("a mouse press released outside the qubit toggles nothing, not even after the long-press delay", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<Host />);
      const q = qubitIndex(3, 1, 1);
      fireEvent.pointerDown(qubit(container, q), {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
        button: 0,
      });
      const svg = container.querySelector("svg");
      if (svg === null) throw new Error("grid not rendered");
      fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100, clientY: 0 });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 50);
      });
      expect(qubit(container, q).getAttribute("data-pauli")).toBe("I");
    } finally {
      vi.useRealTimers();
    }
  });

  it("random errors at p = 1 put a Y on every qubit and both logical errors in the verdict", () => {
    const { container } = render(<Host p0={1} />);
    fireEvent.click(screen.getByText(i18n.t("grid.random")));
    expect(
      container.querySelectorAll('[data-qubit][data-pauli="Y"]'),
    ).toHaveLength(9);
    expect(screen.getByRole("status").textContent).toBe(
      i18n.t("grid.verdict.xz"),
    );
    expect(screen.getByRole("status").getAttribute("data-verdict")).toBe("3");
  });

  it("random errors at p = 0 leave the grid clean", () => {
    const { container } = render(<Host p0={0} />);
    fireEvent.click(screen.getByText(i18n.t("grid.random")));
    expect(
      container.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(0);
  });

  it("changing the distance redraws and clears the grid", () => {
    const { container } = render(<Host />);
    click(qubit(container, 0));
    expect(qubit(container, 0).getAttribute("data-pauli")).toBe("X");
    // The distance is a segmented control (design.md D4): a radio per value,
    // inside the group named grid.distance.
    const group = screen.getByRole("group", { name: i18n.t("grid.distance") });
    fireEvent.click(within(group).getByRole("radio", { name: "5" }));
    expect(container.querySelectorAll("[data-qubit]")).toHaveLength(25);
    expect(
      container.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(0);
  });

  it("a press pending across a distance change fires into neither grid (7 → 3 on q = 40; 3 → 5 on q = 8)", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<Host d0={7} />);
      const press = (q: number) =>
        fireEvent.pointerDown(qubit(container, q), {
          pointerId: 1,
          clientX: 0,
          clientY: 0,
          button: 0,
        });
      const select = (d: number) =>
        fireEvent.click(
          within(
            screen.getByRole("group", { name: i18n.t("grid.distance") }),
          ).getByRole("radio", { name: String(d) }),
        );
      const wait = () =>
        act(() => {
          vi.advanceTimersByTime(LONG_PRESS_MS + 50);
        });
      press(40);
      select(3); // q = 40 does not exist here: no RangeError, no blank screen
      wait();
      expect(container.querySelectorAll("[data-qubit]")).toHaveLength(9);
      press(8);
      select(5); // q = 8 exists here: it must stay clean
      wait();
      expect(container.querySelectorAll("[data-qubit]")).toHaveLength(25);
      expect(
        container.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the slider reports p to its owner", () => {
    const onPChange = vi.fn();
    render(
      <GridPanel
        d={3}
        onDistanceChange={vi.fn()}
        p={0.1}
        onPChange={onPChange}
      />,
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.05" } });
    expect(onPChange).toHaveBeenCalledWith(0.05);
  });
});
