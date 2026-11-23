import { describe, expect, it } from "vitest";
import { identity, pauliEquals } from "../lattice/pauli";
import { rotatedSurfaceCode } from "../lattice/rotated";
import { independentNoise, sampleNoise } from "./independent";
import { phenomenologicalNoise, sampleCycleNoise } from "./phenomenological";
import { createRng, type Rng } from "./rng";

const code5 = rotatedSurfaceCode(5);
const M5 = (code5.n - 1) / 2;

function flipBuffers(m: number): { Z: Uint8Array; X: Uint8Array } {
  return { Z: new Uint8Array(m), X: new Uint8Array(m) };
}

/** An Rng wrapper that counts calls and forwards to `inner`. */
function counting(inner: Rng): Rng & { calls: number } {
  const wrapped = {
    seed: inner.seed,
    calls: 0,
    nextUint32(): number {
      wrapped.calls++;
      return inner.nextUint32();
    },
    nextFloat(): number {
      wrapped.calls++;
      return inner.nextFloat();
    },
  };
  return wrapped;
}

describe("T-A1 phenomenologicalNoise: shape and validation", () => {
  it("q === p, cycles kept, threshold = floor(p · 2³²), kind discriminant", () => {
    const noise = phenomenologicalNoise(0.1, 7);
    expect(noise.kind).toBe("phenomenological");
    expect(noise.p).toBe(0.1);
    expect(noise.q).toBe(0.1);
    expect(noise.cycles).toBe(7);
    expect(noise.threshold).toBe(Math.floor(0.1 * 2 ** 32));
    expect(noise.threshold).toBe(independentNoise(0.1).threshold);
  });

  it("rejects p ∉ [0, 1], NaN, cycles = 0 and non-integer cycles", () => {
    expect(() => phenomenologicalNoise(-0.1, 3)).toThrow(RangeError);
    expect(() => phenomenologicalNoise(1.01, 3)).toThrow(RangeError);
    expect(() => phenomenologicalNoise(Number.NaN, 3)).toThrow(RangeError);
    expect(() => phenomenologicalNoise(0.1, 0)).toThrow(RangeError);
    expect(() => phenomenologicalNoise(0.1, 2.5)).toThrow(RangeError);
    expect(() => phenomenologicalNoise(0.1, -1)).toThrow(RangeError);
    expect(phenomenologicalNoise(0, 1).cycles).toBe(1);
    expect(phenomenologicalNoise(1, 1).threshold).toBe(2 ** 32);
  });

  it("rejects flip buffers of the wrong length and a Pauli of the wrong size", () => {
    const noise = phenomenologicalNoise(0.1, 5);
    const rng = createRng(1);
    expect(() =>
      sampleCycleNoise(noise, rng, code5, identity(code5.n), {
        Z: new Uint8Array(M5 - 1),
        X: new Uint8Array(M5),
      }),
    ).toThrow(RangeError);
    expect(() =>
      sampleCycleNoise(noise, rng, code5, identity(code5.n), {
        Z: new Uint8Array(M5),
        X: new Uint8Array(M5 + 1),
      }),
    ).toThrow(RangeError);
    expect(() =>
      sampleCycleNoise(noise, rng, code5, identity(9), flipBuffers(M5)),
    ).toThrow(RangeError);
  });
});

