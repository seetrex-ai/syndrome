import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rotatedSurfaceCode, type StabilizerType } from "../lattice/rotated";
import { createMatcher, NO_EDGE, type Matcher } from "./blossom";
import { defectGraph, type DefectGraph } from "./graph";
import { exactMatchingWeight } from "./oracle";

/** Fills the dense matrix of `matcher` from a plain (symmetric) V×V table. */
function fill(matcher: Matcher, table: readonly (readonly number[])[]): number {
  const v = table.length;
  const n = matcher.maxVertices;
  for (let a = 0; a < v; a++) {
    for (let b = 0; b < v; b++) {
      matcher.weight[a * n + b] = table[a]![b]!;
    }
  }
  return v;
}

/** Symmetric matrix from an upper-triangle edge list; missing edges are NO_EDGE. */
function fromEdges(
  v: number,
  edges: readonly (readonly [number, number, number])[],
): number[][] {
  const table = Array.from({ length: v }, () =>
    Array.from({ length: v }, () => NO_EDGE),
  );
  for (let a = 0; a < v; a++) table[a]![a] = 0;
  for (const [a, b, w] of edges) {
    table[a]![b] = w;
    table[b]![a] = w;
  }
  return table;
}

/**
 * Independent of Blossom: minimum over the (V − 1)!! perfect matchings by
 * recursion on the lowest unmatched vertex. Infinity when none avoids NO_EDGE.
 */
function bruteForce(table: readonly (readonly number[])[]): number {
  const v = table.length;
  const used = new Array<boolean>(v).fill(false);
  function rec(): number {
    let a = 0;
    while (a < v && used[a]) a++;
    if (a === v) return 0;
    used[a] = true;
    let best = Number.POSITIVE_INFINITY;
    for (let b = a + 1; b < v; b++) {
      if (used[b]) continue;
      const w = table[a]![b]!;
      if (w === NO_EDGE) continue;
      used[b] = true;
      const candidate = w + rec();
      if (candidate < best) best = candidate;
      used[b] = false;
    }
    used[a] = false;
    return best;
  }
  return rec();
}

function expectValidMatching(matcher: Matcher, v: number, total: number): void {
  const n = matcher.maxVertices;
  let sum = 0;
  for (let a = 0; a < v; a++) {
    const b = matcher.mate[a]!;
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(v);
    expect(b).not.toBe(a);
    expect(matcher.mate[b]).toBe(a);
    const w = matcher.weight[a * n + b]!;
    expect(w).not.toBe(NO_EDGE);
    sum += w;
  }
  expect(sum / 2).toBe(total);
}

