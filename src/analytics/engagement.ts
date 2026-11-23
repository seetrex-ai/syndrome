// `chart_engaged`: the chart counted as seen after 15 s accumulated with it on
// screen and the tab visible, once per page load (tasks/plans/analytics.md
// D12). The clock is pure (time and timers injected) so it is tested without
// a DOM; the React hook in src/ui/chart feeds it visibility and activity.
import type { NoiseKind } from "../worker/protocol";
import { trackChartEngaged } from "./events";

/** Seconds on screen that make the chart "engaged" (15 s). */
export const CHART_ENGAGED_THRESHOLD_MS = 15_000;

export interface EngagementClockOptions {
  readonly thresholdMs: number;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly onEngaged: () => void;
}

export interface EngagementClock {
  /** The watched element is (not) on screen enough. */
  setVisible(visible: boolean): void;
  /** The tab is (not) visible. */
  setActive(active: boolean): void;
  /** Stops the clock for good (unmount). */
  dispose(): void;
  /** Whether `onEngaged` has fired. */
  readonly engaged: boolean;
}

/**
 * A pausable stopwatch: it accumulates time only while visible and active, and
 * calls `onEngaged` once when the total reaches `thresholdMs`. Both flags start
 * false.
 */
export function createEngagementClock(
  options: EngagementClockOptions,
): EngagementClock {
  const { thresholdMs, now, setTimer, clearTimer, onEngaged } = options;
  let visible = false;
  let active = false;
  let engaged = false;
  let disposed = false;
  let accumulated = 0;
  // Start of the current running stretch, or null while paused.
  let runningSince: number | null = null;
  let timer: unknown = undefined;
  let hasTimer = false;

  const cancelTimer = () => {
    if (hasTimer) clearTimer(timer);
    hasTimer = false;
  };

  const elapsed = () =>
    accumulated + (runningSince === null ? 0 : now() - runningSince);

  const check = () => {
    hasTimer = false;
    if (engaged || disposed || runningSince === null) return;
    const total = elapsed();
    if (total >= thresholdMs) {
      engaged = true;
      accumulated = total;
      runningSince = null;
      onEngaged();
    } else {
      schedule(thresholdMs - total);
    }
  };

  const schedule = (ms: number) => {
    cancelTimer();
    timer = setTimer(check, ms);
    hasTimer = true;
  };

  const update = () => {
    if (engaged || disposed) return;
    const shouldRun = visible && active;
    if (shouldRun && runningSince === null) {
      runningSince = now();
      schedule(thresholdMs - accumulated);
    } else if (!shouldRun && runningSince !== null) {
      accumulated += now() - runningSince;
      runningSince = null;
      cancelTimer();
    }
  };

  return {
    setVisible(value: boolean) {
      visible = value;
      update();
    },
    setActive(value: boolean) {
      active = value;
      update();
    },
    dispose() {
      if (runningSince !== null) accumulated += now() - runningSince;
      runningSince = null;
      cancelTimer();
      disposed = true;
    },
    get engaged() {
      return engaged;
    },
  };
}

// Once per page load: a remounted chart panel (StrictMode, Suspense, leaving
// and coming back) starts a new clock but never a second event.
let engagedThisPage = false;

/** Whether `chart_engaged` was already sent in this page load. */
export function chartEngagedThisPage(): boolean {
  return engagedThisPage;
}

/**
 * Sends `chart_engaged` with the model shown at this moment, unless it was
 * already sent in this page load.
 */
export function reportChartEngaged(model: NoiseKind): void {
  if (engagedThisPage) return;
  engagedThisPage = true;
  trackChartEngaged(model);
}

/** Tests only: forget that the event was sent. */
export function resetChartEngagementForTests(): void {
  engagedThisPage = false;
}
