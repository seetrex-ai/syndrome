import { describe, expect, it } from "vitest";
import { wilsonInterval } from "../../core";
import {
  lambdaAt,
  pointAt,
  poolPoints,
  shotsRange,
  type PointLike,
} from "./curves";

function point(
  d: number,
  p: number,
  failures: number,
  shots: number,
  extra: Partial<PointLike> = {},
): PointLike {
  const { low, high } = wilsonInterval(failures, shots);
  return {
    d,
    p,
    shots,
    failures,
    estimate: shots === 0 ? 0 : failures / shots,
    low,
    high,
    stopReason: null,
    upperBoundOnly: failures === 0,
    ...extra,
  };
}

const BASE = [
  point(3, 0.1, 1000, 100_000, { stopReason: "shots" }),
  point(5, 0.1, 500, 100_000, { stopReason: "shots" }),
  point(7, 0.1, 200, 100_000, { stopReason: "shots" }),
];

describe("poolPoints", () => {
  it("sums the counts of identical (d, p) and recomputes Wilson on the pooled counts", () => {
    const live = [point(3, 0.1, 15, 1500, { rate: 42 })];
    const out = poolPoints(BASE, live);
    const pooled = pointAt(out, 3, 0.1)!;
    expect(pooled.shots).toBe(101_500);
    expect(pooled.failures).toBe(1015);
    expect(pooled.estimate).toBeCloseTo(1015 / 101_500, 15);
    expect(pooled.live).toBe(true);
    expect(pooled.liveShots).toBe(1500);
    expect(pooled.rate).toBe(42);
    const w = wilsonInterval(1015, 101_500);
    expect(pooled.low).toBe(w.low);
    expect(pooled.high).toBe(w.high);
    // The other base points are untouched and not live.
    const base5 = pointAt(out, 5, 0.1)!;
    expect(base5.shots).toBe(100_000);
    expect(base5.live).toBe(false);
    expect(base5.liveShots).toBe(0);
  });

  it("the pooled interval is narrower than each part's", () => {
    const base = point(3, 0.1, 100, 10_000);
    const live = point(3, 0.1, 100, 10_000);
    const [pooled] = poolPoints([base], [live]);
    expect(pooled!.high - pooled!.low).toBeLessThan(base.high - base.low);
    expect(pooled!.high - pooled!.low).toBeLessThan(live.high - live.low);
  });

  it("pools only IDENTICAL p: 0.1 and 0.10000001 stay apart", () => {
    const live = [point(3, 0.10000001, 15, 1500)];
    const out = poolPoints(BASE, live);
    expect(out).toHaveLength(4);
    expect(pointAt(out, 3, 0.1)!.shots).toBe(100_000);
    expect(pointAt(out, 3, 0.1)!.live).toBe(false);
    const alone = pointAt(out, 3, 0.10000001)!;
    expect(alone.shots).toBe(1500);
    expect(alone.live).toBe(true);
  });

  it("a live point off the grid keeps the core's estimate by stop reason, a base-only point keeps the base's", () => {
    const live = point(3, 0.08, 100, 4000, {
      estimate: 99 / 3999,
      stopReason: "failures",
    });
    const out = poolPoints(BASE, [live]);
    expect(pointAt(out, 3, 0.08)!.estimate).toBe(99 / 3999);
    expect(pointAt(out, 3, 0.08)!.stopReason).toBe("failures");
    expect(pointAt(out, 5, 0.1)!.estimate).toBe(BASE[1]!.estimate);
    expect(pointAt(out, 5, 0.1)!.stopReason).toBe("shots");
  });

  it("live: true only when live shots exist; a live lane with 0 shots is not live", () => {
    const out = poolPoints(BASE, [point(3, 0.1, 0, 0), point(3, 0.08, 0, 0)]);
    expect(pointAt(out, 3, 0.1)!.live).toBe(false);
    expect(pointAt(out, 3, 0.08)!.live).toBe(false);
  });

  it("upperBoundOnly follows the pooled failures: a bound in one part plus a failure in the other is a point", () => {
    const base = [point(7, 0.03, 0, 1000)];
    expect(poolPoints(base, [])[0]!.upperBoundOnly).toBe(true);
    expect(poolPoints(base, [point(7, 0.03, 1, 1000)])[0]!.upperBoundOnly).toBe(
      false,
    );
  });

  it("a validated base point plus a live lane with no failure yet: the pooled value, not the lane's zero", () => {
    // The first turns of the Worker at a grid p: k_live = 0 over 100 shots on top
    // of 2892 / 10⁵ validated.
    const base = [point(3, 0.03, 2892, 100_000, { stopReason: "shots" })];
    const [pooled] = poolPoints(base, [point(3, 0.03, 0, 100)]);
    expect(pooled!.failures).toBe(2892);
    expect(pooled!.shots).toBe(100_100);
    expect(pooled!.estimate).toBe(2892 / 100_100);
    expect(pooled!.upperBoundOnly).toBe(false);
    expect(pooled!.live).toBe(true);
    expect(pooled!.liveShots).toBe(100);
    const w = wilsonInterval(2892, 100_100);
    expect(pooled!.low).toBe(w.low);
    expect(pooled!.high).toBe(w.high);
  });

  it("returns the union sorted by d then p", () => {
    const out = poolPoints(BASE, [
      point(5, 0.05, 1, 10),
      point(3, 0.05, 1, 10),
    ]);
    expect(out.map((pt) => [pt.d, pt.p])).toEqual([
      [3, 0.05],
      [3, 0.1],
      [5, 0.05],
      [5, 0.1],
      [7, 0.1],
    ]);
  });

  it("two live points with the same (d, p) are a protocol error", () => {
    expect(() =>
      poolPoints([], [point(3, 0.1, 1, 10), point(3, 0.1, 2, 10)]),
    ).toThrow(RangeError);
  });
});

describe("shotsRange", () => {
  it("is the smallest and largest shots of the set; equal for a uniform base; {0, 0} when empty", () => {
    expect(shotsRange(BASE)).toEqual({ min: 100_000, max: 100_000 });
    expect(
      shotsRange([
        point(3, 0.03, 100, 100_000),
        point(5, 0.03, 100, 350_000),
        point(7, 0.03, 100, 1_000_000),
      ]),
    ).toEqual({ min: 100_000, max: 1_000_000 });
    expect(shotsRange([])).toEqual({ min: 0, max: 0 });
  });
});

describe("lambdaAt", () => {
  it("is the ratio of the pooled counts at (d, p) and (d + 2, p) with an interval", () => {
    const out = poolPoints(BASE, []);
    const lambda = lambdaAt(out, 3, 0.1)!;
    expect(lambda.ratio).toBeCloseTo(2, 12);
    expect(lambda.low).toBeLessThan(2);
    expect(lambda.high).toBeGreaterThan(2);
    expect(lambdaAt(out, 5, 0.1)!.ratio).toBeCloseTo(2.5, 12);
  });

  it("is null when a point is missing or has no failure", () => {
    const out = poolPoints(BASE, [
      point(3, 0.08, 5, 100),
      point(5, 0.08, 0, 100),
    ]);
    expect(lambdaAt(out, 3, 0.08)).toBeNull(); // k(5, 0.08) = 0
    expect(lambdaAt(out, 5, 0.08)).toBeNull(); // (7, 0.08) missing
    expect(lambdaAt(out, 7, 0.1)).toBeNull(); // no d = 9
  });
});
