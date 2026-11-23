import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { rotatedSurfaceCode } from "../lattice/rotated";
import { independentNoise } from "../noise/independent";
import { createRng } from "../noise/rng";
import { phenomenologicalNoise } from "../noise/phenomenological";
import { estimatePoint, VALIDATION_STOP_RULE } from "./adaptive";
import {
  EXACT_MAX_DISTANCE,
  EXACT_SPACETIME_MECHANISMS,
  exactFailureCounts,
  exactLogicalRates,
  exactSpacetimeFailureCounts,
  exactSpacetimeRates,
} from "./exact";
import { createShotContext, decodeShot, LOGICAL_X, LOGICAL_Z } from "./shot";
import { createSpacetimeShotContext, runSpacetimeShot } from "./spacetime-shot";
import { pointSeed, wilsonInterval } from "./stats";

// The 2^18 enumeration (T-E3) and the 10^5-shot points (T-E4) run under 2 s on a
// laptop; the margin is for the CI runner.
vi.setConfig({ testTimeout: 30_000 });

const code3 = rotatedSurfaceCode(3);
const N = 9;

/** C(n, k) by the multiplicative formula (exact for n ≤ 9). */
function choose(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

// T-E1: the literal a_k table (tasks/plans/validation.md M5), measured with PyMatching.
describe("exactFailureCounts at d = 3", () => {
  const A = [0, 0, 18, 56, 57, 69, 28, 18, 9, 1];

  it.each(["Z", "X"] as const)(
    "type %s: a_k = [0, 0, 18, 56, 57, 69, 28, 18, 9, 1], 256 of 512 patterns fail",
    (type) => {
      const counts = exactFailureCounts(code3, type);
      expect(counts).toBeInstanceOf(Int32Array);
      expect(Array.from(counts)).toEqual(A);
      expect(counts.reduce((s, a) => s + a, 0)).toBe(256);
    },
  );

  it("invariant independent of the table: a_k + a_{9−k} = C(9, k)", () => {
    for (const type of ["Z", "X"] as const) {
      const counts = exactFailureCounts(code3, type);
      for (let k = 0; k <= N; k++) {
        expect(counts[k]! + counts[N - k]!).toBe(choose(N, k));
      }
    }
    expect(choose(9, 4)).toBe(126);
  });

  it("refuses d > 3 with RangeError", () => {
    expect(EXACT_MAX_DISTANCE).toBe(3);
    expect(() => exactFailureCounts(rotatedSurfaceCode(5), "Z")).toThrow(
      RangeError,
    );
  });
});

// T-E2: literal exact rates (M5).
describe("exactLogicalRates", () => {
  const countsZ = exactFailureCounts(code3, "Z");
  const countsX = exactFailureCounts(code3, "X");

  it("matches the tabulated values to 9 digits", () => {
    const r03 = exactLogicalRates(countsZ, countsX, N, 0.03);
    expect(r03.x).toBeCloseTo(0.01438992688, 9);
    expect(r03.either).toBeCloseTo(0.02857278377, 9);
    expect(exactLogicalRates(countsZ, countsX, N, 0.05).either).toBeCloseTo(
      0.07236987753,
      9,
    );
    const r10 = exactLogicalRates(countsZ, countsX, N, 0.1);
    expect(r10.x).toBeCloseTo(0.119694592, 9);
    expect(r10.z).toBeCloseTo(0.119694592, 9);
    expect(r10.either).toBeCloseTo(0.2250623886, 9);
    expect(exactLogicalRates(countsZ, countsX, N, 0.15).either).toBeCloseTo(
      0.3867134912,
      9,
    );
  });

  it("positive control: either = x + z would give 0.434 at p = 0.15, not 0.387", () => {
    const r = exactLogicalRates(countsZ, countsX, N, 0.15);
    expect(r.x + r.z).toBeGreaterThan(0.43);
    expect(r.either).toBeLessThan(0.39);
  });

  it("p = 0 → 0; p = 1 → either = 1 (a_9 = 1: X on all nine qubits is X_L times stabilizers)", () => {
    expect(exactLogicalRates(countsZ, countsX, N, 0)).toEqual({
      x: 0,
      z: 0,
      either: 0,
    });
    const r1 = exactLogicalRates(countsZ, countsX, N, 1);
    expect(r1.x).toBe(1);
    expect(r1.z).toBe(1);
    expect(r1.either).toBe(1);
  });

  it("rejects mismatched lengths and p outside [0, 1]", () => {
    expect(() => exactLogicalRates(new Int32Array(9), countsX, N, 0.1)).toThrow(
      RangeError,
    );
    expect(() => exactLogicalRates(countsZ, countsX, N, 1.5)).toThrow(
      RangeError,
    );
    expect(() => exactLogicalRates(countsZ, countsX, N, -0.1)).toThrow(
      RangeError,
    );
  });
});

// T-E3: the product equals the full 2^18 enumeration through the real shot.
describe("factorisation: product of 2^9 × 2^9 equals the 2^18 enumeration", () => {
  const ctx = createShotContext(code3, independentNoise(0.1), createRng(1));
  // Joint histograms over (weight X, weight Z) of failing patterns: either, X, Z.
  const W = N + 1;
  const failEither = new Int32Array(W * W);
  const failX = new Int32Array(W * W);
  const failZ = new Int32Array(W * W);
  let total = 0;
  for (let mx = 0; mx < 512; mx++) {
    let wx = 0;
    for (let q = 0; q < N; q++) {
      const bit = (mx >>> q) & 1;
      ctx.error.x[q] = bit;
      wx += bit;
    }
    for (let mz = 0; mz < 512; mz++) {
      let wz = 0;
      for (let q = 0; q < N; q++) {
        const bit = (mz >>> q) & 1;
        ctx.error.z[q] = bit;
        wz += bit;
      }
      const bits = decodeShot(ctx);
      const cell = wx * W + wz;
      if (bits !== 0) failEither[cell] = failEither[cell]! + 1;
      if (bits & LOGICAL_X) failX[cell] = failX[cell]! + 1;
      if (bits & LOGICAL_Z) failZ[cell] = failZ[cell]! + 1;
      total++;
    }
  }

  function rate(hist: Int32Array, p: number): number {
    let sum = 0;
    for (let wx = 0; wx <= N; wx++) {
      for (let wz = 0; wz <= N; wz++) {
        const c = hist[wx * W + wz]!;
        if (c !== 0) sum += c * p ** (wx + wz) * (1 - p) ** (2 * N - wx - wz);
      }
    }
    return sum;
  }

  const countsZ = exactFailureCounts(code3, "Z");
  const countsX = exactFailureCounts(code3, "X");

  it("enumerated all 2^18 patterns", () => {
    expect(total).toBe(262_144);
  });

  it.each([0.05, 0.1, 0.15])(
    "p = %f: P_L, P_X and P_Z from the enumeration match the product within 1e-12",
    (p) => {
      const exact = exactLogicalRates(countsZ, countsX, N, p);
      expect(Math.abs(rate(failEither, p) - exact.either)).toBeLessThan(1e-12);
      expect(Math.abs(rate(failX, p) - exact.x)).toBeLessThan(1e-12);
      expect(Math.abs(rate(failZ, p) - exact.z)).toBeLessThan(1e-12);
      // The combined verdict is OR, not sum: the joint rate is below P_X + P_Z.
      expect(rate(failEither, p)).toBeLessThan(exact.x + exact.z);
    },
  );
});

// T-E4: docs/spec.md §6 "Exacto en d = 3": the Monte Carlo falls inside its interval.
describe("Monte Carlo at d = 3 against the exact rate", () => {
  const countsZ = exactFailureCounts(code3, "Z");
  const countsX = exactFailureCounts(code3, "X");

  it.each([
    [0.1, 0.2250623886],
    [0.03, 0.02857278377],
  ])(
    "p = %f with the validation rule and pointSeed(20261016, 3, p): 10⁵ shots, Wilson 95 % contains %f",
    (p, exact) => {
      const e = estimatePoint(
        code3,
        p,
        pointSeed(20261016, 3, p),
        VALIDATION_STOP_RULE,
      );
      expect(e.shots).toBe(100_000);
      expect(e.stopReason).toBe("shots");
      expect(e.low).toBeLessThanOrEqual(exact);
      expect(e.high).toBeGreaterThanOrEqual(exact);
      expect(exactLogicalRates(countsZ, countsX, N, p).either).toBeCloseTo(
        exact,
        9,
      );
    },
  );

  // 5σ, not 4σ: CI run 39173180766 (2026-10-18) drew seed 501439000 at
  // p = 0.05 with z = 4.247. Measured over 4 000 fresh seeds (p = 0.05 and
  // 0.1): mean z 0.007 / 0.034, sd 1.007 / 0.986, |z| > 3 in 7 cases (≈ 11
  // expected), none above 4 — an unbiased estimator; a 4σ bound with new
  // seeds every run fails by chance about once per 5 000 runs. 5σ keeps a
  // bias of a few σ visible and fails spuriously ≈ 6·10⁻⁶ per run.
  it("random seeds, N = 2·10⁴: |p̂ − exact| ≤ 5σ (spurious failure ≈ 6·10⁻⁷ per case)", () => {
    const rule = { minFailures: 2, minShots: 20_000, maxShots: 20_000 };
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.constantFrom(0.03, 0.05, 0.1, 0.15),
        (seed, p) => {
          const exact = exactLogicalRates(countsZ, countsX, N, p).either;
          const e = estimatePoint(code3, p, seed, rule);
          const sigma = Math.sqrt((exact * (1 - exact)) / e.shots);
          expect(Math.abs(e.estimate - exact)).toBeLessThanOrEqual(5 * sigma);
        },
      ),
      { numRuns: 10 },
    );
  });
});

