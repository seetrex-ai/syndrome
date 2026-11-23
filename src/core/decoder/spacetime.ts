// Spacetime defect graph and MWPM decoder of the phenomenological model
// (docs/spec.md §3 "Modelo de ruido", tasks/plans/phase2.md D1/D3/D4), one per
// (code, type, cycles). The 2D decoder (graph.ts, decoder.ts) is untouched: the
// phase 1 model keeps its own path (D2); with cycles = 1 the first layer of this
// graph IS the 2D graph entry by entry (spacetime.test.ts), which is the sense
// in which 2D is the special case.
//
// Nodes: the detectors D_r = s_r ⊕ s_{r−1} (s_0 = 0) of one type, r = 1 …
// cycles + 1, index (r − 1)·m + typeIndex: m·(cycles + 1) of them. The last
// layer (r = cycles + 1) is the perfect final readout.
// Edges = error mechanisms, one each, indexed as decoder/weights.ts does:
//   space edge (q, r), r ≤ cycles: a data error on qubit q in cycle r lights
//     the ≤ 2 checks of q IN LAYER r (the boundary if only one);
//   time edge (s, r), r ≤ cycles: a measurement flip of check s in cycle r
//     lights (r, s) and (r + 1, s).
// The last layer has NO space edges (no data noise after the final readout)
// and there is NO time boundary (layer 1 is compared with the known s_0 = 0,
// the last layer is perfect). Weight of edge e: edgeWeight(e). A space edge
// carries its qubit into the correction; a time edge carries no qubit
// (edgeQubit = −1) and only its weight.
//
// Dense Dijkstra from every node gives dist/via (first EDGE of a shortest
// path) and boundaryDist/boundaryVia; O(M³) once per graph, cached per (code,
// type, cycles): d = 7 → 192³ ≈ 7·10⁶ steps, d = 9 → 400³. Values stay below
// 2³¹ (≤ (d + cycles)·2²⁴), so Int32Array holds them. Ties by scan order.
//
// Decoder: same dense formulation as decode() (defects + one virtual boundary
// node each), but the Blossom matcher is NOT sized for the worst case (2M
// vertices = 12–50 MB of (2N + 1)² tables at d = 7–9): it starts small and is
// replaced by a larger one when a syndrome needs it (next power of two in
// defects, capped at M). A shot is never dropped for its size: no selection
// bias on the tails (D4).

import type { Pauli } from "../lattice/pauli";
import type {
  ReadonlyIntTable,
  RotatedSurfaceCode,
  StabilizerType,
} from "../lattice/rotated";
import { createMatcher, NO_EDGE, type Matcher } from "./blossom";
import { BOUNDARY } from "./graph";
import { edgeWeight } from "./weights";

// Module-level copies read once (imported bindings are getters under Vitest).
const INF = NO_EDGE;
const NONE = BOUNDARY;

export interface SpacetimeGraph {
  readonly code: RotatedSurfaceCode;
  readonly type: StabilizerType;
  /** Noisy cycles (≥ 1). */
  readonly cycles: number;
  /** Detector layers, cycles + 1 (the last one is the perfect readout). */
  readonly layers: number;
  /** Checks of this type per layer, (d² − 1)/2. */
  readonly m: number;
  /** Nodes, m · layers. */
  readonly nodes: number;
  /** n·cycles space edges followed by m·cycles time edges. */
  readonly edgeCount: number;
  /** Endpoints of edge e: edgeU[e] a node, edgeV[e] a node or BOUNDARY (−1). */
  readonly edgeU: ReadonlyIntTable;
  readonly edgeV: ReadonlyIntTable;
  /** Qubit of a space edge; −1 for a time edge. */
  readonly edgeQubit: ReadonlyIntTable;
  /** edgeWeight(e) for every e. */
  readonly edgeWeight: ReadonlyIntTable;
  /** nodes·nodes row-major: shortest path weight u → v, 0 on the diagonal. */
  readonly dist: ReadonlyIntTable;
  /** nodes·nodes: first edge of a shortest path u → v; −1 on the diagonal. */
  readonly via: ReadonlyIntTable;
  /** nodes: shortest path weight from u to the boundary. */
  readonly boundaryDist: ReadonlyIntTable;
  /** nodes: first edge of a shortest path from u to the boundary. */
  readonly boundaryVia: ReadonlyIntTable;
}

const cache = new WeakMap<RotatedSurfaceCode, Map<string, SpacetimeGraph>>();

/** Node index of detector (cycle, typeIndex): (cycle − 1)·m + typeIndex. RangeError out of range. */
export function nodeIndex(
  graph: SpacetimeGraph,
  cycle: number,
  typeIndex: number,
): number {
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > graph.layers) {
    throw new RangeError(`cycle ${cycle} out of range [1, ${graph.layers}]`);
  }
  if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= graph.m) {
    throw new RangeError(`typeIndex ${typeIndex} out of range [0, ${graph.m})`);
  }
  return (cycle - 1) * graph.m + typeIndex;
}

