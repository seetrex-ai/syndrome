import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { identity } from "../lattice/pauli";
import { rotatedSurfaceCode, type StabilizerType } from "../lattice/rotated";
import { createRng } from "../noise/rng";
import { BOUNDARY, defectGraph } from "./graph";
import { exactMatchingWeight, ORACLE_MAX_DEFECTS } from "./oracle";
import {
  createSpacetimeDecoder,
  decodeSpacetime,
  nodeIndex,
  SPACETIME_INITIAL_DEFECTS,
  spacetimeChains,
  spacetimeGraph,
  spacetimePathEdges,
  xorSpacetimePathInto,
  type SpacetimeGraph,
} from "./spacetime";
import { edgeWeight, spaceEdgeIndex, timeEdgeIndex } from "./weights";

// d = 9 with cycles = 9 builds a 400-node graph (dense Dijkstra, ≈ 0.5 s);
// the margin is for the CI runner.
vi.setConfig({ testTimeout: 60_000 });

const TYPES: readonly StabilizerType[] = ["Z", "X"];

function layerOf(graph: SpacetimeGraph, node: number): number {
  return Math.floor(node / graph.m) + 1;
}

describe("T-A3 spacetime graph: shape (phase2.md D1, M9)", () => {
  for (const d of [3, 5, 7]) {
    for (const cycles of [1, 2, d]) {
      for (const type of TYPES) {
        it(`d = ${d}, cycles = ${cycles}, type ${type}: nodes, edges, last layer perfect, no time boundary`, () => {
          const code = rotatedSurfaceCode(d);
          const g = spacetimeGraph(code, type, cycles);
          const m = (code.n - 1) / 2;
          expect(g.m).toBe(m);
          expect(g.layers).toBe(cycles + 1);
          expect(g.nodes).toBe(m * (cycles + 1));
          expect(g.edgeCount).toBe(code.n * cycles + m * cycles);
          expect(g.edgeQubit.length).toBe(g.edgeCount);
          // Degree of every node of the last layer is exactly 1 (its time
          // edge from layer `cycles`); no space edge touches the last layer.
          const degree = new Int32Array(g.nodes);
          for (let e = 0; e < g.edgeCount; e++) {
            const u = g.edgeU[e]!;
            const v = g.edgeV[e]!;
            degree[u]!++;
            if (v >= 0) degree[v]!++;
            if (g.edgeQubit[e]! >= 0) {
              expect(layerOf(g, u)).toBeLessThanOrEqual(cycles);
              if (v >= 0) expect(layerOf(g, v)).toBe(layerOf(g, u));
              expect(e).toBe(
                spaceEdgeIndex(code, g.edgeQubit[e]!, layerOf(g, u), cycles),
              );
            } else {
              // Time edge: never to the boundary, consecutive layers, same check.
              expect(v).toBeGreaterThanOrEqual(0);
              expect(layerOf(g, v)).toBe(layerOf(g, u) + 1);
              expect(v - u).toBe(m);
              expect(e).toBe(timeEdgeIndex(code, u % m, layerOf(g, u), cycles));
            }
            expect(g.edgeWeight[e]).toBe(edgeWeight(e));
          }
          for (let s = 0; s < m; s++) {
            expect(degree[nodeIndex(g, cycles + 1, s)]).toBe(1);
          }
          // Every node of a noisy layer has at least one space edge and one
          // time edge (two for the middle layers).
          for (let r = 1; r <= cycles; r++) {
            for (let s = 0; s < m; s++) {
              expect(degree[nodeIndex(g, r, s)]).toBeGreaterThanOrEqual(
                r === 1 ? 3 : 4,
              );
            }
          }
        });
      }
    }
  }

  it("M9 literal edge counts with cycles = d: 39, 185, 511, 1 089 (type Z); the d = 9 graph builds", () => {
    const counts: Record<number, number> = {};
    for (const d of [3, 5, 7, 9]) {
      counts[d] = spacetimeGraph(rotatedSurfaceCode(d), "Z", d).edgeCount;
    }
    expect(counts).toEqual({ 3: 39, 5: 185, 7: 511, 9: 1089 });
  });

  it("is cached per (code object, type, cycles)", () => {
    const code = rotatedSurfaceCode(3);
    expect(spacetimeGraph(code, "Z", 3)).toBe(spacetimeGraph(code, "Z", 3));
    expect(spacetimeGraph(code, "Z", 3)).not.toBe(spacetimeGraph(code, "X", 3));
    expect(spacetimeGraph(code, "Z", 3)).not.toBe(spacetimeGraph(code, "Z", 2));
  });

  it("rejects cycles < 1 or non-integer, and node coordinates out of range", () => {
    const code = rotatedSurfaceCode(3);
    expect(() => spacetimeGraph(code, "Z", 0)).toThrow(RangeError);
    expect(() => spacetimeGraph(code, "Z", 1.5)).toThrow(RangeError);
    const g = spacetimeGraph(code, "Z", 2);
    expect(() => nodeIndex(g, 0, 0)).toThrow(RangeError);
    expect(() => nodeIndex(g, 4, 0)).toThrow(RangeError);
    expect(() => nodeIndex(g, 1, 4)).toThrow(RangeError);
    expect(nodeIndex(g, 3, 3)).toBe(11);
  });
});

