import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exactMatchingWeight } from "../../src/core/decoder/oracle";
import {
  commutes,
  createDecoder,
  createSpacetimeDecoder,
  decodeSpacetime,
  exactLogicalRates,
  exactSpacetimeRates,
  identity,
  rotatedSurfaceCode,
  VALIDATION_STOP_RULE,
  wilsonInterval,
  type StabilizerType,
} from "../../src/core/index";
import {
  buildReport as buildReportStrict,
  checkConsistency,
  checkGrid,
  checkMetadata,
  checkMinWeights,
  checkVerdicts,
  compareFiles,
  crossings,
  exactCheck,
  exactCountsD3,
  exactProbeCheck,
  fixtureShapeReasons,
  exactSpacetimeCountsD3,
  MAX_ABS_Z,
  MAX_PARITY_MISMATCHES,
  renderDocument,
  renderDocuments,
  renderTable,
  SUM_Z2_LIMIT_EXACT,
  SUM_Z2_LIMIT_GRID,
  SUM_Z2_LIMIT_PROBE,
  zScore,
} from "../../tools/validate/compare";
import {
  asValidationFile,
  coreMetadata,
  coreWeightsBlock,
  FIXTURE_CASES,
  readMinWeightsFixture,
  readValidationFile,
  readVerdictsFixture,
  VALIDATION_GRID,
  VALIDATION_GRID_PHENOMENOLOGICAL,
  type ExactProbe,
  type GeometryEntry,
  type MinWeightsFixture,
  type ValidationFile,
  type ValidationPoint,
  type VerdictsFixture,
} from "../../tools/validate/format";

// The report judges the fixtures' shape by default (FIXTURE_CASES cases of the
// model's kind: the CLI path). These unit tests build small synthetic fixtures
// on purpose, so they switch that gate off; the gate itself is tested apart
// (T-C11 "fixture shape is a gate") through buildReportStrict.
const buildReport = (
  ...[reference, browser, minWeights, counts, verdicts = null]: Parameters<
    typeof buildReportStrict
  >
) =>
  buildReportStrict(reference, browser, minWeights, counts, verdicts, {
    fixtureShape: false,
  });

// ---------------------------------------------------------------------------
// Synthetic fixtures (tasks/plans/validation.md §4 «compare.test.ts»)

const SHOTS = 100_000;

/**
 * A self-consistent point (what checkConsistency demands of a real file): failures =
 * round(rate · shots), estimate = failures/shots, Wilson on (k, N) and on the X/Z halves.
 */
function makePoint(
  d: number,
  p: number,
  rate: number,
  shots = SHOTS,
): ValidationPoint {
  const failures = Math.round(rate * shots);
  const { low, high } = wilsonInterval(failures, shots);
  const half = Math.round(failures / 2);
  const x = wilsonInterval(half, shots);
  const z = wilsonInterval(failures - half, shots);
  return {
    d,
    p,
    shots,
    failures,
    failuresX: half,
    failuresZ: failures - half,
    estimate: failures / shots,
    low,
    high,
    estimateX: half / shots,
    lowX: x.low,
    highX: x.high,
    estimateZ: (failures - half) / shots,
    lowZ: z.low,
    highZ: z.high,
    stopReason: "shots",
    upperBoundOnly: failures === 0,
  };
}

/** The same point rebuilt from its integer failures: consistent again after a shift of the estimate. */
function rounded(pt: ValidationPoint): ValidationPoint {
  return makePoint(pt.d, pt.p, pt.failures / pt.shots, pt.shots);
}

/** Smooth default curves with a crossing near p ≈ 0.095–0.105: P_L = exp(a_d + b_d·p). */
const CURVE: Record<number, [number, number]> = {
  3: [-4, 10],
  5: [-4.475, 15],
  7: [-5, 20],
};

function curveRate(d: number, p: number): number {
  const [a, b] = CURVE[d]!;
  return Math.exp(a + b * p);
}

function makeFile(
  rate: (d: number, p: number) => number = curveRate,
  overrides: Partial<ValidationFile> = {},
): ValidationFile {
  const points: ValidationPoint[] = [];
  for (const d of VALIDATION_GRID.distances) {
    for (const p of VALIDATION_GRID.probabilities) {
      points.push(makePoint(d, p, rate(d, p)));
    }
  }
  return {
    schema: 1,
    generator: "test",
    engine: { name: "test" },
    noise: "independent",
    stopRule: VALIDATION_STOP_RULE,
    seed: 1,
    ...coreMetadata(),
    points,
    ...overrides,
  };
}

function withPoint(
  file: ValidationFile,
  d: number,
  p: number,
  replace: (pt: ValidationPoint) => ValidationPoint,
): ValidationFile {
  return {
    ...file,
    points: file.points.map((pt) =>
      pt.d === d && pt.p === p ? replace(pt) : pt,
    ),
  };
}

/** The point whose estimate sits exactly z = target from `ref` (bisection on zScore; keeps n). */
function shiftedToZ(ref: ValidationPoint, target: number): ValidationPoint {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const z = zScore(ref, { ...ref, estimate: mid });
    if (z < target) lo = mid;
    else hi = mid;
  }
  const estimate = (lo + hi) / 2;
  return { ...ref, estimate, failures: Math.round(estimate * ref.shots) };
}

function minWeightsFixture(): MinWeightsFixture {
  const cases: { d: number; type: StabilizerType; defects: number[] }[] = [
    { d: 3, type: "Z", defects: [0, 3] },
    { d: 3, type: "X", defects: [1] },
    { d: 3, type: "Z", defects: [0, 1, 2, 3] },
  ];
  return {
    schema: 1,
    generator: "test",
    pymatching: "2.4.0",
    weights: coreWeightsBlock(),
    cases: cases.map((c) => ({
      ...c,
      weight: exactMatchingWeight(
        createDecoder(rotatedSurfaceCode(c.d), c.type).graph,
        c.defects,
      ),
    })),
  };
}

const COUNTS = exactCountsD3();

// ---------------------------------------------------------------------------

describe("T-C1 identical files pass", () => {
  it("every z = 0, Σz² = 0, pass, no reasons", () => {
    const f = makeFile();
    const r = compareFiles(f, f);
    expect(r.points).toHaveLength(24);
    expect(r.points.every((c) => c.z === 0)).toBe(true);
    expect(r.sumZ2).toBe(0);
    expect(r.maxAbsZ).toBe(0);
    expect(r.pass).toBe(true);
    expect(r.reasons).toEqual([]);
  });
});

describe("T-C2 one point at 4σ fails by point", () => {
  it("names d = 7, p = 0.03 and maxAbsZ ≈ 4", () => {
    const ref = makeFile();
    const ts = withPoint(ref, 7, 0.03, (pt) => shiftedToZ(pt, 4));
    const r = compareFiles(ref, ts);
    expect(r.maxAbsZ).toBeCloseTo(4, 6);
    expect(r.pass).toBe(false);
    expect(r.reasons.some((s) => s.includes("d = 7, p = 0.03"))).toBe(true);
    // Only the shifted point moved; the other 23 are still z = 0.
    expect(r.points.filter((c) => c.z !== 0)).toHaveLength(1);
    // Negative direction too: the gate is on |z|.
    const down = withPoint(ref, 7, 0.03, (pt) => shiftedToZ(pt, -4));
    expect(compareFiles(ref, down).pass).toBe(false);
  });
});

