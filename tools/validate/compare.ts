// Statistical comparison of browser*.json (TS core) with reference*.json (PyMatching),
// docs/spec.md §3 «Valores de referencia y tolerancias» and §6 «Validación contra la
// referencia», tasks/plans/validation.md D7/D8/D12; phase 2 (the phenomenological
// model): tasks/plans/phase2.md D6–D9.
//
// Per point: z = (p̂_TS − p̂_ref) / √(σ_TS² + σ_ref²), σ² = p̂(1 − p̂)/n with each file's
// own p̂ and n. Pass iff max |z| ≤ 3 and Σz² < 43 (χ², 24 d.o.f., p > 0.01). More gates:
// the reference against the exact d = 3 curve (independent model: |z| ≤ 3 on the 8
// points and Σz² < 20.1, 8 d.o.f.; phenomenological model: the exact cycles = 1 probe,
// a_w EQUAL by enumeration on both sides and |z| ≤ 3, Σz² < 11.3 on its 3 points; the
// one check of the Python decoder that does not depend on the TS Monte Carlo), the
// exact equality of the 10⁴ minimum weights, the verdicts fixture (phenomenological:
// 10⁴ weights equal and ≥ 9 995 logical parities equal, D8), the metadata of both files
// against the core and the internal consistency of every point with its own counts
// (R8: the files are regenerated, never edited). The curve crossing is informative only
// (§6.4).
//
// «Las curvas no se tocan»: nothing here adjusts, reweights or excludes a point. A
// failure is reported with the list of points; the fix is the simulation (or the
// reference, when the exact check also fails), never the numbers.

import {
  commutes,
  createDecoder,
  createSpacetimeDecoder,
  decode,
  decodeSpacetime,
  EXACT_SPACETIME_MECHANISMS,
  exactFailureCounts,
  exactLogicalRates,
  exactSpacetimeFailureCounts,
  exactSpacetimeRates,
  identity,
  pointRate,
  rotatedSurfaceCode,
  VALIDATION_STOP_RULE,
  wilsonInterval,
  type Decoder,
  type SpacetimeDecoder,
  type StabilizerType,
  type StopRule,
} from "../../src/core/index";
import {
  coreMetadata,
  EXACT_PROBE_PROBABILITIES,
  EXACT_PROBE_RULE,
  FIXTURE_CASES,
  FIXTURE_DISTANCES,
  FIXTURE_MIN_DISTINCT,
  FIXTURE_MIN_PER_CELL,
  GEOMETRY_DISTANCES,
  VERDICT_DISTANCES,
  VERDICT_PROBABILITIES,
  gridOf,
  weightSampleOf,
  type GeometryEntry,
  type MinWeightsFixture,
  type ValidationFile,
  type ValidationNoise,
  type ValidationPoint,
  type VerdictsFixture,
} from "./format";

/** Per-point gate: |z| ≤ 3 (docs/spec.md §3). */
export const MAX_ABS_Z = 3;
/** Global gate on the 24 grid points: Σz² < 43 (χ², 24 d.o.f., p > 0.01). */
export const SUM_Z2_LIMIT_GRID = 43;
/** Gate of the exact d = 3 check on its 8 points: Σz² < 20.1 (χ², 8 d.o.f., p > 0.01). */
export const SUM_Z2_LIMIT_EXACT = 20.1;
/** Gate of the exact cycles = 1 probe on its 3 points: Σz² < 11.3 (χ², 3 d.o.f., p > 0.01). */
export const SUM_Z2_LIMIT_PROBE = 11.3;
/** D8: logical parities of the verdicts fixture that may differ (ties between minimum matchings). */
export const MAX_PARITY_MISMATCHES = 5;

// ---------------------------------------------------------------------------
// Grid comparison (D7)

export interface PointComparison {
  readonly d: number;
  readonly p: number;
  readonly ref: ValidationPoint;
  readonly ts: ValidationPoint;
  readonly z: number;
}