describe("T-A3 spacetime graph: distances", () => {
  for (const d of [3, 5]) {
    for (const type of TYPES) {
      it(`d = ${d}, type ${type}, cycles = ${d}: dist symmetric, zero diagonal, triangle inequality, boundary consistent`, () => {
        const g = spacetimeGraph(rotatedSurfaceCode(d), type, d);
        const M = g.nodes;
        for (let u = 0; u < M; u++) {
          expect(g.dist[u * M + u]).toBe(0);
          expect(g.via[u * M + u]).toBe(-1);
          expect(g.boundaryDist[u]).toBeGreaterThan(0);
          expect(Number.isInteger(g.boundaryDist[u])).toBe(true);
          for (let v = 0; v < M; v++) {
            expect(g.dist[u * M + v]).toBe(g.dist[v * M + u]);
            if (u !== v) expect(g.dist[u * M + v]).toBeGreaterThan(0);
            expect(Number.isInteger(g.dist[u * M + v])).toBe(true);
            // Going through the boundary is never shorter than the boundary
            // distance itself (the boundary absorbs): b_u ≤ dist(u, v) + b_v.
            expect(g.boundaryDist[u]).toBeLessThanOrEqual(
              g.dist[u * M + v]! + g.boundaryDist[v]!,
            );
          }
        }
        const rng = createRng(5);
        for (let i = 0; i < 2000; i++) {
          const u = rng.nextUint32() % M;
          const v = rng.nextUint32() % M;
          const w = rng.nextUint32() % M;
          expect(g.dist[u * M + w]).toBeLessThanOrEqual(
            g.dist[u * M + v]! + g.dist[v * M + w]!,
          );
        }
      });
    }
  }

  for (const d of [3, 5, 7]) {
    for (const type of TYPES) {
      it(`d = ${d}, type ${type}: with cycles = 1 the first layer equals the 2D defect graph entry by entry`, () => {
        const code = rotatedSurfaceCode(d);
        const g = spacetimeGraph(code, type, 1);
        const g2 = defectGraph(code, type);
        const m = g2.m;
        const M = g.nodes;
        for (let u = 0; u < m; u++) {
          expect(g.boundaryDist[u]).toBe(g2.boundaryDist[u]);
          for (let v = 0; v < m; v++) {
            expect(g.dist[u * M + v]).toBe(g2.dist[u * m + v]);
          }
        }
        // The space-edge weights of layer 1 are the qubit weights of 2D.
        for (let q = 0; q < code.n; q++) {
          expect(g.edgeWeight[q]).toBe(g2.weights[q]);
        }
      });
    }
  }
});

