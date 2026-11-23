// Statistics of a Monte Carlo point (docs/spec.md §3 "Métrica del marcador"):
// Wilson 95 % interval, the point estimator by stop reason and the per-point
// seed. Pure arithmetic, no allocation in the hot loop: wilsonInterval and
// pointRate are called once per estimate, never per shot.

/** z of the 95 % two-sided normal quantile. */
export const WILSON_Z95 = 1.959963984540054;

export interface Interval {
  readonly low: number;
  readonly high: number;
}

/**
 * Wilson score interval for k failures in n shots at confidence z.
 *   centre = (p̂ + z²/2n) / (1 + z²/n)
 *   half   = z · √(p̂(1 − p̂)/n + z²/4n²) / (1 + z²/n)
 * Exact ends: low = 0 when k = 0 (the formula leaves ~4·10⁻²² of rounding),
 * high = 1 when k = n, and [0, 1] when n = 0. RangeError unless 0 ≤ k ≤ n are
 * integers and z > 0. Allocates the result object.
 */
export function wilsonInterval(
  k: number,
  n: number,
  z: number = WILSON_Z95,
): Interval {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`shots must be a non-negative integer, got ${n}`);
  }
  if (!Number.isInteger(k) || k < 0 || k > n) {
    throw new RangeError(`failures must be an integer in [0, ${n}], got ${k}`);
  }
  if (!(z > 0)) {
    throw new RangeError(`z must be positive, got ${z}`);
  }
  if (n === 0) {
    return { low: 0, high: 1 };
  }
  const phat = k / n;
  const z2n = (z * z) / n;
  const denominator = 1 + z2n;
  const centre = (phat + z2n / 2) / denominator;
  const half =
    (z * Math.sqrt((phat * (1 - phat)) / n + z2n / (4 * n))) / denominator;
  return {
    low: k === 0 ? 0 : centre - half,
    high: k === n ? 1 : centre + half,
  };
}

export interface RatioInterval {
  /** p̂₁ / p̂₂ with p̂ = k/n. */
  readonly ratio: number;
  readonly low: number;
  readonly high: number;
}

/**
 * Λ = P_L(d) / P_L(d + 2) with a confidence interval (docs/spec.md §3 "Métrica del
 * marcador"): the ratio of two binomial proportions p̂ᵢ = kᵢ/nᵢ by the delta
 * method on log Λ, where Var(log p̂) ≈ (1 − p̂)/k, so
 *   σ² = (1 − p̂₁)/k₁ + (1 − p̂₂)/k₂,  [Λ·e^(−zσ), Λ·e^(+zσ)].
 * null when k₁ = 0 or k₂ = 0: a rate without a single failure has no ratio
 * (the UI says so instead of showing 0 or ∞). RangeError unless 0 ≤ kᵢ ≤ nᵢ
 * are integers and z > 0. Allocates the result object.
 */
export function ratioInterval(
  k1: number,
  n1: number,
  k2: number,
  n2: number,
  z: number = WILSON_Z95,
): RatioInterval | null {
  for (const [k, n] of [
    [k1, n1],
    [k2, n2],
  ] as const) {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`shots must be a non-negative integer, got ${n}`);
    }
    if (!Number.isInteger(k) || k < 0 || k > n) {
      throw new RangeError(
        `failures must be an integer in [0, ${n}], got ${k}`,
      );
    }
  }
  if (!(z > 0)) {
    throw new RangeError(`z must be positive, got ${z}`);
  }
  if (k1 === 0 || k2 === 0) {
    return null;
  }
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const ratio = p1 / p2;
  const sigma = Math.sqrt((1 - p1) / k1 + (1 - p2) / k2);
  return {
    ratio,
    low: ratio * Math.exp(-z * sigma),
    high: ratio * Math.exp(z * sigma),
  };
}

/**
 * Why a point stopped sampling (tasks/plans/validation.md D1):
 *   "shots"    — reached minShots with at least minFailures failures;
 *   "failures" — past minShots, the shot that made failures = minFailures;
 *   "cap"      — reached maxShots without the rule firing;
 *   "budget"   — the caller stopped it (time budget, cancellation).
 */
export type StopReason = "shots" | "failures" | "cap" | "budget";

/**
 * Point estimate of the logical error rate by stop reason. With a fixed
 * number of shots ("shots", "cap", "budget") k/N is unbiased. When sampling
 * stopped at the k-th failure ("failures") the count of shots is the random
 * variable (inverse binomial sampling) and k/N is biased by ≈ +1/k; Haldane's
 * (k − 1)/(N − 1) is unbiased. Returns 0 when the quotient is 0/0 (N = 0).
 * Precondition for "failures": k ≥ 2 (stopRule enforces minFailures ≥ 2), so
 * the estimate is never a 0 that is not an upper bound; k < 2 with "failures"
 * is a RangeError.
 */
export function pointRate(
  failures: number,
  shots: number,
  stopReason: StopReason,
): number {
  if (shots <= 0) {
    return 0;
  }
  if (stopReason === "failures") {
    if (failures < 2 || shots < 2) {
      throw new RangeError(
        `a stop by failures needs k ≥ 2 and N ≥ 2, got k = ${failures}, N = ${shots}`,
      );
    }
    return (failures - 1) / (shots - 1);
  }
  return failures / shots;
}

const MAX_SEED_BASE = 2 ** 52;

const SEED_D_STRIDE = 2 ** 20; // > 10⁶ ≥ round(p·10⁶): d and p never overlap
const MAX_SEED_D = 2 ** 12;

/**
 * Seed of the point (d, p) derived from a base seed: base + d·2²⁰ + round(p·10⁶).
 * The p term is at most 10⁶ < 2²⁰, so (d, p) pairs never collide for any p on
 * the 10⁻⁶ lattice and any d < 2¹² (a 1000·d stride, used first, collided:
 * pointSeed(·, 3, 0.003) = pointSeed(·, 5, 0.001); found on 2026-10-16).
 * An integer below 2⁵³ for any base below 2⁵² (createRng's domain).
 * RangeError unless base is an integer in [0, 2⁵²), d a positive integer < 2¹²
 * and 0 ≤ p ≤ 1.
 */
export function pointSeed(base: number, d: number, p: number): number {
  if (!Number.isInteger(base) || base < 0 || base >= MAX_SEED_BASE) {
    throw new RangeError(
      `seed base must be an integer in [0, 2^52), got ${base}`,
    );
  }
  if (!Number.isInteger(d) || d <= 0 || d >= MAX_SEED_D) {
    throw new RangeError(
      `distance must be a positive integer below ${MAX_SEED_D}, got ${d}`,
    );
  }
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`error probability must be in [0, 1], got ${p}`);
  }
  return base + SEED_D_STRIDE * d + Math.round(p * 1e6);
}
