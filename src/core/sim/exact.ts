// Exact logical error rate of d = 3 by enumeration (docs/spec.md §6 "Exacto en
// d = 3", tasks/plans/validation.md D5/M5).
//
// Independent X/Z noise is decoded independently, so P_L factorises:
//   P_X(p) = Σ_k a_k p^k (1 − p)^(n − k)     a_k = X patterns of weight k that fail
//   P_Z(p) likewise from the Z patterns
//   P_L   = 1 − (1 − P_X)(1 − P_Z)
// exactFailureCounts enumerates the 2^n patterns of ONE type (n = 9 at d = 3:
// 512 decodes) and the test enumerates the full 2^18 product to pin the
// factorisation. d > 3 is refused: 2^25 patterns per type (≈ 30 s) is not
// something the app or the validation needs.
//
// By the parity theorem (tasks/plans/decoder.md M2) the verdict of a pattern
// is the same for every exact MWPM decoder, whatever tie-break it uses, so
// these counts are a decoder-independent check of the TS against PyMatching:
// a_k + a_{n−k} = C(n, k) because e and its complement e·X^{⊗n} share syndrome
// and correction (X^{⊗n} = X_L times a product of X stabilizers has null
// syndrome and flips the verdict), so exactly one of the two fails.

import { commutes, identity, multiplyInto } from "../lattice/pauli";
import type { RotatedSurfaceCode, StabilizerType } from "../lattice/rotated";
import { computeTypeSyndrome } from "../lattice/syndrome";
import { createDecoder, decode } from "../decoder/decoder";
import { createSpacetimeDecoder, decodeSpacetime } from "../decoder/spacetime";
import { detectorsOf } from "./spacetime-shot";

/** Largest distance exactFailureCounts enumerates (2^9 patterns per type). */
export const EXACT_MAX_DISTANCE = 3;

/**
 * a_k for k = 0 … n: patterns of the errors `type` detects (X errors for type
 * "Z", Z errors for type "X") of weight k whose MWPM correction leaves a
 * logical error. Int32Array of length n + 1. RangeError if d > 3.
 */
export function exactFailureCounts(
  code: RotatedSurfaceCode,
  type: StabilizerType,
): Int32Array {
  if (code.d > EXACT_MAX_DISTANCE) {
    throw new RangeError(
      `exact enumeration is limited to d ≤ ${EXACT_MAX_DISTANCE}, got d = ${code.d}`,
    );
  }
  const n = code.n;
  const decoder = createDecoder(code, type);
  const error = identity(n);
  const correction = identity(n);
  const residual = identity(n);
  const syndrome = new Uint8Array((n - 1) / 2);
  // Type-Z checks see X errors; an X-only residual fails iff it anticommutes with Z_L.
  const mask = type === "Z" ? error.x : error.z;
  const logical = type === "Z" ? code.logicalZ : code.logicalX;
  const counts = new Int32Array(n + 1);
  const patterns = 2 ** n;
  for (let pattern = 0; pattern < patterns; pattern++) {
    let w = 0;
    for (let q = 0; q < n; q++) {
      const bit = (pattern >>> q) & 1;
      mask[q] = bit;
      w += bit;
    }
    computeTypeSyndrome(code, type, error, syndrome);
    decode(decoder, syndrome, correction);
    multiplyInto(residual, error, correction);
    if (!commutes(residual, logical)) counts[w] = counts[w]! + 1;
  }
  return counts;
}

export interface ExactRates {
  /** P_X: probability of a logical X error (from the type-Z counts). */
  readonly x: number;
  /** P_Z: probability of a logical Z error (from the type-X counts). */
  readonly z: number;
  /** P_L = 1 − (1 − x)(1 − z). */
  readonly either: number;
}

function binomialSum(counts: Int32Array, n: number, p: number): number {
  let total = 0;
  for (let k = 0; k <= n; k++) {
    const a = counts[k]!;
    if (a !== 0) total += a * p ** k * (1 - p) ** (n - k);
  }
  return total;
}

/**
 * Exact rates at p from the two count tables (length n + 1 each; countsZ from
 * the type-Z checks gives P_X, countsX gives P_Z). RangeError on a length
 * mismatch or p ∉ [0, 1].
 */
