import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rotatedSurfaceCode } from "../lattice/rotated";
import { independentNoise } from "../noise/independent";
import { phenomenologicalNoise } from "../noise/phenomenological";
import { createRng } from "../noise/rng";
import {
  createPointSampler,
  estimate,
  estimatePoint,
  INDEPENDENT_MODEL,
  PHENOMENOLOGICAL_MODEL,
  step,
  stop,
  stopRule,
  VALIDATION_STOP_RULE,
  type ModelSpec,
  type StopRule,
} from "./adaptive";
import { createShotContext, runShot } from "./shot";
import { createSpacetimeShotContext, runSpacetimeShot } from "./spacetime-shot";
import { wilsonInterval } from "./stats";

const code3 = rotatedSurfaceCode(3);

/** Verdict bits of the first `count` shots of a twin context (same seed, same p). */
function replay(d: number, p: number, seed: number, count: number): number[] {
  const ctx = createShotContext(
    rotatedSurfaceCode(d),
    independentNoise(p),
    createRng(seed),
  );
  const bits: number[] = [];
  for (let i = 0; i < count; i++) bits.push(runShot(ctx));
  return bits;
}

describe("VALIDATION_STOP_RULE", () => {
  it("is ≥ 100 failures and ≥ 10⁵ shots, cap 10⁶ (docs/spec.md §3, §6)", () => {
    expect(VALIDATION_STOP_RULE).toEqual({
      minFailures: 100,
      minShots: 100_000,
      maxShots: 1_000_000,
    });
  });
});

// T-A1: stop by shots (the grid case).
describe("stop by shots", () => {
  const rule: StopRule = { minFailures: 10, minShots: 2000, maxShots: 100_000 };

  it("d = 3, p = 0.10: exactly 2000 shots, ≈ 450 failures, estimate = k/N", () => {
    const e = estimatePoint(code3, 0.1, 42, rule);
    expect(e.shots).toBe(2000);
    expect(e.stopReason).toBe("shots");
    expect(e.failures).toBeGreaterThan(350);
    expect(e.failures).toBeLessThan(550);
    expect(e.estimate).toBe(e.failures / 2000);
    expect(e.d).toBe(3);
    expect(e.p).toBe(0.1);
    expect(e.upperBoundOnly).toBe(false);
    const w = wilsonInterval(e.failures, e.shots);
    expect(e.low).toBe(w.low);
    expect(e.high).toBe(w.high);
    // Positive control: a rule that ignored minShots would stop at the 10th failure, under 100 shots.
    expect(e.shots).toBeGreaterThan(100);
  });
});

// T-A2: stop by failures lands on the exact shot of the k-th failure.
describe("stop by failures", () => {
  const rule: StopRule = {
    minFailures: 10,
    minShots: 100,
    maxShots: 1_000_000,
  };

  it("per-type detail splits Haldane's estimate in proportion: estimateX = estimate·kX/k ≤ estimate (kX/N would be biased and could exceed P_L)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const e = estimatePoint(code3, 0.05, seed, {
        minFailures: 2,
        minShots: 1,
        maxShots: 1_000_000,
      });
      expect(e.stopReason).toBe("failures");
      expect(e.failures).toBe(2);
      expect(e.estimate).toBe(1 / (e.shots - 1));
      expect(e.estimateX).toBeCloseTo((e.estimate * e.failuresX) / 2, 15);
      expect(e.estimateZ).toBeCloseTo((e.estimate * e.failuresZ) / 2, 15);
      expect(e.estimateX).toBeLessThanOrEqual(e.estimate);
      expect(e.estimateZ).toBeLessThanOrEqual(e.estimate);
      expect(e.estimateX + e.estimateZ).toBeGreaterThanOrEqual(e.estimate);
      // The naive kX/N would exceed the combined Haldane estimate whenever
      // kX = k: the mutant is visible on the first seed where that happens.
      if (e.failuresX === 2) {
        expect(2 / e.shots).toBeGreaterThan(e.estimate);
      }
    }
  });

  it("d = 3, p = 0.01: 10 failures, the last shot is a failure, estimate = 9/(N − 1)", () => {
    const seed = 2026;
    const e = estimatePoint(code3, 0.01, seed, rule);
    expect(e.stopReason).toBe("failures");
    expect(e.failures).toBe(10);
    expect(e.shots).toBeGreaterThan(100);
    expect(e.estimate).toBe(9 / (e.shots - 1));
    expect(e.estimate).not.toBe(10 / e.shots);
    const bits = replay(3, 0.01, seed, e.shots + 5);
    let cumulative = 0;
    for (let i = 0; i < e.shots - 1; i++) if (bits[i] !== 0) cumulative++;
    expect(cumulative).toBe(9);
    expect(bits[e.shots - 1]).not.toBe(0);
    // Not one shot more: the sampler did not run shot N + 1.
    const w = wilsonInterval(10, e.shots);
    expect(e.low).toBe(w.low);
    expect(e.high).toBe(w.high);
  });
});

