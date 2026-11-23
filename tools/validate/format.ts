// The one shape shared by docs/validacion/reference*.json (tools/reference/run.py,
// PyMatching) and docs/validacion/browser*.json (tools/validate/run.ts, the TS core):
// tasks/plans/validation.md D6, phase 2 tasks/plans/phase2.md D9. compare.ts and the
// chart read either file without branching, and the metadata blocks (weights,
// geometry) let a mirrored geometry or different weights be detected without running
// Python. No timestamp inside: the browser JSON must be reproducible byte for byte
// (CI regenerates it and diffs).
//
// Two noise models, one schema: `noise` discriminates. The phenomenological files add
// `model` ({cycles: "d", q: "p"}: the policy, not numbers) and `exactProbe` (the exact
// cycles = 1, d = 3 enumeration and three Monte Carlo points of that reduced model),
// and sample the weights of four 3D edge indices too. The phase 1 files are untouched.

import { readFileSync } from "node:fs";
import {
  MAX_EDGE_WEIGHT,
  edgeWeight,
  rotatedSurfaceCode,
  WEIGHT_EPSILON_DENOMINATOR,
  WEIGHT_SCALE,
  WEIGHT_SEED,
  type StabilizerType,
  type StopReason,
  type StopRule,
} from "../../src/core/index";

/** The noise models a validation file can describe (NoiseModel["kind"] of the core). */
export type ValidationNoise = "independent" | "phenomenological";

export const VALIDATION_NOISES: readonly ValidationNoise[] = [
  "independent",
  "phenomenological",
];

export interface ValidationGrid {
  readonly distances: readonly number[];
  readonly probabilities: readonly number[];
}

/** The validation grid of docs/spec.md §6 (phase 1 model): d ascending, p ascending, 24 points. */
export const VALIDATION_GRID = {
  distances: [3, 5, 7],
  probabilities: [0.03, 0.05, 0.07, 0.09, 0.1, 0.11, 0.13, 0.15],
} as const;

/** The phenomenological grid (phase2.md D6): same distances, p around the ≈ 2–3 % crossing. */
export const VALIDATION_GRID_PHENOMENOLOGICAL = {
  distances: [3, 5, 7],
  probabilities: [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04],
} as const;

export function gridOf(noise: ValidationNoise): ValidationGrid {
  return noise === "independent"
    ? VALIDATION_GRID
    : VALIDATION_GRID_PHENOMENOLOGICAL;
}

/** Qubit indices whose integer weight both generators record (the T-W2 vector). */
export const WEIGHT_SAMPLE_QUBITS = [0, 1, 2, 8, 24, 48, 80, 120] as const;

/** Edge indices sampled by the phenomenological files: the qubits plus four 3D edges (T-A2). */
export const WEIGHT_SAMPLE_EDGES = [
  0, 1, 2, 8, 24, 48, 80, 81, 120, 343, 511, 1088,
] as const;

export function weightSampleOf(noise: ValidationNoise): readonly number[] {
  return noise === "independent" ? WEIGHT_SAMPLE_QUBITS : WEIGHT_SAMPLE_EDGES;
}

/** Distances whose stabilizer tables both generators record. */
export const GEOMETRY_DISTANCES = [3, 5] as const;

/** One point of the grid: PointEstimate of src/core/sim with its (d, p). */
export interface ValidationPoint {
  readonly d: number;
  readonly p: number;
  readonly shots: number;
  readonly failures: number;
  readonly failuresX: number;
  readonly failuresZ: number;
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly estimateX: number;
  readonly lowX: number;
  readonly highX: number;
  readonly estimateZ: number;
  readonly lowZ: number;
  readonly highZ: number;
  readonly stopReason: StopReason;
  readonly upperBoundOnly: boolean;
}

export interface WeightsBlock {
  /** "0x53594E44": the splitmix64 seed of the generic weights. */
  readonly seed: string;
  readonly scale: number;
  readonly epsilonDenominator: number;
  readonly maxEdgeWeight: number;
  /** Integer weight of each index of weightSampleOf(noise), keyed by the index as text. */
  readonly sample: Readonly<Record<string, number>>;
}

