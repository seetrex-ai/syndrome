import { describe, expect, it } from "vitest";
import {
  createRng,
  independentNoise,
  qubitIndex,
  rotatedSurfaceCode,
  sampleNoise,
  LOGICAL_X,
  LOGICAL_Z,
} from "../../core";
import { createTraceContext, decodeTrace } from "../model/trace";

/**
 * The rule `steps.explain.verdict` tells the viewer ("count the X flips of the
 * leftover along any complete row, the Z flips along any complete column: even
 * is a product of stabilizers, odd a logical operator") must be what the decoder
 * computes, for EVERY row and column, or the text lies (docs/spec.md §4: "pueden
 * simplificar, nunca mentir"). It holds because Z on any full row is Z_L times
 * Z stabilizers and the residual has a null syndrome; this test measures it
 * rather than trusting the argument: all 2⁹ X errors of d = 3, all 2⁹ Z errors
 * of d = 3, and random errors of both kinds in d = 5 and d = 7.
 */

function rowParity(x: ArrayLike<number>, d: number, row: number): number {
  let parity = 0;
  for (let col = 0; col < d; col++) parity ^= x[qubitIndex(d, row, col)]!;
  return parity;
}

function colParity(z: ArrayLike<number>, d: number, col: number): number {
  let parity = 0;
  for (let row = 0; row < d; row++) parity ^= z[qubitIndex(d, row, col)]!;
  return parity;
}

function checkRule(d: 3 | 5 | 7, error: { x: Uint8Array; z: Uint8Array }) {
  const ctx = createTraceContext(d);
  const trace = decodeTrace(ctx, { n: d * d, x: error.x, z: error.z });
  const logicalX = (trace.verdict & LOGICAL_X) !== 0 ? 1 : 0;
  const logicalZ = (trace.verdict & LOGICAL_Z) !== 0 ? 1 : 0;
  for (let line = 0; line < d; line++) {
    expect(rowParity(trace.residual.x, d, line)).toBe(logicalX);
    expect(colParity(trace.residual.z, d, line)).toBe(logicalZ);
  }
}

describe("the verdict rule shown to the viewer is the decoder's verdict", () => {
  it("every X-only and Z-only error pattern of d = 3, on every row and column", () => {
    const d = 3;
    for (let mask = 0; mask < 1 << (d * d); mask++) {
      const bits = new Uint8Array(d * d);
      for (let q = 0; q < d * d; q++) bits[q] = (mask >> q) & 1;
      checkRule(d, { x: bits, z: new Uint8Array(d * d) });
      checkRule(d, { x: new Uint8Array(d * d), z: bits });
    }
  });

  it.each([5, 7] as const)(
    "random independent X/Z errors of d = %i at p = 0.15 (2 000 shots)",
    (d) => {
      const code = rotatedSurfaceCode(d);
      const rng = createRng(20261017 + d);
      const noise = independentNoise(0.15);
      const error = {
        n: code.n,
        x: new Uint8Array(code.n),
        z: new Uint8Array(code.n),
      };
      for (let shot = 0; shot < 2000; shot++) {
        sampleNoise(noise, rng, error);
        checkRule(d, error);
      }
    },
  );
});
