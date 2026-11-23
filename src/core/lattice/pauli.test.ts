import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  clearPauli,
  commutes,
  copyPauli,
  identity,
  multiplyInto,
  pauliEquals,
  pauliFrom,
  weight,
  type Pauli,
} from "./pauli";

const SIZES = [9, 25, 81] as const;

function arbPauli(n: number): fc.Arbitrary<Pauli> {
  const mask = fc.uint8Array({ minLength: n, maxLength: n });
  return fc.tuple(mask, mask).map(([x, z]) => ({
    n,
    x: x.map((b) => b & 1),
    z: z.map((b) => b & 1),
  }));
}

function product(a: Pauli, b: Pauli): Pauli {
  return multiplyInto(identity(a.n), a, b);
}

describe("pauliEquals compares both components (fixed cases)", () => {
  it("distinguishes X, Z and Y on the same qubit, and each from the identity", () => {
    const id = identity(2);
    const x0 = pauliFrom(2, [0], []);
    const z0 = pauliFrom(2, [], [0]);
    const y0 = pauliFrom(2, [0], [0]);
    const z1 = pauliFrom(2, [], [1]);
    expect(pauliEquals(id, id)).toBe(true);
    expect(pauliEquals(x0, copyPauli(x0))).toBe(true);
    expect(pauliEquals(z0, identity(2))).toBe(false);
    expect(pauliEquals(x0, identity(2))).toBe(false);
    expect(pauliEquals(x0, z0)).toBe(false);
    expect(pauliEquals(y0, x0)).toBe(false);
    expect(pauliEquals(y0, z0)).toBe(false);
    expect(pauliEquals(z0, z1)).toBe(false);
    expect(pauliEquals(z0, pauliFrom(3, [], [0]))).toBe(false); // different n
  });
});

describe("pauliFrom has set semantics", () => {
  it("a repeated qubit index is the same as listing it once", () => {
    expect(pauliEquals(pauliFrom(3, [0, 0], []), pauliFrom(3, [0], []))).toBe(
      true,
    );
    expect(
      pauliEquals(pauliFrom(3, [], [2, 2, 2]), pauliFrom(3, [], [2])),
    ).toBe(true);
    expect(pauliEquals(pauliFrom(3, [1, 1], [1]), pauliFrom(3, [1], [1]))).toBe(
      true,
    );
    expect(weight(pauliFrom(3, [0, 0], [0]))).toBe(1);
  });
});

describe("T1 multiplyInto is XOR and an abelian group of exponent 2", () => {
  for (const n of SIZES) {
    it(`n = ${n}`, () => {
      fc.assert(
        fc.property(arbPauli(n), arbPauli(n), arbPauli(n), (a, b, c) => {
          const id = identity(n);
          expect(pauliEquals(product(a, a), id)).toBe(true);
          expect(pauliEquals(product(a, b), product(b, a))).toBe(true);
          expect(
            pauliEquals(product(product(a, b), c), product(a, product(b, c))),
          ).toBe(true);
          expect(pauliEquals(product(a, id), a)).toBe(true);
          // Aliasing out = a gives the same as a fresh out.
          const fresh = product(a, b);
          const aliased = copyPauli(a);
          const returned = multiplyInto(aliased, aliased, b);
          expect(returned).toBe(aliased);
          expect(pauliEquals(aliased, fresh)).toBe(true);
          // Aliasing out = b too.
          const aliasedB = copyPauli(b);
          multiplyInto(aliasedB, a, aliasedB);
          expect(pauliEquals(aliasedB, fresh)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  }

  it("rejects size mismatches", () => {
    expect(() => multiplyInto(identity(3), identity(3), identity(4))).toThrow(
      RangeError,
    );
    expect(() => commutes(identity(3), identity(4))).toThrow(RangeError);
    expect(pauliEquals(identity(3), identity(4))).toBe(false);
  });

  it("identity, pauliFrom, copy and clear", () => {
    expect(() => identity(-1)).toThrow(RangeError);
    expect(() => pauliFrom(4, [4], [])).toThrow(RangeError);
    expect(() => pauliFrom(4, [], [-1])).toThrow(RangeError);
    const p = pauliFrom(4, [0, 2], [2, 3]);
    expect(Array.from(p.x)).toEqual([1, 0, 1, 0]);
    expect(Array.from(p.z)).toEqual([0, 0, 1, 1]);
    const c = copyPauli(p);
    expect(c).not.toBe(p);
    expect(c.x).not.toBe(p.x);
    expect(pauliEquals(c, p)).toBe(true);
    clearPauli(c);
    expect(pauliEquals(c, identity(4))).toBe(true);
    expect(pauliEquals(p, identity(4))).toBe(false);
  });
});

describe("T2 commutes is the symplectic product", () => {
  for (const n of SIZES) {
    it(`n = ${n}: symmetric, reflexive, bilinear`, () => {
      fc.assert(
        fc.property(arbPauli(n), arbPauli(n), arbPauli(n), (a, b, c) => {
          expect(commutes(a, b)).toBe(commutes(b, a));
          expect(commutes(a, a)).toBe(true);
          expect(commutes(product(a, b), c)).toBe(
            commutes(a, c) === commutes(b, c),
          );
        }),
        { numRuns: 200 },
      );
    });
  }

  it("fixed cases on two qubits", () => {
    const x0 = pauliFrom(2, [0], []);
    const z0 = pauliFrom(2, [], [0]);
    const z1 = pauliFrom(2, [], [1]);
    const y0 = pauliFrom(2, [0], [0]);
    expect(commutes(x0, z0)).toBe(false);
    expect(commutes(x0, z1)).toBe(true);
    expect(commutes(y0, x0)).toBe(false);
    expect(commutes(y0, z0)).toBe(false);
    expect(commutes(x0, x0)).toBe(true);
    expect(commutes(identity(2), y0)).toBe(true);
  });
});

describe("T3 weight", () => {
  it("weight(I) = 0", () => {
    for (const n of SIZES) {
      expect(weight(identity(n))).toBe(0);
    }
  });

  it("weight(pauliFrom(n, xs, zs)) = |xs ∪ zs|", () => {
    for (const n of SIZES) {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.nat(n - 1)),
          fc.uniqueArray(fc.nat(n - 1)),
          (xs, zs) => {
            expect(weight(pauliFrom(n, xs, zs))).toBe(
              new Set([...xs, ...zs]).size,
            );
          },
        ),
        { numRuns: 100 },
      );
    }
  });

  it("triangle inequality: weight(a) ≤ weight(a·b) + weight(b)", () => {
    for (const n of SIZES) {
      fc.assert(
        fc.property(arbPauli(n), arbPauli(n), (a, b) => {
          expect(weight(a)).toBeLessThanOrEqual(
            weight(product(a, b)) + weight(b),
          );
        }),
        { numRuns: 100 },
      );
    }
  });
});
