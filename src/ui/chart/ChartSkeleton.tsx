// Suspense fallback while the chart chunk loads (tasks/plans/ui.md D6): the
// panel's frame with empty axes, plus placeholders the size of the loaded
// panel's model select, status, stats, Λ tiles, base note and explanations
// (the `.chart-skeleton__*` rules of src/index.css: this file imports nothing
// from chart/, tests/intent/deferred-loading), so the lattice below does not
// jump when the chunk arrives. `hero` adds the first-figure class the App
// gives the real panel (design.md D1).
import { useTranslation } from "react-i18next";

export interface ChartSkeletonProps {
  readonly hero?: boolean;
}

export function ChartSkeleton({ hero = false }: ChartSkeletonProps) {
  const { t } = useTranslation();
  return (
    <section
      id="panel-chart"
      className={hero ? "panel panel--chart panel--hero" : "panel panel--chart"}
      aria-busy="true"
    >
      <h2>{t("chart.title")}</h2>
      <div className="chart-skeleton__model" aria-hidden="true" />
      <figure className="chart chart--skeleton">
        <svg className="chart__svg" viewBox="0 0 640 400" role="img">
          <title>{t("chart.loading")}</title>
          <line className="chart__axis" x1={64} x2={64} y1={16} y2={352} />
          <line className="chart__axis" x1={64} x2={624} y1={352} y2={352} />
        </svg>
        <figcaption className="chart__caption">{t("chart.loading")}</figcaption>
      </figure>
      <div className="chart-skeleton__status" aria-hidden="true" />
      <div className="chart-skeleton__stats" aria-hidden="true" />
      <div className="chart-skeleton__lambda" aria-hidden="true">
        <div />
        <div />
      </div>
      <div className="chart-skeleton__base" aria-hidden="true" />
      <div className="chart-skeleton__explain" aria-hidden="true" />
    </section>
  );
}
