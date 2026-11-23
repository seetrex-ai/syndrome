// The scenes of the explainer video (tasks/plans/video.md D8; decisions of
// §7, 2026-10-18): title → step by step in 2D (d = 3) → spacetime viewer (d = 3,
// preset "both") → the chart in both noise models (base curves only) → closing.
// The same scenes serve the four (lang, format) variants. Texts are i18n keys
// of the app (D9); the site URL is the one constant of the script's own.
// tools/video/check.ts validates every scene against the core before anything
// is rendered (tests/intent/video-conventions.test.ts).

import type { Distance } from "../../src/core/index";
import type { NoiseKind } from "../../src/ui/model/noise-kinds";
import type { PresetKind } from "../../src/ui/model/spacetime-trace";
import type { View } from "../../src/ui/spacetime/projection";

export type Format = "landscape" | "portrait";
export const FORMATS: readonly Format[] = ["landscape", "portrait"];

export function isFormat(value: unknown): value is Format {
  return (FORMATS as readonly unknown[]).includes(value);
}

export const SITE_URL = "https://seequant.app/syndrome";

/** The length H fixes (video.md §1): the whole video is at most this long. */
export const MAX_SECONDS = 60;

export type Action =
  /** One captured state of the current step, held for `seconds`. */
  | { readonly kind: "hold"; readonly seconds: number }
  /** Press "next"; waits for `data-step` to increase. Captures nothing. */
  | { readonly kind: "next" }
  /** Move the viewer's layer slider to `value`, wait for `data-gap`, capture one state. */
  | { readonly kind: "gap"; readonly value: number; readonly seconds: number };

export interface CardScene {
  readonly id: string;
  readonly panel: "card";
  /** i18n keys, one per line (at most two). */
  readonly lines: readonly string[];
  /** Whether the site URL is printed under the lines. */
  readonly url: boolean;
  readonly seconds: number;
}

export interface StepsScene {
  readonly id: string;
  readonly panel: "steps";
  /** The app's distance and p at load (no scene changes them). */
  readonly d: Distance;
  readonly p: number;
  /** Every Math.random() of the page returns seed2d / 2⁵³: the shot is sampleNoise(p, createRng(seed2d)). */
  readonly seed2d: number;
  /** What the core says of that shot; the script asserts the DOM agrees. */
  readonly expect: { readonly weight: number; readonly verdict: number };
  readonly actions: readonly Action[];
}

export interface ViewerScene {
  readonly id: string;
  readonly panel: "spacetime";
  readonly d: Distance;
  readonly shot:
    | { readonly preset: PresetKind }
    | { readonly link: string /* "#v=f<d>.<mask>" */ };
  readonly view: View;
  /** The layer gap at load (a value of the slider's grid). */
  readonly gap: number;
  readonly actions: readonly Action[];
}

export interface ChartScene {
  readonly id: string;
  readonly panel: "chart";
  readonly model: NoiseKind;
  readonly seconds: number;
}

export type PanelScene = StepsScene | ViewerScene | ChartScene;
export type Scene = CardScene | PanelScene;

const hold = (seconds: number): Action => ({ kind: "hold", seconds });
const next = (): Action => ({ kind: "next" });
const gap = (value: number, seconds: number): Action => ({
  kind: "gap",
  value,
  seconds,
});

/** `steps` steps after the first, each held `seconds`: hold, (next, hold) × steps. */
function walkthrough(steps: number, seconds: number): Action[] {
  const actions: Action[] = [hold(seconds)];
  for (let i = 0; i < steps; i++) actions.push(next(), hold(seconds));
  return actions;
}

export const SCENES: readonly Scene[] = [
  {
    id: "title",
    panel: "card",
    lines: ["app.title", "app.tagline"],
    url: false,
    seconds: 3,
  },
  {
    id: "steps2d",
    panel: "steps",
    d: 3,
    p: 0.05,
    // Chosen with `npm run video -- --dry` over seeds 1…60 (2026-10-18): one X
    // and one Z error, two chains, corrected (§7.3: the video closes without a
    // "failed" in the middle).
    seed2d: 16,
    expect: { weight: 2, verdict: 0 },
    actions: walkthrough(4, 3.5),
  },
  {
    id: "spacetime",
    panel: "spacetime",
    d: 3,
    shot: { preset: "both" },
    view: 0,
    gap: 1.25,
    actions: [
      // The "errors" step: the stack closed, then spread in three short states.
      hold(1),
      gap(1.75, 0.2),
      gap(2.25, 0.2),
      gap(2.75, 2.6),
      ...walkthrough(5, 3).slice(1),
    ],
  },
  { id: "chartIndependent", panel: "chart", model: "independent", seconds: 5 },
  {
    id: "chartPhenomenological",
    panel: "chart",
    model: "phenomenological",
    seconds: 4,
  },
  {
    id: "outro",
    panel: "card",
    lines: ["app.byline"],
    url: true,
    seconds: 3.5,
  },
];

export interface State {
  readonly label: string;
  readonly seconds: number;
}

/** The captured states of a scene, in order: one per `hold` and one per `gap`. */
export function statesOf(scene: Scene): readonly State[] {
  if (scene.panel === "card")
    return [{ label: "card", seconds: scene.seconds }];
  if (scene.panel === "chart") {
    return [{ label: scene.model, seconds: scene.seconds }];
  }
  const states: State[] = [];
  let step = 0;
  for (const action of scene.actions) {
    if (action.kind === "next") step++;
    else if (action.kind === "hold") {
      states.push({ label: `step ${step}`, seconds: action.seconds });
    } else {
      states.push({
        label: `step ${step} gap ${action.value}`,
        seconds: action.seconds,
      });
    }
  }
  return states;
}

export function sceneSeconds(scene: Scene): number {
  return statesOf(scene).reduce((sum, s) => sum + s.seconds, 0);
}

export function totalSeconds(scenes: readonly Scene[]): number {
  return scenes.reduce((sum, s) => sum + sceneSeconds(s), 0);
}