export function exactLogicalRates(
  countsZ: Int32Array,
  countsX: Int32Array,
  n: number,
  p: number,
): ExactRates {
  if (countsZ.length !== n + 1 || countsX.length !== n + 1) {
    throw new RangeError(
      `count tables must have length ${n + 1}, got ${countsZ.length} and ${countsX.length}`,
    );
  }
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`error probability must be in [0, 1], got ${p}`);
  }
  const x = binomialSum(countsZ, n, p);
  const z = binomialSum(countsX, n, p);
  return { x, z, either: 1 - (1 - x) * (1 - z) };
}

/** Error mechanisms per type of the exact spacetime model: n data errors + m measurement flips with cycles = 1. */
export const EXACT_SPACETIME_MECHANISMS = 13;

/**
 * Phase 2 (tasks/plans/phase2.md D5): exact failure counts of the reduced
 * phenomenological model with ONE noisy cycle and a perfect final readout,
 * d = 3. Per type there are 13 mechanisms (9 data errors in cycle 1, 4
 * measurement flips in cycle 1), each with probability p: 2^13 = 8 192
 * patterns, a_w = patterns of w mechanisms whose spacetime MWPM correction
 * leaves a logical error. Int32Array of length 14. RangeError unless d = 3
 * and cycles = 1 (cycles = 2 would be 2^26 patterns).
 *
 * With one cycle the model reduces EXACTLY to the phase 1 decoder: the perfect
 * final layer reveals the flips (D_2 = f) and every layer-2 node has only its
 * time edge, so every closing matching uses time edge s iff f_s = 1 and the
 * rest is the 2D matching of D_1 ⊕ f = H·E with the same W_q. Hence
 * a_w = Σ_k a2D_k · C(4, w − k), the rates equal the 2D ones, the verdict is
 * tie-break independent (parity theorem) and the symmetry
 * a_w + a_{13−w} = C(13, w) holds (inherited from 2D, where the complement of
 * 9 qubits is X_L times a stabilizer). All of this is pinned by exact.test.ts
 * and was reproduced independently with PyMatching. R3 of the plan stays
 * open only for cycles ≥ 2, which the verdict fixture measures.
 */
export function exactSpacetimeFailureCounts(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  cycles: number,
): Int32Array {
  if (code.d !== EXACT_MAX_DISTANCE) {
    throw new RangeError(
      `exact spacetime enumeration is limited to d = ${EXACT_MAX_DISTANCE}, got d = ${code.d}`,
    );
  }
  if (cycles !== 1) {
    throw new RangeError(
      `exact spacetime enumeration is limited to cycles = 1, got ${cycles}`,
    );
  }
  const n = code.n;
  const m = (n - 1) / 2;
  const mechanisms = n + m;
  const decoder = createSpacetimeDecoder(code, type, 1);
  const error = identity(n);
  const flips = new Uint8Array(m);
  const correction = identity(n);
  const residual = identity(n);
  const detectors = new Uint8Array(decoder.graph.nodes);
  const mask = type === "Z" ? error.x : error.z;
  const logical = type === "Z" ? code.logicalZ : code.logicalX;
  const counts = new Int32Array(mechanisms + 1);
  const patterns = 2 ** mechanisms;
  for (let pattern = 0; pattern < patterns; pattern++) {
    let w = 0;
    for (let q = 0; q < n; q++) {
      const bit = (pattern >>> q) & 1;
      mask[q] = bit;
      w += bit;
    }
    for (let s = 0; s < m; s++) {
      const bit = (pattern >>> (n + s)) & 1;
      flips[s] = bit;
      w += bit;
    }
    detectorsOf(code, type, 1, [error], [flips], detectors);
    decodeSpacetime(decoder, detectors, correction);
    multiplyInto(residual, error, correction);
    if (!commutes(residual, logical)) counts[w] = counts[w]! + 1;
  }
  return counts;
}

/**
 * Exact rates of the reduced spacetime model from its two count tables
 * (length mechanisms + 1 each): exactLogicalRates with n = mechanisms.
 */
export function exactSpacetimeRates(
  countsZ: Int32Array,
  countsX: Int32Array,
  mechanisms: number,
  p: number,
): ExactRates {
  return exactLogicalRates(countsZ, countsX, mechanisms, p);
}
