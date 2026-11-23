import { describe, expect, it } from "vitest";
import {
  SPLITMIX64_GAMMA,
  splitmix64,
  splitmix64Step,
  uniform53,
} from "./splitmix64";

// Seed of the generic qubit weights (docs/spec.md §3). Repeated literally here so
// that this vector does not depend on decoder/weights.ts.
const WEIGHT_SEED = 0x53594e44n;

describe("T-W1 splitmix64 test vector shared with Python (§6 last item)", () => {
  // Computed independently in Python and re-derived in Node with an independent
  // script before this test was written.
  // tools/reference/run.py must reproduce the same table with the same definition.
  const table: readonly [q: number, hex: string, top53: number, u: number][] = [
    [0, "62db0789e75f0e7a", 3478171642817505, 0.38615462414543],
    [1, "a6e8441d6cc6aa15", 5872528172882133, 0.6519815990293646],
    [2, "ca8eaf64bc6c83db", 7126853657005456, 0.7912397023141455],
    [8, "57ae679b0ca4b9c9", 3085010372498583, 0.34250495467553577],
    [24, "233bcfe45f5f7f48", 1239673532574703, 0.13763140988828393],
    [48, "bcfaad76aa4bf596", 6649114818595198, 0.738200036498071],
    [80, "2bd0a31e57eef7a8", 1541602875735518, 0.1711523007469926],
    [120, "dd6bb5f155e39c8e", 7790549879405683, 0.8649247850606926],
  ];

  it("splitmix64(WEIGHT_SEED + q) and uniform53 match the literal table", () => {
    for (const [q, hex, top53, u] of table) {
      const out = splitmix64(WEIGHT_SEED + BigInt(q));
      expect(out.toString(16).padStart(16, "0"), `q = ${q}`).toBe(hex);
      expect(Number(out >> 11n), `top53 of q = ${q}`).toBe(top53);
      expect(uniform53(out), `u_${q}`).toBe(u);
    }
  });

  it("is the first output of next() (with the golden-ratio increment), not mix(seed) (positive control)", () => {
    // The reading "mix(seed + q) without the increment" would give this value for q = 0.
    const withoutGamma = 0xcf4e83bafee90fcdn;
    expect(splitmix64(WEIGHT_SEED)).not.toBe(withoutGamma);
    expect(uniform53(withoutGamma)).toBeCloseTo(0.8097917872936798, 15);
    expect(uniform53(splitmix64(WEIGHT_SEED))).not.toBeCloseTo(
      0.8097917872936798,
      6,
    );
  });

  it("splitmix64Step chained twice from 0n yields the two outputs that seed xoshiro (T-R1)", () => {
    const [o1, s1] = splitmix64Step(0n);
    expect(s1).toBe(SPLITMIX64_GAMMA);
    expect(o1).toBe(splitmix64(0n));
    const [o2, s2] = splitmix64Step(s1);
    expect(s2).toBe((2n * SPLITMIX64_GAMMA) & (2n ** 64n - 1n));
    // createRng(0) state = [lo(o1), hi(o1), lo(o2), hi(o2)] (rng.test.ts pins the words).
    expect(Number(o1 & 0xffffffffn)).toBe(0x7b1dcdaf);
    expect(Number(o1 >> 32n)).toBe(0xe220a839);
    expect(Number(o2 & 0xffffffffn)).toBe(0xa1b965f4);
    expect(Number(o2 >> 32n)).toBe(0x6e789e6a);
  });

  it("state wraps modulo 2^64 and outputs stay within 64 bits", () => {
    const [o, s] = splitmix64Step((1n << 64n) - 1n);
    expect(s).toBe(SPLITMIX64_GAMMA - 1n);
    expect(o).toBeGreaterThanOrEqual(0n);
    expect(o).toBeLessThan(1n << 64n);
    expect(splitmix64((1n << 64n) + 5n)).toBe(splitmix64(5n));
  });

  it("uniform53 is in [0, 1) and reaches 1 − 2^−53 at the top", () => {
    expect(uniform53(0n)).toBe(0);
    expect(uniform53(2n ** 64n - 1n)).toBe(1 - 2 ** -53);
    expect(uniform53(2n ** 64n - 1n)).toBeLessThan(1);
    expect(uniform53(2047n)).toBe(0); // low 11 bits are discarded
    expect(uniform53(2048n)).toBe(2 ** -53);
  });
});