describe("T-A3 xorSpacetimePathInto", () => {
  it("between nodes of different layers: accumulates only the qubits of the space edges, returns dist (d = 5, cycles = 5, 500 random pairs)", () => {
    const code = rotatedSurfaceCode(5);
    const g = spacetimeGraph(code, "Z", 5);
    const M = g.nodes;
    const rng = createRng(17);
    const mask = new Uint8Array(code.n);
    const expected = new Uint8Array(code.n);
    for (let i = 0; i < 500; i++) {
      const u = rng.nextUint32() % M;
      const v = i % 10 === 0 ? BOUNDARY : rng.nextUint32() % M;
      mask.fill(0);
      const total = xorSpacetimePathInto(g, u, v, mask);
      expect(total).toBe(
        v === BOUNDARY ? g.boundaryDist[u] : g.dist[u * M + v],
      );
      // Independent walk of the via table: XOR of space-edge qubits, sum of weights.
      expected.fill(0);
      let sum = 0;
      let node = u;
      let hops = 0;
      while (node !== v) {
        const e = v === BOUNDARY ? g.boundaryVia[node]! : g.via[node * M + v]!;
        const q = g.edgeQubit[e]!;
        if (q >= 0) expected[q] = expected[q]! ^ 1;
        sum += g.edgeWeight[e]!;
        node = g.edgeU[e] === node ? g.edgeV[e]! : g.edgeU[e]!;
        hops++;
        expect(hops).toBeLessThanOrEqual(M);
      }
      expect(sum).toBe(total);
      expect(Array.from(mask)).toEqual(Array.from(expected));
    }
  });

  it("a path made only of time edges leaves the mask untouched (same check, layers 1 → cycles + 1)", () => {
    const code = rotatedSurfaceCode(3);
    const g = spacetimeGraph(code, "X", 3);
    const mask = new Uint8Array(code.n).fill(1);
    const total = xorSpacetimePathInto(
      g,
      nodeIndex(g, 1, 2),
      nodeIndex(g, 4, 2),
      mask,
    );
    expect(mask.every((b) => b === 1)).toBe(true);
    let expected = 0;
    for (let r = 1; r <= 3; r++) {
      expected += edgeWeight(timeEdgeIndex(code, 2, r, 3));
    }
    expect(total).toBe(expected);
  });

  it("bounded: an inconsistent via table (two nodes pointing at each other) raises Error instead of looping", () => {
    const code = rotatedSurfaceCode(3);
    const g = spacetimeGraph(code, "Z", 2);
    const M = g.nodes;
    const e = timeEdgeIndex(code, 0, 1, 2); // (1, 0) — (2, 0)
    const u = g.edgeU[e]!;
    const v = g.edgeV[e]!;
    const target = nodeIndex(g, 3, 1);
    const via = Int32Array.from(g.via);
    via[u * M + target] = e;
    via[v * M + target] = e;
    const broken: SpacetimeGraph = { ...g, via };
    expect(() =>
      xorSpacetimePathInto(broken, u, target, new Uint8Array(code.n)),
    ).toThrow(/via table inconsistent/);
  });

  it("rejects endpoints out of range", () => {
    const g = spacetimeGraph(rotatedSurfaceCode(3), "Z", 1);
    const mask = new Uint8Array(9);
    expect(() => xorSpacetimePathInto(g, -1, 0, mask)).toThrow(RangeError);
    expect(() => xorSpacetimePathInto(g, 0, g.nodes, mask)).toThrow(RangeError);
    expect(() => xorSpacetimePathInto(g, 0, -2, mask)).toThrow(RangeError);
  });
});

/** Random subset of ≤ maxK node indices as a detector vector plus its list. */
function arbSyndrome(
  nodes: number,
  maxK: number,
): fc.Arbitrary<{ detectors: Uint8Array; defects: number[] }> {
  return fc
    .uniqueArray(fc.nat(nodes - 1), { maxLength: maxK })
    .map((defects) => {
      const detectors = new Uint8Array(nodes);
      for (const i of defects) detectors[i] = 1;
      return { detectors, defects: [...defects].sort((a, b) => a - b) };
    });
}