describe("T-C3 all points at 1.5σ: by point passes, global fails", () => {
  it("Σz² = 54 > 43 fails; at 1.3σ Σz² = 40.56 passes (and would with 48 too)", () => {
    const ref = makeFile();
    const at = (z: number): ValidationFile => ({
      ...ref,
      points: ref.points.map((pt) => shiftedToZ(pt, z)),
    });
    const r15 = compareFiles(ref, at(1.5));
    expect(r15.maxAbsZ).toBeCloseTo(1.5, 6);
    expect(r15.sumZ2).toBeCloseTo(54, 4);
    expect(r15.pass).toBe(false);
    expect(r15.reasons).toHaveLength(1);
    expect(r15.reasons[0]).toContain("Σz²");
    expect(SUM_Z2_LIMIT_GRID).toBe(43);
    const r13 = compareFiles(ref, at(1.3));
    expect(r13.sumZ2).toBeCloseTo(24 * 1.69, 4);
    expect(r13.pass).toBe(true);
    // A looser mutant threshold of 48 would still fail 54 but the gate is 43: pinned by value.
    expect(r15.sumZ2).toBeGreaterThan(48);
    expect(r13.sumZ2).toBeLessThan(43);
  });
});

describe("T-C4 edge cases of z", () => {
  const base = makePoint(7, 0.03, 0.005);

  it("both files with zero failures → z = 0", () => {
    const zero = makePoint(7, 0.03, 0);
    expect(zero.failures).toBe(0);
    expect(zScore(zero, zero)).toBe(0);
  });

  it("one file with zero failures → finite, sign of (TS − ref)", () => {
    const zero = makePoint(7, 0.03, 0);
    const zPos = zScore(zero, base);
    expect(Number.isFinite(zPos)).toBe(true);
    expect(zPos).toBeGreaterThan(0);
    const zNeg = zScore(base, zero);
    expect(Number.isFinite(zNeg)).toBe(true);
    expect(zNeg).toBeLessThan(0);
    // σ comes from the non-zero side only: |z| = p̂ / √(p̂(1−p̂)/n).
    const sigma = Math.sqrt((base.estimate * (1 - base.estimate)) / base.shots);
    expect(Math.abs(zPos)).toBeCloseTo(base.estimate / sigma, 9);
  });

  it("each file uses its own n: equal estimates → z = 0; 0.101 vs 0.1 by hand", () => {
    const a = makePoint(3, 0.1, 0.1, 100_000);
    const b = makePoint(3, 0.1, 0.1, 10_000);
    expect(zScore(a, b)).toBe(0);
    const c = makePoint(3, 0.1, 0.101, 100_000);
    const sigmaA2 = (0.1 * 0.9) / 10_000;
    const sigmaC2 = (0.101 * 0.899) / 100_000;
    const expected = 0.001 / Math.sqrt(sigmaA2 + sigmaC2);
    expect(zScore(b, c)).toBeCloseTo(expected, 9);
    expect(zScore(c, b)).toBeCloseTo(-expected, 9);
    // Mutant «n of one file for both»: 0.001/√(2·σ²(0.101, 10⁵)) is √5.5 times larger.
    const wrong = 0.001 / Math.sqrt(2 * sigmaC2);
    expect(wrong / zScore(b, c)).toBeGreaterThan(2);
  });
});

describe("T-C5 different grids or missing points fail with a reason, not an exception", () => {
  it("23 points", () => {
    const ref = makeFile();
    const ts = { ...ref, points: ref.points.slice(0, 23) };
    const r = compareFiles(ref, ts);
    expect(r.pass).toBe(false);
    expect(r.reasons.some((s) => s.includes("23 puntos"))).toBe(true);
    expect(r.points).toHaveLength(23);
  });

  it("a point off the grid (p = 0.04 instead of 0.03) and a reordered grid", () => {
    const ref = makeFile();
    const off = withPoint(ref, 3, 0.03, (pt) => ({ ...pt, p: 0.04 }));
    const r = compareFiles(ref, off);
    expect(r.pass).toBe(false);
    expect(r.reasons.some((s) => s.includes("p = 0.04"))).toBe(true);
    const reordered = { ...ref, points: [...ref.points].reverse() };
    expect(checkGrid(reordered, "x").length).toBeGreaterThan(0);
    expect(compareFiles(ref, reordered).pass).toBe(false);
    expect(checkGrid(ref, "x")).toEqual([]);
  });
});

describe("T-C6 checkMetadata detects the mirror image and other weights", () => {
  it("the core's own metadata passes", () => {
    expect(checkMetadata(makeFile())).toEqual([]);
  });

  it("transposed geometry of d = 3 → reason «geometry d = 3»", () => {
    const f = makeFile();
    const transposed: GeometryEntry[] = f.geometry["3"]!.map(
      ([t, i, j]): GeometryEntry => [t, j, i],
    );
    const reasons = checkMetadata({
      ...f,
      geometry: { ...f.geometry, "3": transposed },
    });
    expect(reasons.some((s) => s.startsWith("geometry d = 3"))).toBe(true);
    // Swapping the types alone (X boundaries left/right) is also caught.
    const swapped: GeometryEntry[] = f.geometry["5"]!.map(
      ([t, i, j]): GeometryEntry => [t === "X" ? "Z" : "X", i, j],
    );
    expect(
      checkMetadata({ ...f, geometry: { ...f.geometry, "5": swapped } }).some(
        (s) => s.startsWith("geometry d = 5"),
      ),
    ).toBe(true);
  });

  it("seed, scale, epsilonDenominator, maxEdgeWeight, sample and stop rule, one reason each", () => {
    const f = makeFile();
    expect(
      checkMetadata({
        ...f,
        weights: { ...f.weights, seed: "0x53594E45" },
      }).some((s) => s.includes("weights.seed")),
    ).toBe(true);
    // Case of the hex digits is not a difference (Python writes it upper-case too).
    expect(
      checkMetadata({
        ...f,
        weights: { ...f.weights, seed: f.weights.seed.toLowerCase() },
      }),
    ).toEqual([]);
    for (const key of [
      "scale",
      "epsilonDenominator",
      "maxEdgeWeight",
    ] as const) {
      const reasons = checkMetadata({
        ...f,
        weights: { ...f.weights, [key]: f.weights[key] + 1 },
      });
      expect(reasons, key).toHaveLength(1);
      expect(reasons[0]).toContain(`weights.${key}`);
    }
    const sample = { ...f.weights.sample, "0": f.weights.sample["0"]! + 1 };
    expect(
      checkMetadata({ ...f, weights: { ...f.weights, sample } }).some((s) =>
        s.includes("weights.sample[0]"),
      ),
    ).toBe(true);
    expect(
      checkMetadata({
        ...f,
        stopRule: { ...f.stopRule, minShots: 10_000 },
      }).some((s) => s.includes("stopRule.minShots")),
    ).toBe(true);
    const missing = { ...f.weights.sample };
    delete missing["120"];
    expect(
      checkMetadata({
        ...f,
        weights: { ...f.weights, sample: missing },
      }).some((s) => s.includes("weights.sample cubre")),
    ).toBe(true);
  });
});

