// A decoded shot, photographed (tasks/plans/ui.md D1, D5). The core's
// ShotContext reuses its buffers across decodes; the UI needs a value that
// React can hold, compare and replay without the next click rewriting it.
// decodeTrace copies the error into the context, decodes once and copies every
// result out into a deeply frozen ShotTrace that shares no buffer with ctx.

import {
  copyPauli,
  correctionChains,
  createRng,
  createShotContext,
  decodeShot,
  independentNoise,
  rotatedSurfaceCode,
  type ReadonlyMask,
  type ReadonlyPauli,
  type ShotContext,
} from "../../core";

/** What the grid draws; the step-by-step mode reveals them one at a time. */
export type Layer =
  "errors" | "defects" | "matching" | "correction" | "residual";

export const ALL_LAYERS: ReadonlySet<Layer> = new Set<Layer>([
  "errors",
  "defects",
  "matching",
  "correction",
  "residual",
]);

/** One matched pair (`a`, `b` = typeIndex, BOUNDARY = −1) and the qubits of its correction chain, in walking order from `a`. */
export interface Chain {
  readonly a: number;
  readonly b: number;
  readonly qubits: readonly number[];
}

export interface ShotTrace {
  readonly d: number;
  readonly error: ReadonlyPauli;
  /** By typeIndex, length (d² − 1)/2 each. */
  readonly syndromes: { readonly Z: ReadonlyMask; readonly X: ReadonlyMask };
  /** Chains of the Z decoder (X corrections) and of the X decoder (Z corrections). */
  readonly chains: {
    readonly Z: readonly Chain[];
    readonly X: readonly Chain[];
  };
  readonly correction: ReadonlyPauli;
  readonly residual: ReadonlyPauli;
  /** LOGICAL_X | LOGICAL_Z bits, 0 = corrected. */
  readonly verdict: number;
}

/** A ShotContext for manual injection: decoders of distance d; noise and rng are never used. */
export function createTraceContext(d: number): ShotContext {
  return createShotContext(
    rotatedSurfaceCode(d),
    independentNoise(0),
    createRng(0),
  );
}

function freezePauli(p: ReadonlyPauli): ReadonlyPauli {
  return Object.freeze(copyPauli(p));
}

function freezeChains(chains: readonly Chain[]): readonly Chain[] {
  return Object.freeze(
    chains.map((c) =>
      Object.freeze({ a: c.a, b: c.b, qubits: Object.freeze([...c.qubits]) }),
    ),
  );
}

/** Writes `error` into ctx, decodes it and returns a frozen snapshot that shares nothing with ctx. */
export function decodeTrace(ctx: ShotContext, error: ReadonlyPauli): ShotTrace {
  if (error.n !== ctx.code.n) {
    throw new RangeError(
      `error acts on ${error.n} qubits, context has ${ctx.code.n}`,
    );
  }
  ctx.error.x.set(error.x);
  ctx.error.z.set(error.z);
  const verdict = decodeShot(ctx);
  return Object.freeze({
    d: ctx.code.d,
    error: freezePauli(ctx.error),
    syndromes: Object.freeze({
      Z: Uint8Array.from(ctx.syndromes.Z),
      X: Uint8Array.from(ctx.syndromes.X),
    }),
    chains: Object.freeze({
      Z: freezeChains(correctionChains(ctx.decoders.Z)),
      X: freezeChains(correctionChains(ctx.decoders.X)),
    }),
    correction: freezePauli(ctx.correction),
    residual: freezePauli(ctx.residual),
    verdict,
  });
}
