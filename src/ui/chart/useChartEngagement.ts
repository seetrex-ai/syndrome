// `chart_engaged` (tasks/plans/analytics.md D12): feeds the pure engagement
// clock of src/analytics with whether the chart's figure is at least half on
// screen (IntersectionObserver) and whether the tab is visible. The figure, not
// the section: the section (table, Λ, explanations) is taller than a phone
// screen and half of it might never be in view. The model is read when the
// clock fires, not when it starts: a switch of model during the 15 s reports
// the model on screen. Without IntersectionObserver (jsdom) nothing happens.
import { useEffect, useRef, type RefObject } from "react";
import {
  CHART_ENGAGED_THRESHOLD_MS,
  chartEngagedThisPage,
  createEngagementClock,
  reportChartEngaged,
} from "../../analytics/engagement";
import type { NoiseKind } from "../model/noise-kinds";

/** Share of the figure on screen that counts as seen. */
export const CHART_VISIBLE_RATIO = 0.5;

export function useChartEngagement(
  sectionRef: RefObject<HTMLElement | null>,
  model: NoiseKind,
): void {
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    if (chartEngagedThisPage()) return undefined;
    const section = sectionRef.current;
    if (section === null) return undefined;
    const target = section.querySelector("figure.chart") ?? section;
    const clock = createEngagementClock({
      thresholdMs: CHART_ENGAGED_THRESHOLD_MS,
      now: () => Date.now(),
      setTimer: (callback, ms) => window.setTimeout(callback, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      onEngaged: () => reportChartEngaged(modelRef.current),
    });
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          clock.setVisible(
            entry.isIntersecting &&
              entry.intersectionRatio >= CHART_VISIBLE_RATIO,
          );
        }
      },
      { threshold: CHART_VISIBLE_RATIO },
    );
    observer.observe(target);
    const onVisibility = () =>
      clock.setActive(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      clock.dispose();
    };
  }, [sectionRef]);
}
