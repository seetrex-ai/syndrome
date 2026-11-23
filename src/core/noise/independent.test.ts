import { describe, expect, it } from "vitest";
import { identity, pauliEquals } from "../lattice/pauli";
import { independentNoise, sampleNoise } from "./independent";
import { createRng, type Rng } from "./rng";

const N = 81; // d = 9
const SHOTS = 20_000;

interface Counts {
  draws: number; // N · SHOTS Bernoullis per component
  x: number;
  z: number;
  xz: number; // X ∧ Z on the same qubit
  xLeft: number; // x[q] over q < N − 1 (left marginal of the neighbour pairs)
  xRight: number; // x[q+1] over q < N − 1 (right marginal)
  xNext: number; // x[q] ∧ x[q+1]
  xzShift: number[]; // x[q] ∧ z[(q + k) mod N] for k = 1 … SHIFTS (a Z field copied from X with an offset would show here)
}

const SHIFTS = 3;

/** One pass over SHOTS samples with a fixed seed; the sums T-N1 and T-N2 need. */
function sample(p: number, seed = 12345): Counts {
  const noise = independentNoise(p);
  const rng = createRng(seed);
  const out = identity(N);
  const c: Counts = {
    draws: N * SHOTS,
    x: 0,
    z: 0,
    xz: 0,
    xLeft: 0,
    xRight: 0,
    xNext: 0,
    xzShift: new Array<number>(SHIFTS).fill(0),
  };
  for (let s = 0; s < SHOTS; s++) {
    sampleNoise(noise, rng, out);
    for (let q = 0; q < N; q++) {
      const x = out.x[q]!;
      const z = out.z[q]!;
      c.x += x;
      c.z += z;
      c.xz += x & z;
      for (let k = 1; k <= SHIFTS; k++) {
        c.xzShift[k - 1]! += x & out.z[(q + k) % N]!;
      }
      if (q + 1 < N) {
        const next = out.x[q + 1]!;
        c.xLeft += x;
        c.xRight += next;
        c.xNext += x & next;
      }
    }
  }
  return c;
}

/** Sample Pearson correlation of two Bernoulli(p) streams from their joint count. */
function correlation(
  pairs: number,
  countA: number,
  countB: number,
  countAB: number,
): number {
  const pa = countA / pairs;
  const pb = countB / pairs;
  const cov = countAB / pairs - pa * pb;
  return cov / Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
}

describe("T-N1 frequencies ≈ p within 5σ (fixed seed, deterministic)", () => {
  // Positive control (not run): a 16-bit threshold (p·2^16 truncated) realises
  // p = 0.03 as 1966/65536 = 0.029999 and p = 0.1 as 6553/65536 = 0.09999; with
  // 5·10^5 shots × 81 qubits (σ = 8·10^−5) the 0.03 case lands ~1.4σ off on
  // average and a 10^7-shot run would fail it. The 32-bit threshold is within
  // 2.4·10^−10 of p (D2).
  for (const p of [0.1, 0.03]) {
    it(`p = ${p}: X and Z frequencies within p ± 5σ over 1.62·10^6 draws`, () => {
      const c = sample(p);
      const sigma = Math.sqrt((p * (1 - p)) / c.draws);
      expect(Math.abs(c.x / c.draws - p)).toBeLessThan(5 * sigma);
      expect(Math.abs(c.z / c.draws - p)).toBeLessThan(5 * sigma);
    });
  }
});