describe("T-C7 exactCheck against the exact d = 3 curve", () => {
  it("d = 3 points equal to the exact values pass; P_X instead of P_L gives z ≈ −27", () => {
    const exact = (d: number, p: number): number =>
      d === 3
        ? exactLogicalRates(COUNTS.Z, COUNTS.X, 9, p).either
        : curveRate(d, p);
    const good = exactCheck(makeFile(exact), COUNTS);
    expect(good.points).toHaveLength(8);
    expect(good.maxAbsZ).toBeLessThan(0.05); // rounding of failures only
    expect(good.pass).toBe(true);
    expect(SUM_Z2_LIMIT_EXACT).toBe(20.1);
    const ignoresZ = (d: number, p: number): number =>
      d === 3 ? exactLogicalRates(COUNTS.Z, COUNTS.X, 9, p).x : curveRate(d, p);
    const bad = exactCheck(makeFile(ignoresZ), COUNTS);
    const at003 = bad.points.find((pt) => pt.p === 0.03)!;
    expect(at003.z).toBeLessThan(-20);
    expect(at003.z).toBeGreaterThan(-35);
    expect(bad.pass).toBe(false);
    expect(bad.reasons.some((s) => s.includes("p = 0.03"))).toBe(true);
  });

  it("a file without d = 3 points fails", () => {
    const f = makeFile();
    const r = exactCheck(
      { ...f, points: f.points.filter((pt) => pt.d !== 3) },
      COUNTS,
    );
    expect(r.pass).toBe(false);
    expect(r.points).toHaveLength(0);
  });

  it("the 8 points of d = 3 at ≈ 2σ above the exact value pass by point and fail by Σz² ≈ 32", () => {
    // σ under the hypothesis: √(P(1 − P)/n) with the exact P, as exactCheck computes it.
    const twoSigmaUp = (d: number, p: number): number => {
      if (d !== 3) return curveRate(d, p);
      const P = exactLogicalRates(COUNTS.Z, COUNTS.X, 9, p).either;
      return P + 2 * Math.sqrt((P * (1 - P)) / SHOTS);
    };
    const r = exactCheck(makeFile(twoSigmaUp), COUNTS);
    expect(r.points).toHaveLength(8);
    for (const pt of r.points) {
      expect(pt.z).toBeGreaterThan(1.9);
      expect(pt.z).toBeLessThan(2.1);
    }
    expect(r.maxAbsZ).toBeLessThanOrEqual(MAX_ABS_Z);
    expect(r.sumZ2).toBeGreaterThan(30);
    expect(r.sumZ2).toBeLessThan(34);
    expect(r.pass).toBe(false);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0]).toContain("Σz²");
    expect(r.reasons[0]).toContain("8 g.l.");
    // At ≈ 1.5σ (Σz² ≈ 18) the same construction passes: the limit is 20.1, not lower.
    const oneAndAHalf = (d: number, p: number): number => {
      if (d !== 3) return curveRate(d, p);
      const P = exactLogicalRates(COUNTS.Z, COUNTS.X, 9, p).either;
      return P + 1.5 * Math.sqrt((P * (1 - P)) / SHOTS);
    };
    const ok = exactCheck(makeFile(oneAndAHalf), COUNTS);
    expect(ok.sumZ2).toBeGreaterThan(16);
    expect(ok.sumZ2).toBeLessThan(20.1);
    expect(ok.pass).toBe(true);
  });
});

describe("T-C8 crossings by linear interpolation of ln P_L", () => {
  it("analytic crossings at 0.095 (3, 5) and 0.105 (5, 7) within 10⁻⁹ of the bracket", () => {
    // Exact rates, not rounded to integer failures: the interpolation is then exact.
    const f = makeFile();
    const exactPoints = f.points.map((pt) => ({
      ...pt,
      estimate: curveRate(pt.d, pt.p),
    }));
    const [c35, c37, c57] = crossings({ ...f, points: exactPoints });
    expect(c37!.pair).toEqual([3, 7]);
    expect(c37!.inverted).toBe(false);
    expect(c35!.pair).toEqual([3, 5]);
    expect(c35!.pCross).toBeCloseTo(0.095, 9);
    expect(c35!.bracket).toEqual([0.09, 0.1]);
    expect(c35!.inverted).toBe(false);
    expect(c35!.note).toBe("cruce único");
    expect(c57!.pair).toEqual([5, 7]);
    expect(c57!.pCross).toBeCloseTo(0.105, 9);
    expect(c57!.bracket).toEqual([0.1, 0.11]);
    expect(c57!.inverted).toBe(false);
  });

  it("inverted curves (d = 7 fails most below threshold) → the same p*, reported as «cruce invertido»", () => {
    const swap: Record<number, number> = { 3: 7, 5: 5, 7: 3 };
    const f = makeFile();
    const swapped = f.points.map((pt) => ({
      ...pt,
      estimate: curveRate(swap[pt.d]!, pt.p),
    }));
    const [c35, , c57] = crossings({ ...f, points: swapped });
    // (3, 5) now holds the curves of 7 and 5: their crossing is at 0.105, ascending.
    expect(c35!.pCross).toBeCloseTo(0.105, 9);
    expect(c35!.bracket).toEqual([0.1, 0.11]);
    expect(c35!.inverted).toBe(true);
    expect(c35!.note).toContain("invertido");
    expect(c57!.pCross).toBeCloseTo(0.095, 9);
    expect(c57!.inverted).toBe(true);
  });

  it("several sign changes → the FIRST in p is reported, with the count", () => {
    // ln p̂_3 = −2 everywhere; ln p̂_5 = −2 − Δ with Δ = [+1, −1, +1, +1, −1, −1, −1, −1]:
    // crossings at i = 0 (descending), 1 (inverted) and 3 (descending).
    const delta = [1, -1, 1, 1, -1, -1, -1, -1];
    const f = makeFile();
    const points = f.points.map((pt) => {
      const i = VALIDATION_GRID.probabilities.indexOf(
        pt.p as (typeof VALIDATION_GRID.probabilities)[number],
      );
      const ln = pt.d === 3 ? -2 : pt.d === 5 ? -2 - delta[i]! : -3;
      return { ...pt, estimate: Math.exp(ln) };
    });
    const [c35] = crossings({ ...f, points });
    // First change between 0.03 and 0.05: p* = 0.03 + 1 · 0.02 / (1 − (−1)) = 0.04.
    expect(c35!.pCross).toBeCloseTo(0.04, 9);
    expect(c35!.bracket).toEqual([0.03, 0.05]);
    expect(c35!.inverted).toBe(false);
    expect(c35!.note).toContain("cruces múltiples (3");
    expect(c35!.note).toContain("se informa el primero");
    // The last one (i = 3, bracket [0.09, 0.10]) is NOT what is reported.
    expect(c35!.bracket).not.toEqual([0.09, 0.1]);
  });

  it("parallel curves → no crossing; an estimate of 0 → not estimable", () => {
    const parallel = makeFile((d, p) => Math.exp(-4 - 0.2 * d + 10 * p));
    for (const c of crossings(parallel)) {
      expect(c.pCross).toBeNull();
      expect(c.bracket).toBeNull();
      expect(c.note).toContain("sin cruce");
    }
    const zero = withPoint(makeFile(), 7, 0.03, () => makePoint(7, 0.03, 0));
    const [c35, , c57] = crossings(zero);
    expect(c35!.pCross).not.toBeNull();
    expect(c57!.pCross).toBeNull();
    expect(c57!.inverted).toBe(false);
    expect(c57!.note).toContain("no estimable");
  });
});

