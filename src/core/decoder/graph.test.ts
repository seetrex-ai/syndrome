import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DISTANCES } from "../index";
import { identity } from "../lattice/pauli";
import {
  incidentStabilizers,
  rotatedSurfaceCode,
  type RotatedSurfaceCode,
  type StabilizerType,
} from "../lattice/rotated";
import { computeTypeSyndrome } from "../lattice/syndrome";
import {
  BOUNDARY,
  defectGraph,
  pathQubits,
  xorPathInto,
  type DefectGraph,
} from "./graph";
import { qubitWeight, WEIGHT_SCALE } from "./weights";

const TYPES: readonly StabilizerType[] = ["Z", "X"];
const codes = DISTANCES.map((d) => rotatedSurfaceCode(d));
const graphs = codes.flatMap((code) =>
  TYPES.map((type) => defectGraph(code, type)),
);

/**
 * Unweighted BFS over checksOfQubit, independent of graph.ts: number of qubits
 * of a shortest path between two stabilizers of `type` (never through the
 * boundary), or to the boundary when `to` is BOUNDARY.
 */
function uniformBfs(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  from: number,
  to: number,
): number {
  const m = code.stabilizersByType[type].length;
  const checks = code.checksOfQubit[type];
  const steps = new Int32Array(m).fill(-1);
  steps[from] = 0;
  const queue = [from];
  let best = Number.POSITIVE_INFINITY;
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    for (let q = 0; q < code.n; q++) {
      const a = checks[2 * q]!;
      const b = checks[2 * q + 1]!;
      if (a !== u && b !== u) continue;
      const v = a === u ? b : a;
      if (v === BOUNDARY) {
        if (to === BOUNDARY) best = Math.min(best, steps[u]! + 1);
        continue;
      }
      if (steps[v] === -1) {
        steps[v] = steps[u]! + 1;
        queue.push(v);
      }
    }
  }
  return to === BOUNDARY ? best : steps[to]!;
}

function walk(graph: DefectGraph, from: number, to: number): number[] {
  const checks = graph.code.checksOfQubit[graph.type];
  const out: number[] = [];
  let node = from;
  let guard = 0;
  while (node !== to) {
    if (++guard > graph.m + 1) throw new Error("via walk does not terminate");
    const q =
      to === BOUNDARY
        ? graph.boundaryVia[node]!
        : graph.via[node * graph.m + to]!;
    out.push(q);
    const a = checks[2 * q]!;
    node = a === node ? checks[2 * q + 1]! : a;
  }
  return out;
}

describe("T-G1 structure", () => {
  it.each(graphs)("d = $code.d, type $type", (graph) => {
    const { code, type, m } = graph;
    expect(m).toBe((code.d * code.d - 1) / 2);
    expect(graph.dist.length).toBe(m * m);
    expect(graph.via.length).toBe(m * m);
    expect(graph.boundaryDist.length).toBe(m);
    expect(graph.boundaryVia.length).toBe(m);
    expect(graph.weights.length).toBe(code.n);
    for (let i = 0; i < m; i++) {
      expect(graph.dist[i * m + i]).toBe(0);
      expect(graph.via[i * m + i]).toBe(-1);
      expect(incidentStabilizers(code, type, graph.boundaryVia[i]!)).toContain(
        i,
      );
      expect(graph.boundaryDist[i]).toBeGreaterThan(0);
      for (let j = 0; j < m; j++) {
        expect(graph.dist[i * m + j]).toBe(graph.dist[j * m + i]);
        if (i === j) continue;
        expect(graph.dist[i * m + j]).toBeGreaterThan(0);
        expect(
          incidentStabilizers(code, type, graph.via[i * m + j]!),
        ).toContain(i);
      }
    }
    for (let q = 0; q < code.n; q++)
      expect(graph.weights[q]).toBe(qubitWeight(q));
  });
});

