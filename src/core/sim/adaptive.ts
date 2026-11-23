// Adaptive sampling of one point (d, p) of the P_L curve (docs/spec.md §3
// "Métrica del marcador", tasks/plans/validation.md D1/D4).
//
// Stop rule, checked AFTER EVERY SHOT (never per batch), first match wins:
//   (a) shots = minShots and failures ≥ minFailures         → "shots",    k/N
//   (b) shots > minShots and the shot that makes failures
//       = minFailures                                       → "failures", (k−1)/(N−1)
//   (c) shots = maxShots and nothing above fired            → "cap",      k/N
//   (d) the caller stopped it with stop()                   → "budget",   k/N
// With the validation rule {100, 10⁵, 10⁶} every point of the §6 grid stops by
// (a) (M3: the sparsest point has ≈ 567 failures in 10⁵ shots); (b)–(d) are what
// the browser and the tests exercise. The inverse-binomial estimator of (b)
// assumes the stop lands on the k-th failure exactly, which is why the rule is
// per shot.
//
// step(sampler, maxShots) runs at most maxShots shots and cuts at the exact
// shot where the rule fires, so a Worker can post progress every batch and a
// validation run can call it once with the cap. The tally is a sealed object
// with numeric fields: step allocates nothing; estimate() builds the immutable
// result and is called per progress message, not per shot.

import type { RotatedSurfaceCode } from "../lattice/rotated";
import { independentNoise } from "../noise/independent";
import { phenomenologicalNoise } from "../noise/phenomenological";
import { createRng } from "../noise/rng";
import { createShotContext, runShot, type ShotContext } from "./shot";
import {
  createSpacetimeShotContext,
  runSpacetimeShot,
  type SpacetimeShotContext,
} from "./spacetime-shot";
import { pointRate, wilsonInterval, type StopReason } from "./stats";

// Module-level copies read once (imported bindings are getters under Vitest).
const shot = runShot;
const spacetimeShot = runSpacetimeShot;

/**
 * Which noise model a point samples (tasks/plans/phase2.md D2). The
 * phenomenological model runs `cycles` noisy cycles, d by default; `cycles`
 * is for the exact cycles = 1 check and the tests, the UI never sets it.
 */
export type ModelSpec =
  | { readonly kind: "independent" }
  | { readonly kind: "phenomenological"; readonly cycles?: number };

/** Phase 1 model: independent X/Z, perfect measurements, one cycle. The default. */
export const INDEPENDENT_MODEL: ModelSpec = Object.freeze({
  kind: "independent",
});

/** Phase 2 model: d cycles with measurement flips at q = p, perfect final readout. */
export const PHENOMENOLOGICAL_MODEL: ModelSpec = Object.freeze({
  kind: "phenomenological",
});

export interface StopRule {
  /** Failures required before a stop by shots or by failures; ≥ 2 (Haldane needs k ≥ 2). */
  readonly minFailures: number;
  /** Shots required before any stop but the cap; 1 ≤ minShots ≤ maxShots. */
  readonly minShots: number;
  /** Hard cap on shots; the point stops here with whatever it has. */
  readonly maxShots: number;
}

/** The rule of the validation grid (docs/spec.md §3, §6): ≥ 100 failures AND ≥ 10⁵ shots, cap 10⁶. */
export const VALIDATION_STOP_RULE: StopRule = Object.freeze({
  minFailures: 100,
  minShots: 100_000,
  maxShots: 1_000_000,
});

/** Validates a rule and returns a frozen copy. RangeError on non-integers, minFailures < 2 or not 1 ≤ minShots ≤ maxShots. */
export function stopRule(rule: StopRule): StopRule {
  const { minFailures, minShots, maxShots } = rule;
  // ≥ 2: with minFailures = 1 a stop by failures gives the Haldane estimate
  // (k − 1)/(N − 1) = 0 with one failure, a zero that is not an upper bound.
  if (!Number.isInteger(minFailures) || minFailures < 2) {
    throw new RangeError(
      `minFailures must be an integer ≥ 2, got ${minFailures}`,
    );
  }
  if (!Number.isInteger(minShots) || minShots < 1) {
    throw new RangeError(`minShots must be an integer ≥ 1, got ${minShots}`);
  }
  if (!Number.isInteger(maxShots) || maxShots < minShots) {
    throw new RangeError(
      `maxShots must be an integer ≥ minShots (${minShots}), got ${maxShots}`,
    );
  }
  return Object.freeze({ minFailures, minShots, maxShots });
}

