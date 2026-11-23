// Syndrome extraction, stabilizer-group membership and logical verdict for the
// rotated surface code. Hot path of the Monte Carlo shot: no allocation per call,
// indexed loops over typed arrays, the caller owns the output buffers.

import { commutes, type ReadonlyMask, type ReadonlyPauli } from "./pauli";
import type { RotatedSurfaceCode, StabilizerType } from "./rotated";

/**
 * Syndrome of `error` restricted to the stabilizers of `type`, by typeIndex.
 * Z stabilizers detect X components (reads only error.x); X stabilizers detect Z
 * components (reads only error.z). `out.length` must be (d²−1)/2. Writes every
 * entry and returns `out`.
 */
export function computeTypeSyndrome(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  error: ReadonlyPauli,
  out: Uint8Array,
): Uint8Array {
  const count = code.stabilizersByType[type].length;
  if (out.length !== count) {
    throw new RangeError(
      `syndrome buffer must have length ${count}, got ${out.length}`,
    );
  }
  if (error.n !== code.n) {
    throw new RangeError(`error acts on ${error.n} qubits, code has ${code.n}`);
  }
  const mask = type === "Z" ? error.x : error.z;
  const first = code.typeOffset[type];
  parityInto(code, mask, first, first + count, out, 0);
  return out;
}

/**
 * Full syndrome by global stabilizer index (Z block then X block).
 * `out.length` must be d²−1. Writes every entry and returns `out`.
 */
export function computeSyndrome(
  code: RotatedSurfaceCode,
  error: ReadonlyPauli,
  out: Uint8Array,
): Uint8Array {
  const total = code.stabilizers.length;
  if (out.length !== total) {
    throw new RangeError(
      `syndrome buffer must have length ${total}, got ${out.length}`,
    );
  }
  if (error.n !== code.n) {
    throw new RangeError(`error acts on ${error.n} qubits, code has ${code.n}`);
  }
  const split = code.typeOffset.X;
  parityInto(code, error.x, 0, split, out, 0);
  parityInto(code, error.z, split, total, out, split);
  return out;
}

/**
 * out[outOffset + (s − from)] = parity of mask over the support of stabilizer s,
 * for s in [from, to). CSR walk, no allocation.
 */
function parityInto(
  code: RotatedSurfaceCode,
  mask: ReadonlyMask,
  from: number,
  to: number,
  out: Uint8Array,
  outOffset: number,
): void {
  const offsets = code.supportOffsets;
  const support = code.supportQubits;
  let o = outOffset;
  for (let s = from; s < to; s++) {
    let parity = 0;
    const end = offsets[s + 1]!;
    for (let k = offsets[s]!; k < end; k++) {
      parity ^= mask[support[k]!]!;
    }
    out[o++] = parity;
  }
}

/**
 * Logical effect of a residual operator (error · correction) whose syndrome is
 * null. PRECONDITION: the caller knows the syndrome is null (the shot has just
 * computed it); this function does not recompute it. `x` is true iff the residual
 * anticommutes with Z_L (it acts as X_L modulo stabilizers), `z` iff it
 * anticommutes with X_L. Both true for a residual equivalent to Y_L.
 */
export function logicalEffect(
  code: RotatedSurfaceCode,
  residual: ReadonlyPauli,
): { readonly x: boolean; readonly z: boolean } {
  return {
    x: !commutes(residual, code.logicalZ),
    z: !commutes(residual, code.logicalX),
  };
}

/**
 * True iff p is in the stabilizer group: null syndrome and commutes with both
 * logical operators. Acceptance criterion of the challenge mode (docs/spec.md §4.6)
 * applied to the residual error · correction. `scratch`, if given, must have
 * length d²−1 and is used as the syndrome buffer instead of a fresh one (the hot
 * loop passes one; whether that keeps the call allocation-free is for the bench
 * script planned for phase 1 to measure, not promised here).
 */
export function isStabilizerEquivalent(
  code: RotatedSurfaceCode,
  p: ReadonlyPauli,
  scratch?: Uint8Array,
): boolean {
  const syndrome = computeSyndrome(
    code,
    p,
    scratch ?? new Uint8Array(code.stabilizers.length),
  );
  for (let s = 0; s < syndrome.length; s++) {
    if (syndrome[s] !== 0) return false;
  }
  const effect = logicalEffect(code, p);
  return !effect.x && !effect.z;
}