describe("T-N2 X and Z are independent, and so are neighbouring qubits", () => {
  for (const p of [0.1, 0.03]) {
    it(`p = ${p}: P(X ∧ Z) within p² ± 5σ and |r| < 5/√N for (x[q], z[q]) and (x[q], x[q+1])`, () => {
      const c = sample(p);
      const sigma = Math.sqrt((p * p * (1 - p * p)) / c.draws);
      expect(Math.abs(c.xz / c.draws - p * p)).toBeLessThan(5 * sigma);
      expect(Math.abs(correlation(c.draws, c.x, c.z, c.xz))).toBeLessThan(
        5 / Math.sqrt(c.draws),
      );
      // X against Z on OTHER qubits: a Z field that is a shifted copy of the X
      // field keeps both marginals and P(X ∧ Z on the same qubit) right but
      // would bias P_L (X or Z). Checked for shifts 1 … SHIFTS (wrap-around).
      for (let k = 0; k < SHIFTS; k++) {
        expect(
          Math.abs(correlation(c.draws, c.x, c.z, c.xzShift[k]!)),
          `shift ${k + 1}`,
        ).toBeLessThan(5 / Math.sqrt(c.draws));
      }
      // Neighbour pairs (x[q], x[q+1]): N − 1 per shot, with their own marginals.
      const pairs = (N - 1) * SHOTS;
      expect(
        Math.abs(correlation(pairs, c.xLeft, c.xRight, c.xNext)),
      ).toBeLessThan(5 / Math.sqrt(pairs));
    });
  }
});

describe("T-N3 extremes and buffer contract", () => {
  it("p = 0 clears a prefilled buffer, p = 1 fills it, and the same object is returned", () => {
    const rng = createRng(1);
    const out = identity(N);
    out.x.fill(0xff);
    out.z.fill(0xff);
    expect(sampleNoise(independentNoise(0), rng, out)).toBe(out);
    expect(out.x.every((b) => b === 0)).toBe(true);
    expect(out.z.every((b) => b === 0)).toBe(true);
    sampleNoise(independentNoise(1), rng, out);
    expect(out.x.every((b) => b === 1)).toBe(true);
    expect(out.z.every((b) => b === 1)).toBe(true);
  });

  it("p = 0 never fires even when the generator returns 0, and p = 1 fires on 2^32 − 1 (strict < against the threshold)", () => {
    const zeros: Rng = { seed: -1, nextUint32: () => 0, nextFloat: () => 0 };
    const maxes: Rng = {
      seed: -1,
      nextUint32: () => 2 ** 32 - 1,
      nextFloat: () => 1 - 2 ** -32,
    };
    const out = identity(N);
    out.x.fill(1);
    out.z.fill(1);
    sampleNoise(independentNoise(0), zeros, out);
    expect(out.x.every((b) => b === 0)).toBe(true);
    expect(out.z.every((b) => b === 0)).toBe(true);
    sampleNoise(independentNoise(1), maxes, out);
    expect(out.x.every((b) => b === 1)).toBe(true);
    expect(out.z.every((b) => b === 1)).toBe(true);
    // A draw equal to the threshold does not fire: p = 2^-32 with a 0 draw fires,
    // with a 1 draw does not.
    sampleNoise(independentNoise(2 ** -32), zeros, out);
    expect(out.x.every((b) => b === 1)).toBe(true);
    const ones: Rng = { seed: -1, nextUint32: () => 1, nextFloat: () => 0 };
    sampleNoise(independentNoise(2 ** -32), ones, out);
    expect(out.x.every((b) => b === 0)).toBe(true);
  });

  it("thresholds are floor(p · 2^32)", () => {
    expect(independentNoise(1).threshold).toBe(2 ** 32);
    expect(independentNoise(0.5).threshold).toBe(2 ** 31);
    expect(independentNoise(0).threshold).toBe(0);
    expect(independentNoise(0.1).threshold).toBe(Math.floor(0.1 * 2 ** 32));
    expect(independentNoise(0.1).kind).toBe("independent");
    expect(independentNoise(0.1).p).toBe(0.1);
  });

  it("rejects p outside [0, 1] and NaN", () => {
    expect(() => independentNoise(-0.1)).toThrow(RangeError);
    expect(() => independentNoise(1.01)).toThrow(RangeError);
    expect(() => independentNoise(Number.NaN)).toThrow(RangeError);
  });
});

describe("T-N4 reproducible by seed", () => {
  it("two generators with the same seed produce equal Paulis for 100 shots", () => {
    const noise = independentNoise(0.1);
    const a = createRng(2026);
    const b = createRng(2026);
    const pa = identity(N);
    const pb = identity(N);
    for (let s = 0; s < 100; s++) {
      sampleNoise(noise, a, pa);
      sampleNoise(noise, b, pb);
      expect(pauliEquals(pa, pb)).toBe(true);
    }
  });
});
