// One Monte Carlo shot of the phenomenological model (docs/spec.md §3 "Modelo de
// ruido", tasks/plans/phase2.md D1/D2): `cycles` noisy cycles, a perfect final
// readout, detectors by difference, two spacetime decodes, residual, verdict.
// Separate from sim/shot.ts on purpose: the phase 1 loop keeps its shape and
// its bytes (test_intent_independent_model_untouched).
//
// Per cycle r = 1 … cycles:
//   sampleCycleNoise → cycleError E_r and flips f_r (Z checks, then X checks)
//   cumulative C_r = C_{r−1} · E_r
//   per type: s_r = H·C_r ⊕ f_r;  D_r = s_r ⊕ s_{r−1} (s_0 = 0);  previous = s_r
// Layer cycles + 1 (perfect): s = H·C_cycles;  D = s ⊕ s_cycles.
// Then decodeSpacetime for Z (X errors) and X (Z errors) into `correction`
// (space-edge qubits only), residual = C_cycles · correction, verdict bits as
// in shot.ts (LOGICAL_X iff the residual anticommutes with Z_L, LOGICAL_Z
// with X_L). All buffers are allocated once; runSpacetimeShot allocates
// nothing except the documented matcher growth inside decodeSpacetime.

import {
  clearPauli,
  commutes,
  identity,
  multiplyInto,
  type Pauli,
} from "../lattice/pauli";
import type { ReadonlyPauli } from "../lattice/pauli";
import type { RotatedSurfaceCode, StabilizerType } from "../lattice/rotated";
import { computeTypeSyndrome } from "../lattice/syndrome";
import {
  createSpacetimeDecoder,
  decodeSpacetime,
  type SpacetimeDecoder,
} from "../decoder/spacetime";
import {
  sampleCycleNoise,
  type PhenomenologicalNoise,
} from "../noise/phenomenological";
import type { Rng } from "../noise/rng";
import { LOGICAL_X, LOGICAL_Z } from "./shot";

// Module-level copies read once (imported bindings are getters under Vitest).
const sampleCycle = sampleCycleNoise;
const syndromeOf = computeTypeSyndrome;
const decodeType = decodeSpacetime;
const multiply = multiplyInto;
const commute = commutes;
const BIT_X = LOGICAL_X;
const BIT_Z = LOGICAL_Z;

export interface SpacetimeShotContext {
  readonly code: RotatedSurfaceCode;
  readonly noise: PhenomenologicalNoise;
  readonly rng: Rng;
  readonly decoders: {
    readonly Z: SpacetimeDecoder;
    readonly X: SpacetimeDecoder;
  };
  /** Data error of the current cycle (not accumulated). */
  readonly cycleError: Pauli;
  /** C_r, the accumulated data error; after a shot, C_cycles. */
  readonly cumulative: Pauli;
  /** Measurement flips of the current cycle, by typeIndex, length m each. */
  readonly flips: { readonly Z: Uint8Array; readonly X: Uint8Array };
  /** H·C_r of the current cycle (scratch; the reading s_r = H·C_r ⊕ f_r goes to `previous`), length m each. */
  readonly syndromes: { readonly Z: Uint8Array; readonly X: Uint8Array };
  /** s_{r−1}, length m each. */
  readonly previous: { readonly Z: Uint8Array; readonly X: Uint8Array };
  /** Detectors by node index, length m·(cycles + 1) each. */
  readonly detectors: { readonly Z: Uint8Array; readonly X: Uint8Array };
  /** Last correction, both masks written by the two decodes. */
  readonly correction: Pauli;
  /** cumulative · correction after the last shot. */
  readonly residual: Pauli;
}

/** Allocates every buffer of a spacetime shot once (two 3D decoders included). */
export function createSpacetimeShotContext(
  code: RotatedSurfaceCode,
  noise: PhenomenologicalNoise,
  rng: Rng,
): SpacetimeShotContext {
  const m = (code.n - 1) / 2;
  const cycles = noise.cycles;
  const nodes = m * (cycles + 1);
  return Object.freeze({
    code,
    noise,
    rng,
    decoders: Object.freeze({
      Z: createSpacetimeDecoder(code, "Z", cycles),
      X: createSpacetimeDecoder(code, "X", cycles),
    }),
    cycleError: identity(code.n),
    cumulative: identity(code.n),
    flips: Object.freeze({ Z: new Uint8Array(m), X: new Uint8Array(m) }),
    syndromes: Object.freeze({ Z: new Uint8Array(m), X: new Uint8Array(m) }),
    previous: Object.freeze({ Z: new Uint8Array(m), X: new Uint8Array(m) }),
    detectors: Object.freeze({
      Z: new Uint8Array(nodes),
      X: new Uint8Array(nodes),
    }),
    correction: identity(code.n),
    residual: identity(code.n),
  });
}

