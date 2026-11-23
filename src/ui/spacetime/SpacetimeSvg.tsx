// The isometric stack (tasks/plans/phase2-g.md D4, D5, D11): one plane <g>
// per layer in order (cycle 1 at the back / top, the perfect final readout at
// the front / bottom, opaque), each with its plaquettes (the readings) and its
// data qubits at rest, and then ONE overlay <g data-overlay> above every
// plane with everything that tells the story, in two passes: first the
// defects of EVERY layer (opaque polygons, `<g data-defects>` grouped per
// layer), then, per layer in the same order, the measurement-flip marks, the
// data errors (with the correction and residual rings on the final plane) and
// the matching edges that start in that layer (space edges of ℓ, time edges
// ℓ → ℓ + 1).
// With the edges of layer ℓ painted between the planes ℓ and ℓ + 1, the
// opaque final plane hid most of cycle d; with the defects painted last in
// their layer, they hid the flip mark and the error disc that caused them;
// painted first in their layer, the defects of layer ℓ + 1 still
// covered the marks, discs and edges of layer ℓ (with gap 1.75 the plaquette
// (i − 2, j − 2) of ℓ + 1 projects onto (i, j) of ℓ; d = 7, p = 0.01: some
// mark hidden in 11/20 shots), hence the first pass; T-G7 pins both orders.
// Only drawing: the trace is decoded once by the panel and `layers` says
// which of its parts are visible. Every attribute below is a hook of the
// video script (tests/intent/viewer-conventions,
// test_intent_viewer_hooks_are_stable); `[data-layer]` is carried by the
// plane (role="img") and by its two overlay groups (defects, story), so
// `closest("[data-layer]")` names the layer of any mark. A plane's qubit is at rest (`data-rest`, its
// position only): the history of layer ℓ lives in `[data-overlay]
// [data-layer=ℓ]` alone (a fixed `data-pauli="I"` on the
// plane was a false value beside the overlay's `X`).

import { useMemo } from "react";
import {
  BOUNDARY,
  rotatedSurfaceCode,
  type ReadonlyPauli,
  type StabilizerType,
} from "../../core";
import { pauliName, type PauliName } from "../grid/geometry";
import type { SpacetimeTrace } from "../model/spacetime-trace";
import {
  edgeSegment,
  layerPolygon,
  nodeLayer,
  plaquetteCentre,
  pointsAttribute,
  qubitPoint3,
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  titleLayout,
  viewBoxOf,
} from "./projection";
import type { EdgeKind, ViewerLayer } from "./viewer-steps";

const RADIUS = 9;
const FLIP_MARK = 7;
const TYPES: readonly StabilizerType[] = ["Z", "X"];

export interface SpacetimeSvgProps {
  readonly trace: SpacetimeTrace;
  readonly layers: ReadonlySet<ViewerLayer>;
  readonly view: number;
  readonly gap: number;
  /** Accessible name of the whole figure. */
  readonly label: string;
  /** Accessible name of each layer, index 0 = cycle 1. */
  readonly layerLabels: readonly string[];
  /** Label drawn beside each layer, index 0 = cycle 1. */
  readonly layerTitles: readonly string[];
}

interface DrawnEdge {
  readonly type: StabilizerType;
  readonly index: number;
  readonly u: number;
  readonly v: number;
  readonly qubit: number;
}

/** The chains' edges grouped by the layer they start in (1-based; space edges of ℓ and time edges ℓ → ℓ + 1). */
function edgesByLayer(trace: SpacetimeTrace, m: number): DrawnEdge[][] {
  const groups: DrawnEdge[][] = Array.from(
    { length: trace.layers + 1 },
    () => [],
  );
  for (const type of TYPES) {
    for (const chain of trace.chains[type]) {
      for (const e of chain.edges) {
        const layerU = nodeLayer(m, e.u);
        const lower =
          e.v === BOUNDARY ? layerU : Math.min(layerU, nodeLayer(m, e.v));
        groups[lower]!.push({ type, ...e });
      }
    }
  }
  return groups;
}