describe("T-A1 sampleCycleNoise writes every entry", () => {
  it("p = 1 sets all data bits and all flips; p = 0 clears them (no clear needed by the caller)", () => {
    const rng = createRng(3);
    const out = identity(code5.n);
    const flips = flipBuffers(M5);
    sampleCycleNoise(phenomenologicalNoise(1, 5), rng, code5, out, flips);
    expect(out.x.every((b) => b === 1)).toBe(true);
    expect(out.z.every((b) => b === 1)).toBe(true);
    expect(flips.Z.every((b) => b === 1)).toBe(true);
    expect(flips.X.every((b) => b === 1)).toBe(true);
    sampleCycleNoise(phenomenologicalNoise(0, 5), rng, code5, out, flips);
    expect(out.x.every((b) => b === 0)).toBe(true);
    expect(out.z.every((b) => b === 0)).toBe(true);
    expect(flips.Z.every((b) => b === 0)).toBe(true);
    expect(flips.X.every((b) => b === 0)).toBe(true);
  });

  it("frequencies of X, Z, Z flips and X flips within 5σ of p over 10⁴ cycles of d = 5 (fixed seed)", () => {
    const p = 0.03;
    const noise = phenomenologicalNoise(p, 5);
    const rng = createRng(20261017);
    const out = identity(code5.n);
    const flips = flipBuffers(M5);
    const cycles = 10_000;
    let x = 0;
    let z = 0;
    let fz = 0;
    let fx = 0;
    let xz = 0;
    let xfz = 0;
    for (let c = 0; c < cycles; c++) {
      sampleCycleNoise(noise, rng, code5, out, flips);
      for (let q = 0; q < code5.n; q++) {
        x += out.x[q]!;
        z += out.z[q]!;
        xz += out.x[q]! & out.z[q]!;
      }
      for (let s = 0; s < M5; s++) {
        fz += flips.Z[s]!;
        fx += flips.X[s]!;
        // Data error on qubit s against the Z flip of check s: a flip that
        // also flipped the data (mutant of the plan's table) would show here.
        xfz += out.x[s]! & flips.Z[s]!;
      }
    }
    const dataDraws = cycles * code5.n;
    const flipDraws = cycles * M5;
    const sigmaData = Math.sqrt((p * (1 - p)) / dataDraws);
    const sigmaFlip = Math.sqrt((p * (1 - p)) / flipDraws);
    expect(Math.abs(x / dataDraws - p)).toBeLessThan(5 * sigmaData);
    expect(Math.abs(z / dataDraws - p)).toBeLessThan(5 * sigmaData);
    expect(Math.abs(fz / flipDraws - p)).toBeLessThan(5 * sigmaFlip);
    expect(Math.abs(fx / flipDraws - p)).toBeLessThan(5 * sigmaFlip);
    // Independence: X ∧ Z on a qubit ≈ p², data ∧ flip ≈ p² (R11 (d)).
    const sigmaJoint = Math.sqrt((p * p * (1 - p * p)) / flipDraws);
    expect(Math.abs(xz / dataDraws - p * p)).toBeLessThan(
      5 * Math.sqrt((p * p * (1 - p * p)) / dataDraws),
    );
    expect(Math.abs(xfz / flipDraws - p * p)).toBeLessThan(5 * sigmaJoint);
  });
});

describe("T-A1 PRNG consumption order: 2n data draws as sampleNoise, then m Z flips, then m X flips", () => {
  it("one cycle consumes exactly 2n + 2m draws", () => {
    const noise = phenomenologicalNoise(0.1, 3);
    const rng = counting(createRng(11));
    sampleCycleNoise(noise, rng, code5, identity(code5.n), flipBuffers(M5));
    expect(rng.calls).toBe(2 * code5.n + 2 * M5);
  });

  it("the first 2n draws give the Pauli sampleNoise gives on a twin Rng, and the flips are the next 2m draws in Z-then-X order", () => {
    const p = 0.2;
    const noise = phenomenologicalNoise(p, 3);
    const twinA = createRng(99);
    const twinB = createRng(99);
    const out = identity(code5.n);
    const flips = flipBuffers(M5);
    const expected = identity(code5.n);
    for (let c = 0; c < 20; c++) {
      sampleCycleNoise(noise, twinA, code5, out, flips);
      sampleNoise(independentNoise(p), twinB, expected);
      expect(pauliEquals(out, expected)).toBe(true);
      const t = noise.threshold;
      for (let s = 0; s < M5; s++) {
        expect(flips.Z[s]).toBe(twinB.nextUint32() < t ? 1 : 0);
      }
      for (let s = 0; s < M5; s++) {
        expect(flips.X[s]).toBe(twinB.nextUint32() < t ? 1 : 0);
      }
    }
  });
});
