import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Distance } from "../core";
import { SiteHeader } from "./brand/SiteHeader";
import { ChallengePanel } from "./challenge/ChallengePanel";
import { ChartSkeleton } from "./chart/ChartSkeleton";
import type { CreateWorker } from "./chart/useSimulation";
import { Footer } from "./footer/Footer";
import { GridPanel } from "./grid/GridPanel";
import { followPathLanguage } from "./language-url";
import { readStoredModel, storeModel } from "./model/model-store";
import { SectionNav } from "./nav/SectionNav";
import {
  DEFAULT_MODEL,
  DEFAULT_P_BY_MODEL,
  type NoiseKind,
} from "./model/noise-kinds";
import { UpdateToast } from "./pwa/UpdateToast";
import { SpacetimeSkeleton } from "./spacetime/SpacetimeSkeleton";
import { StepsPanel } from "./steps/StepsPanel";
import { ThemeToggle } from "./theme/ThemeToggle";

// Deferred (tasks/plans/ui.md D6, docs/spec.md §7): the chart and its Worker are
// not in the initial chunk; tests/intent/deferred-loading and bundle-budget.
const ChartPanel = lazy(() => import("./chart/ChartPanel"));
// Deferred too (tasks/plans/phase2-g.md D9): the spacetime viewer.
const SpacetimePanel = lazy(() => import("./spacetime/SpacetimePanel"));

export const DEFAULT_DISTANCE: Distance = 3;

// The prefixes of the shareable links (spacetime/link VIEWER_HASH_PREFIX,
// challenge/puzzle HASH_PREFIX; not imported: both panels are deferred) and
// the panel each one opens (design.md D1: they sit under the hero).
const PANEL_LINKS: readonly (readonly [prefix: string, panel: string])[] = [
  // i18n-exempt: a hash prefix and the CSS selector of the panel it opens
  ["#v=", ".panel--spacetime"],
  // i18n-exempt: a hash prefix and the CSS selector of the panel it opens
  ["#c=", ".panel--challenge"],
];

export interface AppProps {
  /** Tests inject a fake simulation Worker; the app uses the real one. */
  readonly createWorker?: CreateWorker;
}

export function App({ createWorker }: AppProps) {
  const { t, i18n } = useTranslation();
  // The shared state (tasks/plans/ui.md D1): the three panels take d and p by
  // props; the chart alone takes the noise model (phase2.md D10), remembered
  // across visits. A change of model moves p to that model's default once
  // (DEFAULT_P_BY_MODEL); the slider stays free afterwards.
  const [d, setD] = useState<Distance>(DEFAULT_DISTANCE);
  const [model, setModel] = useState<NoiseKind>(
    () => readStoredModel() ?? DEFAULT_MODEL,
  );
  const [p, setP] = useState(() => DEFAULT_P_BY_MODEL[model]);
  const changeModel = useCallback((next: NoiseKind) => {
    setModel(next);
    setP(DEFAULT_P_BY_MODEL[next]);
    storeModel(next);
  }, []);
  // A `#c=` link opens that challenge puzzle (tasks/plans/phase2.md D11) and a
  // `#v=` link a shot of the spacetime viewer (phase2-g.md D8), at load and
  // whenever the hash changes in the open tab (a pasted link); each panel
  // ignores the other's prefix.
  const [link, setLink] = useState(() => window.location.hash);
  useEffect(() => {
    const onHashChange = () => setLink(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  // Those panels sit under the hero now (design.md D1): a prefixed link
  // scrolls its panel into view at mount and on each change; an anchor or an
  // empty hash scrolls nothing (jsdom has no scrollIntoView: guarded).
  useEffect(() => {
    const target = PANEL_LINKS.find(([prefix]) => link.startsWith(prefix));
    if (target === undefined) return;
    const panel = document.querySelector(target[1]);
    if (panel !== null && typeof panel.scrollIntoView === "function") {
      // No options: the default aligns the panel's top (block "start").
      panel.scrollIntoView();
    }
  }, [link]);

  // The language switch lives in the brand bar (brand/LangSwitch.tsx,
  // since 2026-10-20): one lang_switch per gesture that picks another language
  // (tasks/plans/analytics.md D5), the choice stored and the URL moved
  // without reloading (tasks/plans/syndrome-es-url.md D6). Back/Forward to
  // an entry of another language's page shows that language.
  useEffect(() => followPathLanguage(i18n), [i18n]);

  // The scroll story (tasks/plans/design.md D1): the chart, with its Λ, is the
  // first figure under the tagline; the lattice and the walkthroughs follow.
  // The brand bar sits above the app, outside <main>, full width like the
  // brand site's header (SiteHeader.tsx); Syndrome's own header follows with
  // the product's name, the h1, and the theme.
  return (
    <>
      <SiteHeader />
      <main className="app">
        <header className="app__header">
          <h1 className="app__title">{t("app.title")}</h1>
          <div className="app__prefs">
            <ThemeToggle />
          </div>
        </header>
        <UpdateToast />

        <p className="app__tagline">{t("app.tagline")}</p>

        <Suspense fallback={<ChartSkeleton hero />}>
          <ChartPanel
            hero
            p={p}
            model={model}
            onModelChange={changeModel}
            createWorker={createWorker}
          />
        </Suspense>
        <SectionNav />
        <GridPanel d={d} onDistanceChange={setD} p={p} onPChange={setP} />
        <StepsPanel d={d} p={p} />
        <Suspense fallback={<SpacetimeSkeleton />}>
          <SpacetimePanel d={d} link={link} />
        </Suspense>
        <ChallengePanel d={d} link={link} />

        <Footer />
      </main>
    </>
  );
}