/**
 * The spacetime graph of (code, type, cycles). Allocates and runs the Dijkstra
 * on first use, cached afterwards per code object. RangeError unless cycles is
 * an integer ≥ 1.
 */
export function spacetimeGraph(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  cycles: number,
): SpacetimeGraph {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError(`cycles must be an integer ≥ 1, got ${cycles}`);
  }
  let perCode = cache.get(code);
  if (perCode === undefined) {
    perCode = new Map();
    cache.set(code, perCode);
  }
  const key = `${type}:${cycles}`;
  const hit = perCode.get(key);
  if (hit !== undefined) return hit;
  const built = buildSpacetimeGraph(code, type, cycles);
  perCode.set(key, built);
  return built;
}

function buildSpacetimeGraph(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  cycles: number,
): SpacetimeGraph {
  const n = code.n;
  const m = code.stabilizersByType[type].length;
  const layers = cycles + 1;
  const nodes = m * layers;
  const spaceEdges = n * cycles;
  const edgeCount = spaceEdges + m * cycles;
  const checks = code.checksOfQubit[type];

  const edgeU = new Int32Array(edgeCount);
  const edgeV = new Int32Array(edgeCount);
  const edgeQubit = new Int32Array(edgeCount).fill(-1);
  const weights = new Int32Array(edgeCount);
  for (let r = 1; r <= cycles; r++) {
    const layerBase = (r - 1) * m;
    for (let q = 0; q < n; q++) {
      const e = q + n * (r - 1);
      const a = checks[2 * q]!;
      const b = checks[2 * q + 1]!;
      // `a` is always a check for this code (a qubit with no check of a type
      // would be a geometry bug; rotated.ts guarantees ≥ 1).
      edgeU[e] = layerBase + a;
      edgeV[e] = b >= 0 ? layerBase + b : NONE;
      edgeQubit[e] = q;
    }
    for (let s = 0; s < m; s++) {
      const e = spaceEdges + (r - 1) * m + s;
      edgeU[e] = layerBase + s;
      edgeV[e] = layerBase + m + s;
    }
  }
  for (let e = 0; e < edgeCount; e++) weights[e] = edgeWeight(e);

  // CSR adjacency over nodes: edge indices incident to each node.
  const degree = new Int32Array(nodes);
  for (let e = 0; e < edgeCount; e++) {
    degree[edgeU[e]!]!++;
    if (edgeV[e]! >= 0) degree[edgeV[e]!]!++;
  }
  const offsets = new Int32Array(nodes + 1);
  for (let u = 0; u < nodes; u++) offsets[u + 1] = offsets[u]! + degree[u]!;
  const adjEdge = new Int32Array(offsets[nodes]!);
  const fill = Int32Array.from(offsets.subarray(0, nodes));
  for (let e = 0; e < edgeCount; e++) {
    const u = edgeU[e]!;
    const v = edgeV[e]!;
    adjEdge[fill[u]!] = e;
    fill[u]!++;
    if (v >= 0) {
      adjEdge[fill[v]!] = e;
      fill[v]!++;
    }
  }

  const dist = new Int32Array(nodes * nodes);
  const via = new Int32Array(nodes * nodes).fill(-1);
  const boundaryDist = new Int32Array(nodes);
  const boundaryVia = new Int32Array(nodes).fill(-1);

  const d = new Float64Array(nodes);
  const first = new Int32Array(nodes);
  const done = new Uint8Array(nodes);
  for (let source = 0; source < nodes; source++) {
    d.fill(Number.POSITIVE_INFINITY);
    first.fill(-1);
    done.fill(0);
    d[source] = 0;
    let bestBoundary = Number.POSITIVE_INFINITY;
    let bestBoundaryVia = -1;
    for (let step = 0; step < nodes; step++) {
      let u = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let v = 0; v < nodes; v++) {
        if (done[v] === 0 && d[v]! < best) {
          best = d[v]!;
          u = v;
        }
      }
      if (u < 0) break;
      done[u] = 1;
      const end = offsets[u + 1]!;
      for (let k = offsets[u]!; k < end; k++) {
        const e = adjEdge[k]!;
        const v = edgeU[e] === u ? edgeV[e]! : edgeU[e]!;
        const candidate = best + weights[e]!;
        const firstEdge = u === source ? e : first[u]!;
        if (v < 0) {
          if (candidate < bestBoundary) {
            bestBoundary = candidate;
            bestBoundaryVia = firstEdge;
          }
        } else if (candidate < d[v]!) {
          d[v] = candidate;
          first[v] = firstEdge;
        }
      }
    }
    for (let v = 0; v < nodes; v++) {
      if (!Number.isFinite(d[v]!)) {
        throw new Error(
          `spacetime graph of type ${type}, d = ${code.d}, cycles = ${cycles}: node ${v} unreachable from ${source}`,
        );
      }
      dist[source * nodes + v] = d[v]!;
      via[source * nodes + v] = first[v]!;
    }
    if (!Number.isFinite(bestBoundary)) {
      throw new Error(
        `spacetime graph of type ${type}, d = ${code.d}, cycles = ${cycles}: boundary unreachable from ${source}`,
      );
    }
    boundaryDist[source] = bestBoundary;
    boundaryVia[source] = bestBoundaryVia;
  }

  return Object.freeze({
    code,
    type,
    cycles,
    layers,
    m,
    nodes,
    edgeCount,
    edgeU,
    edgeV,
    edgeQubit,
    edgeWeight: weights,
    dist,
    via,
    boundaryDist,
    boundaryVia,
  });
}

