import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  estimatePoint,
  exactSpacetimeFailureCounts,
  PHENOMENOLOGICAL_MODEL,
  pointSeed,
  rotatedSurfaceCode,
  VALIDATION_STOP_RULE,
} from "../../src/core/index";
import {
  asValidationFile,
  coreMetadata,
  serializeValidationFile,
  VALIDATION_GRID,
  VALIDATION_GRID_PHENOMENOLOGICAL,
} from "../../tools/validate/format";
import {
  engineBlock,
  EXACT_PROBE_PROBABILITIES,
  EXACT_PROBE_RULE,
  GENERATOR,
  pointRecord,
  runGrid,
} from "../../tools/validate/run";

// 24 points × 500 shots; d = 7, p = 0.15 is ≈ 16 ms. Margin for a loaded CI runner.
vi.setConfig({ testTimeout: 30_000 });

/** T-R1 — runGrid is deterministic and complete (tasks/plans/validation.md). */
describe("T-R1 runGrid (tools/validate/run.ts)", () => {
  const rule = { minFailures: 5, minShots: 500, maxShots: 500 };

  it("covers the 24 points of the grid in order, all stopped by shots, and calls onPoint per point", () => {
    const seen: [number, number][] = [];
    const file = runGrid({
      seed: 1,
      rule,
      onPoint: (e, seconds) => {
        seen.push([e.d, e.p]);
        expect(seconds).toBeGreaterThanOrEqual(0);
      },
    });
    const expected: [number, number][] = [];
    for (const d of VALIDATION_GRID.distances) {
      for (const p of VALIDATION_GRID.probabilities) expected.push([d, p]);
    }
    expect(seen).toEqual(expected);
    expect(file.points.map((pt) => [pt.d, pt.p])).toEqual(expected);
    for (const pt of file.points) {
      expect(pt.shots).toBe(500);
      expect(pt.stopReason).toBe("shots");
      expect(pt.estimate).toBe(pt.failures / 500);
      expect(pt.failures).toBeGreaterThanOrEqual(5);
      expect(pt.low).toBeLessThanOrEqual(pt.estimate);
      expect(pt.high).toBeGreaterThanOrEqual(pt.estimate);
      expect(pt.upperBoundOnly).toBe(false);
    }
  });

  it("writes the shared metadata from the core and no timestamp", () => {
    const file = runGrid({ seed: 1, rule });
    expect(file.schema).toBe(1);
    expect(file.generator).toBe(GENERATOR);
    expect(file.noise).toBe("independent");
    expect(file.seed).toBe(1);
    expect(file.stopRule).toEqual(rule);
    expect(file.weights).toEqual(coreMetadata().weights);
    expect(file.geometry).toEqual(coreMetadata().geometry);
    expect(file.engine).toEqual(engineBlock());
    expect(file.engine["name"]).toBe("syndrome-core");
    // Node by major version only: the exact patch differs between machines and the
    // file must be byte-identical in CI (run.ts engineBlock).
    expect(file.engine["node"]).toMatch(/^\d+$/);
    expect(Object.keys(file)).toEqual([
      "schema",
      "generator",
      "engine",
      "noise",
      "stopRule",
      "seed",
      "weights",
      "geometry",
      "points",
    ]);
    const text = serializeValidationFile(file);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(/"(date|generatedAt|timestamp)"/);
  });

  it("each point is estimatePoint with pointSeed(seed, d, p): 24 distinct seeds, the record of each", () => {
    const seed = 7;
    const file = runGrid({ seed, rule });
    const seeds = new Set<number>();
    for (const pt of file.points) {
      const s = pointSeed(seed, pt.d, pt.p);
      seeds.add(s);
      const want = pointRecord(
        estimatePoint(rotatedSurfaceCode(pt.d), pt.p, s, rule),
      );
      expect(pt, `d = ${pt.d}, p = ${pt.p}`).toEqual(want);
    }
    expect(seeds.size).toBe(24);
    // Positive control: the same point under another point's seed is a different record
    // (otherwise the comparison above could not see a seed shared by all 24 points).
    const first = file.points[0]!;
    const other = pointRecord(
      estimatePoint(
        rotatedSurfaceCode(first.d),
        first.p,
        pointSeed(seed, 3, 0.1),
        rule,
      ),
    );
    expect(other).not.toEqual(first);
  });

  it("two runs with the same seed serialise to the same bytes; a different seed does not", () => {
    const a = serializeValidationFile(runGrid({ seed: 1, rule }));
    const b = serializeValidationFile(runGrid({ seed: 1, rule }));
    const c = serializeValidationFile(runGrid({ seed: 2, rule }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  /**
   * T-R2 (tasks/plans/phase2.md): the independent grid of runGrid is byte for byte
   * what it was before the second model existed. Literal recorded on the code of
   * main (before run.ts was touched for phase 2): sha256 of
   * serializeValidationFile with `engine` emptied (the engine block carries the Node
   * major version, which is not what this snapshot pins).
   */
  it("T-R2 snapshot: the small-rule independent grid serialises to the recorded sha256", () => {
    const file = runGrid({ seed: 1, rule });
    const text = serializeValidationFile({ ...file, engine: {} });
    expect(text).toHaveLength(11_751);
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      "9665c0c1c04e206084a0d424ace76437ab6fc6bf8c2985a4d06f3f08768e4db4",
    );
  });

  /** T-R2 (phase2.md): the phenomenological grid, same shape, its own grid, model block and probe. */
  it("T-R2 model phenomenological: 24 points of the D6 grid in order, model and exactProbe, deterministic", () => {
    const seen: [number, number][] = [];
    const file = runGrid({
      seed: 1,
      rule,
      model: "phenomenological",
      onPoint: (e) => seen.push([e.d, e.p]),
    });
    const expected: [number, number][] = [];
    for (const d of VALIDATION_GRID_PHENOMENOLOGICAL.distances) {
      for (const p of VALIDATION_GRID_PHENOMENOLOGICAL.probabilities)
        expected.push([d, p]);
    }
    expect(seen).toEqual(expected);
    expect(file.points.map((pt) => [pt.d, pt.p])).toEqual(expected);
    expect(file.noise).toBe("phenomenological");
    expect(file.model).toEqual({ cycles: "d", q: "p" });
    expect(file.weights).toEqual(coreMetadata("phenomenological").weights);
    expect(Object.keys(file.weights.sample)).toContain("1088");
    expect(Object.keys(file)).toEqual([
      "schema",
      "generator",
      "engine",
      "noise",
      "model",
      "stopRule",
      "seed",
      "weights",
      "geometry",
      "exactProbe",
      "points",
    ]);
    // Each point is estimatePoint with the phenomenological model (cycles = d).
    const first = file.points[0]!;
    expect(first).toEqual(
      pointRecord(
        estimatePoint(
          rotatedSurfaceCode(3),
          first.p,
          pointSeed(1, 3, first.p),
          rule,
          PHENOMENOLOGICAL_MODEL,
        ),
      ),
    );
    // The probe: the core's own a_w tables and three d = 3 points of cycles = 1
    // under the probe rule, reproduced by estimatePoint with {cycles: 1}.
    const probe = file.exactProbe!;
    const code3 = rotatedSurfaceCode(3);
    expect(probe.d).toBe(3);
    expect(probe.cycles).toBe(1);
    expect(probe.stopRule).toEqual(EXACT_PROBE_RULE);
    expect(probe.counts.Z).toEqual(
      Array.from(exactSpacetimeFailureCounts(code3, "Z", 1)),
    );
    expect(probe.counts.X).toEqual(
      Array.from(exactSpacetimeFailureCounts(code3, "X", 1)),
    );
    expect(probe.points.map((pt) => pt.p)).toEqual([
      ...EXACT_PROBE_PROBABILITIES,
    ]);
    expect(probe.points[1]).toEqual(
      pointRecord(
        estimatePoint(code3, 0.03, pointSeed(1, 3, 0.03), EXACT_PROBE_RULE, {
          kind: "phenomenological",
          cycles: 1,
        }),
      ),
    );
    expect(asValidationFile(JSON.parse(serializeValidationFile(file)))).toEqual(
      file,
    );
    const again = runGrid({ seed: 1, rule, model: "phenomenological" });
    expect(serializeValidationFile(again)).toBe(serializeValidationFile(file));
  });

  it("rejects an invalid rule before simulating anything", () => {
    expect(() =>
      runGrid({ seed: 1, rule: { ...rule, minShots: 1000 } }),
    ).toThrow(RangeError);
    expect(VALIDATION_STOP_RULE.minShots).toBe(100_000);
  });
});
