import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOISE_KINDS, type NoiseKind } from "../model/noise-kinds";
import {
  BASELINE,
  BASELINE_POINT_COUNT,
  BASELINES,
  loadBaseline,
} from "./baseline";

const FILES: Readonly<Record<NoiseKind, string>> = {
  independent: "browser.json",
  phenomenological: "browser-phenomenological.json",
};
const real = (noise: NoiseKind): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      join(process.cwd(), "docs", "validacion", FILES[noise]),
      "utf8",
    ),
  ) as Record<string, unknown>;
const shape = (noise: NoiseKind) => ({ noise, points: BASELINE_POINT_COUNT });

const GRIDS: Readonly<Record<NoiseKind, readonly number[]>> = {
  independent: [0.03, 0.05, 0.07, 0.09, 0.1, 0.11, 0.13, 0.15],
  phenomenological: [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04],
};

describe("loadBaseline", () => {
  it.each(NOISE_KINDS)(
    "accepts the committed %s file: 3 distances × 8 probabilities, ≥ 10⁵ shots and ≥ 100 failures per point",
    (noise) => {
      const base = loadBaseline(real(noise), shape(noise));
      expect(base.noise).toBe(noise);
      expect(base.points).toHaveLength(BASELINE_POINT_COUNT);
      expect(base.distances).toEqual([3, 5, 7]);
      expect(base.probabilities).toEqual(GRIDS[noise]);
      for (const pt of base.points) {
        expect(pt.shots).toBeGreaterThanOrEqual(100_000);
        expect(pt.failures).toBeGreaterThanOrEqual(100);
        expect(pt.low).toBeLessThan(pt.estimate);
        expect(pt.estimate).toBeLessThan(pt.high);
        expect(pt.upperBoundOnly).toBe(false);
      }
      // The module-level constants are the same files.
      expect(BASELINES[noise].points).toEqual(base.points);
    },
  );

  it("BASELINE is the independent base and the two bases differ", () => {
    expect(BASELINE).toBe(BASELINES.independent);
    expect(BASELINES.phenomenological.noise).toBe("phenomenological");
    expect(BASELINES.phenomenological.probabilities).not.toEqual(
      BASELINES.independent.probabilities,
    );
  });

  it("rejects the file of the other model, in both directions, and an unknown model", () => {
    expect(() =>
      loadBaseline(real("independent"), shape("phenomenological")),
    ).toThrow(/noise model independent, expected phenomenological/);
    expect(() =>
      loadBaseline(real("phenomenological"), shape("independent")),
    ).toThrow(/noise model phenomenological, expected independent/);
    expect(() =>
      loadBaseline(
        { ...real("independent"), noise: "depolarizing" },
        shape("independent"),
      ),
    ).toThrow(/noise/);
  });

  it("rejects another schema and a wrong point count", () => {
    expect(() =>
      loadBaseline({ ...real("independent"), schema: 2 }, shape("independent")),
    ).toThrow(/schema/);
    const file = real("independent");
    const points = (file["points"] as unknown[]).slice(0, 23);
    expect(() =>
      loadBaseline({ ...file, points }, shape("independent")),
    ).toThrow(/23/);
    // The expected count is the caller's: 23 points pass when 23 are expected.
    expect(() =>
      loadBaseline({ ...file, points }, { noise: "independent", points: 23 }),
    ).toThrow(/full grid/);
  });

  it("rejects a point whose upperBoundOnly disagrees with its failures, or with failures > shots", () => {
    const file = real("independent");
    const points = [...(file["points"] as Record<string, unknown>[])];
    points[0] = { ...points[0]!, upperBoundOnly: true };
    expect(() =>
      loadBaseline({ ...file, points }, shape("independent")),
    ).toThrow(/upperBoundOnly/);
    const broken = [...(file["points"] as Record<string, unknown>[])];
    broken[1] = { ...broken[1]!, failures: 10 ** 7 };
    expect(() =>
      loadBaseline({ ...file, points: broken }, shape("independent")),
    ).toThrow(/counts/);
  });

  it("rejects non-objects and a missing weights sample", () => {
    expect(() => loadBaseline(null, shape("independent"))).toThrow();
    expect(() => loadBaseline([], shape("independent"))).toThrow();
    expect(() =>
      loadBaseline(
        { ...real("independent"), weights: {} },
        shape("independent"),
      ),
    ).toThrow(/weights/);
  });
});