describe("T-G2 distances equal an independent uniform BFS, and the closed form", () => {
  it.each(graphs)(
    "d = $code.d, type $type: floor(dist / S) = BFS for every pair and to the boundary",
    (graph) => {
      const { code, type, m } = graph;
      for (let i = 0; i < m; i++) {
        expect(
          Math.floor(graph.boundaryDist[i]! / WEIGHT_SCALE),
          `boundary from ${i}`,
        ).toBe(uniformBfs(code, type, i, BOUNDARY));
        for (let j = 0; j < m; j++) {
          expect(
            Math.floor(graph.dist[i * m + j]! / WEIGHT_SCALE),
            `${i} → ${j}`,
          ).toBe(uniformBfs(code, type, i, j));
        }
      }
    },
  );

  it.each(graphs)(
    "d = $code.d, type $type: boundary = min(i + 1, d − 1 − i) (Z) or min(j + 1, d − 1 − j) (X); interior pairs = Chebyshev",
    (graph) => {
      const { code, type, m } = graph;
      const d = code.d;
      const stabs = code.stabilizersByType[type];
      for (let a = 0; a < m; a++) {
        const s = stabs[a]!;
        const expected =
          type === "Z"
            ? Math.min(s.row + 1, d - 1 - s.row)
            : Math.min(s.col + 1, d - 1 - s.col);
        expect(
          Math.floor(graph.boundaryDist[a]! / WEIGHT_SCALE),
          `boundary of (${s.row}, ${s.col})`,
        ).toBe(expected);
        if (s.boundary !== null) continue;
        for (let b = 0; b < m; b++) {
          const t = stabs[b]!;
          if (t.boundary !== null) continue;
          expect(Math.floor(graph.dist[a * m + b]! / WEIGHT_SCALE)).toBe(
            Math.max(Math.abs(s.row - t.row), Math.abs(s.col - t.col)),
          );
        }
      }
    },
  );

  it("d = 3, type Z: (0,0) → 1, (0,2) → 1, (1,−1) → 1 through qubit (2,0), (1,1) → 1", () => {
    const code = codes[0]!;
    const graph = defectGraph(code, "Z");
    const byPlaquette = new Map(
      code.stabilizersByType.Z.map((s) => [`${s.row},${s.col}`, s.typeIndex]),
    );
    for (const key of ["0,0", "0,2", "1,-1", "1,1"]) {
      const i = byPlaquette.get(key)!;
      expect(Math.floor(graph.boundaryDist[i]! / WEIGHT_SCALE), key).toBe(1);
    }
    const left = byPlaquette.get("1,-1")!;
    expect(graph.boundaryVia[left]).toBe(2 * 3 + 0); // qubit (2, 0), row d − 1
  });
});

describe("T-G3 triangle inequality and path coherence", () => {
  it.each(graphs)("d = $code.d, type $type", (graph) => {
    const { m } = graph;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        const dij = graph.dist[i * m + j]!;
        expect(graph.boundaryDist[i]).toBeLessThanOrEqual(
          dij + graph.boundaryDist[j]!,
        );
        for (let k = 0; k < m; k++) {
          expect(graph.dist[i * m + k]).toBeLessThanOrEqual(
            dij + graph.dist[j * m + k]!,
          );
        }
        const path = walk(graph, i, j);
        expect(path.length).toBeLessThanOrEqual(m);
        let sum = 0;
        for (const q of path) sum += graph.weights[q]!;
        expect(sum, `weight of via walk ${i} → ${j}`).toBe(dij);
        expect(new Set(path).size).toBe(path.length);
      }
      const toBoundary = walk(graph, i, BOUNDARY);
      let sum = 0;
      for (const q of toBoundary) sum += graph.weights[q]!;
      expect(sum).toBe(graph.boundaryDist[i]);
    }
  });
});

describe("T-G4 the boundary is the right one (§3: X errors end on the X boundaries, top and bottom)", () => {
  it.each(graphs)(
    "d = $code.d, type $type: every boundary walk ends on a qubit of the right edge",
    (graph) => {
      const { code, type, m } = graph;
      const d = code.d;
      for (let i = 0; i < m; i++) {
        const path = walk(graph, i, BOUNDARY);
        const last = code.qubits[path[path.length - 1]!]!;
        if (type === "Z") expect([0, d - 1]).toContain(last.row);
        else expect([0, d - 1]).toContain(last.col);
        // Only the last qubit touches the boundary.
        for (const q of path.slice(0, -1))
          expect(incidentStabilizers(code, type, q)).not.toContain(BOUNDARY);
      }
    },
  );

  it("positive control: with the Z boundaries, Z(1,−1) at d = 5 would be at distance 1; it is at 2", () => {
    const code = codes[1]!;
    expect(code.d).toBe(5);
    const graph = defectGraph(code, "Z");
    const s = code.stabilizersByType.Z.find(
      (t) => t.row === 1 && t.col === -1,
    )!;
    expect(Math.floor(graph.boundaryDist[s.typeIndex]! / WEIGHT_SCALE)).toBe(2);
    // The wrong boundary would be reached through qubit (2, 0), col 0.
    expect(graph.boundaryVia[s.typeIndex]).not.toBe(2 * 5 + 0);
  });
});

