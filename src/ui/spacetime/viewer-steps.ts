// The six steps of the spacetime viewer (tasks/plans/phase2-g.md D5): errors →
// measurements → detectors → matching → correction → verdict, each adding a
// layer of the same frozen SpacetimeTrace (nothing is recomputed between
// steps, tests/intent/viewer-conventions). The aliases are tags, not text
// (tests/intent/i18n-literal-text TAG_TYPES): the panel reads
// t(`spacetime.${step}`) and the SVG tests `layers.has("…")`.

import type { SpacetimeTrace } from "../model/spacetime-trace";
import { createStepPlan } from "../steps/step-machine";

/** What the isometric SVG draws; the steps reveal them one at a time. */
export type ViewerLayer =
  | "errors"
  | "measurements"
  | "detectors"
  | "matching"
  | "correction"
  | "residual";

export type ViewerStep =
  | "errors"
  | "measurements"
  | "detectors"
  | "matching"
  | "correction"
  | "verdict";

/** An edge of the matching as drawn: within a layer, or between two consecutive layers (`data-edge`). */
export type EdgeKind = "space" | "time";

export const VIEWER_STEPS: readonly ViewerStep[] = [
  "errors",
  "measurements",
  "detectors",
  "matching",
  "correction",
  "verdict",
];

// "measurements" stays visible after step 2 (dimmed by CSS once the detectors
// are shown): a data error's persistent readings are the point of the step.
const LAYERS_BY_STEP: readonly ReadonlySet<ViewerLayer>[] = [
  new Set<ViewerLayer>(["errors"]),
  new Set<ViewerLayer>(["errors", "measurements"]),
  new Set<ViewerLayer>(["errors", "measurements", "detectors"]),
  new Set<ViewerLayer>(["errors", "measurements", "detectors", "matching"]),
  new Set<ViewerLayer>([
    "errors",
    "measurements",
    "detectors",
    "matching",
    "correction",
  ]),
  new Set<ViewerLayer>([
    "errors",
    "measurements",
    "detectors",
    "matching",
    "correction",
    "residual",
  ]),
];

export const VIEWER_PLAN = createStepPlan<
  ViewerStep,
  ViewerLayer,
  SpacetimeTrace
>(VIEWER_STEPS, LAYERS_BY_STEP);

export const VIEWER_LAST_STEP = VIEWER_PLAN.LAST_STEP;