describe("T-C11 checkConsistency: every point agrees with its own counts (R8)", () => {
  it("the synthetic file and a point with zero failures pass", () => {
    expect(checkConsistency(makeFile())).toEqual([]);
    // Zero failures can only come from the cap: maxShots shots, stopReason "cap".
    const zero = withPoint(makeFile(), 7, 0.03, () => ({
      ...makePoint(7, 0.03, 0, VALIDATION_STOP_RULE.maxShots),
      stopReason: "cap",
    }));
    expect(zero.points.find((pt) => pt.d === 7)!.upperBoundOnly).toBe(true);
    expect(checkConsistency(zero)).toEqual([]);
    // A stop by failures: Haldane's estimate and the proportional X/Z split.
    const k = 150;
    const n = 123_456;
    const estimate = (k - 1) / (n - 1);
    const byFailures: ValidationPoint = {
      ...makePoint(7, 0.03, 0),
      shots: n,
      failures: k,
      failuresX: 100,
      failuresZ: 60,
      estimate,
      ...wilsonInterval(k, n),
      estimateX: (estimate * 100) / k,
      lowX: wilsonInterval(100, n).low,
      highX: wilsonInterval(100, n).high,
      estimateZ: (estimate * 60) / k,
      lowZ: wilsonInterval(60, n).low,
      highZ: wilsonInterval(60, n).high,
      stopReason: "failures",
      upperBoundOnly: false,
    };
    const f = withPoint(makeFile(), 7, 0.03, () => byFailures);
    expect(checkConsistency(f)).toEqual([]);
    // The same point with k/N instead of Haldane's is caught.
    expect(
      checkConsistency(
        withPoint(f, 7, 0.03, (pt) => ({ ...pt, estimate: k / n })),
      ),
    ).toHaveLength(1);
  });

  it("an edited count, rate, interval or flag names the point and the field", () => {
    const f = makeFile();
    const cases: [string, (pt: ValidationPoint) => ValidationPoint][] = [
      ["estimate", (pt) => ({ ...pt, failures: pt.failures + 1 })],
      ["low", (pt) => ({ ...pt, low: pt.low * 0.99 })],
      ["high", (pt) => ({ ...pt, high: pt.high * 1.01 })],
      ["estimateX", (pt) => ({ ...pt, estimateX: pt.estimateX + 1e-6 })],
      ["lowX", (pt) => ({ ...pt, lowX: pt.lowZ })],
      ["highZ", (pt) => ({ ...pt, highZ: pt.highX })],
      ["upperBoundOnly", (pt) => ({ ...pt, upperBoundOnly: true })],
    ];
    for (const [field, mutate] of cases) {
      const reasons = checkConsistency(withPoint(f, 5, 0.07, mutate));
      expect(reasons.length, field).toBeGreaterThan(0);
      expect(
        reasons.every((s) => s.includes("d = 5, p = 0.07")),
        field,
      ).toBe(true);
      expect(
        reasons.some((s) => s.includes(field)),
        field,
      ).toBe(true);
    }
    // Odd failures: lowZ copied from lowX (the old synthetic fixture did this) is a reason.
    const odd = withPoint(f, 3, 0.03, (pt) => ({
      ...pt,
      failures: 2001,
      estimate: 2001 / pt.shots,
      ...wilsonInterval(2001, pt.shots),
      failuresX: 1001,
      failuresZ: 1000,
      estimateX: 1001 / pt.shots,
      lowX: wilsonInterval(1001, pt.shots).low,
      highX: wilsonInterval(1001, pt.shots).high,
      estimateZ: 1000 / pt.shots,
      lowZ: wilsonInterval(1001, pt.shots).low,
      highZ: wilsonInterval(1000, pt.shots).high,
    }));
    const reasons = checkConsistency(odd);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("lowZ");
    // More type failures than failures: one reason, no exception. Each side alone.
    const overX = withPoint(f, 3, 0.03, (pt) => ({
      ...pt,
      failuresX: pt.failures + 1,
    }));
    expect(checkConsistency(overX)).toHaveLength(1);
    expect(checkConsistency(overX)[0]).toContain("failuresX");
    const overZ = withPoint(f, 3, 0.03, (pt) => ({
      ...pt,
      failuresZ: pt.failures + 1,
    }));
    expect(checkConsistency(overZ)).toHaveLength(1);
    expect(checkConsistency(overZ)[0]).toContain("failuresZ");
    expect(checkConsistency(overZ)[0]).toContain("d = 3, p = 0.03");
  });

  it("failuresX + failuresZ < failures (a logical failure is X, Z or both) is a reason", () => {
    const f = makeFile();
    const pt0 = f.points.find((pt) => pt.d === 5 && pt.p === 0.05)!;
    // Both halves consistent with their own Wilson intervals, but they do not add up.
    const under = withPoint(f, 5, 0.05, (pt) => ({
      ...pt,
      failuresX: pt.failuresX - 1,
      estimateX: (pt.failuresX - 1) / pt.shots,
      lowX: wilsonInterval(pt.failuresX - 1, pt.shots).low,
      highX: wilsonInterval(pt.failuresX - 1, pt.shots).high,
    }));
    const reasons = checkConsistency(under);
    // The other fields are still checked (no early exit): here they are consistent.
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("failuresX + failuresZ");
    expect(reasons[0]).toContain(`< failures = ${pt0.failures}`);
    expect(reasons[0]).toContain("d = 5, p = 0.05");
  });

  it("(shots, failures, stopReason) must obey the stop rule the file declares", () => {
    const f = makeFile();
    const rule = f.stopRule;
    // A point stopped for the given reason, self-consistent in every other field
    // (Haldane's estimate and the proportional X/Z split after a stop by failures).
    const stopped = (
      shots: number,
      failures: number,
      stopReason: ValidationPoint["stopReason"],
    ): ValidationFile => {
      const base = makePoint(7, 0.03, failures / shots, shots);
      if (stopReason !== "failures") {
        return withPoint(f, 7, 0.03, () => ({ ...base, stopReason }));
      }
      const estimate = (base.failures - 1) / (base.shots - 1);
      return withPoint(f, 7, 0.03, () => ({
        ...base,
        estimate,
        estimateX: (estimate * base.failuresX) / base.failures,
        estimateZ: (estimate * base.failuresZ) / base.failures,
        stopReason,
      }));
    };
    // The rule read from the file, not from the core: a file with another rule is
    // judged by its own numbers.
    const other: ValidationFile = {
      ...f,
      stopRule: { minFailures: 10, minShots: 1000, maxShots: 5000 },
      points: f.points.map((pt) => makePoint(pt.d, pt.p, 0.05, 1000)),
    };
    expect(checkConsistency(other)).toEqual([]);
    expect(
      checkConsistency({
        ...other,
        stopRule: { minFailures: 10, minShots: 2000, maxShots: 5000 },
      }),
    ).toHaveLength(24);
    // "shots" / "failures": at least minShots shots and minFailures failures.
    expect(
      checkConsistency(stopped(rule.minShots, rule.minFailures, "shots")),
    ).toEqual([]);
    expect(
      checkConsistency(
        stopped(rule.minShots + 1, rule.minFailures, "failures"),
      ),
    ).toEqual([]);
    for (const reason of ["shots", "failures"] as const) {
      const fewShots = checkConsistency(
        stopped(rule.minShots - 1, rule.minFailures, reason),
      );
      expect(fewShots, reason).toHaveLength(1);
      expect(fewShots[0]).toContain(`stopReason = "${reason}"`);
      expect(fewShots[0]).toContain(`≥ ${rule.minShots} tiradas`);
      const fewFailures = checkConsistency(
        stopped(rule.minShots, rule.minFailures - 1, reason),
      );
      expect(fewFailures, reason).toHaveLength(1);
      expect(fewFailures[0]).toContain(`≥ ${rule.minFailures} fallos`);
      // The rule never lets a point run past maxShots: a coherent point with
      // twice the cap is a forgery, not a stop.
      const pastCap = checkConsistency(
        stopped(2 * rule.maxShots, 2 * rule.minFailures, reason),
      );
      expect(pastCap, reason).toHaveLength(1);
      expect(pastCap[0]).toContain(`≤ ${rule.maxShots} tiradas`);
    }
    // "cap": exactly maxShots shots, whatever the failures.
    expect(checkConsistency(stopped(rule.maxShots, 3, "cap"))).toEqual([]);
    const notCap = checkConsistency(stopped(rule.maxShots - 1, 3, "cap"));
    expect(notCap).toHaveLength(1);
    expect(notCap[0]).toContain(`stopReason = "cap"`);
    expect(notCap[0]).toContain(`${rule.maxShots}`);
    // "budget" never appears in a validation file.
    const budget = checkConsistency(
      stopped(rule.minShots, rule.minFailures, "budget"),
    );
    expect(budget).toHaveLength(1);
    expect(budget[0]).toContain(`stopReason = "budget"`);
    expect(budget[0]).toContain("d = 7, p = 0.03");
  });
});