/**
 * One layer of detectors of one type: syndrome of `cumulative` (into
 * `syndrome`), XOR the flips if given, difference with `previous` into
 * `out[offset …]`, and `previous` ← this layer's syndrome. No allocation.
 */
function layerDetectors(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  cumulative: ReadonlyPauli,
  flips: Uint8Array | null,
  syndrome: Uint8Array,
  previous: Uint8Array,
  out: Uint8Array,
  offset: number,
): void {
  syndromeOf(code, type, cumulative, syndrome);
  const m = syndrome.length;
  if (flips === null) {
    for (let s = 0; s < m; s++) {
      const value = syndrome[s]!;
      out[offset + s] = value ^ previous[s]!;
      previous[s] = value;
    }
  } else {
    for (let s = 0; s < m; s++) {
      const value = syndrome[s]! ^ flips[s]!;
      out[offset + s] = value ^ previous[s]!;
      previous[s] = value;
    }
  }
}

/**
 * Decodes the detectors currently in ctx.detectors (filled by runSpacetimeShot
 * or by the caller) against ctx.cumulative: two decodes into ctx.correction,
 * residual = cumulative · correction, verdict bits (0 = corrected). No
 * allocation beyond matcher growth.
 */
export function decodeSpacetimeShot(ctx: SpacetimeShotContext): number {
  const code = ctx.code;
  const correction = ctx.correction;
  const residual = ctx.residual;
  decodeType(ctx.decoders.Z, ctx.detectors.Z, correction);
  decodeType(ctx.decoders.X, ctx.detectors.X, correction);
  multiply(residual, ctx.cumulative, correction);
  let bits = 0;
  if (!commute(residual, code.logicalZ)) bits |= BIT_X;
  if (!commute(residual, code.logicalX)) bits |= BIT_Z;
  return bits;
}

/**
 * One full shot of the phenomenological model with ctx.noise and ctx.rng:
 * samples the cycles, fills ctx.detectors and decodes. Returns the verdict
 * bits (LOGICAL_X | LOGICAL_Z; 0 = corrected).
 */
export function runSpacetimeShot(ctx: SpacetimeShotContext): number {
  const code = ctx.code;
  const noise = ctx.noise;
  const rng = ctx.rng;
  const cycles = noise.cycles;
  const m = ctx.flips.Z.length;
  const cycleError = ctx.cycleError;
  const cumulative = ctx.cumulative;
  const flips = ctx.flips;
  const syndromes = ctx.syndromes;
  const previous = ctx.previous;
  const detectors = ctx.detectors;
  cumulative.x.fill(0);
  cumulative.z.fill(0);
  previous.Z.fill(0);
  previous.X.fill(0);
  for (let r = 1; r <= cycles; r++) {
    sampleCycle(noise, rng, code, cycleError, flips);
    multiply(cumulative, cumulative, cycleError);
    const offset = (r - 1) * m;
    layerDetectors(
      code,
      "Z",
      cumulative,
      flips.Z,
      syndromes.Z,
      previous.Z,
      detectors.Z,
      offset,
    );
    layerDetectors(
      code,
      "X",
      cumulative,
      flips.X,
      syndromes.X,
      previous.X,
      detectors.X,
      offset,
    );
  }
  const last = cycles * m;
  layerDetectors(
    code,
    "Z",
    cumulative,
    null,
    syndromes.Z,
    previous.Z,
    detectors.Z,
    last,
  );
  layerDetectors(
    code,
    "X",
    cumulative,
    null,
    syndromes.X,
    previous.X,
    detectors.X,
    last,
  );
  return decodeSpacetimeShot(ctx);
}

/**
 * Test and exact-enumeration hook: the detectors of one type for an explicit
 * history. `errors[r − 1]` is the ACCUMULATED data error C_r after cycle r and
 * `flips[r − 1]` the measurement flips of cycle r (length m), r = 1 … cycles;
 * the perfect final readout uses errors[cycles − 1]. Writes every entry of
 * `out` (length m·(cycles + 1)) and returns it. Allocates two scratch
 * buffers. RangeError on length mismatches.
 */
