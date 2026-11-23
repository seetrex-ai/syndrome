// Screen geometry of the rotated surface code (README "Core API", docs/spec.md
// §3): qubit (r, c) → (x = c, y = r), plaquette (i, j) → centre (j + ½, i + ½),
// in lattice units scaled by UNIT so that stroke widths are whole pixels of the
// viewBox. SVG's y grows downwards, so row 0 is on top without inverting.

import {
  BOUNDARY,
  qubitRowCol,
  type RotatedSurfaceCode,
  type Stabilizer,
  type StabilizerType,
} from "../../core";
import type { Chain } from "../model/trace";

/** viewBox pixels per lattice unit. */
export const UNIT = 40;

export type Point = readonly [x: number, y: number];

/** The Pauli on a qubit as the UI names it: index = x + 2z. */
export type PauliName = "I" | "X" | "Z" | "Y";
export const PAULI_NAMES: readonly PauliName[] = ["I", "X", "Z", "Y"];

export function pauliName(x: number, z: number): PauliName {
  return PAULI_NAMES[(x & 1) | ((z & 1) << 1)]!;
}

export function qubitPoint(d: number, q: number): Point {
  const [row, col] = qubitRowCol(d, q);
  return [col * UNIT, row * UNIT];
}

export function plaquettePoint(s: Stabilizer): Point {
  return [(s.col + 0.5) * UNIT, (s.row + 0.5) * UNIT];
}

/** One lattice unit of margin on every side: boundary half discs stick out by ½. */
export function viewBox(d: number): string {
  const size = (d + 1) * UNIT;
  return `${-UNIT} ${-UNIT} ${size} ${size}`;
}

/**
 * Outline of a plaquette: the unit square between its four qubits, or, for a
 * weight-2 stabilizer, the half disc outside the board over its two qubits.
 */
export function plaquettePath(s: Stabilizer): string {
  const x = s.col * UNIT;
  const y = s.row * UNIT;
  const u = UNIT;
  if (s.boundary === null) {
    // i18n-exempt: SVG path commands
    return `M${x},${y}h${u}v${u}h${-u}Z`;
  }
  // Half disc on the board edge, bulging outwards: [x1, y1, sweep, x2, y2].
  const [x1, y1, sweep, x2, y2] = {
    top: [x, y + u, 1, x + u, y + u],
    bottom: [x, y, 0, x + u, y],
    left: [x + u, y, 0, x + u, y + u],
    right: [x, y, 1, x, y + u],
  }[s.boundary];
  // i18n-exempt: SVG path commands
  return `M${x1},${y1}A${u / 2},${u / 2} 0 0 ${sweep} ${x2},${y2}Z`;
}

/**
 * The points a correction chain passes through: the centre of defect `a`, its
 * qubits in walking order and the centre of defect `b`, or, for a chain to the
 * boundary, half a unit beyond the last qubit in the direction it was walking.
 */
export function chainPoints(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  chain: Chain,
): Point[] {
  const stabilizers = code.stabilizersByType[type];
  const points: Point[] = [plaquettePoint(stabilizers[chain.a]!)];
  for (const q of chain.qubits) points.push(qubitPoint(code.d, q));
  if (chain.b !== BOUNDARY) {
    points.push(plaquettePoint(stabilizers[chain.b]!));
  } else {
    const last = points[points.length - 1]!;
    const prev = points[points.length - 2] ?? last;
    const dx = last[0] - prev[0];
    const dy = last[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    points.push([
      last[0] + (dx / len) * (UNIT / 2),
      last[1] + (dy / len) * (UNIT / 2),
    ]);
  }
  return points;
}

export function pointsAttribute(points: readonly Point[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}
