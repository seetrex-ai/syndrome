import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  exactSpacetimeFailureCounts,
  rotatedSurfaceCode,
  VALIDATION_STOP_RULE,
} from "../../src/core/index";
import {
  buildReport,
  checkConsistency,
  checkMetadata,
  checkMinWeights,
  compareFiles,
  exactCheck,
  exactCountsD3,
  exactProbeCheck,
  exactSpacetimeCountsD3,
  MAX_PARITY_MISMATCHES,
} from "../../tools/validate/compare";
import {
  readMinWeightsFixture,
  readValidationFile,
  readVerdictsFixture,
  VALIDATION_GRID,
  VALIDATION_GRID_PHENOMENOLOGICAL,
} from "../../tools/validate/format";
import { GENERATOR } from "../../tools/validate/run";

/**
 * T-F1…T-F3 — the committed validation files (tasks/plans/validation.md §4). The
 * three JSON files are artefacts of `uv run tools/reference/run.py` (reference,
 * min-weights) and `npm run validate` (browser); they are committed together and
 * `npm test` repeats the verdict of the validation on them (cheap: milliseconds).
 * A missing file is red, never skipped. If browser.json is regenerated with another
 * core and reference.json is not, this goes red: that is the point (R11).
 */

const DIR = join(process.cwd(), "docs", "validacion");
const REFERENCE = join(DIR, "reference.json");
const BROWSER = join(DIR, "browser.json");
const MIN_WEIGHTS = join(DIR, "min-weights.json");

describe("T-F1 the committed files exist, describe the core and cover the grid", () => {
  it("reference.json and browser.json parse, their metadata is the core's, 24 points on the grid", () => {
    for (const path of [REFERENCE, BROWSER, MIN_WEIGHTS]) {
      expect(existsSync(path), `${path} missing`).toBe(true);
    }
    const ref = readValidationFile(REFERENCE);
    const ts = readValidationFile(BROWSER);
    expect(ref.generator).toBe("tools/reference/run.py");
    expect(ts.generator).toBe(GENERATOR);
    expect(checkMetadata(ref)).toEqual([]);
    expect(checkMetadata(ts)).toEqual([]);
    // R8: the files are regenerated, never edited. Every point agrees with its own
    // counts under the core's estimators, bit for bit, in both generators.
    expect(checkConsistency(ref)).toEqual([]);
    expect(checkConsistency(ts)).toEqual([]);
    for (const file of [ref, ts]) {
      expect(file.points).toHaveLength(24);
      let i = 0;
      for (const d of VALIDATION_GRID.distances) {
        for (const p of VALIDATION_GRID.probabilities) {
          const pt = file.points[i++]!;
          expect([pt.d, pt.p]).toEqual([d, p]);
          // M3: every grid point has far more than 100 failures in 10⁵ shots; if one
          // day it does not, this names it rather than letting the rule change silently.
          expect(
            pt.failures,
            `failures at d = ${d}, p = ${p}`,
          ).toBeGreaterThanOrEqual(VALIDATION_STOP_RULE.minFailures);
          expect(
            pt.shots,
            `shots at d = ${d}, p = ${p}`,
          ).toBeGreaterThanOrEqual(VALIDATION_STOP_RULE.minShots);
          expect(pt.shots).toBeLessThanOrEqual(VALIDATION_STOP_RULE.maxShots);
          expect(pt.upperBoundOnly).toBe(false);
          expect(pt.low).toBeLessThanOrEqual(pt.estimate);
          expect(pt.estimate).toBeLessThanOrEqual(pt.high);
        }
      }
    }
  });
});

describe("T-F2 npm test repeats the validation verdict on the committed files", () => {
  it("compareFiles(reference, browser) passes and the reference matches the exact d = 3 curve", () => {
    const ref = readValidationFile(REFERENCE);
    const ts = readValidationFile(BROWSER);
    const grid = compareFiles(ref, ts);
    expect(grid.reasons).toEqual([]);
    expect(grid.pass).toBe(true);
    expect(grid.maxAbsZ).toBeLessThanOrEqual(3);
    expect(grid.sumZ2).toBeLessThan(43);
    const counts = exactCountsD3();
    const exactRef = exactCheck(ref, counts);
    expect(exactRef.reasons).toEqual([]);
    expect(exactRef.pass).toBe(true);
    // Informative for the browser side (the core's own tests gate it), but it must
    // hold too: the TS Monte Carlo of d = 3 against its own exact enumeration.
    expect(exactCheck(ts, counts).pass).toBe(true);
  });

  it("the whole report passes", () => {
    const report = buildReport(
      readValidationFile(REFERENCE),
      readValidationFile(BROWSER),
      readMinWeightsFixture(MIN_WEIGHTS),
    );
    expect(report.reasons).toEqual([]);
    expect(report.pass).toBe(true);
    // The crossing is informative, never a gate (docs/spec.md §6.4), for both files: a
    // legitimate regeneration of browser.json with another seed can put the (3, 5)
    // crossing of the core at 0.0895, and `uv run tools/reference/run.py --seed N`
    // regenerates reference.json just as legitimately (measured: a reference with
    // another seed crosses at 0.0891), while `npm run validate` says PASA; `npm test`
    // must not go red for either (the commit guard has no hatch for a red suite). No
    // 9–11 % band anywhere: the expected band is documented, not asserted. What is
    // asserted: one descending crossing per pair in both files.
    for (const c of [
      ...report.crossings.reference,
      ...report.crossings.browser,
    ]) {
      expect(c.pCross).not.toBeNull();
      expect(c.inverted).toBe(false);
      expect(c.note).toBe("cruce único");
    }
  });
});

