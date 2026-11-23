// The chart panel (tasks/plans/ui.md D3, D4, §6; phase2.md D10): the
// validated base curves of the chosen noise model at once, refined live by the
// Worker; the model selector (the chart is the only view that changes with
// it); per-distance shot counters and throughput; Λ = P_L(d) / P_L(d + 2) at
// the user's p with its interval; the explanations of the chart (D13).
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { normalizeP } from "../../worker/protocol";
import { ModelSelect } from "../controls/ModelSelect";
import { Explain, ExplainGroup } from "../explain/Explain";
import type { ExplainId } from "../explain/ids";
import { DEFAULT_MODEL, type NoiseKind } from "../model/noise-kinds";
import { BASELINES, type Baseline } from "./baseline";
import { Chart } from "./Chart";
import { lambdaAt, pointAt, poolPoints, shotsRange } from "./curves";
import { Clamp } from "../controls/Clamp";
import { formatRatio } from "./format";
import { useChartEngagement } from "./useChartEngagement";
import { useSimulation, type CreateWorker } from "./useSimulation";
import "./chart.css";

export interface ChartPanelProps {
  readonly p: number;
  /**
   * The noise model shown; the App owns it (persisted, resets p on change).
   * Absent (tests of the phase 1 behaviour): the default model, selector inert.
   */
  readonly model?: NoiseKind;
  readonly onModelChange?: (model: NoiseKind) => void;
  /** Tests inject a fake Worker; the app uses the real one. */
  readonly createWorker?: CreateWorker;
  /** Tests inject a base; the app serves the validated one of the model. */
  readonly baseline?: Baseline;
  /** The App renders this panel as the first figure (design.md D1): `.panel--hero`. */
  readonly hero?: boolean;
}

const NO_CHANGE = (): void => {};

/**
 * The explanations under the chart, per model (phase2.md D13): the
 * phenomenological one describes measurement failures, which the phase 1 model
 * does not have.
 */
/**
 * The x axis of each model: the slider's 0–20 % for the phase 1 model (its
 * grid spans 3–15 %); 0–5 % for the phenomenological one, whose grid spans
 * 0.5–4 % and whose curves would otherwise sit in the left fifth of the plot
 * (measured at 360 px). A user p beyond the end stretches the axis to it.
 */
const P_AXIS_MAX: Readonly<Record<NoiseKind, number>> = {
  independent: 0.2,
  phenomenological: 0.05,
};

const EXPLANATIONS: Readonly<Record<NoiseKind, readonly ExplainId[]>> = {
  independent: ["threshold", "lambda", "logAxis", "upperBound"],
  phenomenological: [
    "phenomenological",
    "threshold",
    "lambda",
    "logAxis",
    "upperBound",
  ],
};

