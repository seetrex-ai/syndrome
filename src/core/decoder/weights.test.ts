import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rotatedSurfaceCode } from "../lattice/rotated";
import {
  edgeWeight,
  MAX_EDGE_WEIGHT,
  qubitWeight,
  qubitWeightReal,
  qubitWeights,
  spaceEdgeIndex,
  timeEdgeIndex,
  WEIGHT_EPSILON_DENOMINATOR,
  WEIGHT_SCALE,
  WEIGHT_SEED,
} from "./weights";

describe("T-W2 literal W_q table (§6 last item, weights side)", () => {
  // Computed independently in Python and re-derived in Node with an
  // independent script. tools/reference/run.py must reproduce it.
  const table: readonly [q: number, W: number][] = [
    [0, 16766926],
    [1, 16771381],
    [2, 16773715],
    [8, 16766194],
    [24, 16762760],
    [48, 16772826],
    [80, 16763322],
    [120, 16774950],
  ];

  it("qubitWeight matches the table", () => {
    for (const [q, W] of table) expect(qubitWeight(q), `W_${q}`).toBe(W);
  });

  it("sums over d = 3 and d = 9 match the literal values", () => {
    let sum9 = 0;
    let sum81 = 0;
    for (let q = 0; q < 81; q++) {
      const W = qubitWeight(q);
      if (q < 9) sum9 += W;
      sum81 += W;
    }
    expect(sum9).toBe(150_928_060);
    expect(sum81).toBe(1_358_257_734);
  });

  it("constants are the ones of the translingual contract", () => {
    expect(WEIGHT_SEED).toBe(0x53594e44n);
    expect(WEIGHT_SCALE).toBe(16_760_454);
    expect(WEIGHT_SCALE).toBe(Math.floor(((2 ** 24 - 1) * 1000) / 1001));
    expect(WEIGHT_EPSILON_DENOMINATOR).toBe(1000);
    expect(MAX_EDGE_WEIGHT).toBe(2 ** 24 - 1);
  });

  it("rejects invalid qubit indices", () => {
    expect(() => qubitWeight(-1)).toThrow(RangeError);
    expect(() => qubitWeight(1.5)).toThrow(RangeError);
    expect(() => qubitWeights(-1)).toThrow(RangeError);
    expect(() => qubitWeightReal(-1)).toThrow(RangeError);
    expect(qubitWeights(0).length).toBe(0);
  });
});

describe("T-W3 generic and bounded (n = 121, d = 11)", () => {
  const n = 121;
  const table = qubitWeights(n);

  it("all 121 weights are distinct integers in [S, S + 16760] and ≤ MAX_EDGE_WEIGHT", () => {
    const seen = new Set<number>();
    for (let q = 0; q < n; q++) {
      const W = table[q]!;
      expect(Number.isInteger(W)).toBe(true);
      expect(W).toBeGreaterThanOrEqual(WEIGHT_SCALE);
      expect(W).toBeLessThanOrEqual(WEIGHT_SCALE + 16760);
      expect(W).toBeLessThanOrEqual(MAX_EDGE_WEIGHT);
      seen.add(W);
    }
    expect(seen.size).toBe(n);
    // Min and max over q < 121.
    expect(Math.min(...table)).toBe(16_760_749);
    expect(Math.max(...table)).toBe(16_777_040);
  });

  it("W_q / S is w_q discretised downwards by less than 1/S (one integer step)", () => {
    // 1/S ≈ 5.97·10⁻⁸ is the true bound; 2⁻²⁴ ≈ 5.96·10⁻⁸ is slightly smaller and
    // fails for some q ≥ 121 (2026-10-16: q = 763 is a counterexample).
    for (let q = 0; q < 800; q++) {
      const w = qubitWeightReal(q);
      const ratio = qubitWeight(q) / WEIGHT_SCALE;
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThan(1 + 1 / WEIGHT_EPSILON_DENOMINATOR);
      expect(ratio).toBeLessThanOrEqual(w);
      expect(ratio).toBeGreaterThan(w - 1 / WEIGHT_SCALE);
    }
  });

  it("qubitWeights(n)[q] === qubitWeight(q)", () => {
    for (let q = 0; q < n; q++) expect(table[q]).toBe(qubitWeight(q));
  });
});