/**
 * T-F5 — the three phase 1 files are NOT regenerated by phase 2 (tasks/plans/phase2.md
 * D9: «los tres ficheros de fase 1 no se regeneran ni se tocan»). The sha256 of each,
 * as docs/validacion.md records them, is a literal here: a change that regenerates one
 * of them goes red in this test, not silently in a diff nobody reads. EXPIRA SI: a
 * decision on weights or seed regenerates the phase 1 files (then the literals change
 * in the same commit as docs/validacion.md and docs/decisiones.md).
 */
describe("T-F5 the phase 1 files are byte-identical to their recorded sha256", () => {
  it.each([
    [
      "browser.json",
      "6390b3f2f3c60d25d05176c3e7754cc72565bd9f7fe338a0b8df776d0ca9f98a",
    ],
    [
      "min-weights.json",
      "cf0e3468e39c52c5350c4207612ad36bfe19c061002d68a6b7f173d2fd856b73",
    ],
    [
      "reference.json",
      "9c8b09678289285df20062070e4394efdd846df5734b50d7c5a28a6d831d9d2e",
    ],
  ])("%s has sha256 %s", (name, sha256) => {
    const bytes = readFileSync(join(DIR, name));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });
});

/**
 * T-F4 — the four committed phenomenological files (tasks/plans/phase2.md D7–D9):
 * reference-phenomenological.json and min-weights-phenomenological.json and
 * verdicts-phenomenological.json by `uv run tools/reference/run.py --model
 * phenomenological`, browser-phenomenological.json by `npm run validate -- --model
 * phenomenological`. `npm test` repeats the verdict of that validation on them.
 */