describe("T-G5 xorPathInto and pathQubits", () => {
  it.each(graphs)("d = $code.d, type $type", (graph) => {
    const { code, type, m } = graph;
    const arbEnd = fc.oneof(fc.nat(m - 1), fc.constant(BOUNDARY));
    fc.assert(
      fc.property(fc.nat(m - 1), arbEnd, (i, j) => {
        const error = identity(code.n);
        const mask = type === "Z" ? error.x : error.z;
        const w = xorPathInto(graph, i, j, mask);
        const qubits = pathQubits(graph, i, j);
        const expectedMask = new Uint8Array(code.n);
        for (const q of qubits) expectedMask[q] = 1;
        expect(mask).toEqual(expectedMask);
        // Walking order: the first qubit touches i, consecutive qubits share a
        // stabilizer of this type, and the last one touches j (or the boundary).
        const checks = code.checksOfQubit[type];
        const touches = (q: number, s: number) =>
          checks[2 * q] === s || checks[2 * q + 1] === s;
        if (qubits.length > 0) {
          expect(touches(qubits[0]!, i)).toBe(true);
          for (let k = 1; k < qubits.length; k++) {
            const prev = qubits[k - 1]!;
            const cur = qubits[k]!;
            const shared = [checks[2 * prev]!, checks[2 * prev + 1]!].some(
              (s) => s >= 0 && touches(cur, s),
            );
            expect(shared).toBe(true);
          }
          const last = qubits[qubits.length - 1]!;
          expect(touches(last, j === BOUNDARY ? -1 : j)).toBe(true);
        }
        expect(w).toBe(
          j === BOUNDARY ? graph.boundaryDist[i] : graph.dist[i * m + j],
        );
        const syndrome = computeTypeSyndrome(
          code,
          type,
          error,
          new Uint8Array(m),
        );
        const expectedSyndrome = new Uint8Array(m);
        if (i !== j) {
          expectedSyndrome[i] = 1;
          if (j !== BOUNDARY) expectedSyndrome[j] = 1;
        }
        expect(syndrome).toEqual(expectedSyndrome);
        // XOR semantics: applying the path twice clears it.
        xorPathInto(graph, i, j, mask);
        expect(mask.every((b) => b === 0)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects endpoints out of range", () => {
    const graph = graphs[0]!;
    const mask = new Uint8Array(graph.code.n);
    expect(() => xorPathInto(graph, -1, 0, mask)).toThrow(RangeError);
    expect(() => xorPathInto(graph, 0, graph.m, mask)).toThrow(RangeError);
    expect(() => xorPathInto(graph, 0, -2, mask)).toThrow(RangeError);
    expect(() => pathQubits(graph, graph.m, 0)).toThrow(RangeError);
    expect(pathQubits(graph, 0, 0)).toEqual([]);
  });

  it("an inconsistent via table throws instead of walking forever (bounded by m steps)", () => {
    // Same graph with every via entry shifted by one qubit: the walk never
    // reaches its target. Measured 2026-10-16: without the bound, a shifted-via
    // mutant hung the whole suite instead of turning it red.
    const graph = graphs[2]!; // d = 5, Z
    const n = graph.code.n;
    const shifted = Int32Array.from(graph.via, (q) =>
      q >= 0 ? (q + 1) % n : -1,
    );
    const shiftedBoundary = Int32Array.from(
      graph.boundaryVia,
      (q) => (q + 1) % n,
    );
    const broken: DefectGraph = {
      ...graph,
      via: shifted,
      boundaryVia: shiftedBoundary,
    };
    const mask = new Uint8Array(n);
    expect(() => xorPathInto(broken, 0, graph.m - 1, mask)).toThrow(
      /via table inconsistent/,
    );
    expect(() => pathQubits(broken, 0, graph.m - 1)).toThrow(Error);
  });
});
