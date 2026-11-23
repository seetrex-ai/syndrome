// The noise models of the chart at runtime (tasks/plans/phase2.md D10). The
// type is the Worker protocol's (src/worker/protocol.ts, a type-only import:
// src/worker is deferred, tests/intent/deferred-loading); the list is here so
// the App, the selector and the stored choice share one source outside the
// deferred directories.
import type { NoiseKind } from "../../worker/protocol";

export type { NoiseKind };

/** Every NoiseKind, in the order the selector lists them. */
export const NOISE_KINDS: readonly NoiseKind[] = [
  "independent",
  "phenomenological",
];

export function isNoiseKind(value: unknown): value is NoiseKind {
  return (NOISE_KINDS as readonly unknown[]).includes(value);
}

/** The model of the first visit: the phase 1 model (docs/spec.md §3). */
export const DEFAULT_MODEL: NoiseKind = "independent";

/**
 * The p of the first view of each noise model, below the measured crossing of
 * its curves (docs/validacion.md: ≈ 0.094–0.096 with perfect measurements,
 * ≈ 0.022–0.028 with measurement failures), so the chart shows Λ > 1 next to
 * the tagline; tests/intent/chart-conventions (test_intent_default_p_below_crossing)
 * measures both against the base curves. Decisions of 2026-10-17: 0.05
 * for the phase 1 model; 0.01 for the phenomenological one, where Λ(3→5) ≈ 2
 * and Λ(5→7) ≈ 3 (tasks/plans/phase2.md D10, M3). On a change of model the App
 * moves p to the new model's default once (the slider stays free afterwards):
 * p = 0.05 under the phenomenological model would show the three curves
 * inverted under the tagline (test_intent_model_switch_resets_p).
 */
export const DEFAULT_P_BY_MODEL: Readonly<Record<NoiseKind, number>> =
  Object.freeze({
    independent: 0.05,
    phenomenological: 0.01,
  });

/** The p of a first visit: the default model's (the grid and the walkthrough read it). */
export const DEFAULT_P = DEFAULT_P_BY_MODEL[DEFAULT_MODEL];
