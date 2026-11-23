// Pooling of the validated base curves with the live counts of the Worker
// (tasks/plans/ui.md D3 "Fusión con la curva base"): for a (d, p) that exists
// in BOTH sets, k = k_base + k_live and N = N_base + N_live, estimator k/N and
// Wilson on (k, N). Two independent samples (different seeds) of the same
// decoder and noise model (tests/intent/chart-conventions.test.ts keeps the
// base equal to this core) pool like that; a live part stopped by failures
// biases its share by ≈ 1/k, far below the Wilson width. Only IDENTICAL (d, p)
// pool: the user's p off the grid never inherits a neighbour's counts.
import {
  ratioInterval,
  wilsonInterval,
  type RatioInterval,
  type StopReason,
} from "../../core";

/** What both a base point and a live point provide. */
export interface PointLike {
  readonly d: number;
  readonly p: number;
  readonly shots: number;
  readonly failures: number;
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly stopReason: StopReason | null;
  readonly upperBoundOnly: boolean;
  /** Live points carry the Worker's throughput; base points do not. */
  readonly rate?: number;
}

export interface CurvePoint {
  readonly d: number;
  readonly p: number;
  readonly shots: number;
  readonly failures: number;
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly upperBoundOnly: boolean;
  /** true when live shots contributed. */
  readonly live: boolean;
  /** Live shots pooled into this point (0 for a base-only point). */
  readonly liveShots: number;
  /** null while live sampling continues (or for a base-only point: the base's reason). */
  readonly stopReason: StopReason | null;
  /** Throughput of the live lane, 0 for a base-only point. */
  readonly rate: number;
}

function fromSingle(pt: PointLike, live: boolean): CurvePoint {
  return {
    d: pt.d,
    p: pt.p,
    shots: pt.shots,
    failures: pt.failures,
    estimate: pt.estimate,
    low: pt.low,
    high: pt.high,
    upperBoundOnly: pt.failures === 0,
    live: live && pt.shots > 0,
    liveShots: live ? pt.shots : 0,
    stopReason: pt.stopReason,
    rate: pt.rate ?? 0,
  };
}

function pooled(base: PointLike, live: PointLike): CurvePoint {
  const failures = base.failures + live.failures;
  const shots = base.shots + live.shots;
  const { low, high } = wilsonInterval(failures, shots);
  return {
    d: base.d,
    p: base.p,
    shots,
    failures,
    // k/N on the pooled counts (the stop by failures of the live part is ≈ 1/k).
    estimate: shots === 0 ? 0 : failures / shots,
    low,
    high,
    upperBoundOnly: failures === 0,
    live: live.shots > 0,
    liveShots: live.shots,
    stopReason: live.stopReason,
    rate: live.rate ?? 0,
  };
}

/** Sort key: by d, then p. */
function compare(a: CurvePoint, b: CurvePoint): number {
  return a.d - b.d || a.p - b.p;
}

/**
 * Merges base and live points: identical (d, p) pool their counts, every other
 * point stands alone. Returns the union sorted by d then p. Two live points
 * with the same (d, p) are a protocol error (the Worker keeps one lane per
 * pair), not pooled: RangeError.
 */
export function poolPoints(
  base: readonly PointLike[],
  live: readonly PointLike[],
): CurvePoint[] {
  const liveByKey = new Map<string, PointLike>();
  for (const pt of live) {
    const key = `${pt.d}:${pt.p}`;
    if (liveByKey.has(key)) {
      throw new RangeError(`two live points for d = ${pt.d}, p = ${pt.p}`);
    }
    liveByKey.set(key, pt);
  }
  const out: CurvePoint[] = [];
  for (const pt of base) {
    const key = `${pt.d}:${pt.p}`;
    const match = liveByKey.get(key);
    if (match === undefined) {
      out.push(fromSingle(pt, false));
    } else {
      out.push(pooled(pt, match));
      liveByKey.delete(key);
    }
  }
  for (const pt of liveByKey.values()) {
    out.push(fromSingle(pt, true));
  }
  return out.sort(compare);
}