export function detectorsOf(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  cycles: number,
  errors: readonly ReadonlyPauli[],
  flips: readonly Uint8Array[],
  out: Uint8Array,
): Uint8Array {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError(`cycles must be an integer ≥ 1, got ${cycles}`);
  }
  const m = code.stabilizersByType[type].length;
  if (errors.length !== cycles || flips.length !== cycles) {
    throw new RangeError(
      `history must have ${cycles} cumulative errors and ${cycles} flip vectors, got ${errors.length} and ${flips.length}`,
    );
  }
  if (out.length !== m * (cycles + 1)) {
    throw new RangeError(
      `detector buffer must have length ${m * (cycles + 1)}, got ${out.length}`,
    );
  }
  const syndrome = new Uint8Array(m);
  const previous = new Uint8Array(m);
  for (let r = 1; r <= cycles; r++) {
    const f = flips[r - 1]!;
    if (f.length !== m) {
      throw new RangeError(
        `flip vector of cycle ${r} must have length ${m}, got ${f.length}`,
      );
    }
    layerDetectors(
      code,
      type,
      errors[r - 1]!,
      f,
      syndrome,
      previous,
      out,
      (r - 1) * m,
    );
  }
  layerDetectors(
    code,
    type,
    errors[cycles - 1]!,
    null,
    syndrome,
    previous,
    out,
    cycles * m,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Explicit histories (tasks/plans/phase2-g.md D1): what the spacetime viewer
// draws is what the shot decodes. Cold path, called once per shown shot; the
// functions above keep their bytes (test_intent_phenomenological_model_untouched
// and T-G1 of spacetime-shot.test.ts pin that).

/**
 * The events of one shot, cycle by cycle: E_r (the data error of cycle r, NOT
 * accumulated) and the measurement flips f_r of each type, r = 1 … cycles.
 */
export interface SpacetimeHistory {
  readonly cycles: number;
  /** E_r, length n each. */
  readonly cycleErrors: readonly Pauli[];
  /** f_r by typeIndex, length m each. */
  readonly flips: readonly {
    readonly Z: Uint8Array;
    readonly X: Uint8Array;
  }[];
}

/** Allocates an empty history (identity errors, no flips). RangeError unless cycles is an integer ≥ 1. */
export function createSpacetimeHistory(
  code: RotatedSurfaceCode,
  cycles: number,
): SpacetimeHistory {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError(`cycles must be an integer ≥ 1, got ${cycles}`);
  }
  const m = (code.n - 1) / 2;
  const cycleErrors: Pauli[] = [];
  const flips: { readonly Z: Uint8Array; readonly X: Uint8Array }[] = [];
  for (let r = 1; r <= cycles; r++) {
    cycleErrors.push(identity(code.n));
    flips.push(Object.freeze({ Z: new Uint8Array(m), X: new Uint8Array(m) }));
  }
  return Object.freeze({
    cycles,
    cycleErrors: Object.freeze(cycleErrors),
    flips: Object.freeze(flips),
  });
}

function checkHistory(
  code: RotatedSurfaceCode,
  cycles: number,
  history: SpacetimeHistory,
): void {
  if (history.cycles !== cycles) {
    throw new RangeError(
      `history has ${history.cycles} cycles, expected ${cycles}`,
    );
  }
  const m = (code.n - 1) / 2;
  if (
    history.cycleErrors.length !== cycles ||
    history.flips.length !== cycles
  ) {
    throw new RangeError(
      `history must have ${cycles} cycle errors and ${cycles} flip pairs, got ${history.cycleErrors.length} and ${history.flips.length}`,
    );
  }
  for (let r = 1; r <= cycles; r++) {
    const e = history.cycleErrors[r - 1]!;
    const f = history.flips[r - 1]!;
    if (e.n !== code.n) {
      throw new RangeError(
        `cycle ${r} error acts on ${e.n} qubits, code has ${code.n}`,
      );
    }
    if (f.Z.length !== m || f.X.length !== m) {
      throw new RangeError(
        `flip vectors of cycle ${r} must have length ${m}, got ${f.Z.length} and ${f.X.length}`,
      );
    }
  }
}

/**
 * Samples a whole history: `cycles` calls of sampleCycleNoise into
 * history.cycleErrors[r − 1] / history.flips[r − 1], the exact PRNG consumption
 * of one runSpacetimeShot (2n data draws, m Z flips, m X flips per cycle).
 * RangeError unless the history matches noise.cycles and the code.
 */
export function sampleSpacetimeHistory(
  noise: PhenomenologicalNoise,
  rng: Rng,
  code: RotatedSurfaceCode,
  history: SpacetimeHistory,
): void {
  checkHistory(code, noise.cycles, history);
  for (let r = 1; r <= noise.cycles; r++) {
    sampleCycle(
      noise,
      rng,
      code,
      history.cycleErrors[r - 1]!,
      history.flips[r - 1]!,
    );
  }
}

/**
 * The accumulated errors C_r = C_{r−1} · E_r into out[r − 1] (length cycles,
 * each a Pauli on n qubits). Returns `out`. RangeError on a length mismatch.
 */