export interface Tally {
  readonly shots: number;
  /** Shots with a logical error of either type (X or Z: OR, not sum). */
  readonly failures: number;
  readonly failuresX: number;
  readonly failuresZ: number;
  /** null while the point is still sampling. */
  readonly stopReason: StopReason | null;
}

interface MutableTally extends Tally {
  shots: number;
  failures: number;
  failuresX: number;
  failuresZ: number;
  stopReason: StopReason | null;
}

export interface PointSampler {
  readonly code: RotatedSurfaceCode;
  readonly p: number;
  readonly seed: number;
  readonly rule: StopRule;
  /** The model this point samples (what createPointSampler received, or INDEPENDENT_MODEL). */
  readonly model: ModelSpec;
  /**
   * TypeScript does not narrow a union on the nested `ctx.noise.kind`; narrow
   * with the `"detectors" in ctx` guard (true only for SpacetimeShotContext),
   * or read `sampler.model.kind` first.
   */
  readonly ctx: ShotContext | SpacetimeShotContext;
  /** Updated in place by step(); read it, never write it. */
  readonly tally: Tally;
}

// Internal: the shot function bound to the context, chosen once per sampler
// so that step() has no per-shot branch on the model.
interface SamplerInternals extends PointSampler {
  readonly shot: () => number;
}

/**
 * Allocates the sampler of one point. `model` defaults to INDEPENDENT_MODEL
 * (phase 1; the 21 existing call sites keep their shape and their draws).
 * RangeError on an invalid rule, p ∉ [0, 1], a bad seed (createRng) or
 * cycles not an integer ≥ 1.
 */
export function createPointSampler(
  code: RotatedSurfaceCode,
  p: number,
  seed: number,
  rule: StopRule,
  model: ModelSpec = INDEPENDENT_MODEL,
): PointSampler {
  const checked = stopRule(rule);
  const rng = createRng(seed);
  const tally: MutableTally = Object.seal({
    shots: 0,
    failures: 0,
    failuresX: 0,
    failuresZ: 0,
    stopReason: null,
  });
  let ctx: ShotContext | SpacetimeShotContext;
  let run: () => number;
  if (model.kind === "independent") {
    const c = createShotContext(code, independentNoise(p), rng);
    ctx = c;
    run = () => shot(c);
  } else if (model.kind === "phenomenological") {
    const c = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(p, model.cycles ?? code.d),
      rng,
    );
    ctx = c;
    run = () => spacetimeShot(c);
  } else {
    // A Worker message built at runtime can carry any string.
    throw new RangeError(
      `unknown model kind ${String((model as { kind: unknown }).kind)}`,
    );
  }
  const sampler: SamplerInternals = Object.freeze({
    code,
    p,
    seed,
    rule: checked,
    model,
    ctx,
    tally,
    shot: run,
  });
  return sampler;
}

/**
 * Runs at most maxShots shots and stops at the exact shot where the rule
 * fires. Returns tally.stopReason: null means "keep going". A sampler that
 * has already stopped returns its reason without running anything. No
 * allocation. RangeError unless maxShots is a non-negative integer.
 */
export function step(
  sampler: PointSampler,
  maxShots: number,
): StopReason | null {
  if (!Number.isInteger(maxShots) || maxShots < 0) {
    throw new RangeError(
      `maxShots must be a non-negative integer, got ${maxShots}`,
    );
  }
  const tally = sampler.tally as MutableTally;
  if (tally.stopReason !== null) {
    return tally.stopReason;
  }
  const run = (sampler as SamplerInternals).shot;
  const minFailures = sampler.rule.minFailures;
  const minShots = sampler.rule.minShots;
  const cap = sampler.rule.maxShots;
  let shots = tally.shots;
  let failures = tally.failures;
  let failuresX = tally.failuresX;
  let failuresZ = tally.failuresZ;
  let reason: StopReason | null = null;
  for (let i = 0; i < maxShots; i++) {
    const bits = run();
    shots++;
    if (bits !== 0) {
      failures++;
      failuresX += bits & 1;
      failuresZ += bits >> 1;
    }
    if (shots >= minShots) {
      if (failures >= minFailures) {
        // At shots > minShots this is the shot that made failures = minFailures:
        // the check runs after every shot, so an earlier shot would have stopped.
        reason = shots === minShots ? "shots" : "failures";
        break;
      }
      if (shots === cap) {
        reason = "cap";
        break;
      }
    }
  }
  tally.shots = shots;
  tally.failures = failures;
  tally.failuresX = failuresX;
  tally.failuresZ = failuresZ;
  tally.stopReason = reason;
  return reason;
}

