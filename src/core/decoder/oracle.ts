// Exact minimum-weight matching with boundary by dynamic programming over bit
// masks (docs/spec.md §5 "Oráculo del decodificador", tasks/plans/decoder.md D8).
// TEST ONLY: exponential in the number of defects, it exists to verify Blossom
// without depending on another library. It lives in src/core because core tests
// may not import from outside src/core; it is NOT exported from
// src/core/index.ts and no non-test core file imports it (pinned by
// tests/intent/decoder-conventions.test.ts).
//
//   f(∅) = 0
//   f(S) = min( f(S ∖ i) + b_i,  min_{j ∈ S, j ≠ i} f(S ∖ {i, j}) + w_ij )
//
// with i the lowest set bit of S: in any matching, i goes either to the
// boundary (b_i = boundaryDist) or to some j (w_ij = dist). Memo in a
// Float64Array(2^k), k ≤ 12 (4 096 states × 12 transitions).

import type { ReadonlyIntTable } from "../lattice/rotated";

export const ORACLE_MAX_DEFECTS = 12;

/**
 * What the oracle reads of a graph: a DefectGraph (2D, `m` nodes) or a
 * SpacetimeGraph (3D, `{ m: graph.nodes, dist, boundaryDist }`; phase 2).
 */
export interface MatchingTables {
  readonly m: number;
  readonly dist: ReadonlyIntTable;
  readonly boundaryDist: ReadonlyIntTable;
}

/**
 * Minimum total weight of a matching of `defects` (distinct node indices of
 * `graph`) where every defect is paired with another or with the boundary.
 * RangeError if more than ORACLE_MAX_DEFECTS, repeated or out of range.
 */
export function exactMatchingWeight(
  graph: MatchingTables,
  defects: readonly number[],
): number {
  const k = defects.length;
  if (k > ORACLE_MAX_DEFECTS) {
    throw new RangeError(
      `the DP oracle accepts at most ${ORACLE_MAX_DEFECTS} defects, got ${k}`,
    );
  }
  const m = graph.m;
  for (let a = 0; a < k; a++) {
    const i = defects[a]!;
    if (!Number.isInteger(i) || i < 0 || i >= m) {
      throw new RangeError(`defect ${i} out of range [0, ${m})`);
    }
    for (let b = 0; b < a; b++) {
      if (defects[b] === i) throw new RangeError(`defect ${i} repeated`);
    }
  }
  if (k === 0) return 0;

  const f = new Float64Array(1 << k);
  for (let S = 1; S < 1 << k; S++) {
    // Lowest set bit of S and its position.
    const lowBit = S & -S;
    const a = 31 - Math.clz32(lowBit);
    const i = defects[a]!;
    const rest = S ^ lowBit;
    let best = f[rest]! + graph.boundaryDist[i]!;
    for (let b = a + 1; b < k; b++) {
      const bit = 1 << b;
      if ((rest & bit) === 0) continue;
      const candidate = f[rest ^ bit]! + graph.dist[i * m + defects[b]!]!;
      if (candidate < best) best = candidate;
    }
    f[S] = best;
  }
  return f[(1 << k) - 1]!;
}