describe("T-C9 checkMinWeights", () => {
  it("oracle weights → 0 mismatches; one weight off by 1 → one mismatch with expected/got", () => {
    const fixture = minWeightsFixture();
    const ok = checkMinWeights(fixture);
    expect(ok.total).toBe(3);
    expect(ok.mismatches).toEqual([]);
    expect(ok.reasons).toEqual([]);
    const broken: MinWeightsFixture = {
      ...fixture,
      cases: fixture.cases.map((c, i) =>
        i === 1 ? { ...c, weight: c.weight + 1 } : c,
      ),
    };
    const bad = checkMinWeights(broken);
    expect(bad.mismatches).toHaveLength(1);
    expect(bad.mismatches[0]!.expected).toBe(fixture.cases[1]!.weight + 1);
    expect(bad.mismatches[0]!.got).toBe(fixture.cases[1]!.weight);
    expect(bad.mismatches[0]!.d).toBe(3);
    expect(bad.mismatches[0]!.type).toBe("X");
    const otherWeights: MinWeightsFixture = {
      ...fixture,
      weights: { ...fixture.weights, scale: 1 },
    };
    expect(checkMinWeights(otherWeights).reasons.length).toBeGreaterThan(0);
  });

  it("weights.seed of the fixture: another seed is a reason naming it; the same seed in lower case is not", () => {
    const fixture = minWeightsFixture();
    const otherSeed = checkMinWeights({
      ...fixture,
      weights: { ...fixture.weights, seed: "0x53594E45" },
    });
    expect(otherSeed.reasons).toHaveLength(1);
    expect(otherSeed.reasons[0]).toContain("weights.seed");
    expect(otherSeed.reasons[0]).toContain("0x53594E45");
    expect(otherSeed.mismatches).toEqual([]);
    const lower = checkMinWeights({
      ...fixture,
      weights: { ...fixture.weights, seed: fixture.weights.seed.toLowerCase() },
    });
    expect(lower.reasons).toEqual([]);
  });
});

