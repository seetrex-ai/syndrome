// A decoded history of the phenomenological model, photographed
// (tasks/plans/phase2-g.md D3; the pattern of trace.ts). The core's
// SpacetimeShotContext reuses its buffers; the viewer needs a value React can
// hold and replay. decodeSpacetimeTrace decodes once (decodeSpacetimeHistory:
// the shot's own layerDetectors and decodeSpacetimeShot) and copies every
// result out into a deeply frozen SpacetimeTrace that shares no buffer with
// the context. The physics comes from the core only (tests/intent/
// viewer-conventions, test_intent_viewer_physics_comes_from_core).

import {
  copyPauli,
  createRng,
  createSpacetimeHistory,
  createSpacetimeShotContext,
  cumulativeErrorsOf,
  decodeSpacetimeHistory,
  identity,
  phenomenologicalNoise,
  qubitIndex,
  rotatedSurfaceCode,
  sampleSpacetimeHistory,
  spacetimeChains,
  readingsOf,
  type ReadonlyMask,
  type ReadonlyPauli,
  type SpacetimeHistory,
  type SpacetimeShotContext,
  type StabilizerType,
} from "../../core";

/** One edge of a matched path: its endpoints (nodes; `v` may be BOUNDARY) and its qubit (−1 for a time edge). */
export interface SpacetimeEdge {
  readonly index: number;
  readonly u: number;
  readonly v: number;
  readonly qubit: number;
}

/** One matched pair (`a`, `b` = node or BOUNDARY) and the edges of its path, walking from `a`. */
export interface SpacetimeChain {
  readonly a: number;
  readonly b: number;
  readonly edges: readonly SpacetimeEdge[];
}

export interface SpacetimeTrace {
  readonly d: number;
  readonly cycles: number;
  /** cycles + 1: the last layer is the perfect final readout. */
  readonly layers: number;
  /** E_r (not accumulated) and f_r per cycle, r = 1 … cycles. */
  readonly history: {
    readonly cycleErrors: readonly ReadonlyPauli[];
    readonly flips: readonly {
      readonly Z: ReadonlyMask;
      readonly X: ReadonlyMask;
    }[];
  };
  /** C_r, r = 1 … cycles; the final layer shows C_cycles. */
  readonly cumulative: readonly ReadonlyPauli[];
  /** s_r by node index (m·layers each): what each check READ in each layer. */
  readonly readings: { readonly Z: ReadonlyMask; readonly X: ReadonlyMask };
  /** D_r = s_r ⊕ s_{r−1} by node index: the defects the decoder saw. */
  readonly detectors: { readonly Z: ReadonlyMask; readonly X: ReadonlyMask };
  /** Chains of the Z decoder (X corrections) and of the X decoder (Z corrections). */
  readonly chains: {
    readonly Z: readonly SpacetimeChain[];
    readonly X: readonly SpacetimeChain[];
  };
  readonly correction: ReadonlyPauli;
  readonly residual: ReadonlyPauli;
  /** LOGICAL_X | LOGICAL_Z bits, 0 = corrected. */
  readonly verdict: number;
}

/** A context for explicit histories: decoders of distance d with cycles = d; noise and rng are never used. */
export function createSpacetimeTraceContext(d: number): SpacetimeShotContext {
  return createSpacetimeShotContext(
    rotatedSurfaceCode(d),
    phenomenologicalNoise(0, d),
    createRng(0),
  );
}

function freezePauli(p: ReadonlyPauli): ReadonlyPauli {
  return Object.freeze(copyPauli(p));
}

function freezeChains(
  ctx: SpacetimeShotContext,
  type: StabilizerType,
): readonly SpacetimeChain[] {
  const decoder = ctx.decoders[type];
  const graph = decoder.graph;
  return Object.freeze(
    spacetimeChains(decoder).map((chain) =>
      Object.freeze({
        a: chain.a,
        b: chain.b,
        edges: Object.freeze(
          chain.edges.map((index) =>
            Object.freeze({
              index,
              u: graph.edgeU[index]!,
              v: graph.edgeV[index]!,
              qubit: graph.edgeQubit[index]!,
            }),
          ),
        ),
      }),
    ),
  );
}