function checkEndpoints(graph: SpacetimeGraph, from: number, to: number): void {
  const M = graph.nodes;
  if (!Number.isInteger(from) || from < 0 || from >= M) {
    throw new RangeError(`path start ${from} out of range [0, ${M})`);
  }
  if (!Number.isInteger(to) || to < NONE || to >= M) {
    throw new RangeError(`path end ${to} out of range [−1, ${M})`);
  }
}

/**
 * XORs the QUBITS OF THE SPACE EDGES of a shortest path from node `from` to
 * node `to` (or BOUNDARY) into `mask` and returns the path weight (dist or
 * boundaryDist; time edges add weight, never a qubit). No allocation. A
 * shortest path visits each node once, so a walk of more than `nodes` steps
 * means `via` is inconsistent: Error rather than a silent loop.
 */
export function xorSpacetimePathInto(
  graph: SpacetimeGraph,
  from: number,
  to: number,
  mask: Uint8Array,
): number {
  checkEndpoints(graph, from, to);
  const M = graph.nodes;
  const via = graph.via;
  const boundaryVia = graph.boundaryVia;
  const edgeU = graph.edgeU;
  const edgeV = graph.edgeV;
  const edgeQubit = graph.edgeQubit;
  const weights = graph.edgeWeight;
  let total = 0;
  let node = from;
  let steps = 0;
  while (node !== to) {
    if (steps++ >= M) {
      throw new Error(
        `spacetime graph of type ${graph.type}, d = ${graph.code.d}, cycles = ${graph.cycles}: via table inconsistent, path ${from} → ${to} exceeds ${M} steps`,
      );
    }
    const e = to === NONE ? boundaryVia[node]! : via[node * M + to]!;
    const q = edgeQubit[e]!;
    if (q >= 0) mask[q] = mask[q]! ^ 1;
    total += weights[e]!;
    node = edgeU[e] === node ? edgeV[e]! : edgeU[e]!;
  }
  return total;
}

/**
 * UI only (tasks/plans/phase2-g.md D2): the EDGE INDICES of a shortest path
 * from node `from` to node `to` (or BOUNDARY), in walking order from `from`.
 * A second walker over `via` beside xorSpacetimePathInto, which stays
 * allocation-free for the hot path; same bound: Error after `nodes`
 * steps. Allocates the returned array.
 */
export function spacetimePathEdges(
  graph: SpacetimeGraph,
  from: number,
  to: number,
): number[] {
  checkEndpoints(graph, from, to);
  const M = graph.nodes;
  const via = graph.via;
  const boundaryVia = graph.boundaryVia;
  const edgeU = graph.edgeU;
  const edgeV = graph.edgeV;
  const edges: number[] = [];
  let node = from;
  while (node !== to) {
    if (edges.length >= M) {
      throw new Error(
        `spacetime graph of type ${graph.type}, d = ${graph.code.d}, cycles = ${graph.cycles}: via table inconsistent, path ${from} → ${to} exceeds ${M} steps`,
      );
    }
    const e = to === NONE ? boundaryVia[node]! : via[node * M + to]!;
    edges.push(e);
    node = edgeU[e] === node ? edgeV[e]! : edgeU[e]!;
  }
  return edges;
}

/** One matched pair of the last decodeSpacetime (`b` = node or BOUNDARY) and the edges of its path, walking from `a`. */
export interface SpacetimeChain {
  readonly a: number;
  readonly b: number;
  readonly edges: readonly number[];
}

/**
 * UI only: one entry per pair of the last decodeSpacetime with the edge
 * indices of its shortest path (space edges carry edgeQubit ≥ 0, time edges
 * −1; the XOR of the space-edge qubits over all chains of a type is the mask
 * decodeSpacetime left in the correction). Allocates.
 */