describe("T-W4 a perturbed minimum is a uniform minimum (ε·n < 1 in integers)", () => {
  it("121 · 16760 < WEIGHT_SCALE: the total perturbation of any set of qubits is below one qubit", () => {
    expect(121 * 16760).toBeLessThan(WEIGHT_SCALE);
  });

  it("floor(ΣW / S) is the set size for random sets of ≤ 81 qubits", () => {
    const table = qubitWeights(81);
    fc.assert(
      fc.property(fc.uniqueArray(fc.nat(80), { maxLength: 81 }), (qubits) => {
        let sum = 0;
        for (const q of qubits) sum += table[q]!;
        expect(Math.floor(sum / WEIGHT_SCALE)).toBe(qubits.length);
        expect(Number.isSafeInteger(sum)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("T-A2 edge weights: the same formula over an edge index (phase2.md D3)", () => {
  it("edgeWeight(q) === qubitWeight(q) for q < 121", () => {
    for (let q = 0; q < 121; q++) expect(edgeWeight(q)).toBe(qubitWeight(q));
  });

  it("literal vector shared with tools/reference (computed in TS and in Python, 2026-10-17)", () => {
    const table: readonly [e: number, W: number][] = [
      [0, 16766926],
      [81, 16764263],
      [343, 16770859],
      [511, 16774866],
      [1088, 16773412],
    ];
    for (const [e, W] of table) expect(edgeWeight(e), `W_${e}`).toBe(W);
  });

  it("every W_e for e < 1089 (d = 9, cycles = 9) is an integer ≤ MAX_EDGE_WEIGHT; collisions are counted, not forbidden", () => {
    const seen = new Set<number>();
    let max = 0;
    for (let e = 0; e < 1089; e++) {
      const W = edgeWeight(e);
      expect(Number.isInteger(W)).toBe(true);
      expect(W).toBeGreaterThanOrEqual(WEIGHT_SCALE);
      if (W > max) max = W;
      seen.add(W);
    }
    expect(max).toBeLessThanOrEqual(MAX_EDGE_WEIGHT);
    expect(max).toBe(16_777_201);
    // Documentation, not an assertion of distinctness: 1 061 distinct values
    // over 1 089 indices (28 birthday collisions on 16 760 levels).
    expect(seen.size).toBe(1061);
  });

  it("rejects invalid edge indices", () => {
    expect(() => edgeWeight(-1)).toThrow(RangeError);
    expect(() => edgeWeight(0.5)).toThrow(RangeError);
    expect(() => edgeWeight(Number.NaN)).toThrow(RangeError);
  });
});

describe("T-A2 space and time edge indices are a bijection onto [0, n·cycles + m·cycles)", () => {
  for (const d of [3, 5, 7, 9]) {
    for (const cycles of [1, d]) {
      it(`d = ${d}, cycles = ${cycles}: ${d * d * cycles + ((d * d - 1) / 2) * cycles} edges, space first`, () => {
        const code = rotatedSurfaceCode(d);
        const n = code.n;
        const m = (n - 1) / 2;
        const total = n * cycles + m * cycles;
        const hit = new Uint8Array(total);
        for (let cycle = 1; cycle <= cycles; cycle++) {
          for (let q = 0; q < n; q++) {
            const e = spaceEdgeIndex(code, q, cycle, cycles);
            expect(e).toBe(q + n * (cycle - 1));
            expect(hit[e]).toBe(0);
            hit[e] = 1;
          }
        }
        for (let cycle = 1; cycle <= cycles; cycle++) {
          for (let s = 0; s < m; s++) {
            const e = timeEdgeIndex(code, s, cycle, cycles);
            expect(e).toBeGreaterThanOrEqual(n * cycles);
            expect(hit[e]).toBe(0);
            hit[e] = 1;
          }
        }
        expect(hit.every((b) => b === 1)).toBe(true);
      });
    }
  }

  it("M9 literal edge counts with cycles = d: 39, 185, 511, 1089", () => {
    const counts: Record<number, number> = {};
    for (const d of [3, 5, 7, 9]) {
      const code = rotatedSurfaceCode(d);
      const m = (code.n - 1) / 2;
      counts[d] = timeEdgeIndex(code, m - 1, d, d) + 1;
    }
    expect(counts).toEqual({ 3: 39, 5: 185, 7: 511, 9: 1089 });
  });

  it("rejects cycles out of range, cycle ∉ [1, cycles], qubit ∉ [0, n), typeIndex ∉ [0, m)", () => {
    const code = rotatedSurfaceCode(3);
    expect(() => spaceEdgeIndex(code, 0, 0, 3)).toThrow(RangeError);
    expect(() => spaceEdgeIndex(code, 0, 4, 3)).toThrow(RangeError);
    expect(() => spaceEdgeIndex(code, 9, 1, 3)).toThrow(RangeError);
    expect(() => spaceEdgeIndex(code, -1, 1, 3)).toThrow(RangeError);
    expect(() => spaceEdgeIndex(code, 0, 1, 0)).toThrow(RangeError);
    expect(() => spaceEdgeIndex(code, 0, 1.5, 3)).toThrow(RangeError);
    expect(() => timeEdgeIndex(code, 4, 1, 3)).toThrow(RangeError);
    expect(() => timeEdgeIndex(code, -1, 1, 3)).toThrow(RangeError);
    expect(() => timeEdgeIndex(code, 0, 0, 3)).toThrow(RangeError);
    expect(() => timeEdgeIndex(code, 0, 1, 2.5)).toThrow(RangeError);
    expect(timeEdgeIndex(code, 0, 1, 1)).toBe(9);
    expect(spaceEdgeIndex(code, 8, 1, 1)).toBe(8);
  });
});