// T-A3: cap.
describe("stop by cap", () => {
  const rule: StopRule = { minFailures: 1000, minShots: 10, maxShots: 500 };

  it("p = 0.10: 500 shots, reason cap, estimate = k/500", () => {
    const e = estimatePoint(code3, 0.1, 1, rule);
    expect(e.shots).toBe(500);
    expect(e.stopReason).toBe("cap");
    expect(e.failures).toBeGreaterThan(0);
    expect(e.estimate).toBe(e.failures / 500);
  });

  it("p = 0: zero failures is an upper bound, never a zero", () => {
    const e = estimatePoint(code3, 0, 1, rule);
    expect(e.shots).toBe(500);
    expect(e.stopReason).toBe("cap");
    expect(e.failures).toBe(0);
    expect(e.estimate).toBe(0);
    expect(e.upperBoundOnly).toBe(true);
    expect(e.low).toBe(0);
    expect(e.high).toBe(wilsonInterval(0, 500).high);
    expect(e.high).toBeGreaterThan(0.007);
  });
});

// T-A4: cooperative step, progress snapshots and caller-side stop.
describe("step", () => {
  const rule: StopRule = { minFailures: 10, minShots: 2000, maxShots: 100_000 };

  it("step(300) returns null until the step that reaches 2000, cut at the exact shot", () => {
    const sampler = createPointSampler(code3, 0.1, 42, rule);
    const perStep: number[] = [];
    let reason = null;
    let steps = 0;
    while (reason === null) {
      const before = sampler.tally.shots;
      const snapshot = estimate(sampler);
      expect(snapshot.stopReason).toBeNull();
      expect(snapshot.shots).toBe(before);
      // A point in progress (what the live refinement shows) is estimated as
      // k/N: the sequential-stopping correction only applies once the rule
      // fired by failures.
      if (before > 0) {
        expect(snapshot.estimate).toBe(snapshot.failures / snapshot.shots);
        expect(snapshot.upperBoundOnly).toBe(snapshot.failures === 0);
      }
      reason = step(sampler, 300);
      perStep.push(sampler.tally.shots - before);
      if (++steps > 10) throw new Error("step never fired the rule");
    }
    expect(reason).toBe("shots");
    expect(steps).toBe(7);
    expect(perStep).toEqual([300, 300, 300, 300, 300, 300, 200]);
    expect(sampler.tally.shots).toBe(2000);
    expect(estimate(sampler).stopReason).toBe("shots");
    // A stopped sampler returns its reason without running more shots.
    const tallyBefore = { ...sampler.tally };
    expect(step(sampler, 300)).toBe("shots");
    expect({ ...sampler.tally }).toEqual(tallyBefore);
    // step(300) × 7 and step(2000) give the same tally.
    const whole = createPointSampler(code3, 0.1, 42, rule);
    expect(step(whole, 2000)).toBe("shots");
    expect({ ...whole.tally }).toEqual(tallyBefore);
    expect(estimatePoint(code3, 0.1, 42, rule)).toEqual(estimate(whole));
  });

  it("an unknown model kind is a RangeError, never silently phenomenological", () => {
    const bad = { kind: "depolarizing" } as unknown as ModelSpec;
    expect(() => createPointSampler(code3, 0.01, 1, rule, bad)).toThrow(
      RangeError,
    );
  });

  it("step(0) runs nothing; a bad maxShots is a RangeError", () => {
    const sampler = createPointSampler(code3, 0.1, 1, rule);
    expect(step(sampler, 0)).toBeNull();
    expect(sampler.tally.shots).toBe(0);
    expect(() => step(sampler, -1)).toThrow(RangeError);
    expect(() => step(sampler, 1.5)).toThrow(RangeError);
  });

  it('stop(sampler, "budget") mid-way: reason budget, estimate k/N, not overwritten later', () => {
    const sampler = createPointSampler(code3, 0.1, 42, rule);
    expect(step(sampler, 700)).toBeNull();
    stop(sampler, "budget");
    expect(sampler.tally.stopReason).toBe("budget");
    const e = estimate(sampler);
    expect(e.shots).toBe(700);
    expect(e.stopReason).toBe("budget");
    expect(e.estimate).toBe(e.failures / 700);
    expect(step(sampler, 300)).toBe("budget");
    expect(sampler.tally.shots).toBe(700);
    // stop after the rule fired keeps the rule's reason.
    const done = createPointSampler(code3, 0.1, 42, rule);
    expect(step(done, 2000)).toBe("shots");
    stop(done, "budget");
    expect(done.tally.stopReason).toBe("shots");
    expect(() => stop(done, "cap" as "budget")).toThrow(RangeError);
  });

  it("estimate() returns a new frozen object each call; the tally is the same sealed object", () => {
    const sampler = createPointSampler(code3, 0.1, 3, rule);
    const tally = sampler.tally;
    step(sampler, 10);
    const a = estimate(sampler);
    const b = estimate(sampler);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(sampler.tally).toBe(tally);
    expect(Object.isSealed(tally)).toBe(true);
    expect(Object.isFrozen(sampler)).toBe(true);
  });
});

