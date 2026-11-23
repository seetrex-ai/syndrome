// Defect graph of one stabilizer type (docs/spec.md §3 "Grafo de defectos",
// tasks/plans/decoder.md D5), precomputed once per (code, type).
//
// Nodes are the stabilizers of `type` (by typeIndex, m = (d² − 1)/2 of them).
// Every data qubit is an edge of weight W_q (decoder/weights.ts) between the ≤ 2
// stabilizers of that type that contain it (`checksOfQubit[type]`); a qubit with
// a single one is an edge from that node to the boundary. The boundary is not a
// node: for type Z (X errors) it is the X boundaries, top and bottom, because the
// qubits of row 0 and row d − 1 are the ones with a single Z stabilizer; for type
// X it is the Z boundaries, left and right. The boundary qubit belongs to the
// correction chain and its weight counts (R3).
//
// Integer Dijkstra from every node gives `dist`/`via` (first qubit of a shortest
// path i → j) and `boundaryDist`/`boundaryVia`. All values are integers below
// 2·d·2²⁴ < 2³¹, so Int32Array holds them exactly; sums of several paths belong
// to `number`, never to Int32Array (R7). Ties between equal-weight shortest paths
// are resolved by scan order: deterministic, and by the parity theorem (M2) they
// never change the verdict, only which equivalent chain is drawn.

import type {
  ReadonlyIntTable,
  RotatedSurfaceCode,
  StabilizerType,
} from "../lattice/rotated";
import { qubitWeights } from "./weights";

export interface DefectGraph {
  readonly code: RotatedSurfaceCode;
  readonly type: StabilizerType;
  /** Number of nodes, (d² − 1)/2, indexed by typeIndex. */
  readonly m: number;
  /** W_q by qubit, length n. */
  readonly weights: ReadonlyIntTable;
  /** m·m, row-major: dist[i·m + j] is the shortest path weight i → j (0 on the diagonal). */
  readonly dist: ReadonlyIntTable;
  /** m·m: first qubit of a shortest path i → j; −1 on the diagonal. */
  readonly via: ReadonlyIntTable;
  /** m: shortest path weight from i to the boundary, boundary qubit included. */
  readonly boundaryDist: ReadonlyIntTable;
  /** m: first qubit of a shortest path from i to the boundary. */
  readonly boundaryVia: ReadonlyIntTable;
}

/** Marker for the boundary as a path endpoint. */
export const BOUNDARY = -1;

/** Precomputes the defect graph of `type`. Allocates; call once per (code, type). */
export function defectGraph(
  code: RotatedSurfaceCode,
  type: StabilizerType,
): DefectGraph {
  const m = code.stabilizersByType[type].length;
  const n = code.n;
  const weights = qubitWeights(n);
  const checks = code.checksOfQubit[type];

  // Adjacency as CSR: for node u, the (neighbour, qubit) pairs of its edges; a
  // neighbour of −1 is the boundary.
  const degree = new Int32Array(m);
  for (let q = 0; q < n; q++) {
    const a = checks[2 * q]!;
    const b = checks[2 * q + 1]!;
    if (a >= 0) degree[a]!++;
    if (b >= 0) degree[b]!++;
  }
  const offsets = new Int32Array(m + 1);
  for (let u = 0; u < m; u++) offsets[u + 1] = offsets[u]! + degree[u]!;
  const adjNode = new Int32Array(offsets[m]!);
  const adjQubit = new Int32Array(offsets[m]!);
  const fill = Int32Array.from(offsets.subarray(0, m));
  for (let q = 0; q < n; q++) {
    const a = checks[2 * q]!;
    const b = checks[2 * q + 1]!;
    if (a >= 0) {
      adjNode[fill[a]!] = b;
      adjQubit[fill[a]!] = q;
      fill[a]!++;
    }
    if (b >= 0) {
      adjNode[fill[b]!] = a;
      adjQubit[fill[b]!] = q;
      fill[b]!++;
    }
  }

  const dist = new Int32Array(m * m);
  const via = new Int32Array(m * m).fill(-1);
  const boundaryDist = new Int32Array(m);
  const boundaryVia = new Int32Array(m).fill(-1);

  const d = new Float64Array(m);
  const first = new Int32Array(m);
  const done = new Uint8Array(m);
  for (let source = 0; source < m; source++) {
    d.fill(Number.POSITIVE_INFINITY);
    first.fill(-1);
    done.fill(0);
    d[source] = 0;
    let bestBoundary = Number.POSITIVE_INFINITY;
    let bestBoundaryVia = -1;
    // Dense Dijkstra, O(m²): m ≤ 40 and it runs once per graph.
    for (let step = 0; step < m; step++) {
      let u = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let v = 0; v < m; v++) {
        if (done[v] === 0 && d[v]! < best) {
          best = d[v]!;
          u = v;
        }
      }
      if (u < 0) break; // disconnected remainder: never for this code
      done[u] = 1;
      const end = offsets[u + 1]!;
      for (let k = offsets[u]!; k < end; k++) {
        const q = adjQubit[k]!;
        const v = adjNode[k]!;
        const candidate = best + weights[q]!;
        const firstQubit = u === source ? q : first[u]!;
        if (v < 0) {
          if (candidate < bestBoundary) {
            bestBoundary = candidate;
            bestBoundaryVia = firstQubit;
          }
        } else if (candidate < d[v]!) {
          d[v] = candidate;
          first[v] = firstQubit;
        }
      }
    }
    for (let v = 0; v < m; v++) {
      if (!Number.isFinite(d[v]!)) {
        throw new Error(
          `defect graph of type ${type}, d = ${code.d}: node ${v} unreachable from ${source}`,
        );
      }
      dist[source * m + v] = d[v]!;
      via[source * m + v] = first[v]!;
    }
    if (!Number.isFinite(bestBoundary)) {
      throw new Error(
        `defect graph of type ${type}, d = ${code.d}: boundary unreachable from ${source}`,
      );
    }
    boundaryDist[source] = bestBoundary;
    boundaryVia[source] = bestBoundaryVia;
  }

  return Object.freeze({
    code,
    type,
    m,
    weights,
    dist,
    via,
    boundaryDist,
    boundaryVia,
  });
}

