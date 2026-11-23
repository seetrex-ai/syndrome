// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetChartEngagementForTests } from "../../analytics/engagement";
import type { NoiseKind } from "../model/noise-kinds";
import { CHART_VISIBLE_RATIO, useChartEngagement } from "./useChartEngagement";

/** A controllable IntersectionObserver: tests decide what is on screen. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;
  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;
  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    FakeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  /** Reports every observed target at `ratio`. */
  show(ratio: number) {
    const entries = this.targets.map(
      (target) =>
        ({
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

let visibility: DocumentVisibilityState = "visible";
function setTabVisible(visible: boolean) {
  visibility = visible ? "visible" : "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
}

function fakeTracker() {
  const calls: { name: string; props: Record<string, string> }[] = [];
  vi.stubGlobal("umami", {
    track: (name: string, props: Record<string, string>) => {
      calls.push({ name, props: { ...props } });
    },
  });
  return calls;
}

function Panel({ model }: { model: NoiseKind }) {
  const ref = useRef<HTMLElement>(null);
  useChartEngagement(ref, model);
  return (
    <section ref={ref}>
      <figure className="chart" />
    </section>
  );
}

beforeEach(() => {
  FakeObserver.instances = [];
  visibility = "visible";
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  resetChartEngagementForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetChartEngagementForTests();
});

const observer = () => FakeObserver.instances.at(-1)!;
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/**
 * test_intent_chart_engaged_once_after_15s_visible (hook)
 *
 * INTENCIÓN: `chart_engaged` cuenta la gráfica como vista sólo tras 15 s acumulados
 *   con la figura al menos a medias en pantalla y la pestaña visible, una vez por
 *   carga de página, con el modelo que se ve en ese momento.
 * CONTEXTO: tasks/plans/analytics.md D12, T-E1 (el reloj está en src/analytics/engagement.ts;
 *   aquí, el hook que lo alimenta). Un umbral corto o un reloj que sigue con la pestaña oculta
 *   inflan la métrica «¿se mira la gráfica?»; un modelo leído al
 *   montar mentiría tras cambiar de modelo durante los 15 s.
 * EXPIRA SI: la taxonomía cambia la definición de `chart_engaged` o la gráfica deja
 *   de ser una figura dentro de su sección.
 */
describe("test_intent_chart_engaged_once_after_15s_visible (hook)", () => {
  it("observes the figure at half visibility, not the whole section", () => {
    fakeTracker();
    render(<Panel model="independent" />);
    expect(observer().targets).toEqual([
      document.querySelector("figure.chart"),
    ]);
    expect(observer().options?.threshold).toBe(CHART_VISIBLE_RATIO);
    expect(CHART_VISIBLE_RATIO).toBe(0.5);
  });

  it("14.9 s on screen: nothing; 15 s: one event; longer: still one", () => {
    const calls = fakeTracker();
    render(<Panel model="independent" />);
    act(() => observer().show(1));
    advance(14_900);
    expect(calls).toEqual([]);
    advance(100);
    expect(calls).toEqual([
      { name: "chart_engaged", props: { model: "independent" } },
    ]);
    advance(60_000);
    act(() => observer().show(0));
    act(() => observer().show(1));
    advance(60_000);
    expect(calls).toHaveLength(1);
  });

  it("less than half of the figure on screen does not count", () => {
    const calls = fakeTracker();
    render(<Panel model="independent" />);
    act(() => observer().show(0.4));
    advance(30_000);
    expect(calls).toEqual([]);
  });

  it("a hidden tab pauses the clock; the time before and after adds up", () => {
    const calls = fakeTracker();
    render(<Panel model="independent" />);
    act(() => observer().show(1));
    advance(10_000);
    act(() => setTabVisible(false));
    advance(60_000);
    expect(calls).toEqual([]);
    act(() => setTabVisible(true));
    advance(4_900);
    expect(calls).toEqual([]);
    advance(100);
    expect(calls).toHaveLength(1);
  });

  it("the model is the one on screen when the 15 s are reached", () => {
    const calls = fakeTracker();
    const view = render(<Panel model="independent" />);
    act(() => observer().show(1));
    advance(5_000);
    view.rerender(<Panel model="phenomenological" />);
    advance(10_000);
    expect(calls).toEqual([
      { name: "chart_engaged", props: { model: "phenomenological" } },
    ]);
  });

  it("a remounted panel after the event sends nothing more", () => {
    const calls = fakeTracker();
    const view = render(<Panel model="independent" />);
    act(() => observer().show(1));
    advance(15_000);
    expect(calls).toHaveLength(1);
    view.unmount();
    render(<Panel model="phenomenological" />);
    act(() => FakeObserver.instances.forEach((o) => o.show(1)));
    advance(60_000);
    expect(calls).toHaveLength(1);
  });

  it("unmount disconnects the observer and stops the clock", () => {
    const calls = fakeTracker();
    const view = render(<Panel model="independent" />);
    act(() => observer().show(1));
    advance(10_000);
    const first = observer();
    view.unmount();
    expect(first.disconnected).toBe(true);
    advance(60_000);
    expect(calls).toEqual([]);
  });
});