describe("T-B1 small graphs by hand", () => {
  it("V = 2: the single edge", () => {
    const matcher = createMatcher(2);
    const v = fill(matcher, fromEdges(2, [[0, 1, 7]]));
    expect(matcher.solve(v)).toBe(7);
    expect(Array.from(matcher.mate.subarray(0, 2))).toEqual([1, 0]);
  });

  it("sparse path 0-1-2-3-4-5 with weights 9,0,9,0,9: the only perfect matching costs 27 (M = C would say none)", () => {
    // The max-weight conversion must make a matching with more edges always win:
    // here the two cheap edges (1-2, 3-4) form a non-perfect matching of converted
    // weight 2·(M + C), which beats the perfect one unless M ≥ (V/2)·C.
    const matcher = createMatcher(6);
    const v = fill(
      matcher,
      fromEdges(6, [
        [0, 1, 9],
        [1, 2, 0],
        [2, 3, 9],
        [3, 4, 0],
        [4, 5, 9],
      ]),
    );
    expect(matcher.solve(v)).toBe(27);
    expect(Array.from(matcher.mate.subarray(0, 6))).toEqual([1, 0, 3, 2, 5, 4]);
  });

  it("an asymmetric matrix is rejected with RangeError", () => {
    const matcher = createMatcher(4);
    const v = fill(
      matcher,
      fromEdges(4, [
        [0, 1, 1],
        [2, 3, 1],
        [0, 2, 5],
        [1, 3, 5],
      ]),
    );
    matcher.weight[1 * 4 + 0] = 2; // weight[1][0] ≠ weight[0][1]
    expect(() => matcher.solve(v)).toThrow(RangeError);
  });

  it("V = 4: 4-cycle of weight 1 with expensive diagonals → 2", () => {
    const matcher = createMatcher(4);
    const v = fill(
      matcher,
      fromEdges(4, [
        [0, 1, 1],
        [1, 2, 1],
        [2, 3, 1],
        [3, 0, 1],
        [0, 2, 100],
        [1, 3, 100],
      ]),
    );
    const total = matcher.solve(v);
    expect(total).toBe(2);
    expectValidMatching(matcher, v, total);
  });

  it("triangle + pendant: the only perfect matching uses the expensive edge (a greedy matcher fails)", () => {
    // 0–1 (1), 0–2 (1), 1–2 (50), 0–3 (1). Greedy takes 0–1 and leaves 2–3 (no edge).
    const matcher = createMatcher(4);
    const v = fill(
      matcher,
      fromEdges(4, [
        [0, 1, 1],
        [0, 2, 1],
        [1, 2, 50],
        [0, 3, 1],
      ]),
    );
    expect(matcher.solve(v)).toBe(51);
    expect(Array.from(matcher.mate.subarray(0, 4))).toEqual([3, 2, 1, 0]);
  });

  it("odd cycle with a tail: the blossom must be shrunk and expanded", () => {
    // 5-cycle 0-1-2-3-4-0 of weight 1, tail 0–5 of weight 1: the matching that
    // uses the tail must take 1–2 and 3–4 → 3. A 6-cycle alternative does not exist.
    const matcher = createMatcher(6);
    const v = fill(
      matcher,
      fromEdges(6, [
        [0, 1, 1],
        [1, 2, 1],
        [2, 3, 1],
        [3, 4, 1],
        [4, 0, 1],
        [0, 5, 1],
      ]),
    );
    const total = matcher.solve(v);
    expect(total).toBe(3);
    expectValidMatching(matcher, v, total);
    expect(matcher.mate[0]).toBe(5);
  });

  it("the decoder shape: two defects with a boundary each, pairing cheaper than both boundaries", () => {
    // 0, 1 defects; 2, 3 their virtual nodes. w(0,1) = 3, b_0 = 2, b_1 = 2, w(2,3) = 0.
    const matcher = createMatcher(4);
    const table = fromEdges(4, [
      [0, 1, 3],
      [0, 2, 2],
      [1, 3, 2],
      [2, 3, 0],
    ]);
    const v = fill(matcher, table);
    expect(matcher.solve(v)).toBe(3);
    expect(matcher.mate[0]).toBe(1);
    expect(matcher.mate[2]).toBe(3);
    // Now boundaries cheaper than the pair.
    table[0]![1] = 5;
    table[1]![0] = 5;
    fill(matcher, table);
    expect(matcher.solve(v)).toBe(4);
    expect(matcher.mate[0]).toBe(2);
    expect(matcher.mate[1]).toBe(3);
  });

  it("a vertex with NO_EDGE everywhere → Error; odd v or v > maxVertices → RangeError", () => {
    const matcher = createMatcher(4);
    const v = fill(
      matcher,
      fromEdges(4, [
        [0, 1, 1],
        [1, 2, 1],
        [2, 0, 1],
      ]),
    );
    expect(() => matcher.solve(v)).toThrow(Error);
    expect(() => matcher.solve(3)).toThrow(RangeError);
    expect(() => matcher.solve(6)).toThrow(RangeError);
    expect(() => matcher.solve(-2)).toThrow(RangeError);
    expect(() => createMatcher(0)).toThrow(RangeError);
    expect(() => createMatcher(1.5)).toThrow(RangeError);
  });

  it("v = 0 → 0; non-integer or negative weights → RangeError", () => {
    const matcher = createMatcher(2);
    expect(matcher.solve(0)).toBe(0);
    fill(matcher, [
      [0, 1.5],
      [1.5, 0],
    ]);
    expect(() => matcher.solve(2)).toThrow(RangeError);
    fill(matcher, [
      [0, -1],
      [-1, 0],
    ]);
    expect(() => matcher.solve(2)).toThrow(RangeError);
  });
});