export function spacetimeChains(decoder: SpacetimeDecoder): SpacetimeChain[] {
  const out: SpacetimeChain[] = [];
  for (let p = 0; p < decoder.pairCount; p++) {
    const a = decoder.pairs[2 * p]!;
    const b = decoder.pairs[2 * p + 1]!;
    out.push({ a, b, edges: spacetimePathEdges(decoder.graph, a, b) });
  }
  return out;
}

export interface SpacetimeDecoder {
  readonly graph: SpacetimeGraph;
  /** After decode: pairs[2k], pairs[2k+1] (node indices; second −1 = boundary) for k < pairCount. Read only. */
  readonly pairs: Int32Array;
  /** Written by decodeSpacetime. */
  readonly pairCount: number;
  /** Written by decodeSpacetime. */
  readonly defectCount: number;
  /** Current capacity of the Blossom matcher (vertices); grows, never shrinks. */
  readonly matcherVertices: number;
}

interface MutableSpacetimeDecoder extends SpacetimeDecoder {
  pairCount: number;
  defectCount: number;
  matcherVertices: number;
  matcher: Matcher;
  readonly defects: Int32Array;
}

/** Initial matcher capacity: 2·min(M, 32) vertices (≤ 64: small, D4). */
export const SPACETIME_INITIAL_DEFECTS = 32;

/**
 * Builds the decoder of (code, type, cycles). `initialVertices` (even integer
 * ≥ 2) overrides the starting matcher capacity (tests). Allocates.
 */
export function createSpacetimeDecoder(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  cycles: number,
  initialVertices?: number,
): SpacetimeDecoder {
  const graph = spacetimeGraph(code, type, cycles);
  const M = graph.nodes;
  const vertices =
    initialVertices ?? 2 * Math.min(M, SPACETIME_INITIAL_DEFECTS);
  if (!Number.isInteger(vertices) || vertices < 2 || vertices % 2 !== 0) {
    throw new RangeError(
      `initialVertices must be an even integer ≥ 2, got ${vertices}`,
    );
  }
  const decoder: MutableSpacetimeDecoder = {
    graph,
    pairs: new Int32Array(2 * M),
    pairCount: 0,
    defectCount: 0,
    matcherVertices: vertices,
    matcher: createMatcher(vertices),
    defects: new Int32Array(M),
  };
  return Object.seal(decoder);
}

function nextPowerOfTwo(k: number): number {
  let p = 1;
  while (p < k) p *= 2;
  return p;
}

/**
 * Decodes `detectors` (length graph.nodes, by node index) into `correction`:
 * clears correction.x (type "Z") or correction.z (type "X") entirely, XORs the
 * qubits of the space edges of the matched paths in and returns the matching
 * weight. Fills pairs / pairCount / defectCount. Grows the matcher when the
 * syndrome has more defects than its capacity (O(log M) times over the life of
 * the decoder; the only allocation this function ever makes) and never drops
 * a shot. RangeError if the lengths do not match.
 */
export function decodeSpacetime(
  decoder: SpacetimeDecoder,
  detectors: Uint8Array,
  correction: Pauli,
): number {
  const dec = decoder as MutableSpacetimeDecoder;
  const graph = dec.graph;
  const M = graph.nodes;
  if (detectors.length !== M) {
    throw new RangeError(
      `detectors must have length ${M} (type ${graph.type}, d = ${graph.code.d}, cycles = ${graph.cycles}), got ${detectors.length}`,
    );
  }
  if (correction.n !== graph.code.n) {
    throw new RangeError(
      `correction acts on ${correction.n} qubits, code has ${graph.code.n}`,
    );
  }
  const mask = graph.type === "Z" ? correction.x : correction.z;
  mask.fill(0);

  const defects = dec.defects;
  let k = 0;
  for (let i = 0; i < M; i++) {
    if (detectors[i] !== 0) defects[k++] = i;
  }
  dec.defectCount = k;
  dec.pairCount = 0;
  if (k === 0) return 0;

  if (2 * k > dec.matcherVertices) {
    const grown = 2 * Math.min(M, nextPowerOfTwo(k));
    dec.matcher = createMatcher(grown);
    dec.matcherVertices = grown;
  }
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
      weight[rowA + b] = dist[i * M + defects[b]!]!;
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
      if (b < a) continue;
      const j = defects[b]!;
      pairs[p++] = i;
      pairs[p++] = j;
      total += xorSpacetimePathInto(graph, i, j, mask);
    } else {
      pairs[p++] = i;
      pairs[p++] = NONE;
      total += xorSpacetimePathInto(graph, i, NONE, mask);
    }
  }
  dec.pairCount = p / 2;
  return total;
}
