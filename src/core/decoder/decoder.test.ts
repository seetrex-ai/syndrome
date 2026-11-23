import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DISTANCES } from "../index";
import {
  identity,
  multiplyInto,
  pauliFrom,
  weight,
  type Pauli,
} from "../lattice/pauli";
import {
  qubitIndex,
  rotatedSurfaceCode,
  type RotatedSurfaceCode,
  type StabilizerType,
} from "../lattice/rotated";
import {
  computeTypeSyndrome,
  isStabilizerEquivalent,
  logicalEffect,
} from "../lattice/syndrome";
import {
  correctionChains,
  createDecoder,
  decode,
  type Decoder,
} from "./decoder";
import { BOUNDARY } from "./graph";
import { exactMatchingWeight } from "./oracle";
import { qubitWeight } from "./weights";

const TYPES: readonly StabilizerType[] = ["Z", "X"];
const codes = DISTANCES.map((d) => rotatedSurfaceCode(d));
const decoders = new Map<string, Decoder>();
function decoderOf(code: RotatedSurfaceCode, type: StabilizerType): Decoder {
  const key = `${code.d}${type}`;
  let dec = decoders.get(key);
  if (dec === undefined) {
    dec = createDecoder(code, type);
    decoders.set(key, dec);
  }
  return dec;
}

/** One manual shot: syndromes of both types, both decodes, residual. */
function shot(
  code: RotatedSurfaceCode,
  error: Pauli,
): {
  correction: Pauli;
  residual: Pauli;
  weights: { Z: number; X: number };
} {
  const m = (code.n - 1) / 2;
  const correction = identity(code.n);
  const weights = { Z: 0, X: 0 };
  for (const type of TYPES) {
    const syndrome = computeTypeSyndrome(code, type, error, new Uint8Array(m));
    weights[type] = decode(decoderOf(code, type), syndrome, correction);
  }
  const residual = multiplyInto(identity(code.n), error, correction);
  return { correction, residual, weights };
}

function arbSparsePauli(n: number, maxWeight: number): fc.Arbitrary<Pauli> {
  return fc
    .tuple(
      fc.uniqueArray(fc.nat(n - 1), { maxLength: maxWeight }),
      fc.array(fc.integer({ min: 1, max: 3 }), {
        minLength: maxWeight,
        maxLength: maxWeight,
      }),
    )
    .map(([qubits, kinds]) => {
      const p = identity(n);
      qubits.forEach((q, idx) => {
        const kind = kinds[idx]!;
        if (kind & 1) p.x[q] = 1;
        if (kind & 2) p.z[q] = 1;
      });
      return p;
    });
}

function arbDensePauli(n: number): fc.Arbitrary<Pauli> {
  return fc
    .tuple(
      fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    )
    .map(([xs, zs]) => {
      const p = identity(n);
      xs.forEach((b, q) => (p.x[q] = b ? 1 : 0));
      zs.forEach((b, q) => (p.z[q] = b ? 1 : 0));
      return p;
    });
}

describe("T-D1 every weight-1 error is corrected (§6 item 1)", () => {
  it.each(codes)("d = $d: X, Z and Y on every qubit", (code) => {
    for (let q = 0; q < code.n; q++) {
      // The minimum correction has one X component, one Z component, or both
      // (Y: Pauli weight 1, two components). On a boundary qubit it may be the
      // neighbouring boundary qubit instead of the error itself (residual = a
      // weight-2 stabilizer), so the qubit is not asserted, only the weight.
      for (const [xs, zs, components] of [
        [[q], [], 1],
        [[], [q], 1],
        [[q], [q], 2],
      ] as const) {
        const error = pauliFrom(code.n, xs, zs);
        const { correction, residual } = shot(code, error);
        expect(isStabilizerEquivalent(code, residual)).toBe(true);
        const sum = (mask: Uint8Array) => mask.reduce((s, b) => s + b, 0);
        expect(sum(correction.x) + sum(correction.z)).toBe(components);
        expect(weight(correction)).toBeGreaterThanOrEqual(1);
        expect(weight(correction)).toBeLessThanOrEqual(components);
      }
    }
  });
});

