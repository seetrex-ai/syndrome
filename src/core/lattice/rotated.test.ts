import { describe, expect, it } from "vitest";
import { DISTANCES } from "../index";
import {
  commutes,
  identity,
  multiplyInto,
  pauliEquals,
  weight,
  type ReadonlyPauli,
} from "./pauli";
import {
  incidentStabilizers,
  logicalXOnColumn,
  logicalZOnRow,
  plaquetteType,
  qubitIndex,
  qubitRowCol,
  rotatedSurfaceCode,
  type Boundary,
  type StabilizerType,
} from "./rotated";

const codes = DISTANCES.map((d) => rotatedSurfaceCode(d));

/** Rank over GF(2) of a list of equal-length 0/1 rows, by Gaussian elimination. */
function gf2Rank(rows: Uint8Array[]): number {
  const m = rows.map((r) => r.slice());
  const cols = m[0]?.length ?? 0;
  let rank = 0;
  for (let c = 0; c < cols && rank < m.length; c++) {
    let pivot = -1;
    for (let r = rank; r < m.length; r++) {
      if (m[r]![c] === 1) {
        pivot = r;
        break;
      }
    }
    if (pivot === -1) continue;
    [m[rank], m[pivot]] = [m[pivot]!, m[rank]!];
    for (let r = 0; r < m.length; r++) {
      if (r !== rank && m[r]![c] === 1) {
        const target = m[r]!;
        const source = m[rank]!;
        for (let k = 0; k < cols; k++)
          target[k] = (target[k]! ^ source[k]!) as number;
      }
    }
    rank++;
  }
  return rank;
}

function sharedQubits(a: readonly number[], b: readonly number[]): number {
  return a.filter((q) => b.includes(q)).length;
}

describe("T4 stabilizer count and boundaries (§6 item 1)", () => {
  for (const code of codes) {
    it(`d = ${code.d}`, () => {
      const d = code.d;
      expect(code.n).toBe(d * d);
      expect(code.qubits.length).toBe(d * d);
      expect(code.stabilizers.length).toBe(d * d - 1);
      expect(code.stabilizersByType.Z.length).toBe((d * d - 1) / 2);
      expect(code.stabilizersByType.X.length).toBe((d * d - 1) / 2);
      expect(code.typeOffset).toEqual({ Z: 0, X: (d * d - 1) / 2 });

      const weight4 = code.stabilizers.filter((s) => s.qubits.length === 4);
      const weight2 = code.stabilizers.filter((s) => s.qubits.length === 2);
      expect(weight4.length).toBe((d - 1) * (d - 1));
      expect(weight2.length).toBe(2 * (d - 1));
      expect(weight4.length + weight2.length).toBe(code.stabilizers.length);

      const perBoundary: Record<Boundary, StabilizerType[]> = {
        top: [],
        bottom: [],
        left: [],
        right: [],
      };
      for (const s of code.stabilizers) {
        expect(s.boundary !== null).toBe(s.qubits.length === 2);
        expect(weight(s.operator)).toBe(s.qubits.length);
        expect(Array.from(s.operator.x).some((b) => b === 1)).toBe(
          s.type === "X",
        );
        expect(Array.from(s.operator.z).some((b) => b === 1)).toBe(
          s.type === "Z",
        );
        expect(s.qubits.every((q, k) => k === 0 || q > s.qubits[k - 1]!)).toBe(
          true,
        );
        if (s.boundary !== null) perBoundary[s.boundary].push(s.type);
      }
      for (const b of ["top", "bottom", "left", "right"] as const) {
        expect(perBoundary[b].length).toBe((d - 1) / 2);
      }
      expect(perBoundary.top.every((t) => t === "X")).toBe(true);
      expect(perBoundary.bottom.every((t) => t === "X")).toBe(true);
      expect(perBoundary.left.every((t) => t === "Z")).toBe(true);
      expect(perBoundary.right.every((t) => t === "Z")).toBe(true);
    });
  }

  it("rejects distances that are not odd integers ≥ 3", () => {
    for (const d of [0, 1, 2, 4, 6, 3.5, -3, NaN]) {
      expect(() => rotatedSurfaceCode(d)).toThrow(RangeError);
    }
    expect(rotatedSurfaceCode(11).stabilizers.length).toBe(120);
  });
});

describe("T5 all stabilizers commute (§6 item 2)", () => {
  for (const code of codes) {
    it(`d = ${code.d}: every pair commutes, and cross-type pairs share 0 or 2 qubits`, () => {
      const s = code.stabilizers;
      let pairs = 0;
      for (let a = 0; a < s.length; a++) {
        for (let b = a + 1; b < s.length; b++) {
          expect(commutes(s[a]!.operator, s[b]!.operator)).toBe(true);
          if (s[a]!.type !== s[b]!.type) {
            expect([0, 2]).toContain(sharedQubits(s[a]!.qubits, s[b]!.qubits));
          }
          pairs++;
        }
      }
      expect(pairs).toBe((s.length * (s.length - 1)) / 2);
    });
  }
});