/** [type, plaquette row i, plaquette column j] in global stabilizer order. */
export type GeometryEntry = readonly [StabilizerType, number, number];

/** The policy of the phenomenological model as text (phase2.md D9), never numbers. */
export interface ModelBlock {
  readonly cycles: "d";
  readonly q: "p";
}

/** Cases every min-weights and verdicts fixture must carry (phase2.md D7/D8): 10⁴. */
export const FIXTURE_CASES = 10_000;
/** A fixture must carry at least this many DISTINCT cases: random syndromes repeat at d = 3 by construction, a generator stuck on one case does not pass. */
export const FIXTURE_MIN_DISTINCT = FIXTURE_CASES / 2;
/** min-weights composition (D7): at least this many cases per (d, type) over FIXTURE_DISTANCES. */
export const FIXTURE_MIN_PER_CELL = 1_000;
export const FIXTURE_DISTANCES = [3, 5, 7, 9] as const;
/** verdicts composition (D8): every (d, p, type) cell of this grid is sampled. */
export const VERDICT_DISTANCES = [3, 5, 7] as const;
export const VERDICT_PROBABILITIES = [0.01, 0.02, 0.03] as const;

/** The three p of the exact cycles = 1 probe and its stop rule (10⁵ shots each): the reference uses the same, and the comparator demands exactly this shape. */
export const EXACT_PROBE_PROBABILITIES = [0.01, 0.03, 0.05] as const;
export const EXACT_PROBE_RULE: StopRule = Object.freeze({
  minFailures: 2,
  minShots: 100_000,
  maxShots: 100_000,
});

/**
 * The exact cycles = 1, d = 3 check of the phenomenological model (phase2.md D5/D7):
 * a_w of both types by enumeration of the 2¹³ patterns (compared EXACTLY between the
 * generators) and three Monte Carlo points of that reduced model under their own
 * stop rule (compared statistically with the exact curve).
 */
export interface ExactProbe {
  readonly d: 3;
  readonly cycles: 1;
  readonly stopRule: StopRule;
  readonly counts: {
    readonly Z: readonly number[];
    readonly X: readonly number[];
  };
  readonly points: readonly ValidationPoint[];
}

export interface ValidationFile {
  readonly schema: 1;
  readonly generator: string;
  /** Free-form versions of the engine; keys differ between generators, values are text. */
  readonly engine: Readonly<Record<string, string>>;
  readonly noise: ValidationNoise;
  /** Phenomenological files only. */
  readonly model?: ModelBlock;
  readonly stopRule: StopRule;
  /** Base seed; the per-point seed derives from it (pointSeed in TS, SeedSequence in Python). */
  readonly seed: number;
  readonly weights: WeightsBlock;
  readonly geometry: Readonly<Record<string, readonly GeometryEntry[]>>;
  /** Phenomenological files only. */
  readonly exactProbe?: ExactProbe;
  readonly points: readonly ValidationPoint[];
}

/**
 * docs/validacion/min-weights*.json (tasks/plans/decoder.md §3, tests/validation/min-weights.test.ts).
 * A case with `cycles` is a spacetime syndrome (defects by node index, phase2.md D7);
 * without it, a 2D syndrome (defects by typeIndex).
 */
export interface MinWeightsFixture {
  readonly schema: number;
  readonly generator: string;
  readonly pymatching: string;
  readonly weights: Omit<WeightsBlock, "sample">;
  readonly cases: readonly {
    readonly d: number;
    readonly type: StabilizerType;
    readonly cycles?: number;
    readonly defects: readonly number[];
    readonly weight: number;
  }[];
}

/**
 * docs/validacion/verdicts-phenomenological.json (phase2.md D8): sampled spacetime
 * syndromes with PyMatching's minimum weight and the logical parity of its correction.
 */
export interface VerdictsFixture {
  readonly schema: number;
  readonly generator: string;
  readonly pymatching: string;
  readonly noise: "phenomenological";
  readonly weights: Omit<WeightsBlock, "sample">;
  readonly skippedEmpty: number;
  readonly cases: readonly {
    readonly d: number;
    readonly type: StabilizerType;
    readonly cycles: number;
    readonly p: number;
    readonly defects: readonly number[];
    readonly weight: number;
    readonly parity: 0 | 1;
  }[];
}