// T-A5: X, Z and "X or Z" are coherent.
describe("failure counts by type", () => {
  const rule: StopRule = { minFailures: 2, minShots: 20_000, maxShots: 20_000 };

  it.each([3, 5])(
    "d = %i, p = 0.10, 2·10⁴ shots: max(kX, kZ) ≤ k ≤ kX + kZ, k = #{bits ≠ 0}, X ≈ Z",
    (d) => {
      const seed = 99;
      const e = estimatePoint(rotatedSurfaceCode(d), 0.1, seed, rule);
      expect(e.shots).toBe(20_000);
      expect(e.failures).toBeGreaterThan(0);
      expect(e.failures).toBeGreaterThanOrEqual(
        Math.max(e.failuresX, e.failuresZ),
      );
      expect(e.failures).toBeLessThanOrEqual(e.failuresX + e.failuresZ);
      // OR, not sum, and not X alone: at p = 0.10 both strict inequalities hold.
      expect(e.failures).toBeLessThan(e.failuresX + e.failuresZ);
      expect(e.failures).toBeGreaterThan(e.failuresX);
      const bits = replay(d, 0.1, seed, 20_000);
      expect(bits.filter((b) => b !== 0).length).toBe(e.failures);
      expect(bits.filter((b) => (b & 1) !== 0).length).toBe(e.failuresX);
      expect(bits.filter((b) => (b & 2) !== 0).length).toBe(e.failuresZ);
      // The model is symmetric under X ↔ Z: the two rates agree within 5σ.
      const mean = (e.estimateX + e.estimateZ) / 2;
      const sigma = Math.sqrt((2 * mean * (1 - mean)) / e.shots);
      expect(Math.abs(e.estimateX - e.estimateZ)).toBeLessThan(5 * sigma);
      expect(e.estimateX).toBe(e.failuresX / 20_000);
      expect(e.estimateZ).toBe(e.failuresZ / 20_000);
      expect(e.lowX).toBe(wilsonInterval(e.failuresX, 20_000).low);
      expect(e.highX).toBe(wilsonInterval(e.failuresX, 20_000).high);
      expect(e.lowZ).toBe(wilsonInterval(e.failuresZ, 20_000).low);
      expect(e.highZ).toBe(wilsonInterval(e.failuresZ, 20_000).high);
      expect(e.low).toBe(wilsonInterval(e.failures, 20_000).low);
      expect(e.high).toBe(wilsonInterval(e.failures, 20_000).high);
    },
  );
});