describe("T-A4 decodeSpacetime against the DP oracle (≤ 12 defects, 1 000 syndromes per distance, cycles = d)", () => {
  for (const d of [3, 5, 7]) {
    for (const type of TYPES) {
      it(`d = ${d}, type ${type}: matching weight equals the oracle exactly; the matching is valid`, () => {
        const code = rotatedSurfaceCode(d);
        const decoder = createSpacetimeDecoder(code, type, d);
        const g = decoder.graph;
        const tables = {
          m: g.nodes,
          dist: g.dist,
          boundaryDist: g.boundaryDist,
        };
        const correction = identity(code.n);
        fc.assert(
          fc.property(arbSyndrome(g.nodes, ORACLE_MAX_DEFECTS), (s) => {
            const other = type === "Z" ? correction.z : correction.x;
            other.fill(1);
            const total = decodeSpacetime(decoder, s.detectors, correction);
            expect(total).toBe(exactMatchingWeight(tables, s.defects));
            expect(decoder.defectCount).toBe(s.defects.length);
            // Valid matching: every defect exactly once, partner a defect or the boundary.
            const seen = new Set<number>();
            let sum = 0;
            for (let p = 0; p < decoder.pairCount; p++) {
              const a = decoder.pairs[2 * p]!;
              const b = decoder.pairs[2 * p + 1]!;
              expect(seen.has(a)).toBe(false);
              seen.add(a);
              expect(s.defects).toContain(a);
              if (b === BOUNDARY) {
                sum += g.boundaryDist[a]!;
              } else {
                expect(seen.has(b)).toBe(false);
                seen.add(b);
                expect(s.defects).toContain(b);
                sum += g.dist[a * g.nodes + b]!;
              }
            }
            expect(seen.size).toBe(s.defects.length);
            expect(sum).toBe(total);
            // The other mask is untouched.
            expect(other.every((v) => v === 1)).toBe(true);
          }),
          { numRuns: 500 },
        );
      });
    }
  }

  it("the correction's weight by edges equals the returned weight only on the mask side: an empty syndrome gives 0 and clears the mask", () => {
    const code = rotatedSurfaceCode(3);
    const decoder = createSpacetimeDecoder(code, "Z", 3);
    const correction = identity(code.n);
    correction.x.fill(1);
    expect(
      decodeSpacetime(decoder, new Uint8Array(decoder.graph.nodes), correction),
    ).toBe(0);
    expect(correction.x.every((v) => v === 0)).toBe(true);
    expect(decoder.pairCount).toBe(0);
    expect(decoder.defectCount).toBe(0);
  });
});