describe("T-B2 Blossom = brute force on random complete graphs", () => {
  const arbTable = fc
    .integer({ min: 1, max: 5 })
    .chain((half) => {
      const v = 2 * half;
      const pairs = (v * (v - 1)) / 2;
      return fc.tuple(
        fc.constant(v),
        fc.array(
          fc.oneof(
            { weight: 9, arbitrary: fc.integer({ min: 0, max: 1_000_000 }) },
            { weight: 1, arbitrary: fc.constant(NO_EDGE) },
          ),
          { minLength: pairs, maxLength: pairs },
        ),
      );
    })
    .map(([v, weights]) => {
      const edges: [number, number, number][] = [];
      let k = 0;
      for (let a = 0; a < v; a++) {
        for (let b = a + 1; b < v; b++) edges.push([a, b, weights[k++]!]);
      }
      return fromEdges(v, edges);
    });

  it("300 cases, V ∈ {2, …, 10}, weights in [0, 10⁶] with some NO_EDGE; the matcher is reused", () => {
    const matcher = createMatcher(10);
    fc.assert(
      fc.property(arbTable, (table) => {
        const expected = bruteForce(table);
        const v = fill(matcher, table);
        if (expected === Number.POSITIVE_INFINITY) {
          expect(() => matcher.solve(v)).toThrow(Error);
          return;
        }
        const total = matcher.solve(v);
        expect(total).toBe(expected);
        expectValidMatching(matcher, v, total);
      }),
      { numRuns: 300 },
    );
  });

  it("300 sparse cases (edge density ≈ 0.4, ≈ 40 % without a perfect matching): the conversion's 'more edges always wins' guarantee is exercised", () => {
    const matcher = createMatcher(10);
    const arbSparse = fc
      .integer({ min: 2, max: 5 })
      .chain((half) => {
        const v = 2 * half;
        const pairs = (v * (v - 1)) / 2;
        return fc.tuple(
          fc.constant(v),
          fc.array(
            fc.oneof(
              { weight: 4, arbitrary: fc.integer({ min: 0, max: 20 }) },
              { weight: 6, arbitrary: fc.constant(NO_EDGE) },
            ),
            { minLength: pairs, maxLength: pairs },
          ),
        );
      })
      .map(([v, weights]) => {
        const edges: [number, number, number][] = [];
        let k = 0;
        for (let a = 0; a < v; a++) {
          for (let b = a + 1; b < v; b++) edges.push([a, b, weights[k++]!]);
        }
        return fromEdges(v, edges);
      });
    let perfect = 0;
    let none = 0;
    fc.assert(
      fc.property(arbSparse, (table) => {
        const expected = bruteForce(table);
        const v = fill(matcher, table);
        if (expected === Number.POSITIVE_INFINITY) {
          none++;
          expect(() => matcher.solve(v)).toThrow(Error);
          return;
        }
        perfect++;
        const total = matcher.solve(v);
        expect(total).toBe(expected);
        expectValidMatching(matcher, v, total);
      }),
      { numRuns: 300 },
    );
    // Both branches must have been exercised for the test to mean anything.
    expect(perfect).toBeGreaterThan(20);
    expect(none).toBeGreaterThan(20);
  });

  it("dense small weights (many ties) and V = 10: still the exact minimum", () => {
    const matcher = createMatcher(10);
    const arbSmall = fc
      .array(fc.integer({ min: 0, max: 3 }), { minLength: 45, maxLength: 45 })
      .map((weights) => {
        const edges: [number, number, number][] = [];
        let k = 0;
        for (let a = 0; a < 10; a++) {
          for (let b = a + 1; b < 10; b++) edges.push([a, b, weights[k++]!]);
        }
        return fromEdges(10, edges);
      });
    // 2 000 runs with a RANDOM seed: a blossom-expansion bug that skips one
    // sub-flower fails ≈1·10⁻⁴ of these graphs (measured over 240 000 on
    // 2026-10-16), so this test alone catches it in ~17 % of runs and
    // accumulates coverage across CI runs; a fixed seed would freeze one set of
    // graphs that happens to miss it (fast-check prints the seed on failure
    // anyway). The fixed case below is the deterministic guard; this is breadth.
    fc.assert(
      fc.property(arbSmall, (table) => {
        const v = fill(matcher, table);
        const total = matcher.solve(v);
        expect(total).toBe(bruteForce(table));
        expectValidMatching(matcher, v, total);
      }),
      { numRuns: 2000 },
    );
  });

  it("fixed V = 10 graph that needs a correct flower expansion (minimum 1; skipping a sub-flower gives 2)", () => {
    const rows = [
      [0, 2, 0, 2, 0, 1, 2, 0, 1, 1],
      [2, 0, 0, 0, 0, 2, 2, 1, 2, 2],
      [0, 0, 0, 2, 0, 2, 0, 0, 0, 1],
      [2, 0, 2, 0, 0, 2, 0, 0, 1, 2],
      [0, 0, 0, 0, 0, 2, 1, 0, 1, 0],
      [1, 2, 2, 2, 2, 0, 2, 1, 2, 2],
      [2, 2, 0, 0, 1, 2, 0, 2, 2, 2],
      [0, 1, 0, 0, 0, 1, 2, 0, 1, 0],
      [1, 2, 0, 1, 1, 2, 2, 1, 0, 1],
      [1, 2, 1, 2, 0, 2, 2, 0, 1, 0],
    ];
    const matcher = createMatcher(10);
    const v = fill(matcher, rows);
    expect(bruteForce(rows)).toBe(1);
    const total = matcher.solve(v);
    expect(total).toBe(1);
    expectValidMatching(matcher, v, total);
  });
});

