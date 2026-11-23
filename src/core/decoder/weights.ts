// Generic, deterministic qubit weights shared with the Python reference
// (docs/spec.md §3 "Pesos y desempate", tasks/plans/decoder.md D4).
//
// The spec defines w_q = 1 + ε·u_q with ε = 10⁻³ and u_q the top 53 bits of
// splitmix64(0x53594E44 + q) over 2⁵³. Floats cannot be made identical on both
// sides of the validation: PyMatching 2.4.0 discretises non-integer weights to
// 2²⁴ levels (error ~10⁻⁸) and silently DROPS any edge heavier than
// MAX_USER_EDGE_WEIGHT = 2²⁴ − 1. So the decoder works on INTEGERS defined by
// integer arithmetic alone, which PyMatching uses verbatim (normalising constant
// 1.0 when every weight is integral):
//
//   top53_q = splitmix64(WEIGHT_SEED + q) >> 11                    (< 2⁵³)
//   S       = floor((2²⁴ − 1) · 1000 / 1001) = 16 760 454           (WEIGHT_SCALE)
//   W_q     = S + floor(top53_q · S / (1000 · 2⁵³))                 (integer)
//
// W_q / S lies in (w_q − 1/S, w_q]: it is w_q discretised to 16 760 perturbation
// levels, and max W_q ≤ S + S/1000 < 2²⁴ fits PyMatching's ceiling. Any sum of
// path weights stays far below 2⁵³, so `number` holds it exactly outside this
// file; bigint is used here only, at construction (R8). Changing the seed, the
// scale or the denominator changes the decoder: entry in docs/decisiones.md and a
// new validation (§3).
//
// Phase 2 (tasks/plans/phase2.md D3): the same formula over an EDGE INDEX gives
// the weights of the spacetime graph of the phenomenological model. Edge e of
// the graph of (code, cycles) is a data error (q, cycle) → e = q + n·(cycle − 1),
// or a measurement flip (s, cycle) → e = n·cycles + (cycle − 1)·m + s with
// s = typeIndex (the same index for both types: they are separate graphs).
// With cycles = 1 and no time edges the index is q: the phase 1 weights are the
// special case, `qubitWeight(q) === edgeWeight(q)`. Consequences: max W_e stays
// ≤ 2²⁴ − 1 (same formula); the guarantee "perturbed minimum = uniform minimum"
// needs (edges of the correction)·16 760 < S, i.e. fewer than 1 000 edges:
// unconditional up to d = 7 (≤ 511 edges per type, M9), conditional at d = 9
// (1 089 edges; false only for corrections using ≥ 1 000 of them); and the
// 3D weights are NOT all distinct (1 061 distinct values over the 1 089 indices
// of d = 9: birthday collisions on 16 760 levels) — the TS/Python identity of
// the decoder rests on the integers, not on their uniqueness.

import type { RotatedSurfaceCode } from "../lattice/rotated";
import { splitmix64 } from "../noise/splitmix64";

export const WEIGHT_SEED = 0x53594e44n;
/** floor((2²⁴ − 1) · 1000 / 1001). */
export const WEIGHT_SCALE = 16_760_454;
/** ε = 1 / WEIGHT_EPSILON_DENOMINATOR. */
export const WEIGHT_EPSILON_DENOMINATOR = 1000;
/** PyMatching 2.4.0 MAX_USER_EDGE_WEIGHT: an edge above it is dropped, not an error. */
export const MAX_EDGE_WEIGHT = 16_777_215;

const SCALE_BIG = BigInt(WEIGHT_SCALE);
const DIVISOR_BIG = BigInt(WEIGHT_EPSILON_DENOMINATOR) * (1n << 53n);

function checkQubit(q: number): void {
  if (!Number.isInteger(q) || q < 0) {
    throw new RangeError(
      `qubit index must be a non-negative integer, got ${q}`,
    );
  }
}

/** Top 53 bits of splitmix64(WEIGHT_SEED + q), as a bigint in [0, 2⁵³). */
function top53(q: number): bigint {
  return splitmix64(WEIGHT_SEED + BigInt(q)) >> 11n;
}

/**
 * W_e, the integer weight of edge index e: S + floor(top53_e · S / (1000 · 2⁵³)).
 * `qubitWeight(q) === edgeWeight(q)`. RangeError unless e is an integer ≥ 0.
 */
export function edgeWeight(e: number): number {
  if (!Number.isInteger(e) || e < 0) {
    throw new RangeError(`edge index must be a non-negative integer, got ${e}`);
  }
  return Number(SCALE_BIG + (top53(e) * SCALE_BIG) / DIVISOR_BIG);
}

/** W_q, the integer weight of qubit q (q = row·d + col): edgeWeight(q). RangeError unless q is an integer ≥ 0. */
export function qubitWeight(q: number): number {
  checkQubit(q);
  return edgeWeight(q);
}

function checkCycle(cycle: number, cycles: number): void {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError(`cycles must be an integer ≥ 1, got ${cycles}`);
  }
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > cycles) {
    throw new RangeError(`cycle ${cycle} out of range [1, ${cycles}]`);
  }
}

/**
 * Edge index of the data error on qubit q in cycle `cycle` (1 … cycles):
 * q + n·(cycle − 1). RangeError on an out-of-range qubit or cycle.
 */
export function spaceEdgeIndex(
  code: RotatedSurfaceCode,
  q: number,
  cycle: number,
  cycles: number,
): number {
  checkCycle(cycle, cycles);
  if (!Number.isInteger(q) || q < 0 || q >= code.n) {
    throw new RangeError(`qubit ${q} out of range [0, ${code.n})`);
  }
  return q + code.n * (cycle - 1);
}

/**
 * Edge index of the measurement flip of stabilizer `typeIndex` (of either
 * type) in cycle `cycle` (1 … cycles): n·cycles + (cycle − 1)·m + typeIndex,
 * after all n·cycles space edges. RangeError on an out-of-range index or cycle.
 */
export function timeEdgeIndex(
  code: RotatedSurfaceCode,
  typeIndex: number,
  cycle: number,
  cycles: number,
): number {
  checkCycle(cycle, cycles);
  const m = (code.n - 1) / 2;
  if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= m) {
    throw new RangeError(`typeIndex ${typeIndex} out of range [0, ${m})`);
  }
  return code.n * cycles + (cycle - 1) * m + typeIndex;
}

/** W_0 … W_{n−1}. */
export function qubitWeights(n: number): Int32Array {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `qubit count must be a non-negative integer, got ${n}`,
    );
  }
  const out = new Int32Array(n);
  for (let q = 0; q < n; q++) out[q] = qubitWeight(q);
  return out;
}

/**
 * w_q = 1 + ε·u_q as the spec writes it (a double). Documentation and tests
 * only: the decoder never uses it (D4).
 */
export function qubitWeightReal(q: number): number {
  checkQubit(q);
  return 1 + Number(top53(q)) / 2 ** 53 / WEIGHT_EPSILON_DENOMINATOR;
}
