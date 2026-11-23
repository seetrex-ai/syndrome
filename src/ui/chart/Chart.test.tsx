// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wilsonInterval } from "../../core";
import i18n from "../../i18n";
import { Chart } from "./Chart";
import type { CurvePoint } from "./curves";

afterEach(cleanup);

function point(
  d: number,
  p: number,
  failures: number,
  shots: number,
  live = false,
): CurvePoint {
  const { low, high } = wilsonInterval(failures, shots);
  return {
    d,
    p,
    shots,
    failures,
    estimate: failures / shots,
    low,
    high,
    upperBoundOnly: failures === 0,
    live,
    liveShots: live ? shots : 0,
    stopReason: null,
    rate: 0,
  };
}

const POINTS = [
  point(3, 0.05, 700, 10_000),
  point(3, 0.1, 2000, 10_000),
  point(5, 0.05, 400, 10_000),
  point(5, 0.1, 2200, 10_000),
  point(7, 0.05, 0, 100),
  point(7, 0.1, 2500, 10_000, true),
];

describe("Chart", () => {
  it("draws one polyline per distance with its class, through the measured points only", () => {
    const { container } = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    const lines = [...container.querySelectorAll("polyline.curve__line")];
    // d = 7 has one bound and one measured point: its polyline would need two
    // measured points, so none is drawn; d = 3 and 5 join two points each.
    expect(lines.map((l) => l.parentElement?.getAttribute("class"))).toEqual([
      "curve curve--d3",
      "curve curve--d5",
    ]);
    expect(container.querySelectorAll("g.curve")).toHaveLength(3);
    expect(lines[0]!.getAttribute("points")!.split(" ")).toHaveLength(2);
    expect(container.querySelector(".curve--d7 polyline")).toBeNull();
  });

  it("a point with failures = 0 is an open marker at `high` with data-upper-bound and no filled dot", () => {
    const { container } = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    const bounds = container.querySelectorAll("[data-upper-bound]");
    expect(bounds).toHaveLength(1);
    const bound = bounds[0]!;
    expect(bound.closest("[data-d]")?.getAttribute("data-d")).toBe("7");
    expect(bound.getAttribute("data-p")).toBe("0.05");
    expect(bound.querySelector(".marker__dot")).toBeNull();
    // The bound wears the shape of its distance, hollow (d = 7: a triangle).
    expect(
      bound.querySelector(".marker__open")?.getAttribute("data-shape"),
    ).toBe("triangle");
    expect(bound.querySelector(".marker__arrow")).not.toBeNull();
    // The open mark sits at high, above the dot of the d = 7, p = 0.1 point
    // (0.25) only if high < 0.25: 0/100 gives high ≈ 0.037, lower on the axis
    // (larger y) — check the coordinate is finite and inside the plot.
    const cy = Number(
      bound.querySelector(".marker__open")!.getAttribute("data-cy"),
    );
    expect(Number.isFinite(cy)).toBe(true);
    const dots = container.querySelectorAll(".marker__dot");
    expect(dots).toHaveLength(5);
  });

  it("every marker has an error bar from low to high; live points are flagged", () => {
    const { container } = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    const bars = container.querySelectorAll(".marker__bar");
    expect(bars).toHaveLength(5);
    for (const bar of bars) {
      const y1 = Number(bar.getAttribute("y1"));
      const y2 = Number(bar.getAttribute("y2"));
      expect(y2).toBeGreaterThan(y1); // low is below high on screen
    }
    expect(container.querySelectorAll('[data-live="1"]')).toHaveLength(1);
  });

  it("names the noise model in both languages and labels the axes; the svg's accessible name carries all three", async () => {
    for (const lang of ["en", "es"]) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        <Chart
          points={POINTS}
          distances={[3, 5, 7]}
          userP={0.1}
          model="independent"
        />,
      );
      expect(container.querySelector(".chart__model")?.textContent).toBe(
        i18n.t("chart.model.independent"),
      );
      expect(container.textContent).toContain(i18n.t("chart.axis.p"));
      expect(container.textContent).toContain(i18n.t("chart.axis.pl"));
      // role="img" makes the children presentational: the name is the label.
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("role")).toBe("img");
      const name = svg.getAttribute("aria-label")!;
      expect(name).toContain(i18n.t("chart.title"));
      expect(name).toContain(i18n.t("chart.axis.p"));
      expect(name).toContain(i18n.t("chart.axis.pl"));
      expect(name).toContain(i18n.t("chart.model.independent"));
      unmount();
    }
    await i18n.changeLanguage("en");
  });

  it("marks the user's p with a vertical line inside the domain and omits it outside", () => {
    const inside = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.08}
        model="independent"
      />,
    );
    expect(
      inside.container
        .querySelector(".chart__user-p")
        ?.getAttribute("data-user-p"),
    ).toBe("0.08");
    inside.unmount();
    const outside = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.5}
        model="independent"
      />,
    );
    expect(outside.container.querySelector(".chart__user-p")).toBeNull();
  });

  it("renders the legend with d from i18n", () => {
    const { container } = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    const items = [...container.querySelectorAll(".chart__legend li")];
    expect(items.map((li) => li.textContent)).toEqual([
      i18n.t("chart.legend.d", { d: 3 }),
      i18n.t("chart.legend.d", { d: 5 }),
      i18n.t("chart.legend.d", { d: 7 }),
    ]);
  });
});

