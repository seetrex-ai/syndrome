import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DISTANCES } from "../index";
import {
  commutes,
  identity,
  multiplyInto,
  pauliFrom,
  weight,
  type Pauli,
  type ReadonlyPauli,
} from "./pauli";
import {
  logicalXOnColumn,
  logicalZOnRow,
  qubitIndex,
  rotatedSurfaceCode,
  type RotatedSurfaceCode,
  type StabilizerType,
} from "./rotated";
import {
  computeSyndrome,
  computeTypeSyndrome,
  isStabilizerEquivalent,
  logicalEffect,
} from "./syndrome";

const codes = DISTANCES.map((d) => rotatedSurfaceCode(d));
const arbDistance = fc.constantFrom(...DISTANCES);

function arbPauli(n: number): fc.Arbitrary<Pauli> {
  const mask = fc.uint8Array({ minLength: n, maxLength: n });
  return fc.tuple(mask, mask).map(([x, z]) => ({
    n,
    x: x.map((b) => b & 1),
    z: z.map((b) => b & 1),
  }));
}

/** Independent of the CSR tables: one commutation check per stabilizer operator. */
function symplecticSyndrome(
  code: RotatedSurfaceCode,
  p: ReadonlyPauli,
): Uint8Array {
  const out = new Uint8Array(code.stabilizers.length);
  for (const s of code.stabilizers)
    out[s.index] = commutes(p, s.operator) ? 0 : 1;
  return out;
}

function syndromeOf(code: RotatedSurfaceCode, p: ReadonlyPauli): Uint8Array {
  return computeSyndrome(code, p, new Uint8Array(code.stabilizers.length));
}

function isNull(s: Uint8Array): boolean {
  return s.every((b) => b === 0);
}

function isLogical(code: RotatedSurfaceCode, p: ReadonlyPauli): boolean {
  if (!isNull(syndromeOf(code, p))) return false;
  const e = logicalEffect(code, p);
  return e.x || e.z;
}

function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n) return;
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i] = idx[i]! + 1;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

