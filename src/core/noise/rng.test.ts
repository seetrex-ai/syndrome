import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng, xoshiro128ssFromState, type Rng } from "./rng";

const arbSeed = fc.nat(2 ** 32 - 1);

function take(rng: Rng, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rng.nextUint32());
  return out;
}

describe("T-R1 the generator is pinned (xoshiro128** seeded by splitmix64)", () => {
  it("reproduces the public xoshiro128** vector from state [1, 2, 3, 4]", () => {
    const rng = xoshiro128ssFromState(1, 2, 3, 4);
    expect(take(rng, 5)).toEqual([11520, 0, 5927040, 70819200, 2031721883]);
  });

  it("createRng(0) has the splitmix64 state and the pinned first outputs", () => {
    const fromState = xoshiro128ssFromState(
      0x7b1dcdaf,
      0xe220a839,
      0xa1b965f4,
      0x6e789e6a,
    );
    const expected = [
      3737715805, 2584255861, 2876756834, 3286328325, 1553311962,
    ];
    expect(take(fromState, 5)).toEqual(expected);
    const rng = createRng(0);
    expect(rng.seed).toBe(0);
    expect(take(rng, 5)).toEqual(expected);
  });

  it("createRng(1) and createRng(0x53594E44) match their literal outputs", () => {
    expect(take(createRng(1), 5)).toEqual([
      1695105466, 1423115009, 634581793, 1068227753, 716759206,
    ]);
    expect(take(createRng(0x53594e44), 5)).toEqual([
      1076465327, 204248548, 3873273890, 3022527639, 3600844737,
    ]);
  });

  it("nextFloat is nextUint32 / 2^32", () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) {
      const f = a.nextFloat();
      expect(f).toBe(b.nextUint32() / 4294967296);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});

describe("T-R2 same seed, same sequence", () => {
  it("two generators from the same seed agree on 10^4 outputs; seed + 1 differs within 8", () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const a = createRng(seed);
        const b = createRng(seed);
        let firstMismatch = -1;
        let outOfRange = -1;
        for (let i = 0; i < 10_000; i++) {
          const v = a.nextUint32();
          if (!Number.isInteger(v) || v < 0 || v >= 2 ** 32) {
            outOfRange = i;
            break;
          }
          if (b.nextUint32() !== v) {
            firstMismatch = i;
            break;
          }
        }
        expect(outOfRange, "output outside [0, 2^32)").toBe(-1);
        expect(firstMismatch, "sequences diverge at index").toBe(-1);
        const c = createRng(seed);
        const d = createRng(seed + 1);
        expect(take(c, 8)).not.toEqual(take(d, 8));
      }),
      { numRuns: 50 },
    );
  });

  it("the seed is recorded on the generator", () => {
    expect(createRng(12345).seed).toBe(12345);
    expect(createRng(2 ** 53 - 1).seed).toBe(2 ** 53 - 1);
    expect(xoshiro128ssFromState(1, 2, 3, 4).seed).toBe(-1);
  });
});

describe("T-R3 invalid seeds and states", () => {
  it("rejects non-integers, negatives and 2^53", () => {
    expect(() => createRng(1.5)).toThrow(RangeError);
    expect(() => createRng(-1)).toThrow(RangeError);
    expect(() => createRng(2 ** 53)).toThrow(RangeError);
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
    expect(() => createRng(2 ** 53 - 1)).not.toThrow();
  });

  it("rejects the all-zero state (fixed point of xoshiro), R10", () => {
    expect(() => xoshiro128ssFromState(0, 0, 0, 0)).toThrow(RangeError);
    expect(() => xoshiro128ssFromState(0, 0, 0, 1)).not.toThrow();
  });
});