/** File names of a model inside docs/validacion/. */
export function fileNamesOf(noise: ValidationNoise): {
  readonly reference: string;
  readonly browser: string;
  readonly minWeights: string;
  readonly verdicts: string | null;
} {
  const suffix = noise === "independent" ? "" : `-${noise}`;
  return {
    reference: `reference${suffix}.json`,
    browser: `browser${suffix}.json`,
    minWeights: `min-weights${suffix}.json`,
    verdicts: noise === "independent" ? null : `verdicts${suffix}.json`,
  };
}

/** The weights block (without the sample) as src/core defines it. */
export function coreWeightsBlock(): Omit<WeightsBlock, "sample"> {
  return {
    seed: `0x${WEIGHT_SEED.toString(16).toUpperCase()}`,
    scale: WEIGHT_SCALE,
    epsilonDenominator: WEIGHT_EPSILON_DENOMINATOR,
    maxEdgeWeight: MAX_EDGE_WEIGHT,
  };
}

/** `weights` and `geometry` emitted from src/core: what browser*.json records and what reference*.json is checked against. */
export function coreMetadata(
  noise: ValidationNoise = "independent",
): Pick<ValidationFile, "weights" | "geometry"> {
  const sample: Record<string, number> = {};
  for (const e of weightSampleOf(noise)) sample[String(e)] = edgeWeight(e);
  const geometry: Record<string, GeometryEntry[]> = {};
  for (const d of GEOMETRY_DISTANCES) {
    geometry[String(d)] = rotatedSurfaceCode(d).stabilizers.map(
      (s): GeometryEntry => [s.type, s.row, s.col],
    );
  }
  return { weights: { ...coreWeightsBlock(), sample }, geometry };
}

const STOP_REASONS: readonly string[] = ["shots", "failures", "cap", "budget"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function fail(where: string, what: string): never {
  throw new Error(`${where}: ${what}`);
}

function checkStopRule(rule: unknown, where: string): void {
  if (
    !isRecord(rule) ||
    !isFiniteNumber(rule["minFailures"]) ||
    !isFiniteNumber(rule["minShots"]) ||
    !isFiniteNumber(rule["maxShots"])
  ) {
    fail(where, "stopRule must have numeric minFailures, minShots, maxShots");
  }
}

function checkPoints(points: unknown, where: string): void {
  if (!Array.isArray(points)) fail(where, "points must be an array");
  points.forEach((pt, index) => {
    const at = `${where}: points[${index}]`;
    if (!isRecord(pt)) fail(at, "not an object");
    for (const key of [
      "d",
      "p",
      "shots",
      "failures",
      "failuresX",
      "failuresZ",
      "estimate",
      "low",
      "high",
      "estimateX",
      "lowX",
      "highX",
      "estimateZ",
      "lowZ",
      "highZ",
    ]) {
      if (!isFiniteNumber(pt[key])) fail(at, `${key} must be a number`);
    }
    if (
      typeof pt["stopReason"] !== "string" ||
      !STOP_REASONS.includes(pt["stopReason"])
    ) {
      fail(at, `stopReason must be one of ${STOP_REASONS.join(", ")}`);
    }
    if (typeof pt["upperBoundOnly"] !== "boolean")
      fail(at, "upperBoundOnly must be a boolean");
  });
}

function isCountTable(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length === 14 &&
    v.every((x) => Number.isInteger(x) && (x as number) >= 0)
  );
}

/**
 * Checks that a parsed JSON value has the ValidationFile shape (types of every field;
 * not its physics: that is compare.ts). Both noise models are accepted; a
 * phenomenological file must carry `model` and `exactProbe`, an independent one must
 * not. Throws an Error naming the offending field.
 */