export function ChartPanel({
  p: rawP,
  model = DEFAULT_MODEL,
  onModelChange = NO_CHANGE,
  createWorker,
  baseline = BASELINES[model],
  hero = false,
}: ChartPanelProps) {
  const { t, i18n } = useTranslation();
  // The same key the Worker gives its lanes (protocol.ts): a p within 10⁻⁶ of
  // a grid value IS that grid point, for Λ and the throughput alike.
  const p = normalizeP(rawP);
  const options = useMemo(
    () => ({
      createWorker,
      model,
      distances: baseline.distances,
      probabilities: baseline.probabilities,
    }),
    [createWorker, model, baseline],
  );
  const sim = useSimulation(p, options);
  // chart_engaged (tasks/plans/analytics.md D12): 15 s with the figure on screen.
  const sectionRef = useRef<HTMLElement>(null);
  useChartEngagement(sectionRef, model);
  const points = useMemo(
    () => poolPoints(baseline.points, sim.live),
    [baseline, sim.live],
  );
  const base = shotsRange(baseline.points);
  const pDomain = useMemo(
    () => ({ min: 0, max: Math.max(P_AXIS_MAX[model], p) }),
    [model, p],
  );
  const lang = i18n.language;
  const number = (v: number, digits: number) =>
    v.toLocaleString(lang, { maximumFractionDigits: digits });
  const percent = (v: number) =>
    v.toLocaleString(lang, { style: "percent", maximumFractionDigits: 1 });

  // The Worker itself failed (its script gone after an update): said before
  // any run's error, which can no longer arrive.
  const status = sim.lost
    ? t("chart.workerLost")
    : sim.error !== null
      ? t("chart.error", { message: sim.error })
      : sim.unavailable
        ? t("chart.unavailable")
        : sim.elapsedMs === null || sim.userRunning
          ? t("chart.running")
          : t("chart.done", { seconds: number(sim.elapsedMs / 1000, 1) });

  return (
    <section
      ref={sectionRef}
      id="panel-chart"
      className={hero ? "panel panel--chart panel--hero" : "panel panel--chart"}
    >
      <h2>{t("chart.title")}</h2>
      <ModelSelect value={model} onChange={onModelChange} />
      <Chart
        points={points}
        distances={baseline.distances}
        userP={p}
        model={model}
        pDomain={pDomain}
      />
      <p
        className="chart__status"
        role="status"
        data-done={sim.elapsedMs !== null ? 1 : 0}
      >
        {status}
      </p>
      <table className="chart__stats">
        <tbody>
          {baseline.distances.map((d) => {
            const own = points.filter((pt) => pt.d === d);
            const liveShots = own.reduce((sum, pt) => sum + pt.liveShots, 0);
            // Throughput at the user's p (docs/spec.md §7 measures d = 7 at p = 0.10);
            // the fastest lane of the curve until that lane has a batch.
            const rate =
              pointAt(own, d, p)?.rate ||
              own.reduce((max, pt) => Math.max(max, pt.rate), 0);
            return (
              <tr key={d} className={`curve--d${d}`} data-d={d}>
                <th scope="row">{t("chart.legend.d", { d })}</th>
                <td data-live-shots={liveShots}>
                  {t("chart.shots", { count: liveShots })}
                </td>
                <td data-rate={Math.round(rate)}>
                  {t("chart.throughput", { rate: Math.round(rate) })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="chart__lambda">
        {baseline.distances.slice(0, -1).map((d) => {
          const lambda = lambdaAt(points, d, p);
          return (
            <div key={d} data-lambda-d={d}>
              <dt>
                {t("chart.lambda.label", { d, next: d + 2, p: percent(p) })}
              </dt>
              <dd data-lambda={lambda === null ? "" : lambda.ratio}>
                {lambda === null
                  ? // At p = 0 no shot ever fails (ChartPanel.test measures it
                    // against the core): "not yet" would promise a Λ that never
                    // comes.
                    p === 0
                    ? t("chart.lambda.noNoise")
                    : t("chart.lambda.undefined")
                  : t("chart.lambda.value", {
                      ratio: formatRatio(lambda.ratio, lang),
                      low: formatRatio(lambda.low, lang),
                      high: formatRatio(lambda.high, lang),
                    })}
              </dd>
              {/* The stat tile's big figure (design.md D1): the same ratio the
                  dd above spells out with its interval, so it is hidden from
                  assistive tech; empty when Λ is not defined. */}
              <dd
                className="chart__ratio"
                data-lambda-ratio={lambda === null ? "" : lambda.ratio}
                aria-hidden="true"
              >
                {lambda === null ? "" : formatRatio(lambda.ratio, lang)}
              </dd>
            </div>
          );
        })}
      </dl>
      <Clamp
        className="chart__base"
        data-base-model={baseline.noise}
        data-base-min={base.min}
        data-base-max={base.max}
      >
        {base.min === base.max
          ? t("chart.base", { shots: base.min })
          : t("chart.baseRange", { min: base.min, max: base.max })}
      </Clamp>
      <ExplainGroup>
        {EXPLANATIONS[model].map((id) => (
          <Explain key={id} id={id} />
        ))}
      </ExplainGroup>
    </section>
  );
}

export default ChartPanel;
