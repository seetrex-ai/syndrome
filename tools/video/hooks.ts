// The DOM hooks the video script relies on (tasks/plans/video.md D11): what it
// waits for, what the camera keeps and what the camera hides, per panel, plus
// the i18n keys of the buttons it presses by accessible name. Every entry is
// checked against the rendered DOM of each panel in both languages by
// tests/intent/video-hooks.test.tsx (test_intent_video_hooks_exist): the
// script never looks for a hook the app does not have, and a hide rule never
// goes stale in silence. The selectors of camera.css are checked the same way
// by tests/intent/video-camera.test.tsx. The viewer's hooks are the ones
// test_intent_viewer_hooks_are_stable already pins.

export type Panel = "steps" | "spacetime" | "chart";
export const PANELS: readonly Panel[] = ["steps", "spacetime", "chart"];

export interface PanelHooks {
  /** The panel's root; the attribute the walkthrough changes is `data-step`. */
  readonly root: string;
  /**
   * A hook only the REAL panel has, never its Suspense skeleton (the chart's
   * and the viewer's fallbacks render the same `section.panel--…`): the
   * script waits for `root ready` and marks the section around it.
   */
  readonly ready: string;
  /**
   * What the camera keeps on screen; must exist on the LAST step of the
   * walkthrough. capture.ts requires every entry in the DOM of the final state
   * of each scene (assertShown): a frame that lost a layer fails the run.
   */
  readonly shown: readonly string[];
  /** What the camera hides inside the panel; must exist too (a stale rule is a bug). */
  readonly hidden: readonly string[];
  /**
   * i18n keys of the buttons the script presses (`getByRole("button", { name })`).
   * Only what a scene action uses: the preset is clicked by `[data-preset]`.
   */
  readonly buttons: readonly string[];
}

/** The attribute the script sets on the one panel a scene shows (camera.css). */
export const SHOWN_ATTRIBUTE = "data-video-shown";
/** The attribute the script sets on `<html>`: "landscape" | "portrait" (camera.css). */
export const LAYOUT_ATTRIBUTE = "data-video-layout";
/** The walkthrough position of the steps and the spacetime panels. */
export const STEP_ATTRIBUTE = "data-step";

/** Hidden everywhere, outside the panels: brand bar, header (title, prefs), tagline, section nav, footer, PWA toast. */
export const APP_HIDDEN: readonly string[] = [
  ".site-header",
  ".app__header",
  ".app__tagline",
  ".app__nav",
  ".app__footer",
  "[data-pwa-toast]",
];

export const HOOKS: Readonly<Record<Panel, PanelHooks>> = {
  steps: {
    root: "section.panel--steps[data-step]",
    ready: ".steps__live",
    shown: [
      '.steps__list [data-done="1"][aria-current="step"]',
      "svg[data-distance]",
      "[data-qubit][data-pauli][data-correction][data-residual]",
      "[data-plaquette][data-type][data-defect]",
      "[data-match][data-type]",
      "[data-chain][data-type]",
      ".steps__live .steps__explain",
      ".steps__verdict[data-verdict]",
    ],
    hidden: [
      ".steps__intro",
      ".steps__controls",
      ".steps__model",
      ".explain-group",
    ],
    buttons: ["steps.next"],
  },
  spacetime: {
    root: "section.panel--spacetime[data-step][data-gap][data-distance][data-from-link]",
    ready: ".spacetime__live",
    shown: [
      '.spacetime__steps [data-done="1"][aria-current="step"]',
      "svg[data-distance]",
      '[role="img"][data-layer]',
      "[data-overlay] [data-layer] [data-qubit][data-residual]",
      '[data-overlay] [data-edge="space"]',
      ".spacetime__live .spacetime__explain",
      ".spacetime__verdict[data-verdict]",
      '.spacetime__gap input[type="range"]',
      '[data-preset="both"]',
    ],
    hidden: [
      ".spacetime__intro",
      ".spacetime__model",
      ".spacetime__shot",
      ".spacetime__look",
      ".spacetime__layers",
      ".spacetime__controls",
      ".spacetime__share",
      ".explain-group",
    ],
    buttons: ["spacetime.next"],
  },
  chart: {
    root: "section.panel--chart",
    ready: ".chart__base[data-base-model]",
    shown: [
      'svg.chart__svg[role="img"]',
      ".curve[data-d]",
      ".curve [data-p]",
      ".chart__caption .chart__legend",
      ".chart__model[data-model]",
      ".chart__lambda [data-lambda-d] dd[data-lambda]",
      ".chart__base[data-base-model]",
    ],
    hidden: [
      ".model-select[data-model]",
      ".chart__status",
      ".chart__stats",
      ".explain-group",
    ],
    buttons: [],
  },
};

/** The CSS that hides everything a scene of `panel` does not show (injected with camera.css). */
export function hiddenCss(panel: Panel): string {
  const selectors = [
    ...APP_HIDDEN,
    `.panel:not([${SHOWN_ATTRIBUTE}])`,
    ...HOOKS[panel].hidden.map((s) => `${HOOKS[panel].root} ${s}`),
  ];
  return `${selectors.join(",\n")} {\n  display: none !important;\n}\n`;
}