describe("T6 incidence: each qubit lies in 1 or 2 stabilizers of each type", () => {
  for (const code of codes) {
    it(`d = ${code.d}`, () => {
      const d = code.d;
      let zIncidence = 0;
      for (const type of ["Z", "X"] as const) {
        const inverted: number[][] = Array.from({ length: code.n }, () => []);
        for (const s of code.stabilizersByType[type]) {
          for (const q of s.qubits) inverted[q]!.push(s.typeIndex);
        }
        for (const qb of code.qubits) {
          const list = inverted[qb.index]!;
          expect(list.length === 1 || list.length === 2).toBe(true);
          const onEdge =
            type === "Z"
              ? qb.row === 0 || qb.row === d - 1
              : qb.col === 0 || qb.col === d - 1;
          expect(list.length === 1).toBe(onEdge);
          const pair = incidentStabilizers(code, type, qb.index);
          expect(pair[0]).toBe(list[0]);
          expect(pair[1]).toBe(list.length === 2 ? list[1] : -1);
          expect(code.checksOfQubit[type][2 * qb.index]).toBe(pair[0]);
          expect(code.checksOfQubit[type][2 * qb.index + 1]).toBe(pair[1]);
          if (type === "Z") zIncidence += list.length;
        }
      }
      expect(zIncidence).toBe(2 * d * (d - 1));
      expect(() => incidentStabilizers(code, "Z", code.n)).toThrow(RangeError);
      expect(() => incidentStabilizers(code, "Z", -1)).toThrow(RangeError);
      expect(() => incidentStabilizers(code, "X", 1.5)).toThrow(RangeError);
      expect(() => incidentStabilizers(code, "X", Number.NaN)).toThrow(
        RangeError,
      );
    });
  }
});

describe("T7 logical operators (§6 item 3)", () => {
  for (const code of codes) {
    it(`d = ${code.d}`, () => {
      const d = code.d;
      const isPureX = (p: ReadonlyPauli) =>
        Array.from(p.z).every((b) => b === 0);
      const isPureZ = (p: ReadonlyPauli) =>
        Array.from(p.x).every((b) => b === 0);
      const checkLogical = (p: ReadonlyPauli) => {
        expect(weight(p)).toBe(d);
        for (const s of code.stabilizers)
          expect(commutes(p, s.operator)).toBe(true);
      };
      checkLogical(code.logicalX);
      checkLogical(code.logicalZ);
      expect(isPureX(code.logicalX)).toBe(true);
      expect(isPureZ(code.logicalZ)).toBe(true);
      expect(commutes(code.logicalX, code.logicalZ)).toBe(false);
      expect(pauliEquals(code.logicalX, logicalXOnColumn(code, 0))).toBe(true);
      expect(pauliEquals(code.logicalZ, logicalZOnRow(code, 0))).toBe(true);
      // Out-of-range or non-integer coordinates throw instead of returning the
      // identity (a typed array silently ignores writes at non-integer keys).
      for (const bad of [-1, code.d, 1.5, Number.NaN]) {
        expect(() => logicalXOnColumn(code, bad)).toThrow(RangeError);
        expect(() => logicalZOnRow(code, bad)).toThrow(RangeError);
      }
      for (let k = 0; k < d; k++) {
        const xk = logicalXOnColumn(code, k);
        const zk = logicalZOnRow(code, k);
        checkLogical(xk);
        checkLogical(zk);
        expect(isPureX(xk)).toBe(true);
        expect(isPureZ(zk)).toBe(true);
        expect(commutes(xk, code.logicalZ)).toBe(false);
        expect(commutes(zk, code.logicalX)).toBe(false);
        for (let m = 0; m < d; m++)
          expect(commutes(xk, logicalZOnRow(code, m))).toBe(false);
      }
      expect(() => logicalXOnColumn(code, d)).toThrow(RangeError);
      expect(() => logicalZOnRow(code, -1)).toThrow(RangeError);
    });
  }
});

/**
 * T8b, band lemma: the product of all Z stabilizers whose plaquette row is r equals
 * Z on rows r and r+1, i.e. Z_row(r)·Z_row(r+1); symmetric for X by columns.
 *
 * Why this bounds the minimum logical weight from below (§6 item 4): the argument is
 * general in d, the premise is measured for every d in DISTANCES. A
 * logical X-type operator L commutes with every stabilizer and anticommutes with
 * Z_L = Z_row(0). By the lemma Z_row(r) ≡ Z_row(0) modulo stabilizers for all r, so L
 * anticommutes with every Z_row(r), hence has an odd (≥ 1) number of X components on
 * each of the d rows: weight ≥ d. Same for Z-type by columns. An operator with Y
 * components has a logical X part or a logical Z part, hence weight ≥ d. With T7
 * (weight(X_L) = d) the minimum is exactly d. The test measures the geometric premise;
 * the counting step is arithmetic. T8a (exhaustive, d = 3) and T8c (exhaustive by
 * weight in d = 5; deformations and near-bound samples in d ≥ 7) complement it in
 * syndrome.test.ts.
 */
