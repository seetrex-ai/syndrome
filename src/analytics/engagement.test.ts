import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoiseKind } from "../worker/protocol";
import {
  CHART_ENGAGED_THRESHOLD_MS,
  chartEngagedThisPage,
  createEngagementClock,
  reportChartEngaged,
  resetChartEngagementForTests,
  type EngagementClock,
} from "./engagement";

/**
 * test_intent_chart_engaged_once_after_15s_visible
 *
 * INTENCIÓN: `chart_engaged` significa «la gráfica estrella se ha mirado»: 15 s
 *   acumulados con la figura en pantalla y la pestaña visible, una sola vez por
 *   carga de página, con el modelo que se ve en ese momento: mide si la gráfica
 *   se mira de verdad.
 * CONTEXTO: tasks/plans/analytics.md T-E1, D12 (parte pura; el hook con
 *   IntersectionObserver está en src/ui/chart/useChartEngagement.ts). Un umbral menor, un reloj que siga
 *   contando con la pestaña oculta o un evento por remontaje del panel
 *   (StrictMode, Suspense) inflarían la métrica y el cupo de Umami.
 * EXPIRA SI: la taxonomía cambia la definición de `chart_engaged` o el umbral.
 */
describe("test_intent_chart_engaged_once_after_15s_visible", () => {
  let model: NoiseKind;
  let sent: { name: string; props: Record<string, string> }[];

  const makeClock = (): EngagementClock =>
    createEngagementClock({
      thresholdMs: CHART_ENGAGED_THRESHOLD_MS,
      now: () => Date.now(),
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
      // The model is read when the clock fires (the hook reads it from a ref).
      onEngaged: () => reportChartEngaged(model),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    resetChartEngagementForTests();
    model = "independent";
    sent = [];
    vi.stubGlobal("umami", {
      track: (name: string, props: Record<string, string>) => {
        sent.push({ name, props });
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("the threshold is 15 s", () => {
    expect(CHART_ENGAGED_THRESHOLD_MS).toBe(15_000);
  });

  it("14.9 s visible: nothing; 15 s: one event; more time: still one", () => {
    const clock = makeClock();
    clock.setActive(true);
    clock.setVisible(true);
    vi.advanceTimersByTime(14_900);
    expect(sent).toEqual([]);
    expect(clock.engaged).toBe(false);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([
      { name: "chart_engaged", props: { model: "independent" } },
    ]);
    vi.advanceTimersByTime(60_000);
    clock.setVisible(false);
    clock.setVisible(true);
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(1);
  });

  it("a hidden tab pauses the clock; time accumulates across stretches", () => {
    const clock = makeClock();
    clock.setVisible(true);
    clock.setActive(true);
    vi.advanceTimersByTime(10_000);
    clock.setActive(false);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
    clock.setActive(true);
    vi.advanceTimersByTime(4_900);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(1);
  });

  it("the chart off screen pauses the clock too", () => {
    const clock = makeClock();
    clock.setActive(true);
    vi.advanceTimersByTime(30_000);
    expect(sent).toEqual([]);
    clock.setVisible(true);
    vi.advanceTimersByTime(7_000);
    clock.setVisible(false);
    vi.advanceTimersByTime(30_000);
    clock.setVisible(true);
    vi.advanceTimersByTime(7_999);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
  });

  it("the model sent is the one shown when the clock fires, not the initial one", () => {
    const clock = makeClock();
    clock.setVisible(true);
    clock.setActive(true);
    vi.advanceTimersByTime(5_000);
    model = "phenomenological";
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual([
      { name: "chart_engaged", props: { model: "phenomenological" } },
    ]);
  });

  it("a remounted panel (new clock) never sends a second event in the page load", () => {
    const first = makeClock();
    first.setVisible(true);
    first.setActive(true);
    vi.advanceTimersByTime(15_000);
    first.dispose();
    expect(chartEngagedThisPage()).toBe(true);
    const second = makeClock();
    second.setVisible(true);
    second.setActive(true);
    vi.advanceTimersByTime(15_000);
    expect(second.engaged).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("a disposed clock never fires", () => {
    const clock = makeClock();
    clock.setVisible(true);
    clock.setActive(true);
    vi.advanceTimersByTime(10_000);
    clock.dispose();
    clock.setVisible(true);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