describe("T-A4 matcher growth (phase2.md D4)", () => {
  it("starts at 2·min(M, 32) vertices; initialVertices must be an even integer ≥ 2", () => {
    const code = rotatedSurfaceCode(7);
    const dec = createSpacetimeDecoder(code, "Z", 7);
    expect(SPACETIME_INITIAL_DEFECTS).toBe(32);
    expect(dec.matcherVertices).toBe(64);
    expect(
      createSpacetimeDecoder(rotatedSurfaceCode(3), "Z", 1).matcherVertices,
    ).toBe(16);
    expect(() => createSpacetimeDecoder(code, "Z", 7, 3)).toThrow(RangeError);
    expect(() => createSpacetimeDecoder(code, "Z", 7, 0)).toThrow(RangeError);
    expect(() => createSpacetimeDecoder(code, "Z", 7, 2.5)).toThrow(RangeError);
  });

  it("initialVertices = 4: a 20-defect syndrome decodes correctly, the matcher grows to ≥ 40 and stays for a later 6-defect syndrome", () => {
    const code = rotatedSurfaceCode(5);
    const decoder = createSpacetimeDecoder(code, "Z", 5, 4);
    const reference = createSpacetimeDecoder(code, "Z", 5);
    const g = decoder.graph;
    expect(decoder.matcherVertices).toBe(4);
    const rng = createRng(3);
    const detectors = new Uint8Array(g.nodes);
    const pick = (k: number): void => {
      detectors.fill(0);
      let placed = 0;
      while (placed < k) {
        const i = rng.nextUint32() % g.nodes;
        if (detectors[i] === 0) {
          detectors[i] = 1;
          placed++;
        }
      }
    };
    const a = identity(code.n);
    const b = identity(code.n);
    pick(20);
    expect(decodeSpacetime(decoder, detectors, a)).toBe(
      decodeSpacetime(reference, detectors, b),
    );
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(decoder.matcherVertices).toBeGreaterThanOrEqual(40);
    expect(decoder.matcherVertices).toBe(64); // 2·min(M = 72, nextPow2(20) = 32)
    const after = decoder.matcherVertices;
    pick(6);
    expect(decodeSpacetime(decoder, detectors, a)).toBe(
      decodeSpacetime(reference, detectors, b),
    );
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(decoder.matcherVertices).toBe(after);
  });

  it("never refuses a syndrome by size: every node lit at d = 5, cycles = 5 (60 defects) decodes in < 1 s and lands exactly on 2M vertices", () => {
    const code = rotatedSurfaceCode(5);
    const decoder = createSpacetimeDecoder(code, "Z", 5);
    const g = decoder.graph;
    expect(g.nodes).toBe(72);
    const detectors = new Uint8Array(g.nodes).fill(1);
    const correction = identity(code.n);
    const t0 = Date.now();
    const total = decodeSpacetime(decoder, detectors, correction);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(total).toBeGreaterThan(0);
    expect(decoder.defectCount).toBe(72);
    expect(decoder.matcherVertices).toBe(2 * g.nodes);
    // Matching valid: 72 defects, each once.
    const seen = new Set<number>();
    for (let p = 0; p < decoder.pairCount; p++) {
      const a = decoder.pairs[2 * p]!;
      const b = decoder.pairs[2 * p + 1]!;
      seen.add(a);
      if (b !== BOUNDARY) seen.add(b);
    }
    expect(seen.size).toBe(72);
  });

  it("rejects wrong lengths with RangeError", () => {
    const decoder = createSpacetimeDecoder(rotatedSurfaceCode(3), "X", 2);
    expect(() =>
      decodeSpacetime(
        decoder,
        new Uint8Array(decoder.graph.nodes - 1),
        identity(9),
      ),
    ).toThrow(RangeError);
    expect(() =>
      decodeSpacetime(
        decoder,
        new Uint8Array(decoder.graph.nodes),
        identity(8),
      ),
    ).toThrow(RangeError);
  });
});

