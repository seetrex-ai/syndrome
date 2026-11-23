import { describe, expect, it } from "vitest";
import { computeTypeSyndrome, logicalEffect } from "../lattice/syndrome";
import { identity, multiplyInto, pauliEquals, weight } from "../lattice/pauli";
import { rotatedSurfaceCode } from "../lattice/rotated";
import { independentNoise } from "../noise/independent";
import { createRng } from "../noise/rng";
import {
  createShotContext,
  decodeShot,
  LOGICAL_X,
  LOGICAL_Z,
  runShot,
} from "./shot";

describe("verdict bits", () => {
  it("LOGICAL_X is bit 0 and LOGICAL_Z bit 1", () => {
    expect(LOGICAL_X).toBe(1);
    expect(LOGICAL_Z).toBe(2);
  });
});

// T-SH1: the bit mask is logicalEffect; the residual is error · correction with null syndrome.
describe("runShot verdict equals logicalEffect", () => {
  it.each([3, 5, 7])(
    "d = %i, p = 0.10, 10⁴ shots: bits = logicalEffect, residual = error · correction, null syndrome",
    (d) => {
      const code = rotatedSurfaceCode(d);
      const ctx = createShotContext(code, independentNoise(0.1), createRng(7));
      const product = identity(code.n);
      const check = new Uint8Array((code.n - 1) / 2);
      const seen = new Set<number>();
      for (let shot = 0; shot < 10_000; shot++) {
        const bits = runShot(ctx);
        seen.add(bits);
        const effect = logicalEffect(code, ctx.residual);
        expect((bits & LOGICAL_X) !== 0).toBe(effect.x);
        expect((bits & LOGICAL_Z) !== 0).toBe(effect.z);
        multiplyInto(product, ctx.error, ctx.correction);
        expect(pauliEquals(ctx.residual, product)).toBe(true);
        for (const type of ["Z", "X"] as const) {
          computeTypeSyndrome(code, type, ctx.residual, check);
          expect(check.every((b) => b === 0)).toBe(true);
        }
      }
      // Both logical errors occur at p = 0.10 (kills a verdict that ignores Z).
      expect(seen.has(0)).toBe(true);
      expect([...seen].some((b) => (b & LOGICAL_X) !== 0)).toBe(true);
      expect([...seen].some((b) => (b & LOGICAL_Z) !== 0)).toBe(true);
    },
  );
});

// T-SH2: stable buffers, integer verdict, reproducible sequences.
describe("runShot buffers and determinism", () => {
  it("keeps the same buffers across 100 shots and returns an integer in {0, 1, 2, 3}", () => {
    const code = rotatedSurfaceCode(5);
    const ctx = createShotContext(code, independentNoise(0.1), createRng(3));
    const { error, correction, residual } = ctx;
    const synZ = ctx.syndromes.Z;
    const synX = ctx.syndromes.X;
    for (let shot = 0; shot < 100; shot++) {
      const bits = runShot(ctx);
      expect(Number.isInteger(bits)).toBe(true);
      expect(bits).toBeGreaterThanOrEqual(0);
      expect(bits).toBeLessThanOrEqual(3);
      expect(ctx.error).toBe(error);
      expect(ctx.correction).toBe(correction);
      expect(ctx.residual).toBe(residual);
      expect(ctx.syndromes.Z).toBe(synZ);
      expect(ctx.syndromes.X).toBe(synX);
    }
    expect(synZ.length).toBe(12);
    expect(synX.length).toBe(12);
  });

  it("two contexts with the same seed produce the same 10³ verdicts", () => {
    const code = rotatedSurfaceCode(5);
    const a = createShotContext(code, independentNoise(0.12), createRng(11));
    const b = createShotContext(code, independentNoise(0.12), createRng(11));
    let failures = 0;
    for (let shot = 0; shot < 1000; shot++) {
      const bits = runShot(a);
      expect(runShot(b)).toBe(bits);
      if (bits !== 0) failures++;
    }
    expect(failures).toBeGreaterThan(0);
  });

  it("decodeShot decodes an injected error without sampling (same verdict as runShot on the same error)", () => {
    const code = rotatedSurfaceCode(3);
    const ctx = createShotContext(code, independentNoise(0.1), createRng(5));
    const bits = runShot(ctx);
    const error = identity(code.n);
    multiplyInto(error, ctx.error, identity(code.n));
    const again = decodeShot(ctx);
    expect(again).toBe(bits);
    expect(pauliEquals(ctx.error, error)).toBe(true);
    // A single X on qubit 0 is corrected: verdict 0, correction = the error.
    ctx.error.x.fill(0);
    ctx.error.z.fill(0);
    ctx.error.x[0] = 1;
    expect(decodeShot(ctx)).toBe(0);
    expect(pauliEquals(ctx.correction, ctx.error)).toBe(true);
    expect(weight(ctx.residual)).toBe(0);
  });
});

// T-SH3: extremes p = 0 and p = 1.
describe("runShot at p = 0 and p = 1", () => {
  it("p = 0: always 0 and the error is the identity", () => {
    const code = rotatedSurfaceCode(5);
    const ctx = createShotContext(code, independentNoise(0), createRng(1));
    for (let shot = 0; shot < 200; shot++) {
      expect(runShot(ctx)).toBe(0);
      expect(weight(ctx.error)).toBe(0);
      expect(weight(ctx.correction)).toBe(0);
    }
  });

  it.each([3, 5, 7])(
    "p = 1, d = %i: error = Y on every qubit, null syndrome, empty correction, verdict 3",
    (d) => {
      // Every weight-4 plaquette sees 4 anticommuting qubits (even), every weight-2
      // plaquette sees 2: the syndrome is null and the correction empty. The
      // residual Y^{⊗n} anticommutes with Z_L (d odd qubits with an X component on
      // row 0) and with X_L (d odd qubits with a Z component on column 0): both bits.
      const code = rotatedSurfaceCode(d);
      const ctx = createShotContext(code, independentNoise(1), createRng(1));
      expect(runShot(ctx)).toBe(LOGICAL_X | LOGICAL_Z);
      expect(ctx.error.x.every((b) => b === 1)).toBe(true);
      expect(ctx.error.z.every((b) => b === 1)).toBe(true);
      expect(ctx.syndromes.Z.every((b) => b === 0)).toBe(true);
      expect(ctx.syndromes.X.every((b) => b === 0)).toBe(true);
      expect(weight(ctx.correction)).toBe(0);
      expect(logicalEffect(code, ctx.residual)).toEqual({ x: true, z: true });
    },
  );
});