describe("T12 syndrome equals commutation with every stabilizer (§6 item 5)", () => {
  it("computeSyndrome matches the symplectic definition; type syndromes are its blocks", () => {
    fc.assert(
      fc.property(
        arbDistance.chain((d) => fc.tuple(fc.constant(d), arbPauli(d * d))),
        ([d, e]) => {
          const code = codes[DISTANCES.indexOf(d)]!;
          const full = syndromeOf(code, e);
          expect(full).toEqual(symplecticSyndrome(code, e));
          const half = (d * d - 1) / 2;
          const z = computeTypeSyndrome(code, "Z", e, new Uint8Array(half));
          const x = computeTypeSyndrome(code, "X", e, new Uint8Array(half));
          expect(z).toEqual(full.subarray(0, half));
          expect(x).toEqual(full.subarray(half));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is linear: syndrome(a·b) = syndrome(a) XOR syndrome(b)", () => {
    fc.assert(
      fc.property(
        arbDistance.chain((d) =>
          fc.tuple(fc.constant(d), arbPauli(d * d), arbPauli(d * d)),
        ),
        ([d, a, b]) => {
          const code = codes[DISTANCES.indexOf(d)]!;
          const sa = syndromeOf(code, a);
          const sb = syndromeOf(code, b);
          const sab = syndromeOf(code, multiplyInto(identity(code.n), a, b));
          expect(sab).toEqual(sa.map((v, i) => v ^ sb[i]!));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("type syndrome for Z reads only error.x and for X only error.z", () => {
    for (const code of codes) {
      fc.assert(
        fc.property(arbPauli(code.n), (e) => {
          const half = (code.n - 1) / 2;
          const onlyX: Pauli = { n: code.n, x: e.x, z: new Uint8Array(code.n) };
          const onlyZ: Pauli = { n: code.n, x: new Uint8Array(code.n), z: e.z };
          expect(
            computeTypeSyndrome(code, "Z", e, new Uint8Array(half)),
          ).toEqual(
            computeTypeSyndrome(code, "Z", onlyX, new Uint8Array(half)),
          );
          expect(
            computeTypeSyndrome(code, "X", e, new Uint8Array(half)),
          ).toEqual(
            computeTypeSyndrome(code, "X", onlyZ, new Uint8Array(half)),
          );
        }),
        { numRuns: 50 },
      );
    }
  });
});

describe("T13 hand-written cases in d = 3 (pin the boundaries)", () => {
  const code = rotatedSurfaceCode(3);
  const q = (r: number, c: number) => qubitIndex(3, r, c);
  const stab = (type: StabilizerType, i: number, j: number) => {
    const found = code.stabilizers.find(
      (s) => s.type === type && s.row === i && s.col === j,
    );
    if (!found) throw new Error(`no stabilizer ${type}(${i},${j})`);
    return found.index;
  };
  const defects = (p: ReadonlyPauli): number[] => {
    const s = syndromeOf(code, p);
    const out: number[] = [];
    s.forEach((v, i) => {
      if (v === 1) out.push(i);
    });
    return out;
  };
  const X = (r: number, c: number) => pauliFrom(9, [q(r, c)], []);
  const Z = (r: number, c: number) => pauliFrom(9, [], [q(r, c)]);
  const Y = (r: number, c: number) => pauliFrom(9, [q(r, c)], [q(r, c)]);

  const cases: ReadonlyArray<[string, Pauli, number[]]> = [
    ["X(0,0) → Z(0,0) only", X(0, 0), [stab("Z", 0, 0)]],
    ["X(1,1) → Z(0,0), Z(1,1)", X(1, 1), [stab("Z", 0, 0), stab("Z", 1, 1)]],
    [
      "X(1,0) → Z(0,0), Z_left(1,−1)",
      X(1, 0),
      [stab("Z", 0, 0), stab("Z", 1, -1)],
    ],
    ["Z(0,0) → X_top(−1,0) only", Z(0, 0), [stab("X", -1, 0)]],
    ["Z(1,1) → X(0,1), X(1,0)", Z(1, 1), [stab("X", 0, 1), stab("X", 1, 0)]],
    [
      "Y(1,1) → the four interior plaquettes",
      Y(1, 1),
      [stab("Z", 0, 0), stab("Z", 1, 1), stab("X", 0, 1), stab("X", 1, 0)],
    ],
    ["Z(2,2) → X_bottom(2,1) only", Z(2, 2), [stab("X", 2, 1)]],
    ["X(0,2) → Z_right(0,2) only", X(0, 2), [stab("Z", 0, 2)]],
  ];
  for (const [name, error, expected] of cases) {
    it(name, () => {
      expect(defects(error)).toEqual([...expected].sort((a, b) => a - b));
    });
  }

  it("every stabilizer, X_L and Z_L have null syndrome", () => {
    for (const s of code.stabilizers)
      expect(isNull(syndromeOf(code, s.operator))).toBe(true);
    expect(isNull(syndromeOf(code, code.logicalX))).toBe(true);
    expect(isNull(syndromeOf(code, code.logicalZ))).toBe(true);
  });
});

describe("T14 any single stabilizer is a valid syndrome: a chain to the boundary absorbs parity", () => {
  for (const code of codes) {
    it(`d = ${code.d}`, () => {
      for (const type of ["Z", "X"] as const) {
        const table = code.checksOfQubit[type];
        const count = code.stabilizersByType[type].length;
        // Defect graph: node = typeIndex, edge = qubit; −1 = boundary.
        const edges: Array<Array<[number, number]>> = Array.from(
          { length: count },
          () => [],
        );
        for (let q = 0; q < code.n; q++) {
          const a = table[2 * q]!;
          const b = table[2 * q + 1]!;
          edges[a]!.push([b, q]);
          if (b !== -1) edges[b]!.push([a, q]);
        }
        for (const s of code.stabilizersByType[type]) {
          // BFS from s to the first boundary edge; the path's qubits are the error.
          const prev = new Map<number, [number, number]>(); // node → [from, qubit]
          const queue = [s.typeIndex];
          prev.set(s.typeIndex, [-2, -1]);
          let pathQubits: number[] | null = null;
          while (queue.length > 0 && pathQubits === null) {
            const u = queue.shift()!;
            for (const [v, q] of edges[u]!) {
              if (v === -1) {
                pathQubits = [q];
                let cur = u;
                while (cur !== s.typeIndex) {
                  const [from, viaQ] = prev.get(cur)!;
                  pathQubits.push(viaQ);
                  cur = from;
                }
                break;
              }
              if (!prev.has(v)) {
                prev.set(v, [u, q]);
                queue.push(v);
              }
            }
          }
          expect(pathQubits).not.toBeNull();
          const error =
            type === "Z"
              ? pauliFrom(code.n, pathQubits!, [])
              : pauliFrom(code.n, [], pathQubits!);
          expect(weight(error)).toBeLessThanOrEqual(code.d);
          const expected = new Uint8Array(code.stabilizers.length);
          expected[s.index] = 1;
          expect(syndromeOf(code, error)).toEqual(expected);
        }
      }
    });
  }
});

describe("T8a exact minimum logical weight in d = 3 by enumerating all 2^18 Paulis", () => {
  it("min weight of a logical operator is 3; X_L and Z_L are among them; group sizes match rank 8", () => {
    const code = rotatedSurfaceCode(3);
    const p = identity(9);
    const syndrome = new Uint8Array(8);
    let minLogicalWeight = Infinity;
    let logicals = 0;
    let stabilizerGroup = 0;
    let nullSyndrome = 0;
    let weight3Logicals = 0;
    const xl = 0b001001001; // qubits 0, 3, 6: column 0
    const zl = 0b000000111; // qubits 0, 1, 2: row 0
    let sawXL = false;
    let sawZL = false;
    for (let xm = 0; xm < 512; xm++) {
      for (let zm = 0; zm < 512; zm++) {
        for (let q = 0; q < 9; q++) {
          p.x[q] = (xm >> q) & 1;
          p.z[q] = (zm >> q) & 1;
        }
        computeSyndrome(code, p, syndrome);
        let clean = true;
        for (let s = 0; s < 8; s++) {
          if (syndrome[s] !== 0) {
            clean = false;
            break;
          }
        }
        if (!clean) continue;
        nullSyndrome++;
        const effect = logicalEffect(code, p);
        if (!effect.x && !effect.z) {
          stabilizerGroup++;
          continue;
        }
        logicals++;
        const w = weight(p);
        if (w < minLogicalWeight) minLogicalWeight = w;
        if (w === 3) weight3Logicals++;
        if (xm === xl && zm === 0) sawXL = effect.x && !effect.z;
        if (xm === 0 && zm === zl) sawZL = effect.z && !effect.x;
      }
    }
    expect(minLogicalWeight).toBe(3);
    expect(sawXL).toBe(true);
    expect(sawZL).toBe(true);
    // 8 independent stabilizer generators (T9): |S| = 2^8; normalizer = 4·|S|.
    expect(stabilizerGroup).toBe(256);
    expect(nullSyndrome).toBe(1024);
    expect(logicals).toBe(768);
    // Informative, not a physics claim: the three columns of X and three rows of Z are
    // weight-3 logicals, so at least 6 exist.
    expect(weight3Logicals).toBeGreaterThanOrEqual(6);
  });
});

/**
 * T8c complements T8b (band lemma) in d ≥ 5. d = 5 is exhaustive by weight for
 * single-type masks of weight 1…4 (Σ_{1≤k≤4} C(25, k) = 15 275 per type; one type
 * at a time suffices by the argument in T8b). d = 7 exhaustive would be ~1.6·10⁷
 * combinations (seconds) and d = 9 ~3.6·10¹⁰ (not feasible): there the tests below
 * check deterministic one-plaquette deformations (weight exactly d) and near-bound
 * normalizer samples; the lower bound itself is proven by T8b + T7.
 */
describe("T8c no logical operator of weight < d in d ≥ 5", () => {
  it("d = 5: exhaustive over single-type masks of weight ≤ 4", () => {
    const code = rotatedSurfaceCode(5);
    const p = identity(25);
    const syndrome = new Uint8Array(24);
    let checked = 0;
    for (const type of ["X", "Z"] as const) {
      const mask = type === "X" ? p.x : p.z;
      const logical = type === "X" ? code.logicalZ : code.logicalX; // the one it could anticommute with
      for (let k = 1; k <= 4; k++) {
        for (const qubits of combinations(25, k)) {
          mask.fill(0);
          for (const q of qubits) mask[q] = 1;
          computeSyndrome(code, p, syndrome);
          if (isNull(syndrome)) {
            expect(commutes(p, logical)).toBe(true);
          }
          checked++;
        }
      }
      mask.fill(0);
    }
    expect(checked).toBe(2 * (25 + 300 + 2300 + 12650));
  });

  // In d ≥ 7 neither a random sparse Pauli (almost never a null syndrome) nor a
  // logical times a uniform random product of stabilizers (weight ~ n/2, far above
  // d) can falsify "no logical of weight < d": the bound there is PROVEN by T8b + T7.
  // What can be checked at the bound is the geometry of the deformations: a column
  // representative times one X stabilizer touching that column is logical and has
  // weight exactly d (an interior plaquette swaps 2 qubits into the next column, a
  // boundary pair swaps 1), and a few such products stay within d .. d + 4·(count).
  for (const d of [7, 9]) {
    it(`d = ${d}: every one-plaquette deformation of a column/row representative is logical with weight exactly ${d}`, () => {
      const code = rotatedSurfaceCode(d);
      let checked = 0;
      for (let k = 0; k < d; k++) {
        for (const s of code.stabilizersByType.X) {
          if (!s.qubits.some((q) => q % d === k)) continue;
          const p = logicalXOnColumn(code, k);
          multiplyInto(p, p, s.operator);
          expect(isLogical(code, p)).toBe(true);
          expect(weight(p)).toBe(d);
          checked++;
        }
        for (const s of code.stabilizersByType.Z) {
          if (!s.qubits.some((q) => Math.floor(q / d) === k)) continue;
          const p = logicalZOnRow(code, k);
          multiplyInto(p, p, s.operator);
          expect(isLogical(code, p)).toBe(true);
          expect(weight(p)).toBe(d);
          checked++;
        }
      }
      // Each interior plaquette touches two columns, each boundary pair two columns
      // as well: every X stabilizer is counted twice; same for Z and rows.
      expect(checked).toBe(2 * (d * d - 1));
    });

    it(`d = ${d}: 300 near-bound normalizer samples (representative × 1–3 same-type stabilizers) are logical with weight in [${d}, ${d + 12}]`, () => {
      const code = rotatedSurfaceCode(d);
      const byType = code.stabilizersByType;
      fc.assert(
        fc.property(
          fc.constantFrom("X", "Z"),
          fc.integer({ min: 0, max: d - 1 }),
          fc.array(fc.integer({ min: 0, max: (d * d - 1) / 2 - 1 }), {
            minLength: 1,
            maxLength: 3,
          }),
          (type, k, picks) => {
            const p =
              type === "X" ? logicalXOnColumn(code, k) : logicalZOnRow(code, k);
            for (const i of picks)
              multiplyInto(p, p, byType[type][i]!.operator);
            expect(isLogical(code, p)).toBe(true);
            expect(weight(p)).toBeGreaterThanOrEqual(d);
            expect(weight(p)).toBeLessThanOrEqual(d + 4 * picks.length);
          },
        ),
        { numRuns: 300 },
      );
    });
  }
});

describe("T15 isStabilizerEquivalent and logicalEffect", () => {
  for (const code of codes) {
    it(`d = ${code.d}`, () => {
      const scratch = new Uint8Array(code.stabilizers.length);
      for (const s of code.stabilizers) {
        expect(isStabilizerEquivalent(code, s.operator, scratch)).toBe(true);
        expect(isStabilizerEquivalent(code, s.operator)).toBe(true);
        expect(logicalEffect(code, s.operator)).toEqual({ x: false, z: false });
      }
      expect(isStabilizerEquivalent(code, identity(code.n))).toBe(true);
      expect(isStabilizerEquivalent(code, code.logicalX)).toBe(false);
      expect(isStabilizerEquivalent(code, code.logicalZ)).toBe(false);
      expect(logicalEffect(code, code.logicalX)).toEqual({ x: true, z: false });
      expect(logicalEffect(code, code.logicalZ)).toEqual({ x: false, z: true });
      const y = multiplyInto(identity(code.n), code.logicalX, code.logicalZ);
      expect(logicalEffect(code, y)).toEqual({ x: true, z: true });
      expect(isStabilizerEquivalent(code, y)).toBe(false);
      // No single-qubit error is equivalent: every qubit sits in at least one
      // stabilizer of each type (T6), so both the Z block (for X errors) and the X
      // block (for Z errors) of the syndrome are exercised, up to the last stabilizer.
      for (let q = 0; q < code.n; q++) {
        expect(
          isStabilizerEquivalent(code, pauliFrom(code.n, [q], []), scratch),
        ).toBe(false);
        expect(
          isStabilizerEquivalent(code, pauliFrom(code.n, [], [q]), scratch),
        ).toBe(false);
        expect(
          isStabilizerEquivalent(code, pauliFrom(code.n, [q], [q]), scratch),
        ).toBe(false);
      }
      // Other representatives.
      for (let k = 0; k < code.d; k++) {
        expect(logicalEffect(code, logicalXOnColumn(code, k))).toEqual({
          x: true,
          z: false,
        });
        expect(logicalEffect(code, logicalZOnRow(code, k))).toEqual({
          x: false,
          z: true,
        });
      }

      fc.assert(
        fc.property(
          fc.array(fc.boolean(), {
            minLength: code.stabilizers.length,
            maxLength: code.stabilizers.length,
          }),
          (pick) => {
            const product = identity(code.n);
            pick.forEach((take, i) => {
              if (take)
                multiplyInto(product, product, code.stabilizers[i]!.operator);
            });
            expect(isStabilizerEquivalent(code, product, scratch)).toBe(true);
            expect(logicalEffect(code, product)).toEqual({
              x: false,
              z: false,
            });
            const shifted = multiplyInto(
              identity(code.n),
              code.logicalX,
              product,
            );
            expect(isNull(syndromeOf(code, shifted))).toBe(true);
            expect(logicalEffect(code, shifted)).toEqual({ x: true, z: false });
            expect(isStabilizerEquivalent(code, shifted)).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });
  }
});