describe("T-D2 every error of weight ≤ (d − 1)/2 is corrected (§6 item 2)", () => {
  // Valid for any exact MWPM regardless of tie-breaking: |E| + |C| ≤ d − 1 < d,
  // so the residual cannot contain a logical operator (minimum weight d).
  it("d = 5: exhaustive over all Paulis of weight ≤ 2 (25·3 + C(25,2)·9 = 2 775)", () => {
    const code = codes[1]!;
    let count = 0;
    for (let q = 0; q < 25; q++) {
      for (let k = 1; k <= 3; k++) {
        const error = pauliFrom(25, k & 1 ? [q] : [], k & 2 ? [q] : []);
        expect(isStabilizerEquivalent(code, shot(code, error).residual)).toBe(
          true,
        );
        count++;
      }
    }
    for (let a = 0; a < 25; a++) {
      for (let b = a + 1; b < 25; b++) {
        for (let ka = 1; ka <= 3; ka++) {
          for (let kb = 1; kb <= 3; kb++) {
            const xs = [...(ka & 1 ? [a] : []), ...(kb & 1 ? [b] : [])];
            const zs = [...(ka & 2 ? [a] : []), ...(kb & 2 ? [b] : [])];
            const error = pauliFrom(25, xs, zs);
            const { residual } = shot(code, error);
            expect(isStabilizerEquivalent(code, residual)).toBe(true);
            count++;
          }
        }
      }
    }
    expect(count).toBe(2775);
  });

  it("d = 7: 500 random Paulis of weight ≤ 3", () => {
    const code = codes[2]!;
    fc.assert(
      fc.property(arbSparsePauli(49, 3), (error) => {
        expect(isStabilizerEquivalent(code, shot(code, error).residual)).toBe(
          true,
        );
      }),
      { numRuns: 500 },
    );
  });

  it("d = 9: 300 random Paulis of weight ≤ 4", () => {
    const code = codes[3]!;
    fc.assert(
      fc.property(arbSparsePauli(81, 4), (error) => {
        expect(isStabilizerEquivalent(code, shot(code, error).residual)).toBe(
          true,
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe("T-D3 fixed sample of heavier errors with hand-derived verdicts (§6)", () => {
  // d = 3, q(r, c) = 3r + c. Z stabilizers by typeIndex: Z0 = (0,0) {0,1,3,4},
  // Z1 = (0,2) {2,5}, Z2 = (1,−1) {3,6}, Z3 = (1,1) {4,5,7,8}. X stabilizers:
  // X0 = (−1,0) {0,1}, X1 = (0,1) {1,2,4,5}, X2 = (1,0) {3,4,6,7}, X3 = (2,1) {7,8}.
  const d3 = codes[0]!;
  const q3 = (r: number, c: number) => qubitIndex(3, r, c);
  const cases: {
    name: string;
    xs: number[];
    zs: number[];
    defectsZ: number[];
    correctionWeight: number;
    effect: { x: boolean; z: boolean };
  }[] = [
    {
      // Full column: null syndrome, empty correction, the error IS X_L.
      name: "X(0,0)X(1,0)X(2,0) → null syndrome, logical X",
      xs: [q3(0, 0), q3(1, 0), q3(2, 0)],
      zs: [],
      defectsZ: [],
      correctionWeight: 0,
      effect: { x: true, z: false },
    },
    {
      // Defects Z0 (qubit 0) and Z2 (qubit 6); they share qubit 3 = (1,0):
      // correction X(1,0) (weight 1 < two boundary edges), residual = column 0.
      name: "X(0,0)X(2,0) → {Z(0,0), Z(1,−1)}, correction X(1,0), logical X",
      xs: [q3(0, 0), q3(2, 0)],
      zs: [],
      defectsZ: [0, 2],
      correctionWeight: 1,
      effect: { x: true, z: false },
    },
    {
      // Defects Z0 (qubit 1) and Z3 (qubit 7); shared qubit 4 = (1,1).
      name: "X(0,1)X(2,1) → {Z(0,0), Z(1,1)}, correction X(1,1), logical X",
      xs: [q3(0, 1), q3(2, 1)],
      zs: [],
      defectsZ: [0, 3],
      correctionWeight: 1,
      effect: { x: true, z: false },
    },
    {
      // Z0 sees qubits 0 and 4 (even); only Z3 fires. Its boundary edge is
      // (2,1) or (2,2): residual is a top-to-bottom diagonal, crosses Z_L once.
      name: "X(0,0)X(1,1) → {Z(1,1)}, correction X(2,1) or X(2,2), logical X",
      xs: [q3(0, 0), q3(1, 1)],
      zs: [],
      defectsZ: [3],
      correctionWeight: 1,
      effect: { x: true, z: false },
    },
    {
      // The error is the stabilizer X0.
      name: "X(0,0)X(0,1) → null syndrome, residual = stabilizer, no logical error",
      xs: [q3(0, 0), q3(0, 1)],
      zs: [],
      defectsZ: [],
      correctionWeight: 0,
      effect: { x: false, z: false },
    },
    {
      // Z0 and Z1 do not share a qubit: pairing costs 2 (via Z3) and so do two
      // boundary edges; either way the residual is a product of X stabilizers.
      name: "X(0,0)X(0,2) → {Z(0,0), Z(0,2)}, weight-2 correction, no logical error",
      xs: [q3(0, 0), q3(0, 2)],
      zs: [],
      defectsZ: [0, 1],
      correctionWeight: 2,
      effect: { x: false, z: false },
    },
    {
      name: "Z(0,0)Z(0,1)Z(0,2) → null syndrome, logical Z",
      xs: [],
      zs: [q3(0, 0), q3(0, 1), q3(0, 2)],
      defectsZ: [],
      correctionWeight: 0,
      effect: { x: false, z: true },
    },
    {
      name: "X column 0 · Z row 0 → null syndrome, logical X and Z",
      xs: [q3(0, 0), q3(1, 0), q3(2, 0)],
      zs: [q3(0, 0), q3(0, 1), q3(0, 2)],
      defectsZ: [],
      correctionWeight: 0,
      effect: { x: true, z: true },
    },
  ];

  it.each(cases)("d = 3: $name", (c) => {
    const error = pauliFrom(9, c.xs, c.zs);
    const synZ = computeTypeSyndrome(d3, "Z", error, new Uint8Array(4));
    const defects = Array.from(synZ)
      .map((b, i) => (b ? i : -1))
      .filter((i) => i >= 0);
    expect(defects).toEqual(c.defectsZ);
    const { correction, residual } = shot(d3, error);
    expect(weight(correction)).toBe(c.correctionWeight);
    expect(logicalEffect(d3, residual)).toEqual(c.effect);
  });

  it("d = 5: X(0,2)X(1,2)X(2,2) → single defect Z(2,2), closed through the bottom (weight 2), logical X", () => {
    const code = codes[1]!;
    const q = (r: number, c: number) => qubitIndex(5, r, c);
    const error = pauliFrom(25, [q(0, 2), q(1, 2), q(2, 2)], []);
    const synZ = computeTypeSyndrome(code, "Z", error, new Uint8Array(12));
    const fired = code.stabilizersByType.Z.filter((s) => synZ[s.typeIndex]);
    expect(fired.map((s) => [s.row, s.col])).toEqual([[2, 2]]);
    const { correction, residual } = shot(code, error);
    expect(weight(correction)).toBe(2);
    expect(logicalEffect(code, residual)).toEqual({ x: true, z: false });
  });

  it("d = 5: X(0,0)X(0,1)X(0,2) → single defect Z(0,2), corrected by one top-boundary qubit, no logical error", () => {
    const code = codes[1]!;
    const q = (r: number, c: number) => qubitIndex(5, r, c);
    const error = pauliFrom(25, [q(0, 0), q(0, 1), q(0, 2)], []);
    const synZ = computeTypeSyndrome(code, "Z", error, new Uint8Array(12));
    const fired = code.stabilizersByType.Z.filter((s) => synZ[s.typeIndex]);
    expect(fired.map((s) => [s.row, s.col])).toEqual([[0, 2]]);
    const { correction, residual } = shot(code, error);
    expect(weight(correction)).toBe(1);
    expect([q(0, 2), q(0, 3)]).toContain(correction.x.indexOf(1));
    expect(isStabilizerEquivalent(code, residual)).toBe(true);
    expect(logicalEffect(code, residual)).toEqual({ x: false, z: false });
  });
});

describe("T-D4/T-D5/T-D6 valid matching, syndrome reproduced, weight = Σ W (§6)", () => {
  it.each(codes.flatMap((code) => TYPES.map((type) => ({ code, type }))))(
    "d = $code.d, type $type: 200 random dense errors",
    ({ code, type }) => {
      const dec = decoderOf(code, type);
      const m = dec.graph.m;
      const other: "x" | "z" = type === "Z" ? "z" : "x";
      fc.assert(
        fc.property(arbDensePauli(code.n), (error) => {
          const syndrome = computeTypeSyndrome(
            code,
            type,
            error,
            new Uint8Array(m),
          );
          const correction = identity(code.n);
          // The other mask must survive the decode untouched.
          const pattern = Uint8Array.from({ length: code.n }, (_, q) =>
            q % 3 === 0 ? 1 : 0,
          );
          correction[other].set(pattern);
          const total = decode(dec, syndrome, correction);

          // T-D4: every defect exactly once; no non-defect; parity free.
          const seen = new Int32Array(m);
          let pairPairs = 0;
          for (let p = 0; p < dec.pairCount; p++) {
            const a = dec.pairs[2 * p]!;
            const b = dec.pairs[2 * p + 1]!;
            expect(syndrome[a]).toBe(1);
            seen[a]!++;
            if (b === BOUNDARY) continue;
            expect(syndrome[b]).toBe(1);
            seen[b]!++;
            pairPairs++;
          }
          let defectCount = 0;
          for (let i = 0; i < m; i++) {
            expect(seen[i]).toBe(syndrome[i]);
            defectCount += syndrome[i]!;
          }
          expect(dec.defectCount).toBe(defectCount);
          expect(dec.pairCount - pairPairs).toBe(defectCount - 2 * pairPairs);

          // T-D5: the correction reproduces the syndrome; other mask intact.
          const synC = computeTypeSyndrome(
            code,
            type,
            correction,
            new Uint8Array(m),
          );
          expect(synC).toEqual(syndrome);
          expect(correction[other]).toEqual(pattern);

          // T-D6: returned weight = Σ W_q over the correction mask.
          const mask = type === "Z" ? correction.x : correction.z;
          let sum = 0;
          for (let q = 0; q < code.n; q++) {
            if (mask[q]) sum += qubitWeight(q);
          }
          expect(total).toBe(sum);
          expect(Number.isInteger(total)).toBe(true);
        }),
        { numRuns: 200 },
      );
    },
  );
});

describe("T-D7 Blossom = DP oracle through the public decode (§6)", () => {
  it.each(codes.flatMap((code) => TYPES.map((type) => ({ code, type }))))(
    "d = $code.d, type $type: 1 000 syndromes with ≤ 12 defects",
    ({ code, type }) => {
      const dec = decoderOf(code, type);
      const m = dec.graph.m;
      const correction = identity(code.n);
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.nat(m - 1), { maxLength: 12 }),
          (defects) => {
            const syndrome = new Uint8Array(m);
            for (const i of defects) syndrome[i] = 1;
            expect(decode(dec, syndrome, correction)).toBe(
              exactMatchingWeight(dec.graph, defects),
            );
          },
        ),
        { numRuns: 1000 },
      );
    },
  );
});

describe("T-D8 empty syndrome, one defect, lengths, chains", () => {
  it("null syndrome → weight 0, pairCount 0, mask cleared (prefilled with 1)", () => {
    for (const code of codes) {
      for (const type of TYPES) {
        const dec = decoderOf(code, type);
        const correction = identity(code.n);
        correction.x.fill(1);
        correction.z.fill(1);
        expect(decode(dec, new Uint8Array(dec.graph.m), correction)).toBe(0);
        expect(dec.pairCount).toBe(0);
        expect(dec.defectCount).toBe(0);
        const mine = type === "Z" ? correction.x : correction.z;
        const other = type === "Z" ? correction.z : correction.x;
        expect(mine.every((b) => b === 0)).toBe(true);
        expect(other.every((b) => b === 1)).toBe(true);
        expect(correctionChains(dec)).toEqual([]);
      }
    }
  });

  it("one defect → pairs = [i, −1], weight = boundaryDist[i]", () => {
    for (const code of codes) {
      for (const type of TYPES) {
        const dec = decoderOf(code, type);
        const m = dec.graph.m;
        for (let i = 0; i < m; i++) {
          const syndrome = new Uint8Array(m);
          syndrome[i] = 1;
          const correction = identity(code.n);
          expect(decode(dec, syndrome, correction)).toBe(
            dec.graph.boundaryDist[i],
          );
          expect(dec.pairCount).toBe(1);
          expect(Array.from(dec.pairs.subarray(0, 2))).toEqual([i, BOUNDARY]);
        }
      }
    }
  });

  it("wrong syndrome length or Pauli size → RangeError", () => {
    const dec = decoderOf(codes[0]!, "Z");
    expect(() => decode(dec, new Uint8Array(3), identity(9))).toThrow(
      RangeError,
    );
    expect(() => decode(dec, new Uint8Array(5), identity(9))).toThrow(
      RangeError,
    );
    expect(() => decode(dec, new Uint8Array(4), identity(25))).toThrow(
      RangeError,
    );
  });

  it("correctionChains: pairCount entries whose qubits XOR to the correction", () => {
    const code = codes[2]!;
    for (const type of TYPES) {
      const dec = decoderOf(code, type);
      fc.assert(
        fc.property(arbDensePauli(code.n), (error) => {
          const syndrome = computeTypeSyndrome(
            code,
            type,
            error,
            new Uint8Array(dec.graph.m),
          );
          const correction = identity(code.n);
          decode(dec, syndrome, correction);
          const chains = correctionChains(dec);
          expect(chains).toHaveLength(dec.pairCount);
          const rebuilt = new Uint8Array(code.n);
          chains.forEach((chain, p) => {
            expect(chain.a).toBe(dec.pairs[2 * p]);
            expect(chain.b).toBe(dec.pairs[2 * p + 1]);
            for (const q of chain.qubits) rebuilt[q] = rebuilt[q]! ^ 1;
            // Each chain belongs to ITS pair: alone, it flips exactly {a, b}
            // (or {a} when b is the boundary). Chains swapped between pairs
            // would still XOR to the same correction.
            const alone = identity(code.n);
            const aloneMask = type === "Z" ? alone.x : alone.z;
            for (const q of chain.qubits) aloneMask[q] = aloneMask[q]! ^ 1;
            const own = computeTypeSyndrome(
              code,
              type,
              alone,
              new Uint8Array(dec.graph.m),
            );
            const expectedOwn = new Uint8Array(dec.graph.m);
            expectedOwn[chain.a] = 1;
            if (chain.b >= 0) expectedOwn[chain.b] = 1;
            expect(own).toEqual(expectedOwn);
          });
          expect(rebuilt).toEqual(type === "Z" ? correction.x : correction.z);
        }),
        { numRuns: 50 },
      );
    }
  });
});