const TYPES: readonly StabilizerType[] = ["Z", "X"];
const graphs = [3, 5, 7, 9].flatMap((d) =>
  TYPES.map((type) => defectGraph(rotatedSurfaceCode(d), type)),
);

/** The matrix `decode` builds: defects 0 … k−1, virtual nodes k … 2k−1. */
function fillDecoderMatrix(
  matcher: Matcher,
  graph: DefectGraph,
  defects: readonly number[],
): number {
  const k = defects.length;
  const n = matcher.maxVertices;
  const m = graph.m;
  for (let a = 0; a < k; a++) {
    const i = defects[a]!;
    for (let b = 0; b < k; b++) {
      const j = defects[b]!;
      matcher.weight[a * n + b] = graph.dist[i * m + j]!;
      matcher.weight[(k + a) * n + (k + b)] = 0;
      const toVirtual = a === b ? graph.boundaryDist[i]! : NO_EDGE;
      matcher.weight[a * n + (k + b)] = toVirtual;
      matcher.weight[(k + b) * n + a] = toVirtual;
    }
  }
  return 2 * k;
}

function arbDefects(m: number, maxK: number): fc.Arbitrary<number[]> {
  return fc.uniqueArray(fc.nat(m - 1), { maxLength: maxK });
}

describe("T-B3 Blossom = DP oracle on the decoder structure (§6)", () => {
  it.each(graphs)(
    "d = $code.d, type $type: 1 000 random syndromes with ≤ 12 defects, any parity",
    (graph) => {
      const matcher = createMatcher(2 * graph.m);
      fc.assert(
        fc.property(arbDefects(graph.m, 12), (defects) => {
          const expected = exactMatchingWeight(graph, defects);
          if (defects.length === 0) {
            expect(expected).toBe(0);
            return;
          }
          const v = fillDecoderMatrix(matcher, graph, defects);
          const total = matcher.solve(v);
          expect(total).toBe(expected);
          expectValidMatching(matcher, v, total);
        }),
        { numRuns: 1000 },
      );
    },
  );

  it("k = 1 → boundaryDist; k = 0 is never sent to the matcher", () => {
    for (const graph of graphs) {
      const matcher = createMatcher(2 * graph.m);
      for (let i = 0; i < graph.m; i++) {
        const v = fillDecoderMatrix(matcher, graph, [i]);
        expect(matcher.solve(v)).toBe(graph.boundaryDist[i]);
        expect(matcher.mate[0]).toBe(1);
      }
    }
  });

  it("the full matrix (every stabilizer a defect) in d = 9: V = 80, Blossom agrees with a 2·boundary bound and is valid", () => {
    const graph = graphs[6]!; // d = 9, Z: m = 40
    const matcher = createMatcher(2 * graph.m);
    const all = Array.from({ length: graph.m }, (_, i) => i);
    const v = fillDecoderMatrix(matcher, graph, all);
    const total = matcher.solve(v);
    expectValidMatching(matcher, v, total);
    let upper = 0;
    for (let i = 0; i < graph.m; i++) upper += graph.boundaryDist[i]!;
    expect(total).toBeLessThanOrEqual(upper);
    expect(Number.isInteger(total)).toBe(true);
  });
});
