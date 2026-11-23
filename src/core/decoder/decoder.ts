// MWPM decoder of one stabilizer type (docs/spec.md §3 "Formulación para
// Blossom", tasks/plans/decoder.md D7). One Decoder per (code, type); the
// simulation keeps two per distance and reuses them.
//
// decode(decoder, syndrome, correction):
//   1. lists the defects (syndrome[i] = 1, by typeIndex);
//   2. builds the dense matrix of §3: vertices 0 … k−1 are the defects, k … 2k−1
//      their virtual boundary nodes b_i; w(i, j) = dist, w(i, b_i) =
//      boundaryDist[i], w(b_i, b_j) = 0, w(i, b_j≠i) = NO_EDGE;
//   3. solves the minimum-weight perfect matching (Blossom);
//   4. clears ONE mask of the caller's Pauli (correction.x for type "Z", which
//      decodes X errors; correction.z for type "X") and XORs the shortest-path
//      chains of the matched pairs into it; the other mask is untouched because
//      the shot decodes Z then X into the same Pauli;
//   5. records the pairs in decoder.pairs (b = −1: boundary) and returns the
//      matching weight, Σ W_q over the chains (chains of a minimum matching are
//      edge-disjoint, so this equals the weight of the correction mask).
//
// No allocation per call: the defect list, the matrix and all Blossom arrays
// are preallocated for V = 2m = d² − 1 (every stabilizer a defect).

import type { Pauli } from "../lattice/pauli";
import type { RotatedSurfaceCode, StabilizerType } from "../lattice/rotated";
import { createMatcher, NO_EDGE, type Matcher } from "./blossom";
import {
  BOUNDARY,
  defectGraph,
  pathQubits,
  xorPathInto,
  type DefectGraph,
} from "./graph";

// Module-level copies read once: inside Vitest's module runner an imported
// binding is a getter, and the hot loop of decode would pay it per entry.
const INF = NO_EDGE;
const NONE = BOUNDARY;

export interface Decoder {
  readonly code: RotatedSurfaceCode;
  readonly type: StabilizerType;
  readonly graph: DefectGraph;
  /** After decode: pairs[2k], pairs[2k+1] for k < pairCount; second entry −1 = boundary. Read only. */
  readonly pairs: Int32Array;
  /** Written by decode. */
  readonly pairCount: number;
  /** Written by decode. */
  readonly defectCount: number;
}

interface MutableDecoder extends Decoder {
  pairCount: number;
  defectCount: number;
  readonly matcher: Matcher;
  readonly defects: Int32Array;
}

/** Builds the decoder of `type` for `code`: precomputes the defect graph and all buffers. Allocates. */
export function createDecoder(
  code: RotatedSurfaceCode,
  type: StabilizerType,
): Decoder {
  const graph = defectGraph(code, type);
  const m = graph.m;
  const decoder: MutableDecoder = {
    code,
    type,
    graph,
    pairs: new Int32Array(2 * m),
    pairCount: 0,
    defectCount: 0,
    matcher: createMatcher(2 * m),
    defects: new Int32Array(m),
  };
  return Object.seal(decoder);
}

/**
 * Decodes `syndrome` (length (d² − 1)/2, by typeIndex) into `correction`:
 * clears correction.x (type "Z") or correction.z (type "X") entirely, XORs the
 * correction chains in and returns the matching weight (integer, Σ W_q over
 * the chains). Fills decoder.pairs / pairCount / defectCount. No allocation.
 * RangeError if the lengths do not match the code.
 */
export function decode(
  decoder: Decoder,
  syndrome: Uint8Array,
  correction: Pauli,
): number {
  const dec = decoder as MutableDecoder;
  const graph = dec.graph;
  const m = graph.m;
  if (syndrome.length !== m) {
    throw new RangeError(
      `syndrome must have length ${m} (type ${dec.type}, d = ${dec.code.d}), got ${syndrome.length}`,
    );
  }
  if (correction.n !== dec.code.n) {
    throw new RangeError(
      `correction acts on ${correction.n} qubits, code has ${dec.code.n}`,
    );
  }
  const mask = dec.type === "Z" ? correction.x : correction.z;
  mask.fill(0);

  const defects = dec.defects;
  let k = 0;
  for (let i = 0; i < m; i++) {
    if (syndrome[i] !== 0) defects[k++] = i;
  }
  dec.defectCount = k;
  dec.pairCount = 0;
  if (k === 0) return 0;

  const matcher = dec.matcher;
  const n0 = matcher.maxVertices;
  const weight = matcher.weight;
  const dist = graph.dist;
  const boundaryDist = graph.boundaryDist;
  for (let a = 0; a < k; a++) {
    const i = defects[a]!;
    const rowA = a * n0;
    const rowVa = (k + a) * n0;
    for (let b = 0; b < k; b++) {
      weight[rowA + b] = dist[i * m + defects[b]!]!;
      weight[rowVa + k + b] = 0;
      weight[rowA + k + b] = INF;
      weight[(k + b) * n0 + a] = INF;
    }
    weight[rowA + k + a] = boundaryDist[i]!;
    weight[rowVa + a] = boundaryDist[i]!;
  }
  matcher.solve(2 * k);

  const mate = matcher.mate;
  const pairs = dec.pairs;
  let total = 0;
  let p = 0;
  for (let a = 0; a < k; a++) {
    const b = mate[a]!;
    const i = defects[a]!;
    if (b < k) {
      if (b < a) continue; // recorded from the other side
      const j = defects[b]!;
      pairs[p++] = i;
      pairs[p++] = j;
      total += xorPathInto(graph, i, j, mask);
    } else {
      pairs[p++] = i;
      pairs[p++] = NONE;
      total += xorPathInto(graph, i, NONE, mask);
    }
  }
  dec.pairCount = p / 2;
  return total;
}

/** UI: one entry per pair of the last decode with the qubits of its chain. Allocates. */
export function correctionChains(
  decoder: Decoder,
): { a: number; b: number; qubits: number[] }[] {
  const out: { a: number; b: number; qubits: number[] }[] = [];
  for (let p = 0; p < decoder.pairCount; p++) {
    const a = decoder.pairs[2 * p]!;
    const b = decoder.pairs[2 * p + 1]!;
    out.push({ a, b, qubits: pathQubits(decoder.graph, a, b) });
  }
  return out;
}