export function cumulativeErrorsOf(
  history: SpacetimeHistory,
  out: Pauli[],
): Pauli[] {
  const cycles = history.cycles;
  if (out.length !== cycles || history.cycleErrors.length !== cycles) {
    throw new RangeError(
      `need ${cycles} output Paulis for ${history.cycleErrors.length} cycle errors, got ${out.length}`,
    );
  }
  for (let r = 1; r <= cycles; r++) {
    const c = out[r - 1]!;
    if (r === 1) {
      clearPauli(c);
      multiply(c, c, history.cycleErrors[0]!);
    } else {
      multiply(c, out[r - 2]!, history.cycleErrors[r - 1]!);
    }
  }
  return out;
}

/**
 * The MEASURED outcomes of one type for an explicit history: s_r = H·C_r ⊕ f_r
 * for r = 1 … cycles and, in the last layer, the perfect readout s = H·C_cycles
 * (flips never apply there). Same contract as detectorsOf: `errors[r − 1]` is
 * the ACCUMULATED error after cycle r, `flips[r − 1]` the flips of cycle r,
 * `out` has length m·(cycles + 1) and is written entirely. detectorsOf is the
 * layer-to-layer difference of this with s_0 = 0 (spacetime-shot.test.ts T-G2).
 * Allocates one scratch buffer. RangeError on length mismatches.
 */
export function readingsOf(
  code: RotatedSurfaceCode,
  type: StabilizerType,
  cycles: number,
  errors: readonly ReadonlyPauli[],
  flips: readonly Uint8Array[],
  out: Uint8Array,
): Uint8Array {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError(`cycles must be an integer ≥ 1, got ${cycles}`);
  }
  const m = code.stabilizersByType[type].length;
  if (errors.length !== cycles || flips.length !== cycles) {
    throw new RangeError(
      `history must have ${cycles} cumulative errors and ${cycles} flip vectors, got ${errors.length} and ${flips.length}`,
    );
  }
  if (out.length !== m * (cycles + 1)) {
    throw new RangeError(
      `readings buffer must have length ${m * (cycles + 1)}, got ${out.length}`,
    );
  }
  const syndrome = new Uint8Array(m);
  for (let r = 1; r <= cycles; r++) {
    const f = flips[r - 1]!;
    if (f.length !== m) {
      throw new RangeError(
        `flip vector of cycle ${r} must have length ${m}, got ${f.length}`,
      );
    }
    syndromeOf(code, type, errors[r - 1]!, syndrome);
    const offset = (r - 1) * m;
    for (let s = 0; s < m; s++) out[offset + s] = syndrome[s]! ^ f[s]!;
  }
  syndromeOf(code, type, errors[cycles - 1]!, syndrome);
  out.set(syndrome, cycles * m);
  return out;
}

/**
 * Decodes an explicit history in `ctx` exactly as runSpacetimeShot would have
 * decoded it had the noise drawn it: cumulative ← C_cycles, detectors of both
 * types by the same layerDetectors (through ctx.syndromes / ctx.previous), then
 * decodeSpacetimeShot. Returns the verdict bits; ctx.correction, ctx.residual
 * and the decoders' pairs are left as after a shot. ctx.cycleError and ctx.rng
 * are not touched. RangeError unless the history matches ctx.noise.cycles and
 * the code.
 */
export function decodeSpacetimeHistory(
  ctx: SpacetimeShotContext,
  history: SpacetimeHistory,
): number {
  const code = ctx.code;
  const cycles = ctx.noise.cycles;
  checkHistory(code, cycles, history);
  const m = ctx.flips.Z.length;
  const cumulative = ctx.cumulative;
  const syndromes = ctx.syndromes;
  const previous = ctx.previous;
  const detectors = ctx.detectors;
  cumulative.x.fill(0);
  cumulative.z.fill(0);
  previous.Z.fill(0);
  previous.X.fill(0);
  for (let r = 1; r <= cycles; r++) {
    multiply(cumulative, cumulative, history.cycleErrors[r - 1]!);
    const flips = history.flips[r - 1]!;
    const offset = (r - 1) * m;
    layerDetectors(
      code,
      "Z",
      cumulative,
      flips.Z,
      syndromes.Z,
      previous.Z,
      detectors.Z,
      offset,
    );
    layerDetectors(
      code,
      "X",
      cumulative,
      flips.X,
      syndromes.X,
      previous.X,
      detectors.X,
      offset,
    );
  }
  const last = cycles * m;
  layerDetectors(
    code,
    "Z",
    cumulative,
    null,
    syndromes.Z,
    previous.Z,
    detectors.Z,
    last,
  );
  layerDetectors(
    code,
    "X",
    cumulative,
    null,
    syndromes.X,
    previous.X,
    detectors.X,
    last,
  );
  return decodeSpacetimeShot(ctx);
}