describe("T8b band lemma (minimum logical weight ≥ d, measured for every d in DISTANCES)", () => {
  for (const code of codes) {
    it(`d = ${code.d}: Z bands by row`, () => {
      for (let r = 0; r < code.d - 1; r++) {
        const band = code.stabilizersByType.Z.filter((s) => s.row === r);
        expect(band.length).toBe((code.d - 1) / 2 + 1);
        const acc = identity(code.n);
        for (const s of band) multiplyInto(acc, acc, s.operator);
        const expected = multiplyInto(
          identity(code.n),
          logicalZOnRow(code, r),
          logicalZOnRow(code, r + 1),
        );
        expect(pauliEquals(acc, expected)).toBe(true);
      }
    });
    it(`d = ${code.d}: X bands by column`, () => {
      for (let c = 0; c < code.d - 1; c++) {
        const band = code.stabilizersByType.X.filter((s) => s.col === c);
        expect(band.length).toBe((code.d - 1) / 2 + 1);
        const acc = identity(code.n);
        for (const s of band) multiplyInto(acc, acc, s.operator);
        const expected = multiplyInto(
          identity(code.n),
          logicalXOnColumn(code, c),
          logicalXOnColumn(code, c + 1),
        );
        expect(pauliEquals(acc, expected)).toBe(true);
      }
    });
  }
});

describe("T9 stabilizers are independent: GF(2) rank d²−1 ⇒ one logical qubit", () => {
  for (const code of codes) {
    it(`d = ${code.d}`, () => {
      const rows = code.stabilizers.map((s) => {
        const row = new Uint8Array(2 * code.n);
        row.set(s.operator.x, 0);
        row.set(s.operator.z, code.n);
        return row;
      });
      expect(gf2Rank(rows)).toBe(code.n - 1);
      // Adding X_L (or Z_L) raises the rank: neither is a stabilizer product.
      const xl = new Uint8Array(2 * code.n);
      xl.set(code.logicalX.x, 0);
      expect(gf2Rank([...rows, xl])).toBe(code.n);
      const zl = new Uint8Array(2 * code.n);
      zl.set(code.logicalZ.z, code.n);
      expect(gf2Rank([...rows, zl])).toBe(code.n);
    });
  }
  it("gf2Rank helper: known ranks", () => {
    expect(gf2Rank([new Uint8Array([1, 1]), new Uint8Array([1, 1])])).toBe(1);
    expect(
      gf2Rank([
        new Uint8Array([1, 0]),
        new Uint8Array([0, 1]),
        new Uint8Array([1, 1]),
      ]),
    ).toBe(2);
  });
});

describe("T11 explicit layout of d = 3 (docs/spec.md §3)", () => {
  const code = rotatedSurfaceCode(3);
  const expected: ReadonlyArray<
    [StabilizerType, number, number, Boundary | null, number[]]
  > = [
    ["Z", 0, 0, null, [0, 1, 3, 4]],
    ["Z", 1, 1, null, [4, 5, 7, 8]],
    ["X", 0, 1, null, [1, 2, 4, 5]],
    ["X", 1, 0, null, [3, 4, 6, 7]],
    ["X", -1, 0, "top", [0, 1]],
    ["X", 2, 1, "bottom", [7, 8]],
    ["Z", 1, -1, "left", [3, 6]],
    ["Z", 0, 2, "right", [2, 5]],
  ];

  it("has exactly the eight stabilizers of the table, with type, boundary and qubits", () => {
    expect(code.stabilizers.length).toBe(expected.length);
    for (const [type, i, j, boundary, qubits] of expected) {
      const found = code.stabilizers.filter((s) => s.row === i && s.col === j);
      expect(found.length).toBe(1);
      const s = found[0]!;
      expect(s.type).toBe(type);
      expect(s.boundary).toBe(boundary);
      expect([...s.qubits]).toEqual(qubits);
    }
  });

  it("plaquetteType follows the parity rule on the extended boards of d = 3 and d = 5", () => {
    for (const d of [3, 5]) {
      for (let i = -1; i <= d - 1; i++) {
        for (let j = -1; j <= d - 1; j++) {
          // Hand-written rule: even sum → Z, odd sum → X; −1 counts as odd.
          const sum = i + j;
          const even = sum === 0 || sum % 2 === 0;
          expect(plaquetteType(i, j)).toBe(even ? "Z" : "X");
        }
      }
    }
    expect(plaquetteType(-1, 0)).toBe("X");
    expect(plaquetteType(-1, 1)).toBe("Z");
    expect(plaquetteType(0, 0)).toBe("Z");
  });

  it("qubit indexing helpers", () => {
    for (const d of DISTANCES) {
      for (let r = 0; r < d; r++) {
        for (let c = 0; c < d; c++) {
          const q = qubitIndex(d, r, c);
          expect(q).toBe(r * d + c);
          expect(qubitRowCol(d, q)).toEqual([r, c]);
          const qb = rotatedSurfaceCode(d).qubits[q]!;
          expect([qb.index, qb.row, qb.col]).toEqual([q, r, c]);
        }
      }
    }
  });
});
