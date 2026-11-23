// One Monte Carlo shot (docs/spec.md §3 "Vocabulario"): noise → syndrome per
// type → decode × 2 → residual → verdict. The pattern of
// tests/scenario/shot-noise-to-verdict.test.ts and tools/bench moved into the
// core so that UI, Worker, bench and validation run ONE shot
// (tasks/plans/validation.md D3).
//
// All buffers are allocated once by createShotContext and reused: runShot and
// decodeShot allocate nothing. The verdict is a bit mask, not an object: the
// Worker runs ~10⁶ shots per curve (§7) and an object per shot would be GC
// pressure in the hot loop. The bits are what logicalEffect computes, taken
// with `commutes` directly (logicalEffect allocates its result).

import { commutes, identity, multiplyInto, type Pauli } from "../lattice/pauli";
import type { RotatedSurfaceCode } from "../lattice/rotated";
import { computeTypeSyndrome } from "../lattice/syndrome";
import { createDecoder, decode, type Decoder } from "../decoder/decoder";
import { sampleNoise, type IndependentNoise } from "../noise/independent";
import type { Rng } from "../noise/rng";

// Module-level copies read once: inside Vitest's module runner an imported
// binding is a getter, and the shot would pay it per call.
const sample = sampleNoise;
const syndromeOf = computeTypeSyndrome;
const decodeType = decode;
const multiply = multiplyInto;
const commute = commutes;

/** Bit 0 of the verdict: the residual anticommutes with Z_L (acts as X_L). */
export const LOGICAL_X = 1;
/** Bit 1 of the verdict: the residual anticommutes with X_L (acts as Z_L). */
export const LOGICAL_Z = 2;

export interface ShotContext {
  readonly code: RotatedSurfaceCode;
  /** Phase 1 model only; the phenomenological one has its own SpacetimeShotContext (phase2.md D2). */
  readonly noise: IndependentNoise;
  readonly rng: Rng;
  readonly decoders: { readonly Z: Decoder; readonly X: Decoder };
  /** Last sampled (or injected) error. */
  readonly error: Pauli;
  /** Last correction, both masks written by the two decodes. */
  readonly correction: Pauli;
  /** error · correction after the last shot. */
  readonly residual: Pauli;
  /** Last syndromes by typeIndex, length (d² − 1)/2 each. */
  readonly syndromes: { readonly Z: Uint8Array; readonly X: Uint8Array };
}

/** Allocates every buffer of a shot once: two decoders, three Paulis, two syndromes. */
export function createShotContext(
  code: RotatedSurfaceCode,
  noise: IndependentNoise,
  rng: Rng,
): ShotContext {
  const m = (code.n - 1) / 2;
  return Object.freeze({
    code,
    noise,
    rng,
    decoders: Object.freeze({
      Z: createDecoder(code, "Z"),
      X: createDecoder(code, "X"),
    }),
    error: identity(code.n),
    correction: identity(code.n),
    residual: identity(code.n),
    syndromes: Object.freeze({ Z: new Uint8Array(m), X: new Uint8Array(m) }),
  });
}

/**
 * Decodes the error currently in ctx.error (sampled by runShot, or injected by
 * the caller for the manual mode and the exact enumeration): syndromes of both
 * types, two decodes into ctx.correction, residual = error · correction, and
 * the verdict as LOGICAL_X | LOGICAL_Z bits (0 = corrected). No allocation.
 */
export function decodeShot(ctx: ShotContext): number {
  const code = ctx.code;
  const error = ctx.error;
  const correction = ctx.correction;
  const residual = ctx.residual;
  syndromeOf(code, "Z", error, ctx.syndromes.Z);
  decodeType(ctx.decoders.Z, ctx.syndromes.Z, correction);
  syndromeOf(code, "X", error, ctx.syndromes.X);
  decodeType(ctx.decoders.X, ctx.syndromes.X, correction);
  multiply(residual, error, correction);
  let bits = 0;
  if (!commute(residual, code.logicalZ)) bits |= LOGICAL_X;
  if (!commute(residual, code.logicalX)) bits |= LOGICAL_Z;
  return bits;
}

/**
 * One full shot: samples ctx.noise with ctx.rng into ctx.error and decodes it.
 * Returns the verdict bits (LOGICAL_X | LOGICAL_Z; 0 = corrected). No allocation.
 */
export function runShot(ctx: ShotContext): number {
  sample(ctx.noise, ctx.rng, ctx.error);
  return decodeShot(ctx);
}