export interface GridComparison {
  readonly points: readonly PointComparison[];
  readonly maxAbsZ: number;
  readonly sumZ2: number;
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

/** Wald variance of a point with its own estimate and shot count; 0 when nothing was sampled. */
function variance(pt: ValidationPoint): number {
  if (pt.shots <= 0) return 0;
  return (pt.estimate * (1 - pt.estimate)) / pt.shots;
}

/**
 * z = (p̂_TS − p̂_ref) / √(σ_TS² + σ_ref²). Both files with zero failures → 0; one of
 * them with zero failures contributes σ = 0 and the other decides; two zero
 * variances with different estimates (k = 0 against k = n) → ±Infinity, which fails.
 */
export function zScore(ref: ValidationPoint, ts: ValidationPoint): number {
  if (ref.failures === 0 && ts.failures === 0) return 0;
  const diff = ts.estimate - ref.estimate;
  const denominator = Math.sqrt(variance(ref) + variance(ts));
  if (denominator === 0) {
    return diff === 0 ? 0 : diff > 0 ? Infinity : -Infinity;
  }
  return diff / denominator;
}

function pointLabel(d: number, p: number): string {
  return `d = ${d}, p = ${p}`;
}

/** Reasons why the points of a file are not the grid of its model in its order; [] when they are. */
export function checkGrid(file: ValidationFile, name: string): string[] {
  const reasons: string[] = [];
  const grid = gridOf(file.noise);
  const expected: { d: number; p: number }[] = [];
  for (const d of grid.distances) {
    for (const p of grid.probabilities) expected.push({ d, p });
  }
  if (file.points.length !== expected.length) {
    reasons.push(
      `${name}: ${file.points.length} puntos en vez de los ${expected.length} de la malla`,
    );
  }
  const n = Math.min(file.points.length, expected.length);
  for (let i = 0; i < n; i++) {
    const got = file.points[i]!;
    const want = expected[i]!;
    if (got.d !== want.d || got.p !== want.p) {
      reasons.push(
        `${name}: el punto ${i} es (${pointLabel(got.d, got.p)}), la malla espera (${pointLabel(want.d, want.p)})`,
      );
    }
  }
  return reasons;
}

/**
 * Compares the two files point by point. Both must describe the same model and hold
 * its grid in order (checkGrid); the points they share are compared even when they
 * do not, so the report shows what it can, but the result then fails with the reasons.
 */
export function compareFiles(
  ref: ValidationFile,
  ts: ValidationFile,
): GridComparison {
  const reasons: string[] = [];
  if (ref.noise !== ts.noise) {
    reasons.push(
      `la referencia describe el modelo "${ref.noise}" y el núcleo "${ts.noise}"`,
    );
  }
  reasons.push(...checkGrid(ref, "referencia"), ...checkGrid(ts, "núcleo"));
  const byKey = new Map<string, ValidationPoint>();
  for (const pt of ts.points) byKey.set(`${pt.d}|${pt.p}`, pt);
  const points: PointComparison[] = [];
  let maxAbsZ = 0;
  let sumZ2 = 0;
  for (const r of ref.points) {
    const t = byKey.get(`${r.d}|${r.p}`);
    if (t === undefined) continue;
    const z = zScore(r, t);
    points.push({ d: r.d, p: r.p, ref: r, ts: t, z });
    maxAbsZ = Math.max(maxAbsZ, Math.abs(z));
    sumZ2 += z * z;
  }
  for (const c of points) {
    if (!(Math.abs(c.z) <= MAX_ABS_Z)) {
      reasons.push(
        `|z| = ${formatZ(Math.abs(c.z))} > ${MAX_ABS_Z} en (${pointLabel(c.d, c.p)}): referencia ${c.ref.estimate}, núcleo ${c.ts.estimate}`,
      );
    }
  }
  if (!(sumZ2 < SUM_Z2_LIMIT_GRID)) {
    reasons.push(
      `Σz² = ${sumZ2.toFixed(2)} ≥ ${SUM_Z2_LIMIT_GRID} (24 g.l., p > 0,01)`,
    );
  }
  return { points, maxAbsZ, sumZ2, pass: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Exact d = 3 (D7, docs/spec.md §6 «Exacto en d = 3»)

export interface ExactCounts {
  readonly Z: Int32Array;
  readonly X: Int32Array;
}

/** a_k of d = 3 for both check types, from the core's own decoder (512 decodes per type). */
export function exactCountsD3(): ExactCounts {
  const code = rotatedSurfaceCode(3);
  return { Z: exactFailureCounts(code, "Z"), X: exactFailureCounts(code, "X") };
}

/** a_w of the reduced spacetime model (d = 3, cycles = 1) for both types, from the core's 3D decoder (8 192 decodes per type). */
export function exactSpacetimeCountsD3(): ExactCounts {
  const code = rotatedSurfaceCode(3);
  return {
    Z: exactSpacetimeFailureCounts(code, "Z", 1),
    X: exactSpacetimeFailureCounts(code, "X", 1),
  };
}

export interface ExactPoint {
  readonly p: number;
  readonly estimate: number;
  readonly exact: number;
  readonly z: number;
}

export interface ExactCheck {
  readonly points: readonly ExactPoint[];
  readonly maxAbsZ: number;
  readonly sumZ2: number;
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

/** z of the points against an exact curve: (p̂ − P) / √(P(1 − P)/n), gated by |z| ≤ 3 and Σz² < limit. */
function exactPoints(
  points: readonly ValidationPoint[],
  exactOf: (p: number) => number,
  sumZ2Limit: number,
  dof: number,
  what: string,
): ExactCheck {
  const out: ExactPoint[] = [];
  const reasons: string[] = [];
  let maxAbsZ = 0;
  let sumZ2 = 0;
  for (const pt of points) {
    const exact = exactOf(pt.p);
    const sigma = Math.sqrt((exact * (1 - exact)) / pt.shots);
    const z = sigma === 0 ? 0 : (pt.estimate - exact) / sigma;
    out.push({ p: pt.p, estimate: pt.estimate, exact, z });
    maxAbsZ = Math.max(maxAbsZ, Math.abs(z));
    sumZ2 += z * z;
    if (!(Math.abs(z) <= MAX_ABS_Z)) {
      reasons.push(
        `|z| = ${formatZ(Math.abs(z))} > ${MAX_ABS_Z} frente al valor exacto en (${what}, p = ${pt.p}): ${pt.estimate} frente a ${exact.toPrecision(10)}`,
      );
    }
  }
  if (out.length === 0) reasons.push(`sin puntos de ${what}`);
  if (!(sumZ2 < sumZ2Limit)) {
    reasons.push(
      `Σz² = ${sumZ2.toFixed(2)} ≥ ${sumZ2Limit} frente al valor exacto (${dof} g.l., p > 0,01)`,
    );
  }
  return { points: out, maxAbsZ, sumZ2, pass: reasons.length === 0, reasons };
}

/**
 * The d = 3 points of a file against the exact P_L of the enumeration, with the
 * variance under the hypothesis: z = (p̂ − P) / √(P(1 − P)/n). Pass iff |z| ≤ 3 on
 * every point and Σz² < 20.1 (8 d.o.f.). A file without d = 3 points fails. Phase 1
 * model only (one perfect cycle): a phenomenological file uses exactProbeCheck.
 */
export function exactCheck(
  file: ValidationFile,
  counts: ExactCounts,
): ExactCheck {
  const n = 9;
  return exactPoints(
    file.points.filter((pt) => pt.d === 3),
    (p) => exactLogicalRates(counts.Z, counts.X, n, p).either,
    SUM_Z2_LIMIT_EXACT,
    8,
    "d = 3",
  );
}

export interface ExactProbeCheck extends ExactCheck {
  /** Reasons of the exact part: a_w tables that differ from the core's, missing probe, wrong d. */
  readonly countReasons: readonly string[];
}

/**
 * The exactProbe of a phenomenological file (phase2.md D5/D7) against the core:
 * counts.Z and counts.X EQUAL to exactSpacetimeFailureCounts (no tolerance: the same
 * decoder must produce the same table), every probe point at d = 3 and consistent
 * with the probe's own stop rule, and its estimate within |z| ≤ 3 of the exact P_L of
 * the reduced model, Σz² < 11.3 (3 d.o.f.). An independent file fails («sin exactProbe»).
 */
export function exactProbeCheck(
  file: ValidationFile,
  counts: ExactCounts,
): ExactProbeCheck {
  const probe = file.exactProbe;
  const empty = (reason: string): ExactProbeCheck => ({
    points: [],
    maxAbsZ: 0,
    sumZ2: 0,
    pass: false,
    reasons: [reason],
    countReasons: [reason],
  });
  if (probe === undefined) return empty("sin exactProbe");
  const countReasons: string[] = [];
  for (const type of ["Z", "X"] as const) {
    const got = probe.counts[type];
    const want = Array.from(counts[type]);
    if (got.length !== want.length || got.some((a, w) => a !== want[w])) {
      countReasons.push(
        `exactProbe.counts.${type} = [${got.join(", ")}] ≠ núcleo [${want.join(", ")}]`,
      );
    }
  }
  for (const pt of probe.points) {
    if (pt.d !== 3) countReasons.push(`exactProbe: punto con d = ${pt.d} ≠ 3`);
  }
  // The probe's shape is part of the gate: fewer
  // points, other p or a weaker stop rule would pass the statistics in silence.
  const got = probe.points.map((pt) => pt.p);
  if (
    got.length !== EXACT_PROBE_PROBABILITIES.length ||
    got.some((p, i) => p !== EXACT_PROBE_PROBABILITIES[i])
  ) {
    countReasons.push(
      `exactProbe: puntos en p = [${got.join(", ")}] ≠ [${EXACT_PROBE_PROBABILITIES.join(", ")}]`,
    );
  }
  const rule = probe.stopRule;
  if (
    rule.minFailures !== EXACT_PROBE_RULE.minFailures ||
    rule.minShots !== EXACT_PROBE_RULE.minShots ||
    rule.maxShots !== EXACT_PROBE_RULE.maxShots
  ) {
    countReasons.push(
      `exactProbe: stopRule ${JSON.stringify(rule)} ≠ ${JSON.stringify(EXACT_PROBE_RULE)}`,
    );
  }
  countReasons.push(
    ...checkPointsConsistency(probe.points, probe.stopRule).map(
      (r) => `exactProbe ${r}`,
    ),
  );
  const stats = exactPoints(
    probe.points,
    (p) =>
      exactSpacetimeRates(counts.Z, counts.X, EXACT_SPACETIME_MECHANISMS, p)
        .either,
    SUM_Z2_LIMIT_PROBE,
    3,
    "d = 3, cycles = 1",
  );
  const reasons = [...countReasons, ...stats.reasons];
  return { ...stats, reasons, pass: reasons.length === 0, countReasons };
}

// ---------------------------------------------------------------------------
// Metadata against the core (D6, R1: a mirrored geometry is invisible to P_L)

function sameEntry(a: GeometryEntry, b: GeometryEntry): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Reasons why the metadata of a file is not what src/core defines: schema, model
 * block (present with {cycles: "d", q: "p"} iff phenomenological), exactProbe
 * presence, stop rule, weights block, weight sample (8 qubits, or 12 edge indices in
 * the phenomenological model) and the stabilizer tables of d = 3 and 5, entry by
 * entry. [] = the file describes the core's geometry and weights.
 */
export function checkMetadata(file: ValidationFile): string[] {
  const reasons: string[] = [];
  const core = coreMetadata(file.noise);
  if (file.schema !== 1) reasons.push(`schema ${String(file.schema)} ≠ 1`);
  if (file.noise === "independent") {
    if (file.model !== undefined)
      reasons.push(
        `model ${JSON.stringify(file.model)} en un fichero independiente`,
      );
    if (file.exactProbe !== undefined)
      reasons.push("exactProbe en un fichero independiente");
  } else {
    if (
      file.model === undefined ||
      file.model.cycles !== "d" ||
      file.model.q !== "p"
    ) {
      reasons.push(
        `model ${JSON.stringify(file.model)} ≠ {"cycles": "d", "q": "p"}`,
      );
    }
    if (file.exactProbe === undefined) reasons.push("sin exactProbe");
  }
  for (const key of ["minFailures", "minShots", "maxShots"] as const) {
    if (file.stopRule[key] !== VALIDATION_STOP_RULE[key]) {
      reasons.push(
        `stopRule.${key} = ${file.stopRule[key]} ≠ ${VALIDATION_STOP_RULE[key]}`,
      );
    }
  }
  const w = file.weights;
  if (w.seed.toUpperCase() !== core.weights.seed.toUpperCase()) {
    reasons.push(`weights.seed ${w.seed} ≠ ${core.weights.seed}`);
  }
  for (const key of ["scale", "epsilonDenominator", "maxEdgeWeight"] as const) {
    if (w[key] !== core.weights[key]) {
      reasons.push(`weights.${key} = ${w[key]} ≠ ${core.weights[key]}`);
    }
  }
  const sampleKeys = Object.keys(w.sample).sort(
    (a, b) => Number(a) - Number(b),
  );
  const wantKeys = weightSampleOf(file.noise).map(String);
  if (sampleKeys.join(",") !== wantKeys.join(",")) {
    reasons.push(
      `weights.sample cubre los índices [${sampleKeys.join(", ")}], se esperan [${wantKeys.join(", ")}]`,
    );
  }
  for (const q of wantKeys) {
    const got = w.sample[q];
    const want = core.weights.sample[q];
    if (got !== undefined && got !== want) {
      reasons.push(`weights.sample[${q}] = ${got} ≠ ${want}`);
    }
  }
  const geometryKeys = Object.keys(file.geometry).sort(
    (a, b) => Number(a) - Number(b),
  );
  const wantGeometry = GEOMETRY_DISTANCES.map(String);
  if (geometryKeys.join(",") !== wantGeometry.join(",")) {
    reasons.push(
      `geometry cubre d = [${geometryKeys.join(", ")}], se esperan [${wantGeometry.join(", ")}]`,
    );
  }
  for (const d of wantGeometry) {
    const table = file.geometry[d];
    const want = core.geometry[d]!;
    if (table === undefined) continue;
    if (table.length !== want.length) {
      reasons.push(
        `geometry d = ${d}: ${table.length} estabilizadores, el núcleo tiene ${want.length}`,
      );
      continue;
    }
    for (let i = 0; i < want.length; i++) {
      if (!sameEntry(table[i]!, want[i]!)) {
        reasons.push(
          `geometry d = ${d}: el estabilizador ${i} es ${JSON.stringify(table[i])}, el núcleo tiene ${JSON.stringify(want[i])}`,
        );
        break;
      }
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Internal consistency of each point (R8: the JSON files are regenerated, never edited)

/**
 * Why (shots, failures, stopReason) of a point do not obey the stop rule the file
 * itself declares; null when they do. "shots" and "failures" both mean the rule fired
 * (≥ minShots shots and ≥ minFailures failures; which one came last is the reason),
 * "cap" means exactly maxShots shots, and "budget" (a time budget or a cancellation)
 * never produces a validation file.
 */
function stopRuleReason(pt: ValidationPoint, rule: StopRule): string | null {
  switch (pt.stopReason) {
    case "shots":
    case "failures":
      return pt.shots >= rule.minShots &&
        pt.shots <= rule.maxShots &&
        pt.failures >= rule.minFailures
        ? null
        : `stopReason = "${pt.stopReason}" con shots = ${pt.shots} y failures = ${pt.failures}; la regla del fichero exige ≥ ${rule.minShots} tiradas, ≤ ${rule.maxShots} tiradas y ≥ ${rule.minFailures} fallos`;
    case "cap":
      return pt.shots === rule.maxShots
        ? null
        : `stopReason = "cap" con shots = ${pt.shots}; el tope del fichero es ${rule.maxShots}`;
    case "budget":
      return `stopReason = "budget": un fichero de validación no se para por presupuesto`;
  }
}

/**
 * Reasons why a point is not what its own counts imply under the core's estimators:
 * estimate = pointRate(k, N, stopReason), [low, high] = Wilson(k, N), the X/Z detail
 * (kX/N, or estimate·kX/k after a stop by failures, with Wilson on kX and kZ) and
 * upperBoundOnly = (k = 0). Exact equality: both generators compute the same IEEE
 * expressions (measured bit-identical on the committed files). The counts themselves
 * must be possible (kX ≤ k, kZ ≤ k and kX + kZ ≥ k: a logical failure is X, Z or
 * both) and (N, k, stopReason) must obey `rule` (stopRuleReason). [] = every point
 * is self-consistent.
 */
export function checkPointsConsistency(
  points: readonly ValidationPoint[],
  rule: StopRule,
): string[] {
  const reasons: string[] = [];
  for (const pt of points) {
    const label = pointLabel(pt.d, pt.p);
    const bad = (what: string, got: number | boolean, want: number | boolean) =>
      reasons.push(`(${label}): ${what} = ${got}, de k y N se sigue ${want}`);
    if (pt.failuresX > pt.failures || pt.failuresZ > pt.failures) {
      reasons.push(
        `(${label}): failuresX = ${pt.failuresX}, failuresZ = ${pt.failuresZ} con failures = ${pt.failures}`,
      );
      continue;
    }
    if (pt.failuresX + pt.failuresZ < pt.failures) {
      reasons.push(
        `(${label}): failuresX + failuresZ = ${pt.failuresX + pt.failuresZ} < failures = ${pt.failures} (un fallo lógico es X, Z o ambos)`,
      );
    }
    const ruleReason = stopRuleReason(pt, rule);
    if (ruleReason !== null) reasons.push(`(${label}): ${ruleReason}`);
    let estimate: number;
    try {
      estimate = pointRate(pt.failures, pt.shots, pt.stopReason);
    } catch (error) {
      reasons.push(
        `(${label}): ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (pt.estimate !== estimate) bad("estimate", pt.estimate, estimate);
    const all = wilsonInterval(pt.failures, pt.shots);
    if (pt.low !== all.low) bad("low", pt.low, all.low);
    if (pt.high !== all.high) bad("high", pt.high, all.high);
    const share = (kType: number): number =>
      pt.stopReason === "failures"
        ? (estimate * kType) / pt.failures
        : pointRate(kType, pt.shots, "shots");
    const x = wilsonInterval(pt.failuresX, pt.shots);
    const z = wilsonInterval(pt.failuresZ, pt.shots);
    if (pt.estimateX !== share(pt.failuresX))
      bad("estimateX", pt.estimateX, share(pt.failuresX));
    if (pt.lowX !== x.low) bad("lowX", pt.lowX, x.low);
    if (pt.highX !== x.high) bad("highX", pt.highX, x.high);
    if (pt.estimateZ !== share(pt.failuresZ))
      bad("estimateZ", pt.estimateZ, share(pt.failuresZ));
    if (pt.lowZ !== z.low) bad("lowZ", pt.lowZ, z.low);
    if (pt.highZ !== z.high) bad("highZ", pt.highZ, z.high);
    if (pt.upperBoundOnly !== (pt.failures === 0))
      bad("upperBoundOnly", pt.upperBoundOnly, pt.failures === 0);
  }
  return reasons;
}

/** checkPointsConsistency of the grid points of a file under the stop rule the file declares. */
export function checkConsistency(file: ValidationFile): string[] {
  return checkPointsConsistency(file.points, file.stopRule);
}

// ---------------------------------------------------------------------------
// Minimum weights (docs/spec.md §6 «Pesos mínimos frente a PyMatching»)

export interface MinWeightMismatch {
  readonly d: number;
  readonly type: StabilizerType;
  readonly cycles?: number;
  readonly defects: readonly number[];
  readonly expected: number;
  readonly got: number;
}

export interface MinWeightsCheck {
  readonly total: number;
  readonly mismatches: readonly MinWeightMismatch[];
  /** Weights block of the fixture against the core; [] = same weights. */
  readonly reasons: readonly string[];
}

function weightsBlockReasons(
  weights: MinWeightsFixture["weights"],
  name: string,
): string[] {
  const reasons: string[] = [];
  const core = coreMetadata().weights;
  if (weights.seed.toUpperCase() !== core.seed.toUpperCase()) {
    reasons.push(`${name}: weights.seed ${weights.seed} ≠ ${core.seed}`);
  }
  for (const key of ["scale", "epsilonDenominator", "maxEdgeWeight"] as const) {
    if (weights[key] !== core[key]) {
      reasons.push(`${name}: weights.${key} = ${weights[key]} ≠ ${core[key]}`);
    }
  }
  return reasons;
}

/** Decoders of both kinds, one per (d, type[, cycles]), built on demand. */
class DecoderCache {
  private readonly flat = new Map<string, Decoder>();
  private readonly spacetime = new Map<string, SpacetimeDecoder>();

  /** Minimum matching weight of a syndrome (defects by typeIndex in 2D, by node index in 3D) and the correction it leaves in `correction`. */
  decode(
    d: number,
    type: StabilizerType,
    cycles: number | undefined,
    defects: readonly number[],
    correction: ReturnType<typeof identity>,
  ): number {
    if (cycles === undefined) {
      const key = `${d}${type}`;
      let dec = this.flat.get(key);
      if (dec === undefined) {
        dec = createDecoder(rotatedSurfaceCode(d), type);
        this.flat.set(key, dec);
      }
      const syndrome = new Uint8Array(dec.graph.m);
      for (const i of defects) syndrome[i] = 1;
      return decode(dec, syndrome, correction);
    }
    const key = `${d}${type}:${cycles}`;
    let dec = this.spacetime.get(key);
    if (dec === undefined) {
      dec = createSpacetimeDecoder(rotatedSurfaceCode(d), type, cycles);
      this.spacetime.set(key, dec);
    }
    const detectors = new Uint8Array(dec.graph.nodes);
    for (const i of defects) detectors[i] = 1;
    return decodeSpacetime(dec, detectors, correction);
  }
}

interface ShapedCase {
  readonly d: number;
  readonly type: StabilizerType;
  readonly cycles?: number;
  readonly p?: number;
  readonly defects: readonly number[];
}

/**
 * Shape of a fixture as a gate: FIXTURE_CASES
 * cases, every case of the model's kind (spacetime with `cycles = d` for the
 * phenomenological model, 2D without `cycles` for the independent one), at least
 * FIXTURE_MIN_DISTINCT distinct cases, and the composition the plan fixes: min-weights with ≥ FIXTURE_MIN_PER_CELL cases per
 * (d, type) over FIXTURE_DISTANCES (D7); verdicts with every (d, p, type) cell of D8
 * sampled and no empty syndrome. Without it an empty, truncated, repeated or
 * other-model fixture passed `npm run validate`.
 */
export function fixtureShapeReasons(
  label: "min-weights" | "verdicts",
  cases: readonly ShapedCase[],
  noise: ValidationNoise,
): string[] {
  const reasons: string[] = [];
  if (cases.length !== FIXTURE_CASES) {
    reasons.push(`${label}: ${cases.length} casos ≠ ${FIXTURE_CASES}`);
  }
  const wrongKind = cases.filter((c) =>
    noise === "phenomenological" ? c.cycles !== c.d : c.cycles !== undefined,
  ).length;
  if (wrongKind > 0) {
    reasons.push(
      noise === "phenomenological"
        ? `${label}: ${wrongKind} casos sin cycles = d (fixture 2D o de otro modelo)`
        : `${label}: ${wrongKind} casos con cycles (fixture espacio-temporal en el modelo independiente)`,
    );
  }
  // Random syndromes repeat by construction at d = 3 (16 subsets per type in
  // 2D; the phase 1 fixture carries 3 739 repeats), so the rule is not "none
  // twice" but "a degenerate generator (one case 10⁴ times) is named": at least
  // FIXTURE_MIN_DISTINCT distinct cases.
  const distinct = new Set(
    cases.map(
      (c) =>
        `${c.d}|${c.type}|${c.cycles ?? ""}|${c.p ?? ""}|${c.defects.join(",")}`,
    ),
  ).size;
  if (distinct < FIXTURE_MIN_DISTINCT) {
    reasons.push(
      `${label}: sólo ${distinct} casos distintos (< ${FIXTURE_MIN_DISTINCT})`,
    );
  }
  if (label === "min-weights") {
    const perCell = new Map<string, number>();
    for (const c of cases) {
      const key = `${c.d}${c.type}`;
      perCell.set(key, (perCell.get(key) ?? 0) + 1);
    }
    const thin: string[] = [];
    for (const d of FIXTURE_DISTANCES) {
      for (const type of ["Z", "X"] as const) {
        const n = perCell.get(`${d}${type}`) ?? 0;
        if (n < FIXTURE_MIN_PER_CELL) thin.push(`d = ${d} ${type}: ${n}`);
      }
    }
    if (thin.length > 0) {
      reasons.push(
        `${label}: celdas (d, tipo) con menos de ${FIXTURE_MIN_PER_CELL} casos: ${thin.join("; ")}`,
      );
    }
  } else {
    const cells = new Set(cases.map((c) => `${c.d}|${c.p}|${c.type}`));
    const missing: string[] = [];
    for (const d of VERDICT_DISTANCES) {
      for (const p of VERDICT_PROBABILITIES) {
        for (const type of ["Z", "X"] as const) {
          if (!cells.has(`${d}|${p}|${type}`))
            missing.push(`(${d}, ${p}, ${type})`);
        }
      }
    }
    if (missing.length > 0) {
      reasons.push(
        `${label}: celdas (d, p, tipo) sin casos: ${missing.join(" ")}`,
      );
    }
    const empty = cases.filter((c) => c.defects.length === 0).length;
    if (empty > 0) reasons.push(`${label}: ${empty} síndromes vacíos`);
  }
  return reasons;
}

/**
 * Decodes every case of the fixture (2D or spacetime, by `cycles`) and lists the ones
 * whose minimum weight differs. No tolerance. With `noise`, the fixture's shape is a
 * gate too (fixtureShapeReasons); the report always passes it.
 */
export function checkMinWeights(
  fixture: MinWeightsFixture,
  noise?: ValidationNoise,
): MinWeightsCheck {
  const reasons = weightsBlockReasons(fixture.weights, "min-weights");
  if (noise !== undefined) {
    reasons.push(...fixtureShapeReasons("min-weights", fixture.cases, noise));
  }
  const decoders = new DecoderCache();
  const mismatches: MinWeightMismatch[] = [];
  for (const c of fixture.cases) {
    const got = decoders.decode(
      c.d,
      c.type,
      c.cycles,
      c.defects,
      identity(c.d * c.d),
    );
    if (got !== c.weight) {
      mismatches.push({
        d: c.d,
        type: c.type,
        ...(c.cycles === undefined ? {} : { cycles: c.cycles }),
        defects: c.defects,
        expected: c.weight,
        got,
      });
    }
  }
  return { total: fixture.cases.length, mismatches, reasons };
}

// ---------------------------------------------------------------------------
// Verdicts of the correction (phase2.md D8)

export interface VerdictMismatch {
  readonly d: number;
  readonly type: StabilizerType;
  readonly cycles: number;
  readonly p: number;
  readonly defects: readonly number[];
  readonly weight: number;
  readonly expectedParity: number;
  readonly gotParity: number;
}

export interface VerdictsCheck {
  readonly total: number;
  /** Cases whose minimum weight differs: a bug, never a tie. */
  readonly weightMismatches: readonly MinWeightMismatch[];
  /** Cases with the same weight and another logical parity: a tie between minimum matchings, or a bug; each one is listed. */
  readonly parityMismatches: readonly VerdictMismatch[];
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

/**
 * Decodes every sampled spacetime syndrome of the fixture with the core: the weight
 * must equal PyMatching's in every case and the logical parity of the correction
 * (row 0 of the X correction for type Z, column 0 of the Z correction for type X) in
 * all but MAX_PARITY_MISMATCHES cases. The parity mismatches are listed, never
 * averaged away: each one is a tie between two minimum matchings of different parity
 * (legitimate, D3) or a bug, and the report says which cases to look at. With
 * `strictShape`, the fixture must carry FIXTURE_CASES spacetime cases (the report
 * always demands it; the unit tests use small inline fixtures without it).
 */
export function checkVerdicts(
  fixture: VerdictsFixture,
  strictShape = false,
): VerdictsCheck {
  const reasons = weightsBlockReasons(fixture.weights, "verdicts");
  if (strictShape) {
    reasons.push(
      ...fixtureShapeReasons("verdicts", fixture.cases, "phenomenological"),
    );
  }
  const decoders = new DecoderCache();
  const weightMismatches: MinWeightMismatch[] = [];
  const parityMismatches: VerdictMismatch[] = [];
  for (const c of fixture.cases) {
    const code = rotatedSurfaceCode(c.d);
    const correction = identity(code.n);
    const got = decoders.decode(c.d, c.type, c.cycles, c.defects, correction);
    if (got !== c.weight) {
      weightMismatches.push({
        d: c.d,
        type: c.type,
        cycles: c.cycles,
        defects: c.defects,
        expected: c.weight,
        got,
      });
      continue;
    }
    // An X correction (type Z) is logical iff it anticommutes with Z_L (row 0);
    // a Z correction (type X) iff it anticommutes with X_L (column 0).
    const logical = c.type === "Z" ? code.logicalZ : code.logicalX;
    const parity = commutes(correction, logical) ? 0 : 1;
    if (parity !== c.parity) {
      parityMismatches.push({
        d: c.d,
        type: c.type,
        cycles: c.cycles,
        p: c.p,
        defects: c.defects,
        weight: c.weight,
        expectedParity: c.parity,
        gotParity: parity,
      });
    }
  }
  if (weightMismatches.length > 0) {
    reasons.push(
      `verdicts: ${weightMismatches.length} pesos mínimos distintos de PyMatching`,
    );
  }
  if (parityMismatches.length > MAX_PARITY_MISMATCHES) {
    reasons.push(
      `verdicts: ${parityMismatches.length} paridades lógicas distintas de PyMatching (> ${MAX_PARITY_MISMATCHES})`,
    );
  }
  return {
    total: fixture.cases.length,
    weightMismatches,
    parityMismatches,
    pass: reasons.length === 0,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Curve crossing (D8): linear interpolation of ln P_L on the sign-changing interval

export interface Crossing {
  readonly pair: readonly [number, number];
  readonly pCross: number | null;
  readonly bracket: readonly [number, number] | null;
  /** True when the reported crossing is ascending: the larger distance fails more below it. */
  readonly inverted: boolean;
  readonly note: string;
}

export const CROSSING_PAIRS: readonly (readonly [number, number])[] = [
  [3, 5],
  [3, 7],
  [5, 7],
];

/**
 * For each pair (a, b), a < b: Δ_i = ln p̂_a(p_i) − ln p̂_b(p_i) over the grid of the
 * file's model; every i where Δ changes sign is a crossing: descending (Δ_i > 0 ≥
 * Δ_{i+1}, the expected one: below threshold the smaller distance fails more) or
 * inverted (Δ_i < 0 ≤ Δ_{i+1}). The first in p is reported with
 * p* = p_i + Δ_i (p_{i+1} − p_i) / (Δ_i − Δ_{i+1}) and its direction; the count of
 * the rest goes to the note. Informative, never a gate.
 */
export function crossings(file: ValidationFile): Crossing[] {
  const ps = gridOf(file.noise).probabilities;
  const curve = (d: number): (number | undefined)[] =>
    ps.map((p) => file.points.find((pt) => pt.d === d && pt.p === p)?.estimate);
  return CROSSING_PAIRS.map((pair) => {
    const [a, b] = pair;
    const ca = curve(a);
    const cb = curve(b);
    const none = (note: string): Crossing => ({
      pair,
      pCross: null,
      bracket: null,
      inverted: false,
      note,
    });
    if (ca.includes(undefined) || cb.includes(undefined)) {
      return none("malla incompleta");
    }
    if (ca.some((v) => v === 0) || cb.some((v) => v === 0)) {
      return none("no estimable (un punto con p̂ = 0)");
    }
    const delta = ps.map((_, i) => Math.log(ca[i]!) - Math.log(cb[i]!));
    const starts: number[] = [];
    for (let i = 0; i + 1 < delta.length; i++) {
      const descending = delta[i]! > 0 && delta[i + 1]! <= 0;
      const ascending = delta[i]! < 0 && delta[i + 1]! >= 0;
      if (descending || ascending) starts.push(i);
    }
    if (starts.length === 0) return none("sin cruce en la malla");
    const i = starts[0]!;
    const d0 = delta[i]!;
    const d1 = delta[i + 1]!;
    const p0 = ps[i]!;
    const p1 = ps[i + 1]!;
    const pCross = p0 + (d0 * (p1 - p0)) / (d0 - d1);
    const inverted = d0 < 0;
    let note: string;
    if (starts.length > 1) {
      note = `cruces múltiples (${starts.length}; se informa el primero${inverted ? ", invertido" : ""})`;
    } else if (inverted) {
      note = "cruce invertido (la distancia mayor falla más por debajo)";
    } else {
      note = "cruce único";
    }
    return { pair, pCross, bracket: [p0, p1], inverted, note };
  });
}

// ---------------------------------------------------------------------------
// The whole report (D12)

export interface Report {
  readonly noise: ValidationNoise;
  readonly reference: ValidationFile;
  readonly browser: ValidationFile;
  readonly grid: GridComparison;
  /** Gate (independent model): the Python reference against the exact d = 3 curve. null in the phenomenological model. */
  readonly exactReference: ExactCheck | null;
  /** Informative: the TS Monte Carlo against the same curve (the core's tests already gate it). */
  readonly exactBrowser: ExactCheck | null;
  /** Gate (phenomenological model): the reference's exactProbe against the core. null in the independent model. */
  readonly exactProbeReference: ExactProbeCheck | null;
  /** Informative: the core's own probe (its counts are the core's by construction). */
  readonly exactProbeBrowser: ExactProbeCheck | null;
  readonly metadataReference: readonly string[];
  readonly metadataBrowser: readonly string[];
  /** Gate: every point of each file agrees with its own counts (checkConsistency). */
  readonly consistencyReference: readonly string[];
  readonly consistencyBrowser: readonly string[];
  readonly minWeights: MinWeightsCheck;
  /** Gate (phenomenological model): the verdicts fixture. null when no fixture was given. */
  readonly verdicts: VerdictsCheck | null;
  readonly crossings: {
    readonly reference: readonly Crossing[];
    readonly browser: readonly Crossing[];
  };
  readonly pass: boolean;
  /** Every reason of every gate, in order; [] iff pass. */
  readonly reasons: readonly string[];
}

/**
 * Builds the report of one model. `counts` are the exact tables of that model
 * (2D a_k for independent, 3D a_w for phenomenological); by default the core's.
 * `verdicts` is required by the phenomenological model (a missing fixture is a
 * reason) and ignored by the independent one.
 */
export function buildReport(
  reference: ValidationFile,
  browser: ValidationFile,
  minWeights: MinWeightsFixture,
  counts?: ExactCounts,
  verdicts: VerdictsFixture | null = null,
  options: {
    /** Judge the fixtures' shape (FIXTURE_CASES cases of the model's kind). The CLI always does; unit tests on small synthetic fixtures switch it off. */
    readonly fixtureShape?: boolean;
  } = {},
): Report {
  const noise = reference.noise;
  const fixtureShape = options.fixtureShape ?? true;
  const grid = compareFiles(reference, browser);
  const metadataReference = checkMetadata(reference);
  const metadataBrowser = checkMetadata(browser);
  const consistencyReference = checkConsistency(reference);
  const consistencyBrowser = checkConsistency(browser);
  const mw = checkMinWeights(minWeights, fixtureShape ? noise : undefined);
  let exactReference: ExactCheck | null = null;
  let exactBrowser: ExactCheck | null = null;
  let exactProbeReference: ExactProbeCheck | null = null;
  let exactProbeBrowser: ExactProbeCheck | null = null;
  let verdictsCheck: VerdictsCheck | null = null;
  const reasons = [
    ...metadataReference.map((r) => `metadatos de la referencia: ${r}`),
    ...metadataBrowser.map((r) => `metadatos del núcleo: ${r}`),
    ...consistencyReference.map(
      (r) => `coherencia interna de la referencia ${r}`,
    ),
    ...consistencyBrowser.map((r) => `coherencia interna del núcleo ${r}`),
    ...grid.reasons,
  ];
  if (noise === "independent") {
    const c = counts ?? exactCountsD3();
    exactReference = exactCheck(reference, c);
    exactBrowser = exactCheck(browser, c);
    reasons.push(
      ...exactReference.reasons.map(
        (r) => `referencia frente al exacto de d = 3: ${r}`,
      ),
    );
  } else {
    const c = counts ?? exactSpacetimeCountsD3();
    exactProbeReference = exactProbeCheck(reference, c);
    exactProbeBrowser = exactProbeCheck(browser, c);
    reasons.push(
      ...exactProbeReference.reasons.map(
        (r) => `referencia frente al exacto de cycles = 1: ${r}`,
      ),
    );
    // The core's own probe: its statistics are informative (the core's test
    // measures them), but its SHAPE and internal consistency are a gate too:
    // a truncated or edited probe is not "informative".
    reasons.push(
      ...exactProbeBrowser.countReasons.map(
        (r) => `sonda exacta del núcleo (forma): ${r}`,
      ),
    );
    if (verdicts === null) {
      reasons.push(
        "sin fixture de veredictos (verdicts-phenomenological.json)",
      );
    } else {
      verdictsCheck = checkVerdicts(verdicts, fixtureShape);
      reasons.push(...verdictsCheck.reasons);
      reasons.push(
        ...verdictsCheck.weightMismatches
          .slice(0, 10)
          .map(
            (m) =>
              `veredicto con peso mínimo distinto en d = ${m.d} ${m.type} cycles = ${m.cycles} ${JSON.stringify(m.defects)}: PyMatching ${m.expected}, núcleo ${m.got}`,
          ),
      );
    }
  }
  reasons.push(...mw.reasons);
  reasons.push(
    ...mw.mismatches
      .slice(0, 10)
      .map(
        (m) =>
          `peso mínimo distinto en d = ${m.d} ${m.type}${m.cycles === undefined ? "" : ` cycles = ${m.cycles}`} ${JSON.stringify(m.defects)}: PyMatching ${m.expected}, núcleo ${m.got}`,
      ),
  );
  if (mw.mismatches.length > 10) {
    reasons.push(
      `… y ${mw.mismatches.length - 10} pesos mínimos distintos más`,
    );
  }
  return {
    noise,
    reference,
    browser,
    grid,
    exactReference,
    exactBrowser,
    exactProbeReference,
    exactProbeBrowser,
    metadataReference,
    metadataBrowser,
    consistencyReference,
    consistencyBrowser,
    minWeights: mw,
    verdicts: verdictsCheck,
    crossings: { reference: crossings(reference), browser: crossings(browser) },
    pass: reasons.length === 0,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Rendering

function formatZ(z: number): string {
  if (!Number.isFinite(z)) return z > 0 ? "+∞" : "−∞";
  const s = z.toFixed(2);
  return z >= 0 ? `+${s}` : `−${s.slice(1)}`;
}

function formatRate(x: number): string {
  return x.toFixed(5);
}

function formatP(p: number): string {
  return p < 0.01 || Math.round(p * 1000) % 10 !== 0
    ? p.toFixed(3)
    : p.toFixed(2);
}

function verdict(pass: boolean): string {
  return pass ? "PASA" : "FALLA";
}

function modelName(noise: ValidationNoise): string {
  return noise === "independent"
    ? "ruido independiente X/Z (mediciones perfectas, un ciclo)"
    : "ruido fenomenológico (fallos de medición con q = p, d ciclos, lectura final perfecta)";
}

function crossingLine(c: Crossing): string {
  const pair = `(${c.pair[0]}, ${c.pair[1]})`;
  if (c.pCross === null || c.bracket === null) return `${pair}: ${c.note}`;
  return `${pair}: p* ≈ ${c.pCross.toFixed(4)} en [${formatP(c.bracket[0])}, ${formatP(c.bracket[1])}] (${c.note})`;
}

function engineLine(file: ValidationFile): string {
  return Object.entries(file.engine)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

function minWeightsPass(mw: MinWeightsCheck): boolean {
  return mw.mismatches.length === 0 && mw.reasons.length === 0;
}

function verdictsLine(v: VerdictsCheck | null): string {
  if (v === null) return "veredictos: sin fixture → FALLA";
  const weights = v.total - v.weightMismatches.length;
  const parities = v.total - v.parityMismatches.length;
  return `veredictos (verdicts-phenomenological.json): pesos ${weights}/${v.total} iguales, paridad lógica ${parities}/${v.total} iguales (≥ ${v.total - MAX_PARITY_MISMATCHES}) → ${verdict(v.pass)}`;
}

/** The report for stdout: a fixed-width table of the 24 points and one line per gate. */
export function renderTable(report: Report): string {
  const lines: string[] = [];
  lines.push(`modelo: ${modelName(report.noise)}`);
  const header = [
    "d".padStart(2),
    "p".padStart(5),
    "k_ref".padStart(6),
    "N_ref".padStart(8),
    "p_ref".padStart(8),
    "k_TS".padStart(6),
    "N_TS".padStart(8),
    "p_TS".padStart(8),
    "z".padStart(7),
  ].join("  ");
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const c of report.grid.points) {
    lines.push(
      [
        String(c.d).padStart(2),
        formatP(c.p).padStart(5),
        String(c.ref.failures).padStart(6),
        String(c.ref.shots).padStart(8),
        formatRate(c.ref.estimate).padStart(8),
        String(c.ts.failures).padStart(6),
        String(c.ts.shots).padStart(8),
        formatRate(c.ts.estimate).padStart(8),
        formatZ(c.z).padStart(7),
      ].join("  "),
    );
  }
  lines.push("");
  lines.push(
    `puntos: max |z| = ${report.grid.maxAbsZ.toFixed(2)} (≤ ${MAX_ABS_Z}) → ${verdict(report.grid.points.every((c) => Math.abs(c.z) <= MAX_ABS_Z))}`,
  );
  lines.push(
    `global: Σz² = ${report.grid.sumZ2.toFixed(2)} (< ${SUM_Z2_LIMIT_GRID}, 24 g.l.) → ${verdict(report.grid.sumZ2 < SUM_Z2_LIMIT_GRID)}`,
  );
  if (report.exactReference !== null && report.exactBrowser !== null) {
    lines.push(
      `referencia frente al exacto de d = 3: max |z| = ${report.exactReference.maxAbsZ.toFixed(2)}, Σz² = ${report.exactReference.sumZ2.toFixed(2)} (< ${SUM_Z2_LIMIT_EXACT}, 8 g.l.) → ${verdict(report.exactReference.pass)}`,
    );
    lines.push(
      `núcleo frente al exacto de d = 3 (informativo): max |z| = ${report.exactBrowser.maxAbsZ.toFixed(2)}, Σz² = ${report.exactBrowser.sumZ2.toFixed(2)}`,
    );
  }
  if (
    report.exactProbeReference !== null &&
    report.exactProbeBrowser !== null
  ) {
    const r = report.exactProbeReference;
    lines.push(
      `referencia frente al exacto de cycles = 1 (d = 3, 2¹³ patrones): a_w ${verdict(r.countReasons.length === 0)} (igualdad exacta); max |z| = ${r.maxAbsZ.toFixed(2)}, Σz² = ${r.sumZ2.toFixed(2)} (< ${SUM_Z2_LIMIT_PROBE}, 3 g.l.) → ${verdict(r.pass)}`,
    );
    const b = report.exactProbeBrowser;
    lines.push(
      `núcleo frente al exacto de cycles = 1 (informativo): max |z| = ${b.maxAbsZ.toFixed(2)}, Σz² = ${b.sumZ2.toFixed(2)}`,
    );
  }
  lines.push(
    `pesos mínimos: ${report.minWeights.total - report.minWeights.mismatches.length}/${report.minWeights.total} iguales → ${verdict(minWeightsPass(report.minWeights))}`,
  );
  if (report.noise === "phenomenological") {
    lines.push(verdictsLine(report.verdicts));
    for (const m of report.verdicts?.parityMismatches ?? []) {
      lines.push(
        `  paridad distinta: d = ${m.d} ${m.type} cycles = ${m.cycles} p = ${m.p} peso ${m.weight} PyMatching ${m.expectedParity} núcleo ${m.gotParity} defectos ${JSON.stringify(m.defects)}`,
      );
    }
  }
  lines.push(
    `metadatos (geometría y pesos): referencia ${verdict(report.metadataReference.length === 0)}, núcleo ${verdict(report.metadataBrowser.length === 0)}`,
  );
  lines.push(
    `coherencia interna (estimador, Wilson, X/Z, cota): referencia ${verdict(report.consistencyReference.length === 0)}, núcleo ${verdict(report.consistencyBrowser.length === 0)}`,
  );
  lines.push("cruces (informativo):");
  for (const c of report.crossings.reference)
    lines.push(`  referencia ${crossingLine(c)}`);
  for (const c of report.crossings.browser)
    lines.push(`  núcleo     ${crossingLine(c)}`);
  lines.push("");
  lines.push(`VEREDICTO: ${verdict(report.pass)}`);
  for (const r of report.reasons) lines.push(`  - ${r}`);
  return `${lines.join("\n")}\n`;
}

export interface RunInfo {
  /** process.version of the run that wrote the document. */
  readonly nodeVersion: string;
  /** Seconds of the simulation that produced browser*.json, by distance; null with --compare-only. */
  readonly simulation: {
    readonly total: number;
    readonly byDistance: Readonly<Record<string, number>>;
  } | null;
  /** sha256 of each JSON file the report read (name → hex), so the document pins the exact bytes it describes. */
  readonly files?: Readonly<Record<string, string>>;
}

export interface DocumentSection {
  readonly report: Report;
  readonly run: RunInfo;
}

function sectionTitle(noise: ValidationNoise): string {
  return noise === "independent"
    ? "Modelo de fase 1: ruido independiente X/Z"
    : "Modelo de fase 2: ruido fenomenológico";
}

function renderSection(L: string[], section: DocumentSection): void {
  const { report, run } = section;
  const ref = report.reference;
  const ts = report.browser;
  const names = {
    reference: `reference${report.noise === "independent" ? "" : "-phenomenological"}.json`,
    browser: `browser${report.noise === "independent" ? "" : "-phenomenological"}.json`,
    minWeights: `min-weights${report.noise === "independent" ? "" : "-phenomenological"}.json`,
  };
  L.push(`## ${sectionTitle(report.noise)}`);
  L.push("");
  L.push(`**Veredicto: ${verdict(report.pass)}**.`);
  L.push("");
  L.push("### Qué se compara");
  L.push("");
  L.push(
    `- Referencia: \`docs/validacion/${names.reference}\`, generada por \`${ref.generator}\` (${engineLine(ref)}), semilla base ${ref.seed}.`,
  );
  L.push(
    `- Núcleo: \`docs/validacion/${names.browser}\`, generado por \`${ts.generator}\` (${engineLine(ts)}), semilla base ${ts.seed}; esta ejecución con Node ${run.nodeVersion}.`,
  );
  L.push(
    `- Regla de parada por punto: ≥ ${ref.stopRule.minFailures} fallos y ≥ ${ref.stopRule.minShots} tiradas, tope ${ref.stopRule.maxShots} (idéntica en ambos ficheros: ${verdict(report.metadataReference.length === 0 && report.metadataBrowser.length === 0)} en metadatos).`,
  );
  if (report.noise === "independent") {
    L.push(
      "- Ruido independiente X/Z, *code-capacity*, un ciclo; pesos genéricos enteros compartidos (`weights`) y geometría de d = 3 y 5 (`geometry`) contrastadas con `src/core`.",
    );
  } else {
    L.push(
      "- Ruido fenomenológico (`docs/spec.md` §3): `cycles = d` ciclos de ruido de datos X/Z con probabilidad `p` por cúbit y fallo de medición con `q = p` por estabilizador, lectura final perfecta, detectores por diferencia; MWPM sobre el grafo espacio-temporal con los pesos enteros por índice de arista (`weights`, con los índices 3D 81, 343, 511 y 1088) y la geometría de d = 3 y 5 contrastadas con `src/core`. La referencia comprueba con Stim que el grafo es el modelo de error del circuito (S1) y que su muestreador coincide con el de Stim (S2).",
    );
  }
  L.push("");
  L.push("### Tabla de la malla (24 puntos)");
  L.push("");
  L.push(
    "`z = (p̂_TS − p̂_ref) / √(σ_TS² + σ_ref²)` con `σ² = p̂(1 − p̂)/n`. Intervalos de Wilson al 95 %.",
  );
  L.push("");
  L.push(
    "| d | p | k_ref | N_ref | p̂_ref [Wilson 95 %] | k_TS | N_TS | p̂_TS [Wilson 95 %] | z |",
  );
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of report.grid.points) {
    L.push(
      `| ${c.d} | ${formatP(c.p)} | ${c.ref.failures} | ${c.ref.shots} | ${formatRate(c.ref.estimate)} [${formatRate(c.ref.low)}, ${formatRate(c.ref.high)}] | ${c.ts.failures} | ${c.ts.shots} | ${formatRate(c.ts.estimate)} [${formatRate(c.ts.low)}, ${formatRate(c.ts.high)}] | ${formatZ(c.z)} |`,
    );
  }
  L.push("");
  L.push("### Criterios");
  L.push("");
  L.push(`| Criterio | Medido | Umbral | Veredicto |`);
  L.push("|---|---|---|---|");
  L.push(
    `| Por punto | max \\|z\\| = ${report.grid.maxAbsZ.toFixed(2)} | \\|z\\| ≤ ${MAX_ABS_Z} | ${verdict(report.grid.points.length > 0 && report.grid.points.every((c) => Math.abs(c.z) <= MAX_ABS_Z))} |`,
  );
  L.push(
    `| Global | Σz² = ${report.grid.sumZ2.toFixed(2)} | < ${SUM_Z2_LIMIT_GRID} (χ², 24 g.l., p > 0,01) | ${verdict(report.grid.sumZ2 < SUM_Z2_LIMIT_GRID)} |`,
  );
  if (report.exactReference !== null) {
    L.push(
      `| Referencia frente al exacto de d = 3 | max \\|z\\| = ${report.exactReference.maxAbsZ.toFixed(2)}, Σz² = ${report.exactReference.sumZ2.toFixed(2)} | \\|z\\| ≤ ${MAX_ABS_Z} y Σz² < ${SUM_Z2_LIMIT_EXACT} (8 g.l.) | ${verdict(report.exactReference.pass)} |`,
    );
  }
  if (report.exactProbeReference !== null) {
    const r = report.exactProbeReference;
    L.push(
      `| Referencia frente al exacto de cycles = 1 (d = 3, 2¹³ patrones por tipo) | a_w ${r.countReasons.length === 0 ? "iguales" : "distintas"}; max \\|z\\| = ${r.maxAbsZ.toFixed(2)}, Σz² = ${r.sumZ2.toFixed(2)} | a_w idénticas, \\|z\\| ≤ ${MAX_ABS_Z} y Σz² < ${SUM_Z2_LIMIT_PROBE} (3 g.l.) | ${verdict(r.pass)} |`,
    );
  }
  L.push(
    `| Pesos mínimos (\`${names.minWeights}\`) | ${report.minWeights.total - report.minWeights.mismatches.length}/${report.minWeights.total} iguales | igualdad exacta | ${verdict(minWeightsPass(report.minWeights))} |`,
  );
  if (report.noise === "phenomenological") {
    const v = report.verdicts;
    L.push(
      v === null
        ? `| Veredictos (\`verdicts-phenomenological.json\`) | sin fixture | pesos iguales, paridad ≥ 9 995/10 000 | FALLA |`
        : `| Veredictos (\`verdicts-phenomenological.json\`) | pesos ${v.total - v.weightMismatches.length}/${v.total}, paridad lógica ${v.total - v.parityMismatches.length}/${v.total} | pesos iguales, paridad ≥ ${v.total - MAX_PARITY_MISMATCHES}/${v.total} | ${verdict(v.pass)} |`,
    );
  }
  L.push(
    `| Metadatos (geometría, pesos, regla) | referencia ${report.metadataReference.length} discrepancias, núcleo ${report.metadataBrowser.length} | 0 | ${verdict(report.metadataReference.length === 0 && report.metadataBrowser.length === 0)} |`,
  );
  L.push(
    `| Coherencia interna (estimador, Wilson, X/Z, cota) | referencia ${report.consistencyReference.length} discrepancias, núcleo ${report.consistencyBrowser.length} | 0 | ${verdict(report.consistencyReference.length === 0 && report.consistencyBrowser.length === 0)} |`,
  );
  L.push("");
  if (report.exactReference !== null && report.exactBrowser !== null) {
    L.push(
      `Informativo: el núcleo frente al exacto de d = 3 da max |z| = ${report.exactBrowser.maxAbsZ.toFixed(2)}, Σz² = ${report.exactBrowser.sumZ2.toFixed(2)} (lo cubre ya el test del núcleo).`,
    );
    L.push("");
    L.push("#### Exacto de d = 3, punto a punto");
    L.push("");
    L.push("| p | P_L exacta | p̂_ref | z_ref | p̂_TS | z_TS |");
    L.push("|---|---|---|---|---|---|");
    for (const r of report.exactReference.points) {
      const b = report.exactBrowser.points.find((pt) => pt.p === r.p);
      L.push(
        `| ${formatP(r.p)} | ${r.exact.toFixed(7)} | ${formatRate(r.estimate)} | ${formatZ(r.z)} | ${b ? formatRate(b.estimate) : "—"} | ${b ? formatZ(b.z) : "—"} |`,
      );
    }
    L.push("");
  }
  if (
    report.exactProbeReference !== null &&
    report.exactProbeBrowser !== null
  ) {
    const probe = report.reference.exactProbe;
    L.push(
      `Informativo: el núcleo frente al exacto de cycles = 1 da max |z| = ${report.exactProbeBrowser.maxAbsZ.toFixed(2)}, Σz² = ${report.exactProbeBrowser.sumZ2.toFixed(2)} (lo cubre ya el test del núcleo).`,
    );
    L.push("");
    L.push(
      "#### Exacto de cycles = 1, d = 3 (un ciclo ruidoso y lectura perfecta): 2¹³ patrones por tipo",
    );
    L.push("");
    if (probe !== undefined) {
      L.push(
        `a_w de la referencia (PyMatching), w = 0 … 13: Z = [${probe.counts.Z.join(", ")}], X = [${probe.counts.X.join(", ")}]; ${report.exactProbeReference.countReasons.length === 0 ? "idénticas a las del núcleo" : "DISTINTAS de las del núcleo"}.`,
      );
      L.push("");
    }
    L.push("| p | P_L exacta | p̂_ref | z_ref | p̂_TS | z_TS |");
    L.push("|---|---|---|---|---|---|");
    for (const r of report.exactProbeReference.points) {
      const b = report.exactProbeBrowser.points.find((pt) => pt.p === r.p);
      L.push(
        `| ${formatP(r.p)} | ${r.exact.toFixed(7)} | ${formatRate(r.estimate)} | ${formatZ(r.z)} | ${b ? formatRate(b.estimate) : "—"} | ${b ? formatZ(b.z) : "—"} |`,
      );
    }
    L.push("");
    const v = report.verdicts;
    if (v !== null && v.parityMismatches.length > 0) {
      L.push(
        "#### Veredictos con paridad distinta (cada uno se investiga; empate o error)",
      );
      L.push("");
      for (const m of v.parityMismatches) {
        L.push(
          `- d = ${m.d} ${m.type}, cycles = ${m.cycles}, p = ${m.p}, peso ${m.weight}: PyMatching ${m.expectedParity}, núcleo ${m.gotParity}; defectos ${JSON.stringify(m.defects)}`,
        );
      }
      L.push("");
    }
  }
  L.push("### Cruce de curvas (informativo)");
  L.push("");
  L.push(
    report.noise === "independent"
      ? "Interpolación lineal de `ln P_L` en el intervalo de la malla donde `P_L(d) − P_L(d')` cambia de signo. Esperado entre el 9 % y el 11 % (umbral asintótico ≈ 10,3 %; la malla no tiene resolución para décimas)."
      : "Interpolación lineal de `ln P_L` en el intervalo de la malla donde `P_L(d) − P_L(d')` cambia de signo. Esperado entre el 2 % y el 3 % para estos tamaños (umbral asintótico ≈ 2,9 %; tamaño finito y bordes lo bajan; la malla no tiene resolución para décimas).",
  );
  L.push("");
  for (const c of report.crossings.reference)
    L.push(`- Referencia ${crossingLine(c)}`);
  for (const c of report.crossings.browser)
    L.push(`- Núcleo ${crossingLine(c)}`);
  L.push("");
  L.push("### Las curvas no se tocan");
  L.push("");
  L.push(
    "Si esta sección dice FALLA, se arregla la simulación (o la referencia, si el fallo está en Python: lo delata el criterio del exacto), nunca los números: `compare.ts` no ajusta, excluye ni repondera ningún punto, y los JSON se regeneran, no se editan (la coherencia interna de cada punto con sus propios recuentos es criterio pasa/falla).",
  );
  L.push("");
  if (report.pass) {
    L.push("Ningún punto fuera de tolerancia.");
  } else {
    L.push("Fuera de tolerancia:");
    L.push("");
    for (const r of report.reasons) L.push(`- ${r}`);
  }
  L.push("");
  L.push("### Tiempos");
  L.push("");
  if (run.simulation === null) {
    L.push(
      `Simulación omitida (\`--compare-only\`): \`${names.browser}\` no se regeneró en esta ejecución y no hay tiempos de simulación que informar; los de la última simulación completa están en \`docs/decisiones.md\` (entrada de \`tools/validate/\`).`,
    );
  } else {
    const by = Object.entries(run.simulation.byDistance)
      .map(([d, s]) => `d = ${d}: ${s.toFixed(1)} s`)
      .join("; ");
    L.push(
      `Simulación de la malla en Node ${run.nodeVersion}: ${run.simulation.total.toFixed(1)} s en total (${by}).`,
    );
  }
  L.push("");
  if (run.files !== undefined) {
    L.push("### Ficheros (sha256)");
    L.push("");
    for (const [name, sha256] of Object.entries(run.files)) {
      L.push(`- \`${name}\`: \`${sha256}\``);
    }
    L.push("");
  }
}

/** docs/validacion.md: Spanish prose, generated, with the date of the run; one section per model and a summary of the verdicts on top. */
export function renderDocuments(
  sections: readonly DocumentSection[],
  date: Date,
): string {
  const L: string[] = [];
  L.push("# Validación del núcleo frente a PyMatching");
  L.push("");
  L.push(
    "> Generado por `npm run validate` (`tools/validate/compare.ts`); no editar a mano. Criterio en `docs/spec.md` §3 y §6; diseño en `tasks/plans/validation.md` y, para el modelo fenomenológico, `tasks/plans/phase2.md` D6–D9.",
  );
  L.push("");
  const all = sections.every((s) => s.report.pass);
  L.push(`**Veredicto global: ${verdict(all)}** (${date.toISOString()}).`);
  L.push("");
  for (const s of sections) {
    L.push(
      `- ${sectionTitle(s.report.noise)}: **${verdict(s.report.pass)}** (max |z| = ${s.report.grid.maxAbsZ.toFixed(2)}, Σz² = ${s.report.grid.sumZ2.toFixed(2)}, pesos mínimos ${s.report.minWeights.total - s.report.minWeights.mismatches.length}/${s.report.minWeights.total}${s.report.verdicts === null ? "" : `, paridad de veredictos ${s.report.verdicts.total - s.report.verdicts.parityMismatches.length}/${s.report.verdicts.total}`}).`,
    );
  }
  L.push("");
  for (const s of sections) renderSection(L, s);
  return `${L.join("\n")}\n`;
}

/** The document of a single model (renderDocuments with one section). */
export function renderDocument(
  report: Report,
  date: Date,
  run: RunInfo,
): string {
  return renderDocuments([{ report, run }], date);
}