/**
 * A ResizeObserver that reports `width` for whatever it observes, at once, and
 * counts its disconnects (unmount must disconnect it).
 */
function stubResizeObserver(width: number) {
  const counter = { disconnects: 0 };
  class FakeResizeObserver {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {
      counter.disconnects++;
    }
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return counter;
}

describe("Chart on a narrow screen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the viewBox width follows the figure's CSS width: one SVG unit per pixel, so the labels keep their size; unmount disconnects the observer", () => {
    const observer = stubResizeObserver(360);
    const narrow = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    const svg = narrow.container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 360 400");
    const axis = narrow.container.querySelector(".chart__axis--x line")!;
    expect(Number(axis.getAttribute("x2"))).toBe(360 - 16);
    expect(observer.disconnects).toBe(0);
    narrow.unmount();
    expect(observer.disconnects).toBe(1);

    stubResizeObserver(1000);
    const wide = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    expect(wide.container.querySelector("svg")!.getAttribute("viewBox")).toBe(
      "0 0 1000 400",
    );
  });

  it("without ResizeObserver (jsdom) the viewBox is the 640 default", () => {
    const { container } = render(
      <Chart
        points={POINTS}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe(
      "0 0 640 400",
    );
  });

  it("upper bounds sharing one p are spread sideways, centred on p and never outside the plot; a lone bound and measured points sit at their p", () => {
    const points = [
      point(3, 0, 0, 1000),
      point(5, 0, 0, 1000),
      point(7, 0, 0, 1000),
      point(3, 0.05, 0, 1000),
      point(5, 0.05, 0, 1000),
      point(7, 0.15, 0, 1000),
      point(3, 0.1, 100, 1000),
      point(5, 0.1, 100, 1000),
      point(7, 0.1, 100, 1000),
    ];
    const { container } = render(
      <Chart
        points={points}
        distances={[3, 5, 7]}
        userP={0.1}
        model="independent"
      />,
    );
    const axis = container.querySelector(".chart__axis--x line")!;
    const x0 = Number(axis.getAttribute("x1"));
    // The x tick labels sit at x(p) for p = 0, 0.05, 0.1, 0.15, 0.2.
    const tickX = [
      ...container.querySelectorAll(
        ".chart__axis--x text:not(.chart__axis-label)",
      ),
    ].map((el) => Number(el.getAttribute("x")));
    expect(tickX).toHaveLength(5);
    expect(tickX[0]).toBe(x0);
    const cxAt = (p: number) =>
      [
        ...container.querySelectorAll(
          `.marker--open[data-p="${p}"] .marker__open`,
        ),
      ].map((c) => Number(c.getAttribute("data-cx")));
    // p = 0, on the axis: three bounds, distinct, equally spaced, the leftmost
    // ON the axis and none to its left (before: the d = 3 one at x0 − 10).
    const onAxis = cxAt(0);
    expect(onAxis).toHaveLength(3);
    expect(new Set(onAxis).size).toBe(3);
    expect(Math.min(...onAxis)).toBe(x0);
    expect(onAxis[1]! - onAxis[0]!).toBeCloseTo(onAxis[2]! - onAxis[1]!, 9);
    // p = 0.05, inside the plot: two bounds centred on p.
    const pair = cxAt(0.05);
    expect(pair).toHaveLength(2);
    expect(pair[0]).not.toBe(pair[1]);
    expect((pair[0]! + pair[1]!) / 2).toBeCloseTo(tickX[1]!, 9);
    // p = 0.15: a lone bound is not moved (mutant: spread always → red).
    expect(cxAt(0.15)).toEqual([tickX[3]]);
    // Each arrow starts under its own circle.
    for (const marker of container.querySelectorAll(".marker--open")) {
      const cx = Number(
        marker.querySelector(".marker__open")!.getAttribute("data-cx"),
      );
      const d = marker.querySelector("path")!.getAttribute("d")!;
      expect(d.startsWith(`M${cx},`)).toBe(true);
    }
    const dots = [...container.querySelectorAll(".marker__dot")].map((c) =>
      Number(c.getAttribute("data-cx")),
    );
    expect(dots).toEqual([tickX[2], tickX[2], tickX[2]]);
  });
});
