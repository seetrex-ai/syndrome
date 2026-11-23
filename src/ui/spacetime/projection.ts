// Dimetric 2:1 projection of the spacetime stack (tasks/plans/phase2-g.md D4),
// pure and testable without the DOM. A layer ℓ = 1 … L (L = cycles + 1; the
// last one is the perfect final readout) is the board rotated `view` quarter
// turns, tilted to half height and pushed down by (ℓ − 1)·gap lattice units:
//   u = (x' − y')·UNIT,  v = ((x' + y')·TILT + (ℓ − 1)·gap)·UNIT
// with (x, y) = (col, row) as in grid/geometry.ts and (x', y') the rotated
// point. Cycle 1 is drawn first (back, top); the final readout last (front,
// bottom), where the correction and the residual are projected.

import {
  BOUNDARY,
  qubitRowCol,
  type RotatedSurfaceCode,
  type Stabilizer,
  type StabilizerType,
} from "../../core";
import { UNIT, type Point } from "../grid/geometry";

export { UNIT };
export type { Point };

/** Height of the tilted board relative to its width (2:1). */
export const TILT = 0.5;
/**
 * Layer separation in lattice units (the "spread layers" slider). Along one
 * vertical line of the projection the points of a layer sit one unit apart
 * (a diagonal step of two qubits), so two layers j apart coincide point for
 * point exactly when j·gap is an integer: gap = 1 would stack every layer on
 * the previous one. The slider therefore moves on k + ¼ and k + ¾ only, where
 * j·gap is an integer first for j = 4: layers fewer than four apart never
 * share a point (projection.test.ts).
 */
export const GAP_MIN = 1.25;
export const GAP_MAX = 3.75;
export const GAP_DEFAULT = 1.75;
export const GAP_STEP = 0.5;

/** Quarter turns of the board before projecting; the panel offers two. */
export type View = 0 | 1;
export const VIEWS: readonly View[] = [0, 1];

/** Rotates a board point (x, y) `view` quarter turns about the board centre; implemented for 0 … 3. */
export function rotatePoint(
  d: number,
  view: number,
  x: number,
  y: number,
): Point {
  let px = x;
  let py = y;
  const turns = ((Math.trunc(view) % 4) + 4) % 4;
  for (let k = 0; k < turns; k++) {
    const nx = py;
    const ny = d - 1 - px;
    px = nx;
    py = ny;
  }
  return [px, py];
}

/** The rotated lattice coordinates of qubit (row, col). */
export function rotate(
  d: number,
  view: number,
  row: number,
  col: number,
): Point {
  return rotatePoint(d, view, col, row);
}

/** Projects the board point (x, y) of layer `layer` (1-based) to viewBox units. */
export function project(
  d: number,
  view: number,
  gap: number,
  layer: number,
  x: number,
  y: number,
): Point {
  const [px, py] = rotatePoint(d, view, x, y);
  return [(px - py) * UNIT, ((px + py) * TILT + (layer - 1) * gap) * UNIT];
}

export function qubitPoint3(
  d: number,
  view: number,
  gap: number,
  layer: number,
  q: number,
): Point {
  const [row, col] = qubitRowCol(d, q);
  return project(d, view, gap, layer, col, row);
}

/** Centre (j + ½, i + ½) of a plaquette, projected. */
export function plaquetteCentre(
  d: number,
  view: number,
  gap: number,
  layer: number,
  s: Stabilizer,
): Point {
  return project(d, view, gap, layer, s.col + 0.5, s.row + 0.5);
}

/**
 * Outline of a plaquette in a layer: the parallelogram of its four qubits, or,
 * for a weight-2 stabilizer, the triangle of its two qubits and its centre
 * (half a unit outside the board). No arcs: a projected half disc is not an
 * SVG arc.
 */