// T-A6: invalid rules and parameters.
describe("validation", () => {
  it("stopRule rejects minShots > maxShots, non-integers, minFailures = 0 and minFailures = 1 (Haldane would give 0)", () => {
    expect(() =>
      stopRule({ minFailures: 1, minShots: 10, maxShots: 50 }),
    ).toThrow(RangeError);
    expect(() =>
      stopRule({ minFailures: 2, minShots: 10, maxShots: 5 }),
    ).toThrow(RangeError);
    expect(() =>
      stopRule({ minFailures: 1.5, minShots: 10, maxShots: 50 }),
    ).toThrow(RangeError);
    expect(() =>
      stopRule({ minFailures: 2, minShots: 10.5, maxShots: 50 }),
    ).toThrow(RangeError);
    expect(() =>
      stopRule({ minFailures: 2, minShots: 10, maxShots: 50.5 }),
    ).toThrow(RangeError);
    expect(() =>
      stopRule({ minFailures: 0, minShots: 10, maxShots: 50 }),
    ).toThrow(RangeError);
    expect(() =>
      stopRule({ minFailures: 2, minShots: 0, maxShots: 50 }),
    ).toThrow(RangeError);
    const ok = stopRule({ minFailures: 2, minShots: 10, maxShots: 10 });
    expect(ok).toEqual({ minFailures: 2, minShots: 10, maxShots: 10 });
    expect(Object.isFrozen(ok)).toBe(true);
  });

  it("createPointSampler rejects p ∉ [0, 1] and a bad seed", () => {
    expect(() =>
      createPointSampler(code3, 1.1, 1, VALIDATION_STOP_RULE),
    ).toThrow(RangeError);
    expect(() =>
      createPointSampler(code3, -0.1, 1, VALIDATION_STOP_RULE),
    ).toThrow(RangeError);
    expect(() =>
      createPointSampler(code3, 0.1, -1, VALIDATION_STOP_RULE),
    ).toThrow(RangeError);
    expect(() =>
      createPointSampler(code3, 0.1, 1, {
        minFailures: 2,
        minShots: 2,
        maxShots: 1,
      }),
    ).toThrow(RangeError);
  });
});

