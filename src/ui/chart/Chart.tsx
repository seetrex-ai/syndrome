// The threshold chart in hand-written SVG (tasks/plans/ui.md D4): P_L against p
// for every distance on a log axis, Wilson bars, a filled marker per point, an
// OPEN marker at `high` with a downward arrow for a point with no failure
// (docs/spec.md §3: an upper bound, never a zero), the user's p as a dashed line,
// the noise model always named. Colours and strokes live in chart.css.
// The <svg> is one image to assistive technology (role="img"): its children
// are presentational, so its accessible name carries both axes and the noise
// model (chart.svgLabel); the panel's heading carries the title once (it is
// not repeated here: the y axis label already starts with it), and the
// caption repeats the model as text.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NoiseKind } from "../model/noise-kinds";
import { crossingOf, estimateAt, type CurvePoint } from "./curves";
import {
  decadeTicks,
  logYScale,
  xScale,
  xTicks,
  yDomain,
  type Domain,
} from "./scales";
import { useWidth } from "./useWidth";

export interface ChartProps {
  readonly points: readonly CurvePoint[];
  readonly distances: readonly number[];
  readonly userP: number;
  /** The noise model the points were sampled under: named in the caption and the svg's name. */
  readonly model: NoiseKind;
  /** The x axis; defaults to the slider's [0, 0.2]. */
  readonly pDomain?: Domain;
}

// Not exported (react-refresh wants component-only modules); tests read the DOM.
// The viewBox is `width` (the figure's CSS width, useWidth) × `height`: one
// unit is one CSS pixel, so the 12 px labels of chart.css are 12 px on a phone
// too. `left` leaves room for the longest tick label ("0,0001 %" at
// 12 px, right-aligned 8 px before the axis) between the axis and the vertical
// y title at Y_TITLE_X (tests/intent/chart-conventions measures
// the boxes).
const VIEW = Object.freeze({
  height: 400,
  left: 88,
  right: 16,
  top: 16,
  bottom: 48,
});
// The rotated title's baseline: its em box reaches ≈ 1.08 em (13 px) to the
// left of it, so at 12 the box started 1 px outside the svg (measured in
// Chrome, 2026-10-20); at 14 it starts at 1 px.
const Y_TITLE_X = 14;

const DEFAULT_P_DOMAIN: Domain = Object.freeze({ min: 0, max: 0.2 });
const MARKER_RADIUS = 3.5;
// The legend's key, in CSS pixels: a line segment with the marker on it.
const SWATCH = Object.freeze({ width: 28, height: 12 });

/**
 * The marker of a distance, a shape per distance so colour is not the only
 * cue: a circle (d = 3), a square (d = 5) or a
 * triangle (d = 7) of the circle's area, centred on (cx, cy); any other
 * distance gets the circle. The same shape draws the measured point
 * (`.marker__dot`, filled), the upper bound (`.marker__open`, hollow)
 * and the legend's key (`.chart__swatch-mark`). `data-cx`/`data-cy` carry
 * the centre whatever the shape and
 * `data-shape` names it; tests/intent/chart-conventions checks the drawn
 * geometry is centred there.
 */
function MarkerDot({
  d,
  cx,
  cy,
  className = "marker__dot", // i18n-exempt: a CSS class, the measured point's hook
}: {
  d: number;
  cx: number;
  cy: number;
  className?: string;
}) {
  const r = MARKER_RADIUS;
  if (d === 5) {
    // Side √π·r: the circle's area.
    const s = r * Math.sqrt(Math.PI);
    return (
      <rect
        className={className}
        data-shape="square"
        data-cx={cx}
        data-cy={cy}
        x={cx - s / 2}
        y={cy - s / 2}
        width={s}
        height={s}
      />
    );
  }
  if (d === 7) {
    // Equilateral, apex up, the circle's area: side √(4π/√3)·r, centroid at (cx, cy).
    const side = r * Math.sqrt((4 * Math.PI) / Math.sqrt(3));
    const h = (side * Math.sqrt(3)) / 2;
    const points = [
      [cx, cy - (2 * h) / 3],
      [cx + side / 2, cy + h / 3],
      [cx - side / 2, cy + h / 3],
    ]
      .map(([px, py]) => `${px},${py}`)
      .join(" ");
    return (
      <polygon
        className={className}
        data-shape="triangle"
        data-cx={cx}
        data-cy={cy}
        points={points}
      />
    );
  }
  return (
    <circle
      className={className}
      data-shape="circle"
      data-cx={cx}
      data-cy={cy}
      cx={cx}
      cy={cy}
      r={r}
    />
  );
}
// Upper bounds of several distances at the same p (every curve at p = 0) would
// share one pixel: those, and only those, are spread sideways by distance, one
// marker width apart, centred on p, and the row is pushed inside the plot area
// when p sits on its edge (at p = 0 the
// d = 3 bound was left of the axis). A lone bound and every measured point sit
// exactly at their p.
const BOUND_SPREAD = 2 * MARKER_RADIUS + 2;
// Two crossing markers closer than this (CSS px) merge into one.
const MARKER_MERGE_PX = 8;