/** The other endpoint of edge q seen from node `node` (−1 = boundary). */
function otherEnd(checks: ReadonlyIntTable, q: number, node: number): number {
  const a = checks[2 * q]!;
  return a === node ? checks[2 * q + 1]! : a;
}

function checkEndpoints(graph: DefectGraph, from: number, to: number): void {
  const m = graph.m;
  if (!Number.isInteger(from) || from < 0 || from >= m) {
    throw new RangeError(`path start ${from} out of range [0, ${m})`);
  }
  if (!Number.isInteger(to) || to < BOUNDARY || to >= m) {
    throw new RangeError(`path end ${to} out of range [−1, ${m})`);
  }
}

/**
 * XORs the qubits of a shortest path from node `from` to node `to` (typeIndex,
 * or BOUNDARY = −1) into `mask`, returns the path weight (dist or
 * boundaryDist). No allocation: the hot path of decode. Each step lowers the
 * remaining distance by the weight of the qubit taken, so the walk ends at `to`
 * in at most m steps.
 */
export function xorPathInto(
  graph: DefectGraph,
  from: number,
  to: number,
  mask: Uint8Array,
): number {
  checkEndpoints(graph, from, to);
  const m = graph.m;
  const via = graph.via;
  const boundaryVia = graph.boundaryVia;
  const weights = graph.weights;
  const checks = graph.code.checksOfQubit[graph.type];
  let total = 0;
  let node = from;
  let steps = 0;
  while (node !== to) {
    if (steps++ >= m) throw tooLong(graph, from, to);
    const q = to === BOUNDARY ? boundaryVia[node]! : via[node * m + to]!;
    mask[q] = mask[q]! ^ 1;
    total += weights[q]!;
    node = otherEnd(checks, q, node);
  }
  return total;
}

// A shortest path visits each node at most once, so a walk longer than m
// steps means `via` is inconsistent: an Error beats a silent infinite loop in
// the Worker (measured with a shifted-via mutant, 2026-10-16).
function tooLong(graph: DefectGraph, from: number, to: number): Error {
  return new Error(
    `defect graph of type ${graph.type}, d = ${graph.code.d}: via table inconsistent, path ${from} → ${to} exceeds ${graph.m} steps`,
  );
}

/** The same path as a fresh list of qubit indices, in walking order (UI only). */
export function pathQubits(
  graph: DefectGraph,
  from: number,
  to: number,
): number[] {
  checkEndpoints(graph, from, to);
  const m = graph.m;
  const checks = graph.code.checksOfQubit[graph.type];
  const out: number[] = [];
  let node = from;
  while (node !== to) {
    if (out.length >= m) throw tooLong(graph, from, to);
    const q =
      to === BOUNDARY ? graph.boundaryVia[node]! : graph.via[node * m + to]!;
    out.push(q);
    node = otherEnd(checks, q, node);
  }
  return out;
}
