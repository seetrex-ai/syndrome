// splitmix64 (Steele, Lea & Flood; reference implementation by Vigna), shared bit
// for bit with tools/reference (Python). It is the only mixer of the core: it seeds
// the shot PRNG (rng.ts) and defines the generic qubit weights (decoder/weights.ts).
//
// Definition fixed here (docs/spec.md §3 "Pesos y desempate" leaves one reading
// open, tasks/plans/decoder.md D3 closes it): `splitmix64(s)` is the FIRST output
// of the generator whose initial state is `s`, i.e. `mix(s + GAMMA)`, exactly what
// `next()` returns in every reference implementation. The variant `mix(s)` without
// the golden-ratio increment is NOT this function; the test vector distinguishes
// them (q = 0 → 0x62DB0789E75F0E7A, not 0xCF4E83BAFEE90FCD).
//
// bigint on purpose: this runs a few hundred times per code (weights) and twice
// per `createRng`, never in the Monte Carlo loop (tasks/plans/decoder.md R8).

const MASK64 = (1n << 64n) - 1n;

export const SPLITMIX64_GAMMA = 0x9e3779b97f4a7c15n;

/** Finaliser of splitmix64 (murmur-style avalanche) on a 64-bit value. */
function mix(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return z ^ (z >> 31n);
}

/**
 * One step of the generator: returns `[output, nextState]` for initial state
 * `state` (any bigint; reduced modulo 2⁶⁴). Used to seed xoshiro (two steps).
 */
export function splitmix64Step(
  state: bigint,
): readonly [output: bigint, next: bigint] {
  const next = (state + SPLITMIX64_GAMMA) & MASK64;
  return [mix(next), next];
}

/** First output of splitmix64 whose initial state is `state`: mix(state + GAMMA). */
export function splitmix64(state: bigint): bigint {
  return splitmix64Step(state)[0];
}

/** Top 53 bits of a 64-bit output over 2⁵³: a double in [0, 1). */
export function uniform53(output: bigint): number {
  return Number((output & MASK64) >> 11n) / 2 ** 53;
}
