// The validated base curves the chart shows at once (docs/spec.md §3 "Curvas base
// precomputadas"; tasks/plans/ui.md D3, R10; phase2.md D10): one per noise
// model, docs/validacion/browser.json (independent) and
// browser-phenomenological.json (phenomenological), the files npm run validate
// regenerates and CI diffs byte for byte, so what the app serves is always what
// was validated against PyMatching. loadBaseline checks the shape here (schema,
// noise model, grid size, numeric fields); that a file describes THIS core
// (weights, geometry) is tests/intent/chart-conventions. Developer-facing
// messages go through `new Error(...)`, the one place the literal detector
// exempts by design: nothing here reaches the screen.
import type { StopReason } from "../../core";
import browser from "../../../docs/validacion/browser.json";
import browserPhenomenological from "../../../docs/validacion/browser-phenomenological.json";
import { isNoiseKind, type NoiseKind } from "../model/noise-kinds";

export interface BaselinePoint {
  readonly d: number;
  readonly p: number;
  readonly shots: number;
  readonly failures: number;
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly stopReason: StopReason;
  readonly upperBoundOnly: boolean;
}

export interface Baseline {
  /** The noise model the file was validated under (its `noise` field). */
  readonly noise: NoiseKind;
  readonly distances: readonly number[];
  readonly probabilities: readonly number[];
  readonly points: readonly BaselinePoint[];
  /** Metadata the intent test compares with the core. */
  readonly weightsSample: Readonly<Record<string, number>>;
  readonly geometry: Readonly<Record<string, readonly (readonly unknown[])[]>>;
}

export interface BaselineShape {
  readonly noise: NoiseKind;
  /** Points of the model's validation grid. */
  readonly points: number;
}

/** docs/spec.md §6: d ∈ {3, 5, 7} × 8 values of p, in both models (phase2.md D6). */
export const BASELINE_POINT_COUNT = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown, at: string, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: ${at} must be a finite number`);
  }
  return value;
}

function stopReason(value: unknown, at: string, where: string): StopReason {
  if (
    value === "shots" ||
    value === "failures" ||
    value === "cap" ||
    value === "budget"
  ) {
    return value;
  }
  throw new Error(`${where}: ${at} is not a stop reason`);
}

/**
 * Validates a parsed browser*.json against the model and grid size expected
 * and returns the base curves. Throws on any other shape, including the file
 * of the other model.
 */
export function loadBaseline(json: unknown, expected: BaselineShape): Baseline {
  const where = `${expected.noise} baseline`; // i18n-exempt: prefix of developer-facing Error messages
  if (!isRecord(json)) throw new Error(`${where}: not an object`);
  if (json["schema"] !== 1) {
    throw new Error(
      `${where}: schema must be 1, got ${String(json["schema"])}`,
    );
  }
  const noise = json["noise"];
  if (!isNoiseKind(noise) || noise !== expected.noise) {
    throw new Error(
      `${where}: unexpected noise model ${String(noise)}, expected ${expected.noise}`,
    );
  }
  const weights = json["weights"];
  if (!isRecord(weights) || !isRecord(weights["sample"])) {
    throw new Error(`${where}: weights.sample must be an object`);
  }
  const weightsSample: Record<string, number> = {};
  for (const [q, w] of Object.entries(weights["sample"])) {
    weightsSample[q] = number(w, q, where);
  }
  const geometry = json["geometry"];
  if (!isRecord(geometry))
    throw new Error(`${where}: geometry must be an object`);
  const tables: Record<string, (readonly unknown[])[]> = {};
  for (const [d, table] of Object.entries(geometry)) {
    if (!Array.isArray(table) || table.some((e) => !Array.isArray(e))) {
      throw new Error(`${where}: geometry ${d} must be a list of lists`);
    }
    tables[d] = table as (readonly unknown[])[];
  }
  const raw = json["points"];
  if (!Array.isArray(raw)) throw new Error(`${where}: points must be an array`);
  if (raw.length !== expected.points) {
    throw new Error(
      `${where}: expected ${expected.points} points, got ${raw.length}`,
    );
  }
  const points = raw.map((pt: unknown, index): BaselinePoint => {
    const at = `#${index}`;
    if (!isRecord(pt))
      throw new Error(`${where}: point ${at} is not an object`);
    const failures = number(pt["failures"], at, where);
    const shots = number(pt["shots"], at, where);
    if (
      !Number.isInteger(failures) ||
      !Number.isInteger(shots) ||
      failures > shots
    ) {
      throw new Error(`${where}: point ${at} has impossible counts`);
    }
    if (pt["upperBoundOnly"] !== (failures === 0)) {
      throw new Error(
        `${where}: point ${at} upperBoundOnly disagrees with failures`,
      );
    }
    return {
      d: number(pt["d"], at, where),
      p: number(pt["p"], at, where),
      shots,
      failures,
      estimate: number(pt["estimate"], at, where),
      low: number(pt["low"], at, where),
      high: number(pt["high"], at, where),
      stopReason: stopReason(pt["stopReason"], at, where),
      upperBoundOnly: failures === 0,
    };
  });
  const distances = [...new Set(points.map((pt) => pt.d))].sort(
    (a, b) => a - b,
  );
  const probabilities = [...new Set(points.map((pt) => pt.p))].sort(
    (a, b) => a - b,
  );
  if (distances.length * probabilities.length !== points.length) {
    throw new Error(`${where}: points do not form a full grid`);
  }
  return {
    noise,
    distances,
    probabilities,
    points,
    weightsSample,
    geometry: tables,
  };
}

/** The committed base curves of each model, validated once at module load. */
export const BASELINES: Readonly<Record<NoiseKind, Baseline>> = Object.freeze({
  independent: loadBaseline(browser, {
    noise: "independent",
    points: BASELINE_POINT_COUNT,
  }),
  phenomenological: loadBaseline(browserPhenomenological, {
    noise: "phenomenological",
    points: BASELINE_POINT_COUNT,
  }),
});

/** The phase 1 base (independent noise): the default model's curves. */
export const BASELINE: Baseline = BASELINES.independent;
