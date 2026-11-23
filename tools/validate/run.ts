// Runs src/core on the validation grid of docs/spec.md §6 with the same stop rule as the
// PyMatching reference and produces docs/validacion/browser.json (the precomputed base
// curves of §7 and the TS side of the comparison), or, with model "phenomenological",
// browser-phenomenological.json on the grid of tasks/plans/phase2.md D6 (cycles = d)
// with the exact cycles = 1 probe of D5. Deterministic: a fixed base seed, pointSeed per
// (d, p), and no timestamp or machine detail in the output, so two runs on any machine
// write the same bytes (tasks/plans/validation.md D11).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimatePoint,
  exactSpacetimeFailureCounts,
  INDEPENDENT_MODEL,
  PHENOMENOLOGICAL_MODEL,
  pointSeed,
  rotatedSurfaceCode,
  stopRule,
  type ModelSpec,
  type PointEstimate,
  type StopRule,
} from "../../src/core/index";
import {
  coreMetadata,
  EXACT_PROBE_PROBABILITIES,
  EXACT_PROBE_RULE,
  gridOf,
  serializeValidationFile,
  type ExactProbe,
  type ValidationFile,
  type ValidationNoise,
  type ValidationPoint,
} from "./format";

export const GENERATOR = "tools/validate/run.ts";

// The probe's p and stop rule live in format.ts (the comparator demands that
// exact shape); re-exported here for the callers that read them from the runner.
export { EXACT_PROBE_PROBABILITIES, EXACT_PROBE_RULE } from "./format";

export interface RunOptions {
  readonly seed: number;
  readonly rule: StopRule;
  /** Defaults to "independent" (phase 1; the file is byte for byte what it was). */
  readonly model?: ValidationNoise;
  /** Called after each point with its estimate and the seconds it took. */
  readonly onPoint?: (estimate: PointEstimate, seconds: number) => void;
}

/** Version of the core as package.json states it. */
function coreVersion(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

/**
 * Engine block of browser.json. Node is recorded by MAJOR version only (what .nvmrc
 * pins): the exact patch differs between the laptop and the CI runner while the
 * simulation (integer PRNG, integer Blossom, one correctly rounded sqrt in Wilson)
 * does not, and the file must diff clean in CI. The exact process.version of a run
 * goes to docs/validacion.md.
 */
export function engineBlock(): Record<string, string> {
  return {
    name: "syndrome-core",
    version: coreVersion(),
    node: process.versions.node.split(".")[0] ?? process.versions.node,
  };
}

/** PointEstimate → the JSON record, with the key order of the reference generator. */
export function pointRecord(e: PointEstimate): ValidationPoint {
  if (e.stopReason === null) {
    throw new Error(`point (d = ${e.d}, p = ${e.p}) is still running`);
  }
  return {
    d: e.d,
    p: e.p,
    shots: e.shots,
    failures: e.failures,
    failuresX: e.failuresX,
    failuresZ: e.failuresZ,
    estimate: e.estimate,
    low: e.low,
    high: e.high,
    estimateX: e.estimateX,
    lowX: e.lowX,
    highX: e.highX,
    estimateZ: e.estimateZ,
    lowZ: e.lowZ,
    highZ: e.highZ,
    stopReason: e.stopReason,
    upperBoundOnly: e.upperBoundOnly,
  };
}

/**
 * The core's exact probe (phase2.md D5): a_w of both types at d = 3, cycles = 1, and
 * three Monte Carlo points of that reduced model with pointSeed(seed, 3, p) and
 * EXACT_PROBE_RULE. Allocates; ≈ 1 s.
 */
export function coreExactProbe(seed: number): ExactProbe {
  const code = rotatedSurfaceCode(3);
  const model: ModelSpec = { kind: "phenomenological", cycles: 1 };
  return {
    d: 3,
    cycles: 1,
    stopRule: EXACT_PROBE_RULE,
    counts: {
      Z: Array.from(exactSpacetimeFailureCounts(code, "Z", 1)),
      X: Array.from(exactSpacetimeFailureCounts(code, "X", 1)),
    },
    points: EXACT_PROBE_PROBABILITIES.map((p) =>
      pointRecord(
        estimatePoint(code, p, pointSeed(seed, 3, p), EXACT_PROBE_RULE, model),
      ),
    ),
  };
}

/** Simulates the 24 points of the model's grid (d ascending, p ascending) and returns the file to write. */
export function runGrid(opts: RunOptions): ValidationFile {
  const rule = stopRule(opts.rule);
  const noise: ValidationNoise = opts.model ?? "independent";
  const model: ModelSpec =
    noise === "independent" ? INDEPENDENT_MODEL : PHENOMENOLOGICAL_MODEL;
  const grid = gridOf(noise);
  const points: ValidationPoint[] = [];
  for (const d of grid.distances) {
    const code = rotatedSurfaceCode(d);
    for (const p of grid.probabilities) {
      const t0 = performance.now();
      const e = estimatePoint(code, p, pointSeed(opts.seed, d, p), rule, model);
      opts.onPoint?.(e, (performance.now() - t0) / 1000);
      points.push(pointRecord(e));
    }
  }
  const { weights, geometry } = coreMetadata(noise);
  if (noise === "independent") {
    return {
      schema: 1,
      generator: GENERATOR,
      engine: engineBlock(),
      noise,
      stopRule: rule,
      seed: opts.seed,
      weights,
      geometry,
      points,
    };
  }
  return {
    schema: 1,
    generator: GENERATOR,
    engine: engineBlock(),
    noise,
    model: { cycles: "d", q: "p" },
    stopRule: rule,
    seed: opts.seed,
    weights,
    geometry,
    exactProbe: coreExactProbe(opts.seed),
    points,
  };
}

export function writeBrowserJson(file: ValidationFile, path: string): void {
  writeFileSync(path, serializeValidationFile(file), "utf8");
}