export function SpacetimeSvg({
  trace,
  layers,
  view,
  gap,
  label,
  layerLabels,
  layerTitles,
}: SpacetimeSvgProps) {
  const d = trace.d;
  const code = useMemo(() => rotatedSurfaceCode(d), [d]);
  const m = (code.n - 1) / 2;
  const L = trace.layers;
  const edges = useMemo(() => edgesByLayer(trace, m), [trace, m]);
  const showErrors = layers.has("errors");
  const showMeasured = layers.has("measurements");
  const showDetectors = layers.has("detectors");
  const showMatching = layers.has("matching");
  const showCorrection = layers.has("correction");
  const showResidual = layers.has("residual");

  const planes = [];
  const defects = [];
  const overlay = [];
  for (let layer = 1; layer <= L; layer++) {
    const final = layer === L;
    const cumulative: ReadonlyPauli =
      trace.cumulative[Math.min(layer, trace.cycles) - 1]!;
    const fresh = final ? null : trace.history.cycleErrors[layer - 1]!;
    const flips = final ? null : trace.history.flips[layer - 1]!;
    const offset = (layer - 1) * m;
    // The title ends just left of the layer's left corner and grows leftwards
    // into the gutter that viewBoxOf reserves, never over a plane
    // (projection.ts, titleLayout). Size, face and weight are inline so no
    // stylesheet can change the width the gutter was sized for.
    const title = titleLayout(d, gap, layer, layerTitles[layer - 1] ?? "");
    planes.push(
      <g
        key={`l${layer}`}
        className={final ? "st-layer st-layer--final" : "st-layer"}
        data-layer={layer}
        role="img"
        aria-label={layerLabels[layer - 1]}
      >
        <text
          className="st-layer__title"
          textAnchor="end"
          style={{
            fontSize: TITLE_FONT_SIZE,
            fontFamily: "var(--font-display)",
            fontWeight: TITLE_FONT_WEIGHT,
          }}
        >
          {title.lines.map(([line, y], i) => (
            <tspan key={i} x={title.x} y={y} dy="0.35em">
              {line}
            </tspan>
          ))}
        </text>
        {code.stabilizers.map((s) => {
          const node = offset + s.typeIndex;
          const measured = showMeasured && trace.readings[s.type][node] === 1;
          return (
            <polygon
              key={`s${s.index}`}
              className={`st-plaquette st-plaquette--${s.type}`}
              points={layerPolygon(d, view, gap, layer, s)}
              data-type={s.type}
              data-plaquette={s.typeIndex}
              data-measured={measured ? 1 : 0}
            />
          );
        })}
        {code.qubits.map((qubit) => {
          const q = qubit.index;
          const [x, y] = qubitPoint3(d, view, gap, layer, q);
          return (
            <g
              key={`q${q}`}
              className="st-qubit"
              transform={`translate(${x} ${y})`}
              data-qubit={q}
              data-row={qubit.row}
              data-col={qubit.col}
              data-rest={1}
            >
              <circle className="st-qubit__disc" r={RADIUS} />
            </g>
          );
        })}
      </g>,
    );

    // The defects of this layer go to the first pass of the overlay: they are
    // opaque polygons, so everything painted after them, of any layer, stays
    // visible.
    if (showDetectors) {
      const polygons = [];
      for (const s of code.stabilizers) {
        const node = offset + s.typeIndex;
        if (trace.detectors[s.type][node] !== 1) continue;
        polygons.push(
          <polygon
            key={`d${s.index}`}
            className={`st-plaquette st-plaquette--${s.type} st-defect`}
            points={layerPolygon(d, view, gap, layer, s)}
            data-type={s.type}
            data-plaquette={s.typeIndex}
            data-defect={1}
          />,
        );
      }
      if (polygons.length > 0) {
        defects.push(
          <g key={`d${layer}`} className="st-story" data-layer={layer}>
            {polygons}
          </g>,
        );
      }
    }
    // The rest of the story of this layer, above the defects of every layer:
    // flips, errors (with the correction on the final plane), then the edges
    // that start here.
    const story = [];
    if (showErrors && flips !== null) {
      for (const s of code.stabilizers) {
        if (flips[s.type][s.typeIndex] !== 1) continue;
        const [cx, cy] = plaquetteCentre(d, view, gap, layer, s);
        story.push(
          <g
            key={`f${s.index}`}
            className="st-flip"
            data-flip={1}
            data-type={s.type}
            data-plaquette={s.typeIndex}
          >
            <line
              x1={cx - FLIP_MARK}
              y1={cy - FLIP_MARK}
              x2={cx + FLIP_MARK}
              y2={cy + FLIP_MARK}
            />
            <line
              x1={cx + FLIP_MARK}
              y1={cy - FLIP_MARK}
              x2={cx - FLIP_MARK}
              y2={cy + FLIP_MARK}
            />
          </g>,
        );
      }
    }
    for (const qubit of code.qubits) {
      const q = qubit.index;
      const drawn: PauliName = showErrors
        ? pauliName(cumulative.x[q]!, cumulative.z[q]!)
        : "I";
      const isNew =
        showErrors && fresh !== null && (fresh.x[q]! | fresh.z[q]!) === 1;
      const correction: PauliName =
        final && showCorrection
          ? pauliName(trace.correction.x[q]!, trace.correction.z[q]!)
          : "I";
      const residual: PauliName =
        final && showResidual
          ? pauliName(trace.residual.x[q]!, trace.residual.z[q]!)
          : "I";
      if (drawn === "I" && !isNew && correction === "I" && residual === "I") {
        continue;
      }
      const [x, y] = qubitPoint3(d, view, gap, layer, q);
      story.push(
        <g
          key={`q${q}`}
          className="st-qubit st-qubit--story"
          transform={`translate(${x} ${y})`}
          data-qubit={q}
          data-pauli={drawn}
          data-new={isNew ? 1 : 0}
          data-correction={correction}
          data-residual={residual}
        >
          {residual !== "I" && (
            <circle className="st-qubit__residual" r={RADIUS + 7} />
          )}
          {correction !== "I" && (
            <circle className="st-qubit__correction" r={RADIUS + 4} />
          )}
          <circle className="st-qubit__disc" r={RADIUS} />
          {isNew && <circle className="st-qubit__new" r={RADIUS + 2} />}
        </g>,
      );
    }
    if (showMatching && edges[layer]!.length > 0) {
      story.push(
        <g key="edges" className="st-edges" data-between={layer}>
          {edges[layer]!.map((e) => {
            const kind: EdgeKind = e.qubit >= 0 ? "space" : "time";
            const dim = showCorrection && kind === "space";
            return (
              <polyline
                key={`${e.type}${e.index}`}
                className={`st-edge st-edge--${kind} st-edge--${e.type}${dim ? " st-edge--dim" : ""}`}
                points={pointsAttribute(
                  edgeSegment(code, e.type, view, gap, e.u, e.v, e.qubit),
                )}
                data-edge={kind}
                data-type={e.type}
                // Space edges draw themselves (spacetime.css st-draw); a time
                // edge keeps its dashes in user units, so no pathLength there.
                pathLength={kind === "space" ? 1 : undefined}
              />
            );
          })}
        </g>,
      );
    }
    if (story.length > 0) {
      overlay.push(
        <g key={`o${layer}`} className="st-story" data-layer={layer}>
          {story}
        </g>,
      );
    }
  }

  return (
    <svg
      className="spacetime__svg"
      viewBox={viewBoxOf(d, L, gap, layerTitles)}
      role="group"
      aria-label={label}
      data-distance={d}
      data-view={view}
      data-gap={gap}
    >
      {planes}
      <g className="st-overlay" data-overlay={1} aria-hidden="true">
        <g className="st-defects" data-defects={1}>
          {defects}
        </g>
        {overlay}
      </g>
    </svg>
  );
}