describe("T-F4 the committed phenomenological files describe the core and pass every gate", () => {
  const REFERENCE_3D = join(DIR, "reference-phenomenological.json");
  const BROWSER_3D = join(DIR, "browser-phenomenological.json");
  const MIN_WEIGHTS_3D = join(DIR, "min-weights-phenomenological.json");
  const VERDICTS_3D = join(DIR, "verdicts-phenomenological.json");

  it("the four files exist and parse; noise, model, 24 points of the D6 grid, metadata and consistency", () => {
    for (const path of [
      REFERENCE_3D,
      BROWSER_3D,
      MIN_WEIGHTS_3D,
      VERDICTS_3D,
    ]) {
      expect(existsSync(path), `${path} missing`).toBe(true);
    }
    const ref = readValidationFile(REFERENCE_3D);
    const ts = readValidationFile(BROWSER_3D);
    expect(ref.generator).toBe("tools/reference/run.py");
    expect(ts.generator).toBe(GENERATOR);
    for (const file of [ref, ts]) {
      expect(file.noise).toBe("phenomenological");
      expect(file.model).toEqual({ cycles: "d", q: "p" });
      expect(checkMetadata(file)).toEqual([]);
      expect(checkConsistency(file)).toEqual([]);
      expect(file.points).toHaveLength(24);
      let i = 0;
      for (const d of VALIDATION_GRID_PHENOMENOLOGICAL.distances) {
        for (const p of VALIDATION_GRID_PHENOMENOLOGICAL.probabilities) {
          const pt = file.points[i++]!;
          expect([pt.d, pt.p]).toEqual([d, p]);
          expect(pt.failures).toBeGreaterThanOrEqual(
            VALIDATION_STOP_RULE.minFailures,
          );
          expect(pt.shots).toBeGreaterThanOrEqual(
            VALIDATION_STOP_RULE.minShots,
          );
          expect(pt.shots).toBeLessThanOrEqual(VALIDATION_STOP_RULE.maxShots);
          expect(pt.upperBoundOnly).toBe(false);
        }
      }
      // D6: d = 7, p = 0.005 is the first grid point ever to stop by failures
      // (≈ 3·10⁻⁴): the Haldane estimator is exercised on both sides.
      const sparse = file.points.find((pt) => pt.d === 7 && pt.p === 0.005)!;
      expect(sparse.stopReason).toBe("failures");
      expect(sparse.failures).toBe(VALIDATION_STOP_RULE.minFailures);
      expect(sparse.estimate).toBe((sparse.failures - 1) / (sparse.shots - 1));
    }
    expect(ref.engine["stim"]).toMatch(/^\d+\.\d+/);
  });

  it("exactProbe: a_w of the reference EQUAL the core's enumeration, probe points within tolerance", () => {
    const ref = readValidationFile(REFERENCE_3D);
    const code3 = rotatedSurfaceCode(3);
    expect(ref.exactProbe!.counts.Z).toEqual(
      Array.from(exactSpacetimeFailureCounts(code3, "Z", 1)),
    );
    expect(ref.exactProbe!.counts.X).toEqual(
      Array.from(exactSpacetimeFailureCounts(code3, "X", 1)),
    );
    const counts = exactSpacetimeCountsD3();
    const probe = exactProbeCheck(ref, counts);
    expect(probe.reasons).toEqual([]);
    expect(probe.pass).toBe(true);
    expect(exactProbeCheck(readValidationFile(BROWSER_3D), counts).pass).toBe(
      true,
    );
  });

  it("the fixtures have the shape the plan fixes: 10⁴ spacetime cases with cycles = d, ≥ 1 000 per (d, type); 10⁴ verdicts", () => {
    const fixture = readMinWeightsFixture(MIN_WEIGHTS_3D);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10_000);
    const perKey = new Map<string, number>();
    for (const c of fixture.cases) {
      expect(c.cycles).toBe(c.d);
      const key = `${c.d}${c.type}`;
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }
    for (const d of [3, 5, 7, 9]) {
      for (const type of ["Z", "X"]) {
        expect(perKey.get(`${d}${type}`) ?? 0).toBeGreaterThanOrEqual(1000);
      }
    }
    const verdicts = readVerdictsFixture(VERDICTS_3D);
    expect(verdicts.cases.length).toBe(10_000);
    for (const c of verdicts.cases) {
      expect(c.cycles).toBe(c.d);
      expect(c.defects.length).toBeGreaterThan(0);
    }
  });

  // One test for the whole report: the 10⁴ spacetime minimum weights and the 10⁴
  // verdicts are decoded once (≈ 5 s on a laptop), not once per gate.
  it("the whole phenomenological report passes: |z| ≤ 3, Σz² < 43, min weights 10⁴/10⁴, verdicts 10⁴/10⁴ in weight and ≥ 9 995 in parity (the rest listed); crossings descending (informative)", () => {
    const report = buildReport(
      readValidationFile(REFERENCE_3D),
      readValidationFile(BROWSER_3D),
      readMinWeightsFixture(MIN_WEIGHTS_3D),
      undefined,
      readVerdictsFixture(VERDICTS_3D),
    );
    expect(report.grid.reasons).toEqual([]);
    expect(report.grid.maxAbsZ).toBeLessThanOrEqual(3);
    expect(report.grid.sumZ2).toBeLessThan(43);
    expect(report.minWeights.reasons).toEqual([]);
    expect(report.minWeights.mismatches).toEqual([]);
    const v = report.verdicts!;
    expect(v.reasons).toEqual([]);
    expect(v.weightMismatches).toEqual([]);
    expect(v.parityMismatches.length).toBeLessThanOrEqual(
      MAX_PARITY_MISMATCHES,
    );
    for (const m of v.parityMismatches) {
      console.log(
        `parity mismatch (tie or bug): d = ${m.d} ${m.type} p = ${m.p} weight ${m.weight} defects ${JSON.stringify(m.defects)}`,
      );
    }
    expect(report.reasons).toEqual([]);
    expect(report.pass).toBe(true);
    for (const c of [
      ...report.crossings.reference,
      ...report.crossings.browser,
    ]) {
      expect(c.pCross).not.toBeNull();
      expect(c.inverted).toBe(false);
      // The band is informative (docs/spec.md §6.4): printed with the pair, never a gate.
      console.log(
        `phenomenological crossing (${c.pair[0]}, ${c.pair[1]}): p* ≈ ${c.pCross!.toFixed(4)} (${c.note})`,
      );
    }
  }, 60_000);
});

describe("T-F3 min-weights.json through checkMinWeights", () => {
  it("10⁴ cases, zero mismatches, the core's weights block", () => {
    const r = checkMinWeights(
      readMinWeightsFixture(MIN_WEIGHTS),
      "independent",
    );
    expect(r.total).toBeGreaterThanOrEqual(10_000);
    expect(r.reasons).toEqual([]);
    expect(r.mismatches).toEqual([]);
  });
});