/**
 * Caller-side stop (time budget, cancellation): marks the point as stopped by
 * "budget" if the rule has not fired yet; a stopped point keeps its reason.
 */
export function stop(sampler: PointSampler, reason: "budget"): void {
  if (reason !== "budget") {
    throw new RangeError(
      `callers may only stop with "budget", got ${String(reason)}`,
    );
  }
  const tally = sampler.tally as MutableTally;
  if (tally.stopReason === null) {
    tally.stopReason = reason;
  }
}

export interface PointEstimate {
  readonly d: number;
  readonly p: number;
  readonly shots: number;
  readonly failures: number;
  readonly failuresX: number;
  readonly failuresZ: number;
  /** P_L (X or Z): pointRate by stop reason; k/N while still running. */
  readonly estimate: number;
  /** Wilson 95 % on (failures, shots). */
  readonly low: number;
  readonly high: number;
  /**
   * Per-type detail. With a stop by shots, cap or budget: kX/N. With a stop by
   * failures the shot count is random and kX/N is biased upwards like k/N (+72 %
   * at k = 2, measured over 4 000 seeds on 2026-10-16); the unbiased
   * estimator is estimate · kX/k (given N, E[kX] = k · P_X/P_L), which also
   * keeps P_X ≤ P_L.
   */
  readonly estimateX: number;
  readonly lowX: number;
  readonly highX: number;
  readonly estimateZ: number;
  readonly lowZ: number;
  readonly highZ: number;
  /** null = still running (UI progress). */
  readonly stopReason: StopReason | null;
  /** failures = 0: draw `high` as an upper bound, never the point as zero (docs/spec.md §3). */
  readonly upperBoundOnly: boolean;
}

/** Immutable snapshot of the tally with its intervals. Allocates: call per progress message, not per shot. */
export function estimate(sampler: PointSampler): PointEstimate {
  const t = sampler.tally;
  const reason = t.stopReason;
  const all = wilsonInterval(t.failures, t.shots);
  const x = wilsonInterval(t.failuresX, t.shots);
  const z = wilsonInterval(t.failuresZ, t.shots);
  const estimate = pointRate(t.failures, t.shots, reason ?? "shots");
  // Per-type estimators: see PointEstimate.estimateX. With "failures" the
  // combined estimate is Haldane's and the types split it in proportion.
  const share = (kType: number): number =>
    reason === "failures"
      ? (estimate * kType) / t.failures
      : pointRate(kType, t.shots, "shots");
  return Object.freeze({
    d: sampler.code.d,
    p: sampler.p,
    shots: t.shots,
    failures: t.failures,
    failuresX: t.failuresX,
    failuresZ: t.failuresZ,
    estimate,
    low: all.low,
    high: all.high,
    estimateX: share(t.failuresX),
    lowX: x.low,
    highX: x.high,
    estimateZ: share(t.failuresZ),
    lowZ: z.low,
    highZ: z.high,
    stopReason: reason,
    upperBoundOnly: t.failures === 0,
  });
}

/** Synchronous convenience (tests, tools/validate): samples until the rule fires and returns the estimate. */
export function estimatePoint(
  code: RotatedSurfaceCode,
  p: number,
  seed: number,
  rule: StopRule,
  model: ModelSpec = INDEPENDENT_MODEL,
): PointEstimate {
  const sampler = createPointSampler(code, p, seed, rule, model);
  // One call with the cap suffices: the rule fires by maxShots at the latest.
  if (step(sampler, sampler.rule.maxShots) === null) {
    throw new Error(
      `stop rule did not fire within maxShots = ${sampler.rule.maxShots} shots`,
    );
  }
  return estimate(sampler);
}
