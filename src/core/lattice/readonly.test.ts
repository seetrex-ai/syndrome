import { describe, expect, it } from "vitest";
import {
  clearPauli,
  copyPauli,
  identity,
  multiplyInto,
  pauliEquals,
  type Pauli,
  type ReadonlyPauli,
} from "./pauli";
import { rotatedSurfaceCode } from "./rotated";

/**
 * The code's shared tables are read-only at the type level, in both directions:
 * an index write into logicalX/logicalZ, a stabilizer operator, the CSR tables or
 * checksOfQubit is a compile error (TS2542), and handing one of them to a mutator
 * (`multiplyInto(out, …)`, `clearPauli`) or to a `Pauli` / `Int32Array` binding is
 * a compile error too, because ReadonlyMask / ReadonlyIntTable are not assignable
 * to Uint8Array / Int32Array (TypeScript ignores `readonly` for assignability, so a
 * `Readonly<Uint8Array>` would not have stopped that).
 *
 * This file is type-checked by `tsc -b` (tsconfig.core.json includes src/core) and
 * by tests/intent/core-purity.test.ts, which compiles src/core in process and
 * requires zero diagnostics: an unused @ts-expect-error is itself an error, so each
 * line below proves the write is rejected.
 */
function attemptWrites(code: ReturnType<typeof rotatedSurfaceCode>): void {
  // @ts-expect-error logicalZ is a ReadonlyPauli
  code.logicalZ.z[0] = 0;
  // @ts-expect-error logicalX is a ReadonlyPauli
  code.logicalX.x[0] = 0;
  // @ts-expect-error stabilizer operators are ReadonlyPauli
  code.stabilizers[0]!.operator.x[0] = 1;
  // @ts-expect-error CSR tables are ReadonlyIntTable
  code.supportQubits[0] = 7;
  // @ts-expect-error CSR tables are ReadonlyIntTable
  code.supportOffsets[0] = 7;
  // @ts-expect-error checksOfQubit tables are ReadonlyIntTable
  code.checksOfQubit.Z[0] = 3;

  const a = identity(code.n);
  // @ts-expect-error a shared operator cannot be the output of multiplyInto
  multiplyInto(code.logicalZ, a, a);
  // @ts-expect-error a shared operator cannot be cleared
  clearPauli(code.stabilizers[0]!.operator);
  // @ts-expect-error ReadonlyPauli is not assignable to the editable Pauli
  const p: Pauli = code.logicalX;
  // @ts-expect-error ReadonlyIntTable is not assignable to Int32Array
  const t: Int32Array = code.supportQubits;
  void p;
  void t;
}

describe("shared tables are read-only at the type level", () => {
  it("a consumer that needs an editable Pauli copies it", () => {
    const code = rotatedSurfaceCode(3);
    const shared: ReadonlyPauli = code.logicalZ;
    const mine = copyPauli(shared);
    mine.z[0] = 0;
    expect(pauliEquals(mine, shared)).toBe(false);
    expect(code.logicalZ.z[0]).toBe(1);
    // Readers accept both views; multiplyInto reads shared operators fine.
    const product = multiplyInto(
      identity(code.n),
      code.logicalX,
      code.stabilizers[0]!.operator,
    );
    expect(product.n).toBe(code.n);
    expect(typeof attemptWrites).toBe("function"); // never called: it would corrupt the code
  });
});
