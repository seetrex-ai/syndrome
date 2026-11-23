// The spacetime viewer of the phenomenological model (tasks/plans/phase2-g.md
// D5–D11): one shot of d noisy cycles plus the perfect final readout, drawn
// as an isometric stack and replayed in six steps (errors → measurements →
// detectors → matching → correction → verdict). The shot is decoded once into
// a frozen SpacetimeTrace; steps, view and gap only choose how it is drawn
// (tests/intent/viewer-conventions, test_intent_viewer_trace_computed_once).
// `d` is the app's; `p` is the viewer's own, starting at the model's default
// (D7). A `#v=` link opens that very history (D8). Loaded lazily (D9).

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LOGICAL_X,
  LOGICAL_Z,
  type Distance,
  type SpacetimeHistory,
} from "../../core";
import { Clamp } from "../controls/Clamp";
import { Disclosure } from "../controls/Disclosure";
import {
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRestart,
} from "../controls/icons";
import { P_MAX, P_MIN, P_STEP } from "../controls/NoiseControls";
import { SegmentedControl } from "../controls/SegmentedControl";
import { Slider } from "../controls/Slider";
import { Explain, ExplainGroup } from "../explain/Explain";
import {
  createSpacetimeTraceContext,
  decodeSpacetimeTrace,
  PRESET_KINDS,
  presetHistory,
  type PresetKind,
} from "../model/spacetime-trace";
import { initialStepState, STEP_INTERVAL_MS } from "../steps/step-machine";
import { drawHistory, LARGE_DISTANCE, VIEWER_DEFAULT_P } from "./draw";
import {
  encodeHistory,
  historyFromHash,
  isViewerLink,
  VIEWER_HASH_PREFIX,
} from "./link";
import {
  GAP_DEFAULT,
  GAP_MAX,
  GAP_MIN,
  GAP_STEP,
  VIEWS,
  type View,
} from "./projection";
import { SpacetimeSvg } from "./SpacetimeSvg";
import { VIEWER_PLAN } from "./viewer-steps";
import {
  readStoredGap,
  readStoredView,
  storeGap,
  storeView,
} from "./viewer-store";
import "./spacetime.css";

export interface SpacetimePanelProps {
  /** The app's shared distance; a linked shot keeps its own. */
  readonly d: Distance;
  /** `location.hash`: a `#v=` link opens that shot; a new value loads a new one. */
  readonly link?: string;
}

interface Shown {
  readonly d: Distance;
  readonly history: SpacetimeHistory;
  readonly fromLink: boolean;
}

function fromLink(link: string | undefined): Shown | null {
  if (link === undefined) return null;
  const linked = historyFromHash(link);
  return linked === null
    ? null
    : { d: linked.d, history: linked.history, fromLink: true };
}

function isBadLink(link: string | undefined): boolean {
  return (
    link !== undefined && isViewerLink(link) && historyFromHash(link) === null
  );
}