describe("exactLogicalRates combines X and Z as P_L = 1 − (1 − P_X)(1 − P_Z)", () => {
  // The d = 3 tables are symmetric (countsX = countsZ), so a mutant that uses
  // x twice is invisible there; synthetic asymmetric tables pin the contract.
  const N = 9;
  const zeros = new Int32Array(N + 1);
  const some = new Int32Array([0, 0, 18, 56, 57, 69, 28, 18, 9, 1]);

  // countsZ are the failures of the Z-stabilizer side (X errors → logical X),
  // countsX those of the X side (Z errors → logical Z).
  it("with no logical-X failures (countsZ = 0), either equals the Z rate and x is 0", () => {
    const r = exactLogicalRates(zeros, some, N, 0.1);
    expect(r.x).toBe(0);
    expect(r.z).toBeGreaterThan(0);
    expect(r.either).toBeCloseTo(r.z, 15); // 1 − (1 − z)·1 up to rounding
  });

  it("with no logical-Z failures (countsX = 0), either equals the X rate and z is 0", () => {
    const r = exactLogicalRates(some, zeros, N, 0.1);
    expect(r.z).toBe(0);
    expect(r.x).toBeGreaterThan(0);
    expect(r.either).toBeCloseTo(r.x, 15);
  });

  it("with both, either is strictly between max(x, z) and x + z", () => {
    const r = exactLogicalRates(some, some, N, 0.1);
    expect(r.either).toBeGreaterThan(Math.max(r.x, r.z));
    expect(r.either).toBeLessThan(r.x + r.z);
    expect(r.either).toBeCloseTo(1 - (1 - r.x) * (1 - r.z), 15);
  });
});