describe("T-G3 spacetimeChains: the matched paths as edges (phase2-g.md D2)", () => {
  for (const d of [3, 5, 7]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    it(`d = ${d}, cycles = ${cycles}: 1 000 random syndromes per type, chains are consecutive, end at b or the boundary, weigh dist, and their space-edge XOR is the correction`, () => {
      const rng = createRng(100 + d);
      for (const type of TYPES) {
        const dec = createSpacetimeDecoder(code, type, cycles);
        const g = dec.graph;
        const M = g.nodes;
        const detectors = new Uint8Array(M);
        const correction = identity(code.n);
        const xor = new Uint8Array(code.n);
        for (let i = 0; i < 1000; i++) {
          // Densities 0.02 … 0.29 (a few to ≈ 55 defects at d = 7): the
          // matcher's cost, not the walker's, is what a denser syndrome adds.
          const density = 0.02 + (i % 10) * 0.03;
          for (let v = 0; v < M; v++) {
            detectors[v] = rng.nextFloat() < density ? 1 : 0;
          }
          decodeSpacetime(dec, detectors, correction);
          const chains = spacetimeChains(dec);
          expect(chains).toHaveLength(dec.pairCount);
          xor.fill(0);
          for (const chain of chains) {
            expect(chain.edges.length).toBeGreaterThan(0);
            let node = chain.a;
            let total = 0;
            for (const e of chain.edges) {
              expect(e).toBeGreaterThanOrEqual(0);
              expect(e).toBeLessThan(g.edgeCount);
              // Consecutive: the edge leaves the node the previous one reached.
              const u = g.edgeU[e]!;
              const v = g.edgeV[e]!;
              expect(u === node || v === node).toBe(true);
              node = u === node ? v : u;
              total += g.edgeWeight[e]!;
              const q = g.edgeQubit[e]!;
              if (q >= 0) xor[q] = xor[q]! ^ 1;
            }
            if (chain.b === BOUNDARY) {
              expect(node).toBe(BOUNDARY);
              expect(total).toBe(g.boundaryDist[chain.a]);
            } else {
              expect(node).toBe(chain.b);
              expect(total).toBe(g.dist[chain.a * M + chain.b]);
            }
          }
          const mask = type === "Z" ? correction.x : correction.z;
          expect(Array.from(xor)).toEqual(Array.from(mask));
        }
      }
    });
  }

  it("a chain to the boundary ends in an edge whose edgeV is BOUNDARY; a time edge has no qubit; a lone flip is one time edge", () => {
    const code = rotatedSurfaceCode(3);
    const dec = createSpacetimeDecoder(code, "Z", 3);
    const g = dec.graph;
    const detectors = new Uint8Array(g.nodes);
    // One flip at (s = 1, r = 2): detectors (2, 1) and (3, 1).
    detectors[nodeIndex(g, 2, 1)] = 1;
    detectors[nodeIndex(g, 3, 1)] = 1;
    decodeSpacetime(dec, detectors, identity(9));
    const chains = spacetimeChains(dec);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.edges).toHaveLength(1);
    const e = chains[0]!.edges[0]!;
    expect(g.edgeQubit[e]).toBe(-1);
    expect(e).toBe(timeEdgeIndex(code, 1, 2, 3));
    // One defect next to the boundary: a single space edge to BOUNDARY.
    detectors.fill(0);
    detectors[nodeIndex(g, 1, 0)] = 1;
    decodeSpacetime(dec, detectors, identity(9));
    const toBoundary = spacetimeChains(dec);
    expect(toBoundary).toHaveLength(1);
    expect(toBoundary[0]!.b).toBe(BOUNDARY);
    const last = toBoundary[0]!.edges[toBoundary[0]!.edges.length - 1]!;
    expect(g.edgeV[last]).toBe(BOUNDARY);
  });

  it("spacetimePathEdges agrees with xorSpacetimePathInto on every pair of nodes at d = 3 and checks its endpoints", () => {
    const code = rotatedSurfaceCode(3);
    const g = spacetimeGraph(code, "X", 3);
    const M = g.nodes;
    const a = new Uint8Array(code.n);
    for (let u = 0; u < M; u++) {
      for (let v = -1; v < M; v++) {
        a.fill(0);
        const weight = xorSpacetimePathInto(g, u, v, a);
        const edges = spacetimePathEdges(g, u, v);
        const b = new Uint8Array(code.n);
        let total = 0;
        for (const e of edges) {
          total += g.edgeWeight[e]!;
          const q = g.edgeQubit[e]!;
          if (q >= 0) b[q] = b[q]! ^ 1;
        }
        expect(total).toBe(weight);
        expect(Array.from(b)).toEqual(Array.from(a));
        if (u === v) expect(edges).toEqual([]);
      }
    }
    expect(() => spacetimePathEdges(g, -1, 0)).toThrow(RangeError);
    expect(() => spacetimePathEdges(g, 0, M)).toThrow(RangeError);
  });

  it("an inconsistent via table is an Error, not a hang", () => {
    const code = rotatedSurfaceCode(3);
    const g = spacetimeGraph(code, "Z", 2);
    const M = g.nodes;
    // A graph whose via always points back along edge 0 ↔ a two-cycle.
    const e0 = 0;
    const u = g.edgeU[e0]!;
    const broken: SpacetimeGraph = {
      ...g,
      via: new Int32Array(M * M).fill(e0),
      boundaryVia: new Int32Array(M).fill(e0),
    };
    const target = (u + 1) % M;
    expect(() => spacetimePathEdges(broken, u, target)).toThrow(
      /via table inconsistent/,
    );
  });
});
