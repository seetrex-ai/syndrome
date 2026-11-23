import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rotatedSurfaceCode, type StabilizerType } from "../lattice/rotated";
import { defectGraph, type DefectGraph } from "./graph";
import { exactMatchingWeight, ORACLE_MAX_DEFECTS } from "./oracle";

const TYPES: readonly StabilizerType[] = ["Z", "X"];
const graphs = [3, 5, 7].flatMap((d) =>
  TYPES.map((type) => defectGraph(rotatedSurfaceCode(d), type)),
);

/**
 * Independent of the DP: enumerates every way of pairing the defects among
 * themselves or with the boundary (the first defect goes to the boundary or to
 * each other defect, recursively) and returns the explicit minimum.
 */
function bruteForce(graph: DefectGraph, defects: readonly number[]): number {
  if (defects.length === 0) return 0;
  const [i, ...rest] = defects as [number, ...number[]];
  let best = graph.boundaryDist[i]! + bruteForce(graph, rest);
  for (let b = 0; b < rest.length; b++) {
    const j = rest[b]!;
    const others = rest.filter((_, idx) => idx !== b);
    const candidate = graph.dist[i * graph.m + j]! + bruteForce(graph, others);
    if (candidate < best) best = candidate;
  }
  return best;
}

function arbDefects(m: number, maxK: number): fc.Arbitrary<number[]> {
  return fc.uniqueArray(fc.nat(m - 1), { maxLength: maxK });
}

describe("T-O1 the DP oracle equals total enumeration (k ≤ 6)", () => {
  it.each(graphs)(
    "d = $code.d, type $type: 200 random defect sets",
    (graph) => {
      fc.assert(
        fc.property(arbDefects(graph.m, 6), (defects) => {
          expect(exactMatchingWeight(graph, defects)).toBe(
            bruteForce(graph, defects),
          );
        }),
        { numRuns: 200 },
      );
    },
  );

  it("is independent of the order of the defects", () => {
    const graph = graphs[4]!; // d = 7, Z
    fc.assert(
      fc.property(arbDefects(graph.m, 8), (defects) => {
        const reversed = [...defects].reverse();
        expect(exactMatchingWeight(graph, reversed)).toBe(
          exactMatchingWeight(graph, defects),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("one defect → boundaryDist; two → min(dist, b_i + b_j); zero → 0", () => {
    for (const graph of graphs) {
      expect(exactMatchingWeight(graph, [])).toBe(0);
      for (let i = 0; i < graph.m; i++) {
        expect(exactMatchingWeight(graph, [i])).toBe(graph.boundaryDist[i]);
        for (let j = i + 1; j < graph.m; j++) {
          expect(exactMatchingWeight(graph, [i, j])).toBe(
            Math.min(
              graph.dist[i * graph.m + j]!,
              graph.boundaryDist[i]! + graph.boundaryDist[j]!,
            ),
          );
        }
      }
    }
  });

  it("accepts 12 defects and rejects 13, repeats and out-of-range indices", () => {
    const graph = graphs[5]!; // d = 7, X: m = 24
    expect(ORACLE_MAX_DEFECTS).toBe(12);
    const twelve = Array.from({ length: 12 }, (_, i) => i);
    expect(Number.isInteger(exactMatchingWeight(graph, twelve))).toBe(true);
    const thirteen = Array.from({ length: 13 }, (_, i) => i);
    expect(() => exactMatchingWeight(graph, thirteen)).toThrow(RangeError);
    expect(() => exactMatchingWeight(graph, [0, 0])).toThrow(RangeError);
    expect(() => exactMatchingWeight(graph, [graph.m])).toThrow(RangeError);
    expect(() => exactMatchingWeight(graph, [-1])).toThrow(RangeError);
  });
});
