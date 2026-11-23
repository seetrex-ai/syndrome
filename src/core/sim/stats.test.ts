import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  pointRate,
  pointSeed,
  ratioInterval,
  WILSON_Z95,
  wilsonInterval,
} from "./stats";

// T-ST1: tabulated Wilson 95 % intervals (tasks/plans/validation.md M6).
describe("wilsonInterval against tabulated values", () => {
  const TABLE: ReadonlyArray<
    [k: number, n: number, low: number, high: number]
  > = [
    [0, 10, 0, 0.2775327999],
    [5, 10, 0.2365930905, 0.7634069095],
    [1, 100, 0.001767432064, 0.05448619618],
    [50, 100, 0.4038315304, 0.5961684696],
    [100, 1000, 0.08290944359, 0.1201519632],
    [100, 100_000, 0.0008223379697, 0.001215998317],
    [0, 1_000_000, 0, 3.841444064e-6],
    [3, 1_000_000, 1.020271241e-6, 8.821149774e-6],
  ];

  it.each(TABLE)("(k, n) = (%i, %i) → [%f, %f]", (k, n, low, high) => {
    const got = wilsonInterval(k, n);
    expect(got.low).toBeCloseTo(low, 9);
    expect(got.high).toBeCloseTo(high, 9);
  });

  it("z is the 95 % quantile", () => {
    expect(WILSON_Z95).toBe(1.959963984540054);
  });

  it("exact ends: low = 0 when k = 0, high = 1 when k = n, [0, 1] when n = 0", () => {
    for (const n of [1, 2, 10, 1000, 1_000_000]) {
      expect(wilsonInterval(0, n).low).toBe(0);
      expect(wilsonInterval(n, n).high).toBe(1);
    }
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it("positive control: Wald would give [0, 0] for (0, 10); Wilson's upper end is ≈ 0.2775", () => {
    const wald = { low: 0 - WILSON_Z95 * 0, high: 0 + WILSON_Z95 * 0 };
    expect(wald).toEqual({ low: 0, high: 0 });
    expect(wilsonInterval(0, 10).high).toBeCloseTo(0.2775327999, 9);
    expect(wilsonInterval(0, 10).high).toBeGreaterThan(0.2);
  });

  it("rejects non-integers, k > n, negatives and z ≤ 0 with RangeError", () => {
    expect(() => wilsonInterval(1.5, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(11, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(0, -1)).toThrow(RangeError);
    expect(() => wilsonInterval(0, 10, Number.NaN)).toThrow(RangeError);
    expect(() => wilsonInterval(0, 10, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(0, 10.5)).toThrow(RangeError);
    expect(() => wilsonInterval(0, 10, 0)).toThrow(RangeError);
  });
});

// T-ST2: properties of Wilson (random seed, so each run explores new cases).
describe("wilsonInterval properties", () => {
  const kn = fc
    .integer({ min: 1, max: 10_000_000 })
    .chain((n) => fc.tuple(fc.integer({ min: 0, max: n }), fc.constant(n)));

  it("0 ≤ low ≤ k/n ≤ high ≤ 1", () => {
    fc.assert(
      fc.property(kn, ([k, n]) => {
        const { low, high } = wilsonInterval(k, n);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(low).toBeLessThanOrEqual(k / n);
        expect(high).toBeGreaterThanOrEqual(k / n);
        expect(high).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("the width shrinks with n at fixed k/n: (10k, 10n) is narrower than (k, n)", () => {
    fc.assert(
      fc.property(kn, ([k, n]) => {
        const a = wilsonInterval(k, n);
        const b = wilsonInterval(10 * k, 10 * n);
        expect(b.high - b.low).toBeLessThan(a.high - a.low);
      }),
    );
  });

  it("symmetry: wilson(k, n) = 1 − wilson(n − k, n) reversed", () => {
    fc.assert(
      fc.property(kn, ([k, n]) => {
        const a = wilsonInterval(k, n);
        const b = wilsonInterval(n - k, n);
        expect(a.low).toBeCloseTo(1 - b.high, 12);
        expect(a.high).toBeCloseTo(1 - b.low, 12);
      }),
    );
  });
});

// T-ST3: the estimator follows the stop reason (D1).
describe("pointRate", () => {
  it("(k − 1)/(N − 1) only when sampling stopped at the k-th failure", () => {
    expect(pointRate(100, 1001, "failures")).toBe(99 / 1000);
    expect(pointRate(100, 1001, "shots")).toBe(100 / 1001);
    expect(pointRate(100, 1001, "cap")).toBe(100 / 1001);
    expect(pointRate(100, 1001, "budget")).toBe(100 / 1001);
  });

  it('positive control: k/N for "failures" would be 100/1001, not 99/1000', () => {
    expect(100 / 1001).not.toBe(99 / 1000);
    expect(pointRate(100, 1001, "failures")).not.toBe(100 / 1001);
  });

  it("zero failures and the 0/0 corners give 0; a stop by failures with k < 2 is refused", () => {
    expect(pointRate(0, 500, "cap")).toBe(0);
    expect(pointRate(0, 0, "shots")).toBe(0);
    expect(pointRate(0, 0, "budget")).toBe(0);
    // Haldane with k = 1 would be a 0 that is not an upper bound (2026-10-16).
    expect(() => pointRate(1, 1, "failures")).toThrow(RangeError);
    expect(() => pointRate(1, 100, "failures")).toThrow(RangeError);
    expect(pointRate(0, 0, "failures")).toBe(0); // no shots at all short-circuits first
    expect(pointRate(2, 2, "failures")).toBe(1);
  });
});

// T-ST4: per-point seed.
describe("pointSeed", () => {
  const GRID_D = [3, 5, 7] as const;
  const GRID_P = [0.03, 0.05, 0.07, 0.09, 0.1, 0.11, 0.13, 0.15] as const;

  const D_STRIDE = 2 ** 20;

  it("base + d·2²⁰ + round(p·10⁶)", () => {
    expect(pointSeed(20261016, 7, 0.1)).toBe(20261016 + 7 * D_STRIDE + 100000);
    expect(pointSeed(0, 3, 0.03)).toBe(3 * D_STRIDE + 30000);
  });

  it("uses round, not floor: a p·1e6 just below an integer rounds up", () => {
    // The eight grid values happen to give exact integers in V8 (0.03·1e6 is
    // 30000 exactly), so the floor mutant is caught with values that do not.
    expect(0.000001999999 * 1e6).toBeLessThan(2);
    expect(pointSeed(0, 1, 0.000001999999)).toBe(D_STRIDE + 2);
    expect(2.9999999999e-6 * 1e6).toBeLessThan(3);
    expect(pointSeed(0, 1, 2.9999999999e-6)).toBe(D_STRIDE + 3);
    for (const p of GRID_P) expect(pointSeed(0, 1, p)).toBe(D_STRIDE + p * 1e6);
  });

  it("never collides across distances on a fine browser grid (a 1000·d stride did)", () => {
    // The old formula gave pointSeed(0, 3, 0.003) === pointSeed(0, 5, 0.001).
    expect(pointSeed(0, 3, 0.003)).not.toBe(pointSeed(0, 5, 0.001));
    const seen = new Set<number>();
    for (const d of [3, 5, 7, 9]) {
      for (let k = 0; k <= 200; k++) {
        const s = pointSeed(20261016, d, k / 1000);
        expect(seen.has(s)).toBe(false);
        seen.add(s);
      }
    }
    expect(seen.size).toBe(4 * 201);
    expect(() => pointSeed(0, 2 ** 12, 0.1)).toThrow(RangeError);
    expect(pointSeed(2 ** 52 - 1, 2 ** 12 - 1, 1)).toBeLessThan(2 ** 53);
  });

  it("distinct over the 24 grid points and across bases; integers below 2^53", () => {
    const seen = new Set<number>();
    for (const base of [0, 20261016, 2 ** 52 - 1]) {
      for (const d of GRID_D) {
        for (const p of GRID_P) {
          const s = pointSeed(base, d, p);
          expect(Number.isInteger(s)).toBe(true);
          expect(s).toBeLessThan(2 ** 53);
          expect(seen.has(s)).toBe(false);
          seen.add(s);
        }
      }
    }
    expect(seen.size).toBe(72);
  });

  it("rejects a negative, non-integer or too large base, a bad d, and p outside [0, 1]", () => {
    expect(() => pointSeed(-1, 3, 0.1)).toThrow(RangeError);
    expect(() => pointSeed(1.5, 3, 0.1)).toThrow(RangeError);
    expect(() => pointSeed(2 ** 52, 3, 0.1)).toThrow(RangeError);
    expect(() => pointSeed(1, 0, 0.1)).toThrow(RangeError);
    expect(() => pointSeed(1, 2.5, 0.1)).toThrow(RangeError);
    expect(() => pointSeed(1, 3, -0.1)).toThrow(RangeError);
    expect(() => pointSeed(1, 3, 1.1)).toThrow(RangeError);
    expect(() => pointSeed(1, 3, Number.NaN)).toThrow(RangeError);
  });
});

// T-core-1 (tasks/plans/ui.md): Λ = P_L(d) / P_L(d + 2) with a delta-method interval in log.
describe("ratioInterval", () => {
  it("two identical points give Λ = 1 with an interval that contains 1", () => {
    const r = ratioInterval(100, 10_000, 100, 10_000);
    expect(r).not.toBeNull();
    expect(r!.ratio).toBe(1);
    expect(r!.low).toBeLessThan(1);
    expect(r!.high).toBeGreaterThan(1);
  });

  it("matches the hand-computed delta method: Λ = 2.14, σ² = (1 − p̂₁)/k₁ + (1 − p̂₂)/k₂", () => {
    // d = 3: 214 failures in 10 000 shots (p̂₁ = 0.0214); d = 5: 100 in 10 000 (p̂₂ = 0.01).
    const r = ratioInterval(214, 10_000, 100, 10_000);
    const sigma = Math.sqrt((1 - 0.0214) / 214 + (1 - 0.01) / 100);
    expect(r!.ratio).toBeCloseTo(2.14, 12);
    expect(r!.low).toBeCloseTo(2.14 * Math.exp(-WILSON_Z95 * sigma), 12);
    expect(r!.high).toBeCloseTo(2.14 * Math.exp(WILSON_Z95 * sigma), 12);
    // The interval is asymmetric around Λ in linear scale, symmetric in log.
    expect(Math.log(r!.high) - Math.log(r!.ratio)).toBeCloseTo(
      Math.log(r!.ratio) - Math.log(r!.low),
      12,
    );
  });

  it("is null when either point has no failure (k = 0), never 0 or Infinity", () => {
    expect(ratioInterval(0, 1000, 10, 1000)).toBeNull();
    expect(ratioInterval(10, 1000, 0, 1000)).toBeNull();
    expect(ratioInterval(0, 0, 0, 0)).toBeNull();
  });

  it("narrows as the counts grow at the same rates (propagated interval)", () => {
    const small = ratioInterval(20, 1000, 10, 1000)!;
    const large = ratioInterval(2000, 100_000, 1000, 100_000)!;
    expect(large.ratio).toBeCloseTo(small.ratio, 12);
    expect(large.high - large.low).toBeLessThan((small.high - small.low) / 5);
    // Width in log is 2zσ: with k × 100 it shrinks by 10.
    const widthSmall = Math.log(small.high / small.low);
    const widthLarge = Math.log(large.high / large.low);
    expect(widthSmall / widthLarge).toBeCloseTo(10, 6);
  });

  it("the interval covers the true ratio ≈ 95 % of the time (two binomials, seeded LCG)", () => {
    // p₁ = 0.02, p₂ = 0.01 (Λ = 2), n = 20 000 each; a cheap LCG keeps the test deterministic.
    let state = 123456789;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const draw = (p: number, n: number) => {
      let k = 0;
      for (let i = 0; i < n; i++) if (next() < p) k++;
      return k;
    };
    let covered = 0;
    const trials = 400;
    for (let t = 0; t < trials; t++) {
      const r = ratioInterval(
        draw(0.02, 20_000),
        20_000,
        draw(0.01, 20_000),
        20_000,
      )!;
      if (r.low <= 2 && 2 <= r.high) covered++;
    }
    // Binomial(400, 0.95): mean 380, σ ≈ 4.4; the bounds are ±4σ.
    expect(covered).toBeGreaterThanOrEqual(362);
    expect(covered).toBeLessThanOrEqual(398);
  });

  it("rejects non-integers, negatives, k > n and a non-positive z", () => {
    expect(() => ratioInterval(1.5, 10, 1, 10)).toThrow(RangeError);
    expect(() => ratioInterval(-1, 10, 1, 10)).toThrow(RangeError);
    expect(() => ratioInterval(11, 10, 1, 10)).toThrow(RangeError);
    expect(() => ratioInterval(1, 10, 1, 10.5)).toThrow(RangeError);
    expect(() => ratioInterval(1, 10, 2, 1)).toThrow(RangeError);
    expect(() => ratioInterval(1, 10, 1, 10, 0)).toThrow(RangeError);
    expect(() => ratioInterval(1, 10, 1, 10, Number.NaN)).toThrow(RangeError);
  });
});