// T-A7: fast-check over the rule (random seed, so each run explores new cases).
describe("the stop reason is exactly one of the D1 conditions and none fired earlier", () => {
  it("50 random small rules at d = 3", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 1, max: 300 }),
        fc.integer({ min: 0, max: 300 }),
        fc.constantFrom(0.05, 0.1, 0.2),
        fc.integer({ min: 0, max: 2 ** 31 }),
        (minFailures, minShots, extra, p, seed) => {
          const rule = { minFailures, minShots, maxShots: minShots + extra };
          const e = estimatePoint(code3, p, seed, rule);
          const bits = replay(3, p, seed, e.shots);
          let k = 0;
          for (let i = 0; i < e.shots; i++) {
            const n = i + 1;
            if (bits[i] !== 0) k++;
            const byShots = n === minShots && k >= minFailures;
            const byFailures =
              n > minShots && k === minFailures && bits[i] !== 0;
            if (n < e.shots) {
              // Nothing fired before the stop.
              expect(byShots).toBe(false);
              expect(byFailures).toBe(false);
              expect(n).toBeLessThan(rule.maxShots);
            } else {
              const byCap = n === rule.maxShots && !byShots && !byFailures;
              const fired = [byShots, byFailures, byCap].filter(Boolean);
              expect(fired).toHaveLength(1);
              const expected = byShots
                ? "shots"
                : byFailures
                  ? "failures"
                  : "cap";
              expect(e.stopReason).toBe(expected);
              expect(e.failures).toBe(k);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// T-A6 (phase2.md D2): the model is an optional last parameter.
describe("ModelSpec: optional model, phenomenological context, same stop rule", () => {
  const rule: StopRule = { minFailures: 2, minShots: 10_000, maxShots: 10_000 };

  it("no model ≡ INDEPENDENT_MODEL: same tally after 10⁴ shots, ctx is a ShotContext, model recorded", () => {
    const a = createPointSampler(code3, 0.1, 5, rule);
    const b = createPointSampler(code3, 0.1, 5, rule, INDEPENDENT_MODEL);
    expect(a.model).toBe(INDEPENDENT_MODEL);
    expect(b.model).toBe(INDEPENDENT_MODEL);
    expect(a.ctx.noise.kind).toBe("independent");
    expect("error" in a.ctx).toBe(true);
    expect(step(a, 10_000)).toBe("shots");
    expect(step(b, 10_000)).toBe("shots");
    expect(a.tally).toEqual(b.tally);
    expect(a.tally.failures).toBeGreaterThan(0);
  });

  it("PHENOMENOLOGICAL_MODEL: ctx is a SpacetimeShotContext with cycles = d; {cycles: 2} is respected", () => {
    for (const d of [3, 5]) {
      const code = rotatedSurfaceCode(d);
      const s = createPointSampler(code, 0.02, 1, rule, PHENOMENOLOGICAL_MODEL);
      expect(s.model).toBe(PHENOMENOLOGICAL_MODEL);
      expect(s.ctx.noise.kind).toBe("phenomenological");
      if (s.ctx.noise.kind !== "phenomenological") throw new Error("narrow");
      expect(s.ctx.noise.cycles).toBe(d);
      expect(s.ctx.noise.q).toBe(0.02);
      const ctx = s.ctx;
      expect("cumulative" in ctx).toBe(true);
      expect("error" in ctx).toBe(false);
      if (!("detectors" in ctx)) throw new Error("narrow");
      expect(ctx.detectors.Z.length).toBe(((d * d - 1) / 2) * (d + 1));
    }
    const two = createPointSampler(code3, 0.02, 1, rule, {
      kind: "phenomenological",
      cycles: 2,
    });
    expect(two.ctx.noise.kind).toBe("phenomenological");
    if (two.ctx.noise.kind !== "phenomenological") throw new Error("narrow");
    expect(two.ctx.noise.cycles).toBe(2);
    expect(() =>
      createPointSampler(code3, 0.02, 1, rule, {
        kind: "phenomenological",
        cycles: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createPointSampler(code3, 0.02, 1, rule, {
        kind: "phenomenological",
        cycles: 1.5,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createPointSampler(code3, 1.5, 1, rule, PHENOMENOLOGICAL_MODEL),
    ).toThrow(RangeError);
  });

  it("step stops at the exact shot in 3D too: replay of runSpacetimeShot on a twin context (stop by failures)", () => {
    // p = 0.01: P_L ≈ 0.02 (M3), so the 10th failure lands well past minShots.
    const p = 0.01;
    const r: StopRule = { minFailures: 10, minShots: 50, maxShots: 100_000 };
    const sampler = createPointSampler(code3, p, 31, r, PHENOMENOLOGICAL_MODEL);
    const reason = step(sampler, r.maxShots);
    expect(reason).toBe("failures");
    const twin = createSpacetimeShotContext(
      code3,
      phenomenologicalNoise(p, 3),
      createRng(31),
    );
    let k = 0;
    let n = 0;
    while (true) {
      const bits = runSpacetimeShot(twin);
      n++;
      if (bits !== 0) k++;
      if (n >= r.minShots && k >= r.minFailures) break;
    }
    expect(sampler.tally.shots).toBe(n);
    expect(sampler.tally.failures).toBe(k);
    expect(k).toBe(10);
    const e = estimate(sampler);
    expect(e.estimate).toBe(9 / (n - 1));
  });

  it("estimatePoint with PHENOMENOLOGICAL_MODEL at d = 3, p = 0.02 is deterministic between two calls and lower than the 2D rate at the same p", () => {
    const small: StopRule = {
      minFailures: 2,
      minShots: 20_000,
      maxShots: 20_000,
    };
    const a = estimatePoint(code3, 0.02, 2026, small, PHENOMENOLOGICAL_MODEL);
    const b = estimatePoint(code3, 0.02, 2026, small, PHENOMENOLOGICAL_MODEL);
    expect(a).toEqual(b);
    expect(a.shots).toBe(20_000);
    expect(a.stopReason).toBe("shots");
    expect(a.failures).toBeGreaterThan(0);
    expect(a.d).toBe(3);
    // Measurement flips over 3 cycles make the model HARDER than 2D at the
    // same p (M3: P_L ≈ 0.072 at p = 0.02 vs ≈ 0.0135 exact in 2D).
    const twoD = estimatePoint(code3, 0.02, 2026, small);
    expect(a.estimate).toBeGreaterThan(twoD.estimate * 2);
    expect(a.estimate).toBeGreaterThan(0.05);
    expect(a.estimate).toBeLessThan(0.1);
  });
});