describe("T-C10 buildReport, renderTable and renderDocument", () => {
  const date = new Date("2026-10-16T12:34:56.000Z");
  const run = { nodeVersion: "v24.0.0", simulation: null };
  // A reference that passes the exact d = 3 gate: its d = 3 points ARE the exact curve.
  const exactD3 = (d: number, p: number): number =>
    d === 3
      ? exactLogicalRates(COUNTS.Z, COUNTS.X, 9, p).either
      : curveRate(d, p);

  it("a passing report: PASA, the date, 24 rows, the house rule, no points listed", () => {
    const f = makeFile(exactD3);
    const report = buildReport(f, f, minWeightsFixture(), COUNTS);
    // The default curve fails the exact gate of the reference: the gate is real.
    expect(
      buildReport(makeFile(), makeFile(), minWeightsFixture(), COUNTS).pass,
    ).toBe(false);
    expect(report.pass).toBe(true);
    expect(report.reasons).toEqual([]);
    const doc = renderDocument(report, date, run);
    expect(doc).toContain("2026-10-16T12:34:56.000Z");
    expect(doc).toContain("**Veredicto: PASA**");
    expect(doc).not.toContain("FALLA**");
    expect(doc).toContain("Las curvas no se tocan");
    expect(doc).toContain("Ningún punto fuera de tolerancia");
    expect(doc).toContain("| Coherencia interna");
    expect(report.consistencyReference).toEqual([]);
    expect(report.consistencyBrowser).toEqual([]);
    const rows = doc
      .split("\n")
      .filter((line) => /^\| [357] \| 0\.\d\d \|/.test(line));
    expect(rows).toHaveLength(24);
    expect(doc).toContain("--compare-only");
    const table = renderTable(report);
    expect(table).toContain("VEREDICTO: PASA");
    expect(
      table.split("\n").filter((l) => /^ [357] +0\.\d\d /.test(l)),
    ).toHaveLength(24);
  });

  it("a failing report: FALLA and the list of points out of tolerance; timings when simulated", () => {
    const ref = makeFile(exactD3);
    const ts = withPoint(ref, 5, 0.07, (pt) => rounded(shiftedToZ(pt, 3.5)));
    const report = buildReport(ref, ts, minWeightsFixture(), COUNTS);
    expect(report.pass).toBe(false);
    // Only the statistical gate fired: the shifted point is still self-consistent.
    expect(report.consistencyBrowser).toEqual([]);
    expect(report.reasons).toHaveLength(1);
    const doc = renderDocument(report, date, {
      nodeVersion: "v24.0.0",
      simulation: {
        total: 21.5,
        byDistance: { "3": 0.6, "5": 3.8, "7": 17.1 },
      },
    });
    expect(doc).toContain("**Veredicto: FALLA**");
    expect(doc).toContain("Fuera de tolerancia");
    expect(doc).toContain("d = 5, p = 0.07");
    expect(doc).toContain("21.5 s");
    expect(renderTable(report)).toContain("VEREDICTO: FALLA");
    // The exact d = 3 gate of the reference also decides.
    const badRef = withPoint(ref, 3, 0.1, () => makePoint(3, 0.1, 0.5));
    const r2 = buildReport(badRef, ref, minWeightsFixture(), COUNTS);
    expect(r2.pass).toBe(false);
    expect(r2.exactReference).not.toBeNull();
    expect(r2.exactReference!.pass).toBe(false);
    // The independent report has no phenomenological gates.
    expect(r2.exactProbeReference).toBeNull();
    expect(r2.verdicts).toBeNull();
    expect(r2.reasons.some((s) => s.includes("exacto de d = 3"))).toBe(true);
  });

  it("metadata, consistency and minimum weights are gates of the verdict, not only lines of the table", () => {
    const ref = makeFile(exactD3);
    const fixture = minWeightsFixture();
    const ok = buildReport(ref, ref, fixture, COUNTS);
    expect(ok.pass).toBe(true);
    // Transposed geometry of d = 3 in the browser file.
    const transposed: GeometryEntry[] = ref.geometry["3"]!.map(
      ([t, i, j]): GeometryEntry => [t, j, i],
    );
    const mirrored = buildReport(
      ref,
      { ...ref, geometry: { ...ref.geometry, "3": transposed } },
      fixture,
      COUNTS,
    );
    expect(mirrored.metadataBrowser.length).toBeGreaterThan(0);
    expect(mirrored.pass).toBe(false);
    expect(
      mirrored.reasons.some((s) => s.includes("metadatos del núcleo")),
    ).toBe(true);
    // The same in the reference.
    const mirroredRef = buildReport(
      { ...ref, geometry: { ...ref.geometry, "3": transposed } },
      ref,
      fixture,
      COUNTS,
    );
    expect(mirroredRef.pass).toBe(false);
    expect(
      mirroredRef.reasons.some((s) => s.includes("metadatos de la referencia")),
    ).toBe(true);
    // One minimum weight + 1 in the fixture.
    const offByOne: MinWeightsFixture = {
      ...fixture,
      cases: fixture.cases.map((c, i) =>
        i === 0 ? { ...c, weight: c.weight + 1 } : c,
      ),
    };
    const mw = buildReport(ref, ref, offByOne, COUNTS);
    expect(mw.minWeights.mismatches).toHaveLength(1);
    expect(mw.pass).toBe(false);
    expect(mw.reasons.some((s) => s.includes("peso mínimo distinto"))).toBe(
      true,
    );
    // Other weights block in the fixture (mw.reasons, not mismatches).
    const otherScale = buildReport(
      ref,
      ref,
      { ...fixture, weights: { ...fixture.weights, scale: 1 } },
      COUNTS,
    );
    expect(otherScale.minWeights.reasons.length).toBeGreaterThan(0);
    expect(otherScale.pass).toBe(false);
    // An edited count in one file: the consistency gate names the point in the verdict.
    const edited = withPoint(ref, 7, 0.03, (pt) => ({
      ...pt,
      failures: pt.failures + 100,
    }));
    const r = buildReport(ref, edited, fixture, COUNTS);
    expect(r.consistencyBrowser.length).toBeGreaterThan(0);
    expect(r.pass).toBe(false);
    expect(
      r.reasons.some(
        (s) =>
          s.includes("coherencia interna") && s.includes("d = 7, p = 0.03"),
      ),
    ).toBe(true);
    expect(renderTable(r)).toContain("coherencia interna");
    expect(renderDocument(r, date, run)).toContain("d = 7, p = 0.03");
    // The same edited count in the REFERENCE (first argument): its own gate, its own
    // wording in the verdict, and the browser side stays clean.
    const rRef = buildReport(edited, ref, fixture, COUNTS);
    expect(rRef.consistencyReference.length).toBeGreaterThan(0);
    expect(rRef.consistencyBrowser).toEqual([]);
    expect(rRef.pass).toBe(false);
    expect(
      rRef.reasons.some(
        (s) =>
          s.includes("coherencia interna de la referencia") &&
          s.includes("d = 7, p = 0.03"),
      ),
    ).toBe(true);
    expect(renderTable(rRef)).toContain("VEREDICTO: FALLA");
  });

  it("asValidationFile accepts the synthetic file and rejects a broken one", () => {
    const f = makeFile();
    expect(asValidationFile(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(() => asValidationFile({ ...f, schema: 2 })).toThrow(/schema/);
    expect(() =>
      asValidationFile({
        ...f,
        points: [{ ...f.points[0]!, stopReason: "never" }],
      }),
    ).toThrow(/stopReason/);
    expect(MAX_ABS_Z).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 (tasks/plans/phase2.md D7–D9): the phenomenological gates

const COUNTS_3D = exactSpacetimeCountsD3();

function exact3D(p: number): number {
  return exactSpacetimeRates(COUNTS_3D.Z, COUNTS_3D.X, 13, p).either;
}

/** A self-consistent exactProbe whose points sit on the exact cycles = 1 curve. */
function makeProbe(
  overrides: Partial<ExactProbe> = {},
  rate: (p: number) => number = exact3D,
): ExactProbe {
  return {
    d: 3,
    cycles: 1,
    stopRule: { minFailures: 2, minShots: SHOTS, maxShots: SHOTS },
    counts: { Z: Array.from(COUNTS_3D.Z), X: Array.from(COUNTS_3D.X) },
    points: [0.01, 0.03, 0.05].map((p) => makePoint(3, p, rate(p))),
    ...overrides,
  };
}

/** Smooth phenomenological curves with crossings near 0.022–0.028. */
const CURVE_3D: Record<number, [number, number]> = {
  3: [-5.3, 70],
  5: [-6.8, 135],
  7: [-7.7, 190],
};

function curveRate3D(d: number, p: number): number {
  const [a, b] = CURVE_3D[d]!;
  return Math.exp(a + b * p);
}

function makeFile3D(
  rate: (d: number, p: number) => number = curveRate3D,
  overrides: Partial<ValidationFile> = {},
): ValidationFile {
  const points: ValidationPoint[] = [];
  for (const d of VALIDATION_GRID_PHENOMENOLOGICAL.distances) {
    for (const p of VALIDATION_GRID_PHENOMENOLOGICAL.probabilities) {
      points.push(makePoint(d, p, rate(d, p)));
    }
  }
  return {
    schema: 1,
    generator: "test",
    engine: { name: "test" },
    noise: "phenomenological",
    model: { cycles: "d", q: "p" },
    stopRule: VALIDATION_STOP_RULE,
    seed: 1,
    ...coreMetadata("phenomenological"),
    exactProbe: makeProbe(),
    points,
    ...overrides,
  };
}

/** Three spacetime syndromes of d = 3, cycles = 3 with the core's own weight and parity. */
function verdictsFixture(): VerdictsFixture {
  const code = rotatedSurfaceCode(3);
  const cases: { type: StabilizerType; defects: number[] }[] = [
    { type: "Z", defects: [0, 4] }, // one measurement flip of check 0 in cycle 1
    { type: "X", defects: [1, 2] }, // a data error seen by two checks of layer 1
    { type: "Z", defects: [3, 9, 14] },
  ];
  return {
    schema: 1,
    generator: "test",
    pymatching: "2.4.0",
    noise: "phenomenological",
    weights: coreWeightsBlock(),
    skippedEmpty: 0,
    cases: cases.map((c) => {
      const dec = createSpacetimeDecoder(code, c.type, 3);
      const detectors = new Uint8Array(dec.graph.nodes);
      for (const i of c.defects) detectors[i] = 1;
      const correction = identity(code.n);
      const weight = decodeSpacetime(dec, detectors, correction);
      const logical = c.type === "Z" ? code.logicalZ : code.logicalX;
      return {
        d: 3,
        type: c.type,
        cycles: 3,
        p: 0.02,
        defects: c.defects,
        weight,
        parity: commutes(correction, logical) ? 0 : 1,
      };
    }),
  };
}

/** A probe whose three points sit k·σ above the exact curve. */
function shiftedProbe(k: number): ExactProbe {
  return makeProbe({}, (p) => {
    const exact = exact3D(p);
    return exact + k * Math.sqrt((exact * (1 - exact)) / SHOTS);
  });
}

describe("T-C11 the phenomenological gates (phase2.md D7–D9)", () => {
  it("asValidationFile accepts both noises, rejects a third, and demands model/exactProbe only in the phenomenological one", () => {
    const f2 = makeFile();
    const f3 = makeFile3D();
    expect(asValidationFile(JSON.parse(JSON.stringify(f2)))).toEqual(f2);
    expect(asValidationFile(JSON.parse(JSON.stringify(f3)))).toEqual(f3);
    expect(() => asValidationFile({ ...f2, noise: "depolarizing" })).toThrow(
      /noise/,
    );
    const noModel = { ...f3, model: undefined };
    expect(() => asValidationFile(noModel)).toThrow(/model/);
    const noProbe = { ...f3, exactProbe: undefined };
    expect(() => asValidationFile(noProbe)).toThrow(/exactProbe/);
    expect(() =>
      asValidationFile({ ...f2, model: { cycles: "d", q: "p" } }),
    ).toThrow(/model/);
    expect(() =>
      asValidationFile({
        ...f3,
        exactProbe: { ...f3.exactProbe, counts: { Z: [1, 2], X: [] } },
      }),
    ).toThrow(/exactProbe/);
  });

  it("checkMetadata of a phenomenological file: the 12-index sample, the model block, the probe", () => {
    const f3 = makeFile3D();
    expect(checkMetadata(f3)).toEqual([]);
    const sample2D = checkMetadata({
      ...f3,
      weights: coreMetadata("independent").weights,
    });
    expect(sample2D).toHaveLength(1);
    expect(sample2D[0]).toContain("[0, 1, 2, 8, 24, 48, 80, 120]");
    expect(
      checkMetadata({ ...f3, model: undefined }).some((r) =>
        r.includes("model"),
      ),
    ).toBe(true);
    expect(checkMetadata({ ...f3, exactProbe: undefined })).toContain(
      "sin exactProbe",
    );
    // And the independent file must not carry them.
    const f2 = makeFile();
    expect(
      checkMetadata({ ...f2, model: { cycles: "d", q: "p" } }).some((r) =>
        r.includes("model"),
      ),
    ).toBe(true);
    expect(checkMetadata({ ...f2, exactProbe: makeProbe() })).toContain(
      "exactProbe en un fichero independiente",
    );
  });

  it("compareFiles: each model on its own grid; a reference of one model against a browser of the other fails", () => {
    const f3 = makeFile3D();
    expect(checkGrid(f3, "x")).toEqual([]);
    expect(compareFiles(f3, f3).pass).toBe(true);
    const mixed = compareFiles(makeFile(), f3);
    expect(mixed.pass).toBe(false);
    expect(mixed.reasons[0]).toContain('"independent"');
    expect(mixed.reasons[0]).toContain('"phenomenological"');
  });

  it("exactProbeCheck: counts equal and points on the exact curve pass; one count off by 1 fails EXACTLY; 2.5σ points pass by point and fail by Σz²", () => {
    const ok = exactProbeCheck(makeFile3D(), COUNTS_3D);
    expect(ok.reasons).toEqual([]);
    expect(ok.pass).toBe(true);
    expect(ok.points).toHaveLength(3);
    expect(ok.maxAbsZ).toBeLessThan(0.1);
    const offByOne = exactProbeCheck(
      makeFile3D(curveRate3D, {
        exactProbe: makeProbe({
          counts: {
            Z: Array.from(COUNTS_3D.Z, (a, w) => (w === 6 ? a + 1 : a)),
            X: Array.from(COUNTS_3D.X),
          },
        }),
      }),
      COUNTS_3D,
    );
    expect(offByOne.pass).toBe(false);
    expect(offByOne.countReasons).toHaveLength(1);
    expect(offByOne.countReasons[0]).toContain("exactProbe.counts.Z");
    // Statistics: three points at +2.5σ pass by point (|z| ≤ 3) and fail by
    // Σz² ≈ 18.75 ≥ 11.3; at +1.5σ (Σz² ≈ 6.75) they pass.
    const twoAndAHalf = exactProbeCheck(
      makeFile3D(curveRate3D, { exactProbe: shiftedProbe(2.5) }),
      COUNTS_3D,
    );
    expect(twoAndAHalf.maxAbsZ).toBeLessThanOrEqual(3);
    expect(twoAndAHalf.sumZ2).toBeGreaterThan(SUM_Z2_LIMIT_PROBE);
    expect(twoAndAHalf.pass).toBe(false);
    expect(
      exactProbeCheck(
        makeFile3D(curveRate3D, { exactProbe: shiftedProbe(1.5) }),
        COUNTS_3D,
      ).pass,
    ).toBe(true);
    // A probe point with another d is a reason; an independent file has no probe.
    const wrongD = exactProbeCheck(
      makeFile3D(curveRate3D, {
        exactProbe: makeProbe({ points: [makePoint(5, 0.03, 0.03)] }),
      }),
      COUNTS_3D,
    );
    expect(wrongD.countReasons.some((r) => r.includes("d = 5"))).toBe(true);
    expect(exactProbeCheck(makeFile(), COUNTS_3D).reasons).toEqual([
      "sin exactProbe",
    ]);
  });

  it("checkMinWeights decodes a case with `cycles` on the spacetime graph", () => {
    const code = rotatedSurfaceCode(3);
    const dec = createSpacetimeDecoder(code, "Z", 3);
    const detectors = new Uint8Array(dec.graph.nodes);
    detectors[0] = 1;
    detectors[4] = 1;
    const weight = decodeSpacetime(dec, detectors, identity(9));
    const fixture: MinWeightsFixture = {
      ...minWeightsFixture(),
      cases: [{ d: 3, type: "Z", cycles: 3, defects: [0, 4], weight }],
    };
    expect(checkMinWeights(fixture).mismatches).toEqual([]);
    const wrong = checkMinWeights({
      ...fixture,
      cases: [{ ...fixture.cases[0]!, weight: weight + 1 }],
    });
    expect(wrong.mismatches).toHaveLength(1);
    expect(wrong.mismatches[0]!.cycles).toBe(3);
  });

  it("checkVerdicts: the core's own verdicts give 0 mismatches; a flipped parity is listed and tolerated up to 5; a wrong weight fails even with the parity right", () => {
    const fixture = verdictsFixture();
    const ok = checkVerdicts(fixture);
    expect(ok.weightMismatches).toEqual([]);
    expect(ok.parityMismatches).toEqual([]);
    expect(ok.pass).toBe(true);
    const flip = (c: VerdictsFixture["cases"][number]) => ({
      ...c,
      parity: (c.parity === 0 ? 1 : 0) as 0 | 1,
    });
    const flipped = checkVerdicts({
      ...fixture,
      cases: fixture.cases.map((c, i) => (i === 2 ? flip(c) : c)),
    });
    expect(flipped.parityMismatches).toHaveLength(1);
    expect(flipped.parityMismatches[0]!.defects).toEqual([3, 9, 14]);
    expect(flipped.pass).toBe(true); // ≤ MAX_PARITY_MISMATCHES: listed, not fatal
    expect(MAX_PARITY_MISMATCHES).toBe(5);
    const sixFlipped = checkVerdicts({
      ...fixture,
      cases: Array.from({ length: 6 }, () => flip(fixture.cases[2]!)),
    });
    expect(sixFlipped.parityMismatches).toHaveLength(6);
    expect(sixFlipped.pass).toBe(false);
    const wrongWeight = checkVerdicts({
      ...fixture,
      cases: fixture.cases.map((c, i) =>
        i === 0 ? { ...c, weight: c.weight + 1 } : c,
      ),
    });
    expect(wrongWeight.weightMismatches).toHaveLength(1);
    expect(wrongWeight.parityMismatches).toEqual([]);
    expect(wrongWeight.pass).toBe(false);
    // Another weights block is a reason too.
    expect(
      checkVerdicts({ ...fixture, weights: { ...fixture.weights, scale: 1 } })
        .pass,
    ).toBe(false);
  });

  it("fixture shape is a gate: FIXTURE_CASES cases of the model's kind, or a named reason; the report judges it by default", () => {
    expect(FIXTURE_CASES).toBe(10_000);
    const real = readMinWeightsFixture(
      join("docs", "validacion", "min-weights-phenomenological.json"),
    );
    const phase1 = readMinWeightsFixture(
      join("docs", "validacion", "min-weights.json"),
    );
    const realVerdicts = readVerdictsFixture(
      join("docs", "validacion", "verdicts-phenomenological.json"),
    );
    // The shape alone (no decoding): the real fixtures have none; truncated,
    // empty, or the other model's kind are named.
    const shape = fixtureShapeReasons;
    expect(shape("min-weights", real.cases, "phenomenological")).toEqual([]);
    expect(shape("min-weights", phase1.cases, "independent")).toEqual([]);
    expect(shape("verdicts", realVerdicts.cases, "phenomenological")).toEqual(
      [],
    );
    // A truncated fixture is named by its count (and, as a consequence, by its
    // thin composition: both reasons, the first is the one asserted here).
    expect(
      shape("min-weights", real.cases.slice(0, 10), "phenomenological")[0],
    ).toBe("min-weights: 10 casos ≠ 10000");
    expect(shape("verdicts", [], "phenomenological")[0]).toBe(
      "verdicts: 0 casos ≠ 10000",
    );
    expect(shape("min-weights", phase1.cases, "phenomenological")).toEqual([
      "min-weights: 10000 casos sin cycles = d (fixture 2D o de otro modelo)",
    ]);
    expect(shape("min-weights", real.cases, "independent")).toEqual([
      "min-weights: 10000 casos con cycles (fixture espacio-temporal en el modelo independiente)",
    ]);
    // Composition: one case repeated 10⁴ times, only
    // d = 3 cases, or a verdicts grid with an empty cell are named too.
    const repeated = Array.from(
      { length: FIXTURE_CASES },
      () => real.cases[0]!,
    );
    expect(shape("min-weights", repeated, "phenomenological")).toEqual([
      "min-weights: sólo 1 casos distintos (< 5000)",
      "min-weights: celdas (d, tipo) con menos de 1000 casos: d = 3 X: 0; d = 5 Z: 0; d = 5 X: 0; d = 7 Z: 0; d = 7 X: 0; d = 9 Z: 0; d = 9 X: 0",
    ]);
    const onlyD3 = real.cases.filter((c) => c.d === 3);
    expect(
      shape("min-weights", onlyD3, "phenomenological").some((r) =>
        r.includes("celdas (d, tipo) con menos de 1000 casos: d = 5 Z"),
      ),
    ).toBe(true);
    // Every one of the 18 (d, p, type) cells is pinned (with one cell only,
    // dropping Z, p = 0.03 or d = 7 from the gate stayed green).
    for (const d of [3, 5, 7]) {
      for (const p of [0.01, 0.02, 0.03]) {
        for (const type of ["Z", "X"] as const) {
          const noCell = realVerdicts.cases.filter(
            (c) => !(c.d === d && c.p === p && c.type === type),
          );
          expect(
            shape("verdicts", noCell, "phenomenological").filter((r) =>
              r.includes("sin casos"),
            ),
          ).toEqual([
            `verdicts: celdas (d, p, tipo) sin casos: (${d}, ${p}, ${type})`,
          ]);
        }
      }
    }
    expect(
      shape(
        "verdicts",
        [{ ...realVerdicts.cases[0]!, defects: [] }],
        "phenomenological",
      ).some((r) => r.includes("síndromes vacíos")),
    ).toBe(true);
    const repeatedVerdicts = Array.from(
      { length: FIXTURE_CASES },
      () => realVerdicts.cases[0]!,
    );
    expect(shape("verdicts", repeatedVerdicts, "phenomenological")[0]).toBe(
      "verdicts: sólo 1 casos distintos (< 5000)",
    );
    // Through the gates: checkMinWeights judges the shape only with `noise`,
    // checkVerdicts only with `strictShape`; buildReport asks for both by
    // default (the CLI path) and the synthetic unit tests switch it off.
    const ten = { ...real, cases: real.cases.slice(0, 10) };
    expect(checkMinWeights(ten).reasons).toEqual([]);
    expect(checkMinWeights(ten, "phenomenological").reasons[0]).toBe(
      "min-weights: 10 casos ≠ 10000",
    );
    const small = verdictsFixture();
    expect(checkVerdicts(small).pass).toBe(true);
    expect(checkVerdicts(small, true).reasons[0]).toBe(
      `verdicts: ${small.cases.length} casos ≠ 10000`,
    );
    const tenVerdicts = {
      ...realVerdicts,
      cases: realVerdicts.cases.slice(0, 10),
    };
    const report = buildReportStrict(
      makeFile3D(),
      makeFile3D(),
      ten,
      COUNTS_3D,
      tenVerdicts,
    );
    expect(report.pass).toBe(false);
    expect(report.reasons).toContain("min-weights: 10 casos ≠ 10000");
    expect(report.reasons).toContain("verdicts: 10 casos ≠ 10000");
    // Switched off, the same report has no shape reason (the synthetic tests).
    expect(
      buildReport(
        makeFile3D(),
        makeFile3D(),
        ten,
        COUNTS_3D,
        tenVerdicts,
      ).reasons.filter((r) => r.includes("casos ≠")),
    ).toEqual([]);
    // The phase 1 fixture handed to the phenomenological report is caught too.
    const wrongKind = buildReportStrict(
      makeFile3D(),
      makeFile3D(),
      phase1,
      COUNTS_3D,
      tenVerdicts,
    );
    expect(wrongKind.reasons.some((r) => r.includes("sin cycles = d"))).toBe(
      true,
    );
  }, 60_000);

  it("exactProbeCheck demands the probe's shape: the three p, the stop rule, and each point consistent with its counts", () => {
    const base = makeFile3D();
    const onePoint = exactProbeCheck(
      makeFile3D(curveRate3D, {
        exactProbe: makeProbe({ points: [makePoint(3, 0.01, exact3D(0.01))] }),
      }),
      COUNTS_3D,
    );
    expect(onePoint.pass).toBe(false);
    expect(onePoint.countReasons).toContain(
      "exactProbe: puntos en p = [0.01] ≠ [0.01, 0.03, 0.05]",
    );
    const weakRule = exactProbeCheck(
      makeFile3D(curveRate3D, {
        exactProbe: makeProbe({
          stopRule: { minFailures: 2, minShots: 1000, maxShots: 1000 },
        }),
      }),
      COUNTS_3D,
    );
    expect(weakRule.pass).toBe(false);
    expect(
      weakRule.countReasons.some((r) => r.startsWith("exactProbe: stopRule")),
    ).toBe(true);
    // A probe point whose failures do not match its estimate is a named reason
    // (the internal-consistency gate of the probe, mutant "skip it" → green before).
    const probe = base.exactProbe!;
    const broken = exactProbeCheck(
      makeFile3D(curveRate3D, {
        exactProbe: {
          ...probe,
          points: probe.points.map((pt, i) =>
            i === 1 ? { ...pt, failures: pt.failures + 1 } : pt,
          ),
        },
      }),
      COUNTS_3D,
    );
    expect(broken.pass).toBe(false);
    expect(
      broken.countReasons.some(
        (r) => r.startsWith("exactProbe ") && r.includes("failures"),
      ),
    ).toBe(true);
    expect(exactProbeCheck(base, COUNTS_3D).countReasons).toEqual([]);
  });

  it("buildReport of the phenomenological model: probe and verdicts are gates; a missing fixture is a reason; the document has both sections", () => {
    const f3 = makeFile3D();
    const fixture = verdictsFixture();
    const mw: MinWeightsFixture = {
      ...minWeightsFixture(),
      cases: fixture.cases.map(({ d, type, cycles, defects, weight }) => ({
        d,
        type,
        cycles,
        defects,
        weight,
      })),
    };
    const ok = buildReport(f3, f3, mw, COUNTS_3D, fixture);
    expect(ok.reasons).toEqual([]);
    expect(ok.pass).toBe(true);
    expect(ok.noise).toBe("phenomenological");
    expect(ok.exactReference).toBeNull();
    expect(ok.exactProbeReference!.pass).toBe(true);
    expect(ok.verdicts!.pass).toBe(true);
    const noFixture = buildReport(f3, f3, mw, COUNTS_3D, null);
    expect(noFixture.pass).toBe(false);
    expect(noFixture.reasons.some((r) => r.includes("verdicts"))).toBe(true);
    const badProbe = buildReport(
      makeFile3D(curveRate3D, {
        exactProbe: makeProbe({
          counts: {
            Z: Array.from(COUNTS_3D.Z, (a, w) => (w === 6 ? a + 1 : a)),
            X: Array.from(COUNTS_3D.X),
          },
        }),
      }),
      f3,
      mw,
      COUNTS_3D,
      fixture,
    );
    expect(badProbe.pass).toBe(false);
    expect(badProbe.reasons.some((r) => r.includes("cycles = 1"))).toBe(true);
    const table = renderTable(ok);
    expect(table).toContain("fenomenológico");
    expect(table).toContain("veredictos");
    expect(table).toContain("VEREDICTO: PASA");
    expect(
      table.split("\n").filter((l) => /^ [357] +0\.\d+ /.test(l)),
    ).toHaveLength(24);
    const f2 = makeFile((d, p) =>
      d === 3
        ? exactLogicalRates(COUNTS.Z, COUNTS.X, 9, p).either
        : curveRate(d, p),
    );
    const r2 = buildReport(f2, f2, minWeightsFixture(), COUNTS);
    const run = { nodeVersion: "v24.0.0", simulation: null };
    const doc = renderDocuments(
      [
        { report: r2, run },
        { report: ok, run },
      ],
      new Date("2026-10-17T00:00:00.000Z"),
    );
    expect(doc).toContain("**Veredicto global: PASA**");
    expect(doc).toContain("## Modelo de fase 1");
    expect(doc).toContain("## Modelo de fase 2");
    expect(doc).toContain("verdicts-phenomenological.json");
    expect(doc).toContain("Exacto de cycles = 1");
    expect(
      doc.split("\n").filter((l) => /^\| [357] \| 0\.\d+ \|/.test(l)),
    ).toHaveLength(48);
    const mixed = renderDocuments(
      [
        { report: r2, run },
        { report: noFixture, run },
      ],
      new Date(),
    );
    expect(mixed).toContain("**Veredicto global: FALLA**");
  });

  it("crossings on the committed phenomenological reference: three pairs, first crossing descending, p* reported (informative)", () => {
    const path = join("docs", "validacion", "reference-phenomenological.json");
    expect(existsSync(path)).toBe(true);
    const file = readValidationFile(path);
    const cs = crossings(file);
    expect(cs.map((c) => c.pair)).toEqual([
      [3, 5],
      [3, 7],
      [5, 7],
    ]);
    for (const c of cs) {
      expect(c.pCross).not.toBeNull();
      expect(c.inverted).toBe(false);
      // Expected in [0.015, 0.035] (phase2.md M3: 0.020–0.025 for (3, 5)); printed,
      // not asserted: the band is documented in docs/validacion.md (docs/spec.md §6.4).
      console.log(
        `crossing (${c.pair[0]}, ${c.pair[1]}): p* ≈ ${c.pCross!.toFixed(4)} (${c.note})`,
      );
    }
  });
});