export function Chart({
  points,
  distances,
  userP,
  model,
  pDomain = DEFAULT_P_DOMAIN,
}: ChartProps) {
  const { t, i18n } = useTranslation();
  const modelLabel = t(`chart.model.${model}`);
  const figureRef = useRef<HTMLElement>(null);
  const width = useWidth(figureRef);
  const xRange = { min: VIEW.left, max: width - VIEW.right };
  const yRange = { min: VIEW.top, max: VIEW.height - VIEW.bottom };
  const domain = yDomain(points);
  const x = (p: number) => xScale(p, pDomain, xRange);
  const y = (v: number) => logYScale(Math.max(v, domain.min), domain, yRange);
  const ticks = decadeTicks(domain.min, domain.max);
  const percent = (v: number) =>
    v.toLocaleString(i18n.language, {
      style: "percent",
      maximumSignificantDigits: 2,
    });

  // Distances with an upper bound at each p, in `distances` order.
  const boundsAt = new Map<number, number[]>();
  for (const d of distances) {
    for (const pt of points) {
      if (pt.d === d && pt.upperBoundOnly) {
        boundsAt.set(pt.p, [...(boundsAt.get(pt.p) ?? []), d]);
      }
    }
  }
  // Crossings of consecutive distances, with the P_L read off the first curve
  // (the two agree there by construction).
  const crossings = distances.flatMap((d1, i) => {
    const d2 = distances[i + 1];
    if (d2 === undefined) return [];
    const p = crossingOf(points, d1, d2);
    const estimate = p === null ? null : estimateAt(points, d1, p);
    return p === null || estimate === null ? [] : [{ d1, d2, p, estimate }];
  });

  // One marker per crossing, except that two crossings closer than
  // MARKER_MERGE_PX on the plot (the independent model: (3, 5) and (5, 7)
  // nearly coincide) draw as a single marker between them, named after both
  // (two overlapping rings read as a smudge).
  const markers: { names: string[]; p: number; cx: number; cy: number }[] = [];
  for (const c of crossings) {
    const cx = x(c.p);
    const cy = y(c.estimate);
    const last = markers[markers.length - 1];
    if (
      last !== undefined &&
      Math.hypot(cx - last.cx, cy - last.cy) < MARKER_MERGE_PX
    ) {
      last.names.push(`${c.d1}-${c.d2}`);
      last.cx = (last.cx + cx) / 2;
      last.cy = (last.cy + cy) / 2;
    } else {
      markers.push({ names: [`${c.d1}-${c.d2}`], p: c.p, cx, cy });
    }
  }

  const boundX = (pt: CurvePoint): number => {
    const group = boundsAt.get(pt.p) ?? [pt.d];
    const half = ((group.length - 1) * BOUND_SPREAD) / 2;
    const centre = Math.min(
      Math.max(x(pt.p), xRange.min + half),
      xRange.max - half,
    );
    return centre - half + group.indexOf(pt.d) * BOUND_SPREAD;
  };

  return (
    <figure className="chart" ref={figureRef}>
      <svg
        className="chart__svg"
        viewBox={`0 0 ${width} ${VIEW.height}`}
        role="img"
        aria-label={t("chart.svgLabel", {
          pl: t("chart.axis.pl"),
          p: t("chart.axis.p"),
          model: modelLabel,
        })}
      >
        {/* The sub-threshold region (design.md D5): from the left edge to the
            crossing of the two smallest distances, where every larger code
            does better. First in the svg, under the gridlines, under the
            curves. No text: the "?" explanations already say
            what a threshold is. It moves with the live points, as it should. */}
        {crossings.length > 0 && crossings[0]!.d1 === distances[0] && (
          <rect
            className="chart__region"
            data-region="sub-threshold"
            x={xRange.min}
            y={yRange.min}
            width={Math.max(0, x(crossings[0]!.p) - xRange.min)}
            height={yRange.max - yRange.min}
          />
        )}
        <g className="chart__grid">
          {ticks.minor.map((v) => (
            <line
              key={v}
              className="chart__gridline chart__gridline--minor"
              x1={xRange.min}
              x2={xRange.max}
              y1={y(v)}
              y2={y(v)}
            />
          ))}
          {ticks.major.map((v) => (
            <line
              key={v}
              className="chart__gridline"
              x1={xRange.min}
              x2={xRange.max}
              y1={y(v)}
              y2={y(v)}
            />
          ))}
        </g>
        <g className="chart__axis chart__axis--y">
          <line
            x1={xRange.min}
            x2={xRange.min}
            y1={yRange.min}
            y2={yRange.max}
          />
          {ticks.major.map((v) => (
            <text key={v} x={xRange.min - 8} y={y(v)} dy="0.35em">
              {percent(v)}
            </text>
          ))}
          <text
            className="chart__axis-label"
            transform={`translate(${Y_TITLE_X} ${(yRange.min + yRange.max) / 2}) rotate(-90)`}
          >
            {t("chart.axis.pl")}
          </text>
        </g>
        <g className="chart__axis chart__axis--x">
          <line
            x1={xRange.min}
            x2={xRange.max}
            y1={yRange.max}
            y2={yRange.max}
          />
          {xTicks(pDomain).map((v) => (
            <text key={v} x={x(v)} y={yRange.max + 18}>
              {percent(v)}
            </text>
          ))}
          <text
            className="chart__axis-label"
            x={(xRange.min + xRange.max) / 2}
            y={VIEW.height - 8}
          >
            {t("chart.axis.p")}
          </text>
        </g>
        {userP >= pDomain.min && userP <= pDomain.max && (
          <line
            className="chart__user-p"
            data-user-p={userP}
            x1={x(userP)}
            x2={x(userP)}
            y1={yRange.min}
            y2={yRange.max}
          />
        )}
        {distances.map((d) => {
          const own = points.filter((pt) => pt.d === d);
          const measured = own.filter((pt) => !pt.upperBoundOnly);
          return (
            <g key={d} className={`curve curve--d${d}`} data-d={d}>
              {measured.length > 1 && (
                <polyline
                  className="curve__line"
                  points={measured
                    .map((pt) => `${x(pt.p)},${y(pt.estimate)}`)
                    .join(" ")}
                />
              )}
              {own.map((pt) =>
                pt.upperBoundOnly ? (
                  <g
                    key={pt.p}
                    className="marker marker--open"
                    data-upper-bound="1"
                    data-p={pt.p}
                  >
                    <title>{t("chart.upperBound")}</title>
                    <MarkerDot
                      d={d}
                      cx={boundX(pt)}
                      cy={y(pt.high)}
                      className="marker__open"
                    />
                    <path
                      className="marker__arrow"
                      d={`M${boundX(pt)},${y(pt.high) + MARKER_RADIUS + 1} v9 m-3,-4 l3,4 l3,-4`}
                    />
                  </g>
                ) : (
                  <g
                    key={pt.p}
                    className="marker"
                    data-p={pt.p}
                    data-live={pt.live ? 1 : 0}
                  >
                    <line
                      className="marker__bar"
                      x1={x(pt.p)}
                      x2={x(pt.p)}
                      y1={y(pt.high)}
                      y2={y(pt.low)}
                    />
                    <MarkerDot d={d} cx={x(pt.p)} cy={y(pt.estimate)} />
                  </g>
                ),
              )}
            </g>
          );
        })}
        {markers.map((m) => (
          <circle
            key={m.names.join(" ")}
            className="chart__crossing"
            data-crossing={m.names.join(" ")}
            data-p={m.p}
            cx={m.cx}
            cy={m.cy}
            r={5}
          />
        ))}
      </svg>
      <figcaption className="chart__caption">
        <ul className="chart__legend">
          {distances.map((d) => (
            <li key={d} className={`curve--d${d}`}>
              {/* The key of the curve: its line and its marker shape (a
                  colour bar alone left the shapes unnamed). */}
              <svg
                className="chart__swatch"
                viewBox={`0 0 ${SWATCH.width} ${SWATCH.height}`}
                width={SWATCH.width}
                height={SWATCH.height}
                aria-hidden="true"
                focusable="false"
              >
                <line
                  className="chart__swatch-line"
                  x1={0}
                  x2={SWATCH.width}
                  y1={SWATCH.height / 2}
                  y2={SWATCH.height / 2}
                />
                <MarkerDot
                  d={d}
                  cx={SWATCH.width / 2}
                  cy={SWATCH.height / 2}
                  className="chart__swatch-mark"
                />
              </svg>
              {t("chart.legend.d", { d })}
            </li>
          ))}
        </ul>
        <p className="chart__model" data-model={model}>
          {modelLabel}
        </p>
      </figcaption>
    </figure>
  );
}
