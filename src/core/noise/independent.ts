// Independent X/Z code-capacity noise (docs/spec.md §3 "Modelo de ruido", phase 1):
// each data qubit suffers X with probability p and, independently, Z with
// probability p. Perfect measurements, one cycle. The MWPM threshold of this
// model is the ≈10.3 % of the literature.
//
// Bernoulli(p) by integer comparison: the threshold t = floor(p · 2^32) is
// precomputed and a qubit has the error iff nextUint32() < t. The realised
// probability is t / 2^32, within 2.4·10^−10 of p: five orders of magnitude below
// the statistical σ of any point of the validation grid (tasks/plans/decoder.md
// D2). p = 1 gives t = 2^32, always true because outputs are < 2^32; p = 0 never.

import type { Pauli } from "../lattice/pauli";
import type { PhenomenologicalNoise } from "./phenomenological";
import type { Rng } from "./rng";

export interface IndependentNoise {
  readonly kind: "independent";
  readonly p: number;
  /** floor(p · 2^32): a qubit draws an error iff nextUint32() < threshold. */
  readonly threshold: number;
}

/**
 * Every noise model of the core, discriminated by `kind`. "depolarizing" is
 * optional in docs/spec.md §3 and not implemented (tasks/plans/phase2.md D15).
 */
export type NoiseModel = IndependentNoise | PhenomenologicalNoise;

/** RangeError unless 0 ≤ p ≤ 1. */
export function independentNoise(p: number): IndependentNoise {
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`error probability must be in [0, 1], got ${p}`);
  }
  return { kind: "independent", p, threshold: Math.floor(p * 4294967296) };
}

/**
 * Samples one error into `out`: writes EVERY entry of out.x and out.z (2n draws,
 * no clear needed), returns `out`. No allocation: this is the first step of the
 * Monte Carlo shot. Any model works here through its `threshold`: for the
 * phenomenological one this is the data noise of ONE cycle (sampleCycleNoise
 * calls it first and then draws the measurement flips).
 */
export function sampleNoise(noise: NoiseModel, rng: Rng, out: Pauli): Pauli {
  const t = noise.threshold;
  const n = out.n;
  const x = out.x;
  const z = out.z;
  for (let q = 0; q < n; q++) {
    x[q] = rng.nextUint32() < t ? 1 : 0;
    z[q] = rng.nextUint32() < t ? 1 : 0;
  }
  return out;
}