export interface ShotsRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Smallest and largest shots over a set of points (equal for a uniform base);
 * {0, 0} with no points. The validation rule stops at ≥ 10⁵ shots AND ≥ 100
 * failures, cap 10⁶, so a base point may carry more than the rest.
 */
export function shotsRange(points: readonly PointLike[]): ShotsRange {
  if (points.length === 0) return { min: 0, max: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const pt of points) {
    min = Math.min(min, pt.shots);
    max = Math.max(max, pt.shots);
  }
  return { min, max };
}

/** The point (d, p) of a curve set, by exact equality. */
/** Measured points of one distance (no upper bounds), by p. */
function measuredOf(
  points: readonly CurvePoint[],
  d: number,
): readonly CurvePoint[] {
  return points
    .filter((pt) => pt.d === d && !pt.upperBoundOnly && pt.estimate > 0)
    .sort((a, b) => a.p - b.p);
}

/**
 * The estimate of distance d at p, read off its polyline in (p, log P_L):
 * exactly what the chart draws between two measured points. null outside the
 * measured range or with fewer than two points.
 */
export function estimateAt(
  points: readonly CurvePoint[],
  d: number,
  p: number,
): number | null {
  const own = measuredOf(points, d);
  for (let i = 0; i + 1 < own.length; i++) {
    const a = own[i]!;
    const b = own[i + 1]!;
    if (p < a.p || p > b.p) continue;
    if (a.p === b.p) return a.estimate;
    const s = (p - a.p) / (b.p - a.p);
    return Math.exp(
      Math.log(a.estimate) + s * (Math.log(b.estimate) - Math.log(a.estimate)),
    );
  }
  return null;
}

/**
 * The p where the curves of d1 and d2 cross (tasks/plans/design.md D5): the
 * intersection of the two polylines in (p, log P_L), over the p values both
 * have measured. With both sampled at the same p grid the difference of the
 * logs is itself piecewise linear and the crossing is its first zero between
 * two consecutive grid points; a sign change at a grid point itself returns
 * that p. null when the curves do not cross (one measured point, or the same
 * sign everywhere): then there is no sub-threshold region to shade.
 */
export function crossingOf(
  points: readonly CurvePoint[],
  d1: number,
  d2: number,
): number | null {
  const a = measuredOf(points, d1);
  const b = measuredOf(points, d2);
  const common = a.map((pt) => pt.p).filter((p) => b.some((pt) => pt.p === p));
  if (common.length < 2) return null;
  const diff = (p: number): number => {
    const ea = a.find((pt) => pt.p === p)!.estimate;
    const eb = b.find((pt) => pt.p === p)!.estimate;
    return Math.log(ea) - Math.log(eb);
  };
  // A crossing is a strict change of sign between the last two non-zero
  // differences (a tie at a grid point is skipped: two equal curves do not
  // cross), interpolated linearly between them.
  let last: { p: number; f: number } | null = null;
  for (const p of common) {
    const f = diff(p);
    if (f === 0) continue;
    if (last !== null && f > 0 !== last.f > 0) {
      return last.p + ((p - last.p) * last.f) / (last.f - f);
    }
    last = { p, f };
  }
  return null;
}

export function pointAt(
  points: readonly CurvePoint[],
  d: number,
  p: number,
): CurvePoint | undefined {
  return points.find((pt) => pt.d === d && pt.p === p);
}

/**
 * Λ = P_L(d) / P_L(d + 2) at p with its propagated interval (ratioInterval on
 * the pooled counts). null when either point is missing or has no failure.
 */
export function lambdaAt(
  points: readonly CurvePoint[],
  d: number,
  p: number,
): RatioInterval | null {
  const a = pointAt(points, d, p);
  const b = pointAt(points, d + 2, p);
  if (a === undefined || b === undefined) return null;
  return ratioInterval(a.failures, a.shots, b.failures, b.shots);
}