/** Decodes `history` in ctx and returns a frozen snapshot that shares nothing with ctx or the history. */
export function decodeSpacetimeTrace(
  ctx: SpacetimeShotContext,
  history: SpacetimeHistory,
): SpacetimeTrace {
  const verdict = decodeSpacetimeHistory(ctx, history);
  const code = ctx.code;
  const cycles = ctx.noise.cycles;
  const m = (code.n - 1) / 2;
  const cumulative = cumulativeErrorsOf(
    history,
    Array.from({ length: cycles }, () => identity(code.n)),
  );
  const readingsFor = (type: StabilizerType): Uint8Array =>
    readingsOf(
      code,
      type,
      cycles,
      cumulative,
      history.flips.map((f) => f[type]),
      new Uint8Array(m * (cycles + 1)),
    );
  return Object.freeze({
    d: code.d,
    cycles,
    layers: cycles + 1,
    history: Object.freeze({
      cycleErrors: Object.freeze(history.cycleErrors.map(freezePauli)),
      flips: Object.freeze(
        history.flips.map((f) =>
          Object.freeze({ Z: Uint8Array.from(f.Z), X: Uint8Array.from(f.X) }),
        ),
      ),
    }),
    cumulative: Object.freeze(cumulative.map(freezePauli)),
    readings: Object.freeze({ Z: readingsFor("Z"), X: readingsFor("X") }),
    detectors: Object.freeze({
      Z: Uint8Array.from(ctx.detectors.Z),
      X: Uint8Array.from(ctx.detectors.X),
    }),
    chains: Object.freeze({
      Z: freezeChains(ctx, "Z"),
      X: freezeChains(ctx, "X"),
    }),
    correction: freezePauli(ctx.correction),
    residual: freezePauli(ctx.residual),
    verdict,
  });
}

/** A random history of distance d (cycles = d) at probability p, from `seed`: the same seed gives the same history. */
export function randomHistory(
  d: number,
  p: number,
  seed: number,
): SpacetimeHistory {
  const code = rotatedSurfaceCode(d);
  const noise = phenomenologicalNoise(p, d);
  const history = createSpacetimeHistory(code, d);
  sampleSpacetimeHistory(noise, createRng(seed), code, history);
  return history;
}

/** Whether any cycle of a history has a data error or a measurement flip. */
export function hasEvent(history: SpacetimeHistory): boolean {
  for (let r = 0; r < history.cycles; r++) {
    const e = history.cycleErrors[r]!;
    const f = history.flips[r]!;
    for (let q = 0; q < e.n; q++) if (e.x[q]! | e.z[q]!) return true;
    for (let s = 0; s < f.Z.length; s++) if (f.Z[s]! | f.X[s]!) return true;
  }
  return false;
}

/**
 * The presets that isolate the two mechanisms (phase2-g.md D6, H): a single
 * measurement flip, a single data error, or both. Deterministic: the same
 * preset always gives the same history.
 */
export type PresetKind = "flip" | "data" | "both";
export const PRESET_KINDS: readonly PresetKind[] = ["flip", "data", "both"];

/** The central cycle, ⌈cycles / 2⌉ (1-based). */
export function centralCycle(cycles: number): number {
  return Math.ceil(cycles / 2);
}

/** The central data qubit of the board, ((d − 1)/2, (d − 1)/2). */
export function centralQubit(d: number): number {
  const mid = (d - 1) / 2;
  return qubitIndex(d, mid, mid);
}

/**
 * The interior X check (weight 4) nearest the board centre, ties by typeIndex.
 * An X check reads Z errors, so its flip never shares a graph with the preset's
 * X data error: the two mechanisms stay separate even at d = 3, where every
 * interior plaquette touches the central qubit.
 */
export function presetCheck(d: number): number {
  const code = rotatedSurfaceCode(d);
  const centre = (d - 1) / 2;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const s of code.stabilizersByType.X) {
    if (s.boundary === null) {
      const distance = Math.hypot(s.col + 0.5 - centre, s.row + 0.5 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = s.typeIndex;
      }
    }
  }
  return best;
}

export function presetHistory(d: number, kind: PresetKind): SpacetimeHistory {
  const code = rotatedSurfaceCode(d);
  const history = createSpacetimeHistory(code, d);
  const r = centralCycle(d);
  if (kind !== "data") history.flips[r - 1]!.X[presetCheck(d)] = 1;
  if (kind !== "flip") history.cycleErrors[r - 1]!.x[centralQubit(d)] = 1;
  return history;
}
