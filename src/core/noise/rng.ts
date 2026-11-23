// xoshiro128** 1.0 (Blackman & Vigna, 2018): the PRNG of the Monte Carlo shots.
// Four 32-bit words of state, 32-bit arithmetic only (Math.imul, >>>, rotations),
// one call per Bernoulli draw. Chosen over splitmix64 (bigint in the hot loop),
// sfc32 (same speed, less scrutiny, no public vector) and Math.random (not
// seedable): tasks/plans/decoder.md D1.
//
// Seeding follows the authors' recipe: the state is the two first outputs of
// splitmix64 started at `seed`, split into low and high words. A seed is an
// integer in [0, 2^53) so that it survives JSON and URLs as a plain number.

import { splitmix64Step } from "./splitmix64";

export interface Rng {
  /** The integer the generator was created from (−1 for a state-seeded one). */
  readonly seed: number;
  /** Uniform integer in [0, 2^32). */
  nextUint32(): number;
  /** nextUint32() / 2^32: uniform double in [0, 1) with 32 bits of resolution (UI conveniences). */
  nextFloat(): number;
}

const MAX_SEED = 2 ** 53;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * xoshiro128** on an explicit state (test-vector hook: state [1, 2, 3, 4] gives
 * 11520, 0, 5927040, 70819200, 2031721883). Each word is reduced to 32 bits.
 * RangeError on the all-zero state, which is a fixed point of the generator.
 */
export function xoshiro128ssFromState(
  s0: number,
  s1: number,
  s2: number,
  s3: number,
  seed = -1,
): Rng {
  const s = new Uint32Array(4);
  s[0] = s0;
  s[1] = s1;
  s[2] = s2;
  s[3] = s3;
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) {
    throw new RangeError("xoshiro128** state must not be all zero");
  }
  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s[1]!, 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1]! << 9) >>> 0;
    // Uint32Array stores modulo 2^32, so int32 XOR results land as unsigned words.
    s[2] = s[2]! ^ s[0]!;
    s[3] = s[3]! ^ s[1]!;
    s[1] = s[1]! ^ s[2]!;
    s[0] = s[0]! ^ s[3]!;
    s[2] = s[2]! ^ t;
    s[3] = rotl(s[3]!, 11);
    return result;
  };
  return {
    seed,
    nextUint32,
    nextFloat: () => nextUint32() / 4294967296,
  };
}

/** Seeded generator. RangeError unless `seed` is an integer in [0, 2^53). */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed >= MAX_SEED) {
    throw new RangeError(`seed must be an integer in [0, 2^53), got ${seed}`);
  }
  const [o1, state1] = splitmix64Step(BigInt(seed));
  const [o2] = splitmix64Step(state1);
  return xoshiro128ssFromState(
    Number(o1 & 0xffffffffn),
    Number(o1 >> 32n),
    Number(o2 & 0xffffffffn),
    Number(o2 >> 32n),
    seed,
  );
}