export function SpacetimePanel({ d, link }: SpacetimePanelProps) {
  const { t, i18n } = useTranslation();
  const [p, setP] = useState(VIEWER_DEFAULT_P);
  const [shown, setShown] = useState<Shown>(
    () => fromLink(link) ?? { d, history: drawHistory(d, p), fromLink: false },
  );
  // A new app distance draws a new shot; a new link (hashchange) opens that
  // shot. Adjusting state during render is React's pattern for deriving from
  // a change in a prop: no frame shows the old stack under the new inputs.
  const [appliedD, setAppliedD] = useState(d);
  const [appliedLink, setAppliedLink] = useState(link);
  // The bad-link note belongs to the link that arrived: any shot started
  // afterwards (preset, new shot, new distance) clears it.
  const [badLink, setBadLink] = useState(() => isBadLink(link));
  if (d !== appliedD) {
    setAppliedD(d);
    setShown({ d, history: drawHistory(d, p), fromLink: false });
    setBadLink(false);
  }
  if (link !== appliedLink) {
    setAppliedLink(link);
    setBadLink(isBadLink(link));
    const linked = fromLink(link);
    if (linked !== null) setShown(linked);
  }

  const ctx = useMemo(() => createSpacetimeTraceContext(shown.d), [shown.d]);
  const trace = useMemo(
    () => decodeSpacetimeTrace(ctx, shown.history),
    [ctx, shown.history],
  );
  const [steps, dispatch] = useReducer(
    VIEWER_PLAN.reducer,
    trace,
    initialStepState,
  );
  if (steps.trace !== trace) dispatch({ type: "load", trace });

  const [view, setView] = useState<View>(() => readStoredView() ?? 0);
  const [gap, setGap] = useState<number>(() => readStoredGap() ?? GAP_DEFAULT);
  const changeView = useCallback((next: View) => {
    setView(next);
    storeView(next);
  }, []);
  const changeGap = useCallback((next: number) => {
    setGap(next);
    storeGap(next);
  }, []);

  const newShot = useCallback(() => {
    setShown({ d, history: drawHistory(d, p), fromLink: false });
    setBadLink(false);
  }, [d, p]);
  const preset = useCallback(
    (kind: PresetKind) => {
      setShown({ d, history: presetHistory(d, kind), fromLink: false });
      setBadLink(false);
    },
    [d],
  );

  useEffect(() => {
    if (!steps.playing) return undefined;
    const id = setInterval(() => dispatch({ type: "next" }), STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [steps.playing]);

  const [copied, setCopied] = useState<boolean | null>(null);
  const copyLink = useCallback(async () => {
    const directory = `${window.location.origin}${window.location.pathname}`
      .replace(/\/index\.html$/, "/")
      .replace(/\/+$/, "");
    const url = `${directory}/${VIEWER_HASH_PREFIX}${encodeHistory(shown.d, shown.history)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [shown]);
  // The copy status belongs to one shot: a new one clears it.
  const [copiedFor, setCopiedFor] = useState(shown);
  if (copiedFor !== shown) {
    setCopiedFor(shown);
    setCopied(null);
  }

  const { index, playing } = steps;
  const step = VIEWER_PLAN.STEPS[index]!;
  const layers = VIEWER_PLAN.layersOf(index);
  const verdict = trace.verdict;
  const verdictText =
    verdict === 0
      ? t("grid.verdict.ok")
      : verdict === LOGICAL_X
        ? t("grid.verdict.x")
        : verdict === LOGICAL_Z
          ? t("grid.verdict.z")
          : t("grid.verdict.xz");

  // Per-layer counts: the accessible names of the <g> elements and the list
  // under the figure (D11); the tests read these, not the geometry.
  const m = (trace.d * trace.d - 1) / 2;
  const layerCounts = useMemo(() => {
    const out = [];
    for (let layer = 1; layer <= trace.layers; layer++) {
      let defects = 0;
      let flips = 0;
      let errors = 0;
      for (let s = 0; s < m; s++) {
        defects +=
          trace.detectors.Z[(layer - 1) * m + s]! +
          trace.detectors.X[(layer - 1) * m + s]!;
      }
      if (layer <= trace.cycles) {
        const f = trace.history.flips[layer - 1]!;
        const e = trace.history.cycleErrors[layer - 1]!;
        for (let s = 0; s < m; s++) flips += f.Z[s]! + f.X[s]!;
        for (let q = 0; q < e.n; q++) errors += e.x[q]! | e.z[q]!;
      }
      out.push({ layer, defects, flips, errors });
    }
    return out;
  }, [trace, m]);
  // One count per plural key (i18next pluralises one `count` per call); the
  // final readout's defects are the last cycle's measurement failures
  // (D_L = f_cycles, tests/intent/explanations T-G8c).
  const layerLabels = layerCounts.map(({ layer, defects, flips, errors }) =>
    layer === trace.layers
      ? t("spacetime.finalLayerLabel", {
          defects: t("spacetime.count.finalDefects", { count: defects }),
        })
      : t("spacetime.layerLabel", {
          cycle: layer,
          defects: t("spacetime.count.defects", { count: defects }),
          flips: t("spacetime.count.flips", { count: flips }),
          errors: t("spacetime.count.errors", { count: errors }),
        }),
  );
  const layerTitles = layerCounts.map(({ layer }) =>
    layer === trace.layers
      ? t("spacetime.finalReadout")
      : t("spacetime.cycle", { cycle: layer }),
  );

  return (
    <section
      id="panel-spacetime"
      className="panel panel--spacetime"
      data-step={index}
      data-view={view}
      data-gap={gap}
      data-verdict={verdict}
      data-from-link={shown.fromLink ? 1 : 0}
      data-distance={shown.d}
    >
      <h2>{t("spacetime.title")}</h2>
      <Clamp className="spacetime__intro">{t("spacetime.intro")}</Clamp>
      <Clamp className="spacetime__model">{t("spacetime.model")}</Clamp>
      {badLink && <p className="spacetime__note">{t("spacetime.badLink")}</p>}
      {shown.fromLink && (
        <p className="spacetime__note">{t("spacetime.fromLink")}</p>
      )}
      {shown.d >= LARGE_DISTANCE && (
        <p className="spacetime__note">{t("spacetime.largeDistance")}</p>
      )}

      <div className="spacetime__shot">
        <fieldset className="spacetime__presets">
          <legend>{t("spacetime.preset.label")}</legend>
          {PRESET_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="btn btn--chip"
              data-preset={kind}
              onClick={() => preset(kind)}
            >
              {t(`spacetime.preset.${kind}`)}
            </button>
          ))}
          <button
            type="button"
            className="btn btn--primary spacetime__new"
            onClick={newShot}
          >
            {t("spacetime.newShot")}
          </button>
        </fieldset>
        <Slider
          className="spacetime__p"
          label={t("spacetime.p")}
          min={P_MIN}
          max={P_MAX}
          step={P_STEP}
          value={p}
          onChange={setP}
          valueText={p.toLocaleString(i18n.language, {
            style: "percent",
            maximumFractionDigits: 1,
          })}
        />
      </div>

      <div className="spacetime__look">
        <SegmentedControl
          className="spacetime__view segmented--fill"
          legend={t("spacetime.view.label")}
          options={VIEWS.map((v) => ({
            value: String(v),
            label:
              v === 0 ? t("spacetime.view.left") : t("spacetime.view.right"),
          }))}
          value={String(view)}
          onChange={(next) => changeView(Number(next) as View)}
        />
        <Slider
          className="spacetime__gap"
          label={t("spacetime.explode")}
          min={GAP_MIN}
          max={GAP_MAX}
          step={GAP_STEP}
          value={gap}
          onChange={changeGap}
          valueText={gap.toLocaleString(i18n.language, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        />
      </div>

      <ol className="stepper spacetime__steps">
        {VIEWER_PLAN.STEPS.map((name, i) => (
          <li
            key={name}
            className="stepper__step spacetime__step"
            data-done={i <= index ? 1 : 0}
            aria-current={i === index ? "step" : undefined}
          >
            {t(`spacetime.${name}`)}
          </li>
        ))}
      </ol>

      <SpacetimeSvg
        trace={trace}
        layers={layers}
        view={view}
        gap={gap}
        label={t("spacetime.svgLabel", { d: trace.d, cycles: trace.cycles })}
        layerLabels={layerLabels}
        layerTitles={layerTitles}
      />
      <Disclosure
        className="spacetime__layers"
        summary={t("spacetime.layersHeading")}
      >
        <ol>
          {layerLabels.map((text, i) => (
            <li key={i} data-layer-summary={i + 1}>
              {text}
            </li>
          ))}
        </ol>
      </Disclosure>

      <div className="spacetime__live" aria-live="polite">
        <p className="spacetime__explain">
          <strong className="spacetime__name">{t(`spacetime.${step}`)}</strong>{" "}
          {t(`spacetime.explain.${step}`)}
        </p>
        {step === "verdict" && (
          <p className="verdict spacetime__verdict" data-verdict={verdict}>
            {verdictText}
          </p>
        )}
      </div>

      <div className="spacetime__controls">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => dispatch({ type: "prev" })}
          disabled={index === 0}
        >
          <IconPrev />
          {t("spacetime.prev")}
        </button>
        {playing ? (
          <button
            type="button"
            className="btn btn--primary btn--play"
            onClick={() => dispatch({ type: "pause" })}
          >
            <IconPause />
            {t("spacetime.pause")}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--play"
            onClick={() => dispatch({ type: "play" })}
          >
            <IconPlay />
            {t("spacetime.play")}
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => dispatch({ type: "next" })}
          disabled={index === VIEWER_PLAN.LAST_STEP}
        >
          {t("spacetime.next")}
          <IconNext />
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => dispatch({ type: "restart" })}
          disabled={index === 0}
        >
          <IconRestart />
          {t("spacetime.restart")}
        </button>
      </div>

      <div className="spacetime__share">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void copyLink()}
        >
          {t("spacetime.copy")}
        </button>
        {copied !== null && (
          <span className="spacetime__note" data-copied={copied ? 1 : 0}>
            {copied ? t("spacetime.copied") : t("spacetime.copyFailed")}
          </span>
        )}
      </div>

      <ExplainGroup>
        <Explain id="phenomenological" />
        <Explain id="measurementFlip" />
        <Explain id="dataErrorPersists" />
        <Explain id="finalPlane" />
      </ExplainGroup>
    </section>
  );
}

export default SpacetimePanel;
