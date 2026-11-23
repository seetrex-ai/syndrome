// Phenomenological noise (docs/spec.md §3 "Modelo de ruido", phase 2;
// tasks/plans/phase2.md D1). One shot is `cycles` cycles (cycles = d by
// default); in cycle r = 1 … cycles:
//   (1) every data qubit suffers X with probability p and, independently, Z
//       with probability p; errors ACCUMULATE: C_r = C_{r−1} · E_r;
//   (2) every stabilizer is measured and each outcome is flipped with
//       probability q = p, independently per stabilizer and cycle:
//       s_r = H · C_r ⊕ f_r.
// After the last cycle a PERFECT final readout of the data qubits, with no
// extra noise, gives s_{cycles+1} = H · C_cycles. Detectors are the differences
// D_r = s_r ⊕ s_{r−1} with s_0 = 0 (sim/spacetime-shot.ts). The MWPM threshold
// of this model is ≈ 3 % (Wang, Harrington & Preskill 2003: 2.9 %); for
// d = 3, 5, 7 the curves cross lower and per pair: (3, 5) ≈ 2.2 %, (3, 7) ≈ 2.5 %,
// (5, 7) ≈ 2.8 % (independent probe, 10⁵ shots per point; docs/validacion.md
// publishes the reference values).
//
// q ≠ p is not a parameter (§3 fixes q = p); `cycles` is exposed for the exact
// cycles = 1 enumeration and the tests, the UI never sets it.
//
// PRNG consumption order, fixed so that browser-phenomenological.json is
// reproducible: per cycle, 2n data draws (X then Z per qubit, exactly as
// sampleNoise), then m flips of the Z checks, then m flips of the X checks.
// Bernoulli(p) by integer comparison against threshold = floor(p · 2³²), the
// same mechanism as independent.ts.

import type { Pauli } from "../lattice/pauli";
import type { RotatedSurfaceCode } from "../lattice/rotated";
import { sampleNoise } from "./independent";
import type { Rng } from "./rng";

export interface PhenomenologicalNoise {
  readonly kind: "phenomenological";
  /** Data error probability per qubit, per component, per cycle. */
  readonly p: number;
  /** Measurement flip probability per stabilizer per cycle; always p. */
  readonly q: number;
  /** Noisy cycles per shot (≥ 1); the perfect final readout is not counted. */
  readonly cycles: number;
  /** floor(p · 2^32): a draw fires iff nextUint32() < threshold (data and flips alike, q = p). */
  readonly threshold: number;
}

/** RangeError unless 0 ≤ p ≤ 1 and cycles is an integer ≥ 1. */
export function phenomenologicalNoise(
  p: number,
  cycles: number,
): PhenomenologicalNoise {
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`error probability must be in [0, 1], got ${p}`);
  }
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new RangeError(`cycles must be an integer ≥ 1, got ${cycles}`);
  }
  return {
    kind: "phenomenological",
    p,
    q: p,
    cycles,
    threshold: Math.floor(p * 4294967296),
  };
}

/**
 * Samples ONE cycle: writes every entry of out.x / out.z (2n draws, the data
 * error of this cycle, not accumulated) and then every entry of flips.Z (m
 * draws) and flips.X (m draws). `flips.Z.length === flips.X.length === m` with
 * m = (d² − 1)/2 (RangeError otherwise). No allocation.
 */
export function sampleCycleNoise(
  noise: PhenomenologicalNoise,
  rng: Rng,
  code: RotatedSurfaceCode,
  out: Pauli,
  flips: { readonly Z: Uint8Array; readonly X: Uint8Array },
): void {
  const m = code.stabilizersByType.Z.length;
  if (flips.Z.length !== m || flips.X.length !== m) {
    throw new RangeError(
      `flip buffers must have length ${m}, got ${flips.Z.length} and ${flips.X.length}`,
    );
  }
  if (out.n !== code.n) {
    throw new RangeError(`error acts on ${out.n} qubits, code has ${code.n}`);
  }
  sampleNoise(noise, rng, out);
  const t = noise.threshold;
  const fz = flips.Z;
  const fx = flips.X;
  for (let s = 0; s < m; s++) fz[s] = rng.nextUint32() < t ? 1 : 0;
  for (let s = 0; s < m; s++) fx[s] = rng.nextUint32() < t ? 1 : 0;
}