export function layerPolygon(
  d: number,
  view: number,
  gap: number,
  layer: number,
  s: Stabilizer,
): string {
  const points: Point[] = [];
  if (s.boundary === null) {
    // Corners in drawing order around the square between rows i, i + 1 and
    // columns j, j + 1.
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const) {
      points.push(project(d, view, gap, layer, s.col + dx, s.row + dy));
    }
  } else {
    for (const q of s.qubits) points.push(qubitPoint3(d, view, gap, layer, q));
    points.push(plaquetteCentre(d, view, gap, layer, s));
  }
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

// Layer titles ("Cycle 3", "Final readout") live in a left gutter, outside
// every plane: in the stack, the height of a layer's top corner is covered by
// the planes above it, so a title drawn there sat on their qubits (three
// iterations). Whatever the view, a layer's leftmost point is the board
// corner (x', y') = (0, d − 1): u = −(d − 1)·UNIT at v = ((d − 1)·TILT +
// (ℓ − 1)·gap)·UNIT, and its rightmost the corner (d − 1, 0) at
// u = +(d − 1)·UNIT. Nothing of any layer reaches further out than STACK_REACH
// from those corners' centres: the residual ring (RADIUS + 7 = 16, stroke 3:
// 17.5) or a boundary edge leaving the corner half a unit outwards (20) with
// its round cap (stroke 6: 23). Each title is right-aligned (text-anchor end)
// TITLE_CLEARANCE to the left of its layer's left corner, so whatever its real
// width it grows away from the stack: a wider font than estimated can only be
// clipped by the viewBox, never touch a qubit, a plaquette or an edge. The
// gutter is sized from an upper bound of the width (TITLE_EM on the pinned
// face), and a title longer than TITLE_LINE_CHARS wraps at its spaces so the
// gutter is as wide as a word, not a phrase (a
// one-line «Lectura final» cost the phone 14–17 % of the disc size).
/** How far, in viewBox units, the stack's drawing reaches beyond a corner centre. */
export const STACK_REACH = UNIT / 2 + 3;
/** Horizontal margin of the viewBox beyond the stack's reach (each side). */
export const SIDE_MARGIN = STACK_REACH + 1;
/** Font size of a layer title in viewBox units (inline style on the <text>). */
export const TITLE_FONT_SIZE = 14;
// The face of the layer titles is pinned inline on the <text> by SpacetimeSvg
// (`var(--font-display)`), so no stylesheet decides the width the gutter was
// sized for: the display stack of index.css, which starts with the
// self-hosted Space Grotesk (deterministic metrics, preloaded); its system
// fallbacks are narrower (measured 0.508 em).
/** Font weight of a layer title (inline, like the size and the face). */
export const TITLE_FONT_WEIGHT = 600;
/**
 * Upper bound of the advance per character, in em, used to size the gutter
 * without layout (jsdom has no getComputedTextLength). Measured in Chrome
 * (out/polish2/em.mjs, getComputedTextLength at weight 600): Space Grotesk at
 * most 0.550 per character over every title word of both locales («readout»),
 * the system fallback 0.508; the bound keeps 3,6 % over the widest.
 */
export const TITLE_EM = 0.57;
/** The widest measured advance per character of the pinned face (see TITLE_EM). */
export const TITLE_EM_MEASURED = 0.55;
/** Titles longer than this wrap at their spaces (one word per line at most). */
export const TITLE_LINE_CHARS = 8;
/** Distance between the baselines of a wrapped title, in em. */
export const TITLE_LINE_HEIGHT = 1.15;
/**
 * Gap between a title's end and the centre of its layer's left corner: the
 * stack's reach plus 5 units of air, of which a glyph's ink can take ~2 past
 * its advance (Chrome getBBox, «Cycle 4»: measured air 1 unit at 26).
 */
export const TITLE_CLEARANCE = STACK_REACH + 5;
// The bound TITLE_EM already leaves ~2 units on the widest line's left: no
// further margin, so the phone keeps its disc size.
const TITLE_MARGIN = 0;