export function asValidationFile(
  value: unknown,
  where = "validation file",
): ValidationFile {
  if (!isRecord(value)) fail(where, "not an object");
  if (value["schema"] !== 1)
    fail(where, `schema must be 1, got ${String(value["schema"])}`);
  if (typeof value["generator"] !== "string")
    fail(where, "generator must be a string");
  const noise = value["noise"];
  if (noise !== "independent" && noise !== "phenomenological") {
    fail(
      where,
      `noise must be "independent" or "phenomenological", got ${JSON.stringify(noise)}`,
    );
  }
  if (!isFiniteNumber(value["seed"])) fail(where, "seed must be a number");
  const engine = value["engine"];
  if (
    !isRecord(engine) ||
    Object.values(engine).some((v) => typeof v !== "string")
  ) {
    fail(where, "engine must be an object of strings");
  }
  checkStopRule(value["stopRule"], where);
  const weights = value["weights"];
  if (
    !isRecord(weights) ||
    typeof weights["seed"] !== "string" ||
    !isFiniteNumber(weights["scale"]) ||
    !isFiniteNumber(weights["epsilonDenominator"]) ||
    !isFiniteNumber(weights["maxEdgeWeight"]) ||
    !isRecord(weights["sample"]) ||
    Object.values(weights["sample"]).some((v) => !isFiniteNumber(v))
  ) {
    fail(
      where,
      "weights must have seed, scale, epsilonDenominator, maxEdgeWeight and a numeric sample",
    );
  }
  const geometry = value["geometry"];
  if (!isRecord(geometry)) fail(where, "geometry must be an object");
  for (const [d, table] of Object.entries(geometry)) {
    if (
      !Array.isArray(table) ||
      table.some(
        (e) =>
          !Array.isArray(e) ||
          e.length !== 3 ||
          (e[0] !== "X" && e[0] !== "Z") ||
          !Number.isInteger(e[1]) ||
          !Number.isInteger(e[2]),
      )
    ) {
      fail(where, `geometry["${d}"] must be a list of [type, i, j]`);
    }
  }
  const model = value["model"];
  const probe = value["exactProbe"];
  if (noise === "independent") {
    if (model !== undefined) fail(where, "an independent file has no model");
    if (probe !== undefined)
      fail(where, "an independent file has no exactProbe");
  } else {
    if (!isRecord(model) || model["cycles"] !== "d" || model["q"] !== "p") {
      fail(
        where,
        `model must be {cycles: "d", q: "p"} in a phenomenological file`,
      );
    }
    if (
      !isRecord(probe) ||
      probe["d"] !== 3 ||
      probe["cycles"] !== 1 ||
      !isRecord(probe["counts"]) ||
      !isCountTable(probe["counts"]["Z"]) ||
      !isCountTable(probe["counts"]["X"])
    ) {
      fail(
        where,
        "exactProbe must have d = 3, cycles = 1, stopRule, counts.Z and counts.X of 14 integers, and points",
      );
    }
    checkStopRule(probe["stopRule"], `${where}: exactProbe`);
    checkPoints(probe["points"], `${where}: exactProbe`);
  }
  checkPoints(value["points"], where);
  return value as unknown as ValidationFile;
}

export function readValidationFile(path: string): ValidationFile {
  return asValidationFile(JSON.parse(readFileSync(path, "utf8")), path);
}

export function readMinWeightsFixture(path: string): MinWeightsFixture {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(value) ||
    !Array.isArray(value["cases"]) ||
    !isRecord(value["weights"])
  ) {
    fail(path, "not a min-weights fixture (needs weights and cases)");
  }
  return value as unknown as MinWeightsFixture;
}

export function readVerdictsFixture(path: string): VerdictsFixture {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(value) ||
    value["noise"] !== "phenomenological" ||
    !Array.isArray(value["cases"]) ||
    !isRecord(value["weights"]) ||
    value["cases"].some(
      (c) =>
        !isRecord(c) ||
        !Number.isInteger(c["cycles"]) ||
        !Array.isArray(c["defects"]) ||
        !Number.isInteger(c["weight"]) ||
        (c["parity"] !== 0 && c["parity"] !== 1),
    )
  ) {
    fail(
      path,
      "not a verdicts fixture (needs noise phenomenological, weights and cases with cycles, defects, weight, parity)",
    );
  }
  return value as unknown as VerdictsFixture;
}

/** The serialisation both generators use: JSON with indent 1 and a final newline. */
export function serializeValidationFile(file: ValidationFile): string {
  return `${JSON.stringify(file, null, 1)}\n`;
}