// T-A5 exact (phase2.md D5): the reduced spacetime model, cycles = 1, d = 3.
describe("exactSpacetimeFailureCounts at d = 3, cycles = 1 (2^13 patterns per type)", () => {
  // Literal a_w, w = 0 … 13, computed by this enumeration on 2026-10-17 and
  // reproduced the same day by the Python enumeration of D7 S3 with PyMatching
  // (reference-phenomenological.json exactProbe.counts, equal in both types;
  // the comparator demands that equality) and by an independent brute-force
  // minimum over the 2¹³ patterns without PyMatching.
  const A = [0, 0, 18, 128, 389, 705, 888, 828, 582, 326, 158, 60, 13, 1];
  const A2D = [0, 0, 18, 56, 57, 69, 28, 18, 9, 1];
  const countsZ = exactSpacetimeFailureCounts(code3, "Z", 1);
  const countsX = exactSpacetimeFailureCounts(code3, "X", 1);

  it.each(["Z", "X"] as const)(
    "type %s: a_0 = a_1 = 0 (an isolated mechanism never fails), the literal table, 4 096 of 8 192 patterns fail",
    (type) => {
      const counts = type === "Z" ? countsZ : countsX;
      expect(counts).toBeInstanceOf(Int32Array);
      expect(counts).toHaveLength(EXACT_SPACETIME_MECHANISMS + 1);
      expect(counts[0]).toBe(0);
      expect(counts[1]).toBe(0);
      expect(Array.from(counts)).toEqual(A);
      expect(counts.reduce((s, a) => s + a, 0)).toBe(4096);
    },
  );

  it("complement symmetry a_w + a_{13−w} = C(13, w) HOLDS with cycles = 1 (measured; the plan expected otherwise)", () => {
    // tasks/plans/phase2.md D5 expected no symmetry. With one cycle it follows
    // from the structure below: a_w = Σ_k a2D_k·C(4, w − k) and a2D_k +
    // a2D_{9−k} = C(9, k) give Σ_k C(9, k)·C(4, w − k) = C(13, w). Nothing is
    // claimed for cycles ≥ 2 (not enumerable: 2^26 patterns).
    for (let w = 0; w <= 13; w++) {
      expect(countsZ[w]! + countsZ[13 - w]!).toBe(choose(13, w));
      expect(countsX[w]! + countsX[13 - w]!).toBe(choose(13, w));
    }
    expect(choose(13, 6)).toBe(1716);
  });

  it("STRUCTURE: with one noisy cycle the perfect readout reveals the flips, so a_w = Σ_k a2D_k · C(4, w − k) and the exact rates equal the 2D ones", () => {
    // Layer 2 detectors equal the flips f (s_2 = H·E, s_1 = H·E ⊕ f); a layer-2
    // node has only its time edge, so every matching pays W_time per flip and
    // then matches H·E in layer 1 with the 2D weights W_q: the spatial
    // correction IS the 2D MWPM correction of H·E (tie-break independent by
    // the parity theorem). Hence the failing patterns are (failing 2D pattern)
    // × (any of the 2⁴ flip patterns).
    for (let w = 0; w <= 13; w++) {
      let expected = 0;
      for (let k = 0; k <= 9; k++) {
        const j = w - k;
        if (j >= 0 && j <= 4) expected += A2D[k]! * choose(4, j);
      }
      expect(countsZ[w]).toBe(expected);
    }
    const counts2dZ = exactFailureCounts(code3, "Z");
    const counts2dX = exactFailureCounts(code3, "X");
    for (const p of [0.01, 0.03, 0.05, 0.1]) {
      const r3d = exactSpacetimeRates(countsZ, countsX, 13, p);
      const r2d = exactLogicalRates(counts2dZ, counts2dX, N, p);
      expect(r3d.x).toBeCloseTo(r2d.x, 12);
      expect(r3d.z).toBeCloseTo(r2d.z, 12);
      expect(r3d.either).toBeCloseTo(r2d.either, 12);
    }
    expect(exactSpacetimeRates(countsZ, countsX, 13, 0.03).x).toBeCloseTo(
      0.01438992688,
      9,
    );
  });

  it("refuses d ≠ 3 and cycles ≠ 1 with RangeError", () => {
    expect(() =>
      exactSpacetimeFailureCounts(rotatedSurfaceCode(5), "Z", 1),
    ).toThrow(RangeError);
    expect(() => exactSpacetimeFailureCounts(code3, "Z", 2)).toThrow(
      RangeError,
    );
  });

  it("Monte Carlo with cycles = 1 (runSpacetimeShot, 10⁵ shots) lands inside the Wilson interval of the exact P_L at p = 0.03 and 0.05", () => {
    for (const p of [0.03, 0.05]) {
      const ctx = createSpacetimeShotContext(
        code3,
        phenomenologicalNoise(p, 1),
        createRng(pointSeed(20261017, 3, p)),
      );
      const shots = 100_000;
      let failures = 0;
      let x = 0;
      let z = 0;
      for (let i = 0; i < shots; i++) {
        const bits = runSpacetimeShot(ctx);
        if (bits !== 0) failures++;
        if (bits & LOGICAL_X) x++;
        if (bits & LOGICAL_Z) z++;
      }
      const exact = exactSpacetimeRates(countsZ, countsX, 13, p);
      const w = wilsonInterval(failures, shots);
      expect(exact.either).toBeGreaterThan(w.low);
      expect(exact.either).toBeLessThan(w.high);
      // Both types fail at the same exact rate: a decoder that ignored Z
      // would give z = 0 here.
      const wx = wilsonInterval(x, shots);
      const wz = wilsonInterval(z, shots);
      expect(exact.x).toBeGreaterThan(wx.low);
      expect(exact.x).toBeLessThan(wx.high);
      expect(exact.z).toBeGreaterThan(wz.low);
      expect(exact.z).toBeLessThan(wz.high);
    }
  });
});