/** Lines of a title: greedy word wrap at TITLE_LINE_CHARS (a longer word keeps its own line). */
export function titleLines(title: string): string[] {
  const lines: string[] = [];
  for (const word of title.split(" ").filter((w) => w.length > 0)) {
    const last = lines[lines.length - 1];
    if (
      last !== undefined &&
      Array.from(last).length + 1 + Array.from(word).length <= TITLE_LINE_CHARS
    )
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** Estimated width of one line in viewBox units (an upper bound; see TITLE_EM). */
export function lineWidth(line: string): number {
  return Array.from(line).length * TITLE_FONT_SIZE * TITLE_EM;
}

/** Estimated width of a title: its widest line. */
export function titleWidth(title: string): number {
  return Math.max(0, ...titleLines(title).map(lineWidth));
}

/**
 * A layer's title: its lines, right-aligned at x (TITLE_CLEARANCE left of the
 * layer's left corner) and centred as a block on the corner's height; each y
 * is a line's middle (SpacetimeSvg draws it with dy = 0.35em).
 */
export function titleLayout(
  d: number,
  gap: number,
  layer: number,
  title: string,
): {
  readonly x: number;
  readonly lines: readonly (readonly [string, number])[];
} {
  const lines = titleLines(title);
  const centre = ((d - 1) * TILT + (layer - 1) * gap) * UNIT;
  const step = TITLE_LINE_HEIGHT * TITLE_FONT_SIZE;
  return {
    x: -(d - 1) * UNIT - TITLE_CLEARANCE,
    lines: lines.map(
      (line, i) =>
        [line, centre + (i - (lines.length - 1) / 2) * step] as const,
    ),
  };
}

/**
 * viewBox of a stack of `layers` layers: one lattice unit of margin above and
 * below, SIDE_MARGIN beyond the stack's reach on the right, and on the left a
 * gutter for the widest line of `titles` (SIDE_MARGIN without titles).
 */
export function viewBoxOf(
  d: number,
  layers: number,
  gap: number,
  titles: readonly string[],
): string {
  const reach = (d - 1) * UNIT;
  const widest = Math.max(0, ...titles.map(titleWidth));
  const x =
    widest > 0
      ? -reach - TITLE_CLEARANCE - widest - TITLE_MARGIN
      : -reach - SIDE_MARGIN;
  const width = reach + SIDE_MARGIN - x;
  const y = -UNIT;
  const height = (d - 1 + (layers - 1) * gap + 2) * UNIT;
  return `${x} ${y} ${width} ${height}`;
}

/** Layer (1-based) and typeIndex of a node of the spacetime graph with m checks per layer. */
export function nodeLayer(m: number, node: number): number {
  return Math.floor(node / m) + 1;
}

export function nodeCheck(m: number, node: number): number {
  return node % m;
}

/**
 * Segment of an edge of the matching: between the centres of the plaquettes
 * of its two nodes (a time edge joins the same plaquette in consecutive
 * layers); for a boundary edge, from the plaquette through its qubit and half
 * a unit further out.
 */
export function edgeSegment(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  view: number,
  gap: number,
  u: number,
  v: number,
  qubit: number,
): readonly [Point, Point] {
  const checks = code.stabilizersByType[type];
  const m = checks.length;
  const d = code.d;
  const from = plaquetteCentre(
    d,
    view,
    gap,
    nodeLayer(m, u),
    checks[nodeCheck(m, u)]!,
  );
  if (v !== BOUNDARY) {
    return [
      from,
      plaquetteCentre(d, view, gap, nodeLayer(m, v), checks[nodeCheck(m, v)]!),
    ];
  }
  const through = qubitPoint3(d, view, gap, nodeLayer(m, u), qubit);
  const dx = through[0] - from[0];
  const dy = through[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [
    from,
    [
      through[0] + (dx / len) * (UNIT / 2),
      through[1] + (dy / len) * (UNIT / 2),
    ],
  ];
}

export function pointsAttribute(points: readonly Point[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}
