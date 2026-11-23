import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  computeSyndrome,
  DISTANCES,
  identity,
  pauliEquals,
  pauliFrom,
  rotatedSurfaceCode,
  weight,
  type Distance,
} from "../../core";
import {
  decodePuzzle,
  drawPuzzle,
  encodePuzzle,
  HASH_PREFIX,
  maskLength,
  MAX_DRAWS,
  puzzleFromHash,
  type Puzzle,
} from "./puzzle";

function puzzle(d: Distance, bits: readonly number[]): Puzzle {
  const n = d * d;
  const error = identity(n);
  for (let q = 0; q < n; q++) {
    error.x[q] = bits[q]!;
    error.z[q] = bits[n + q]!;
  }
  return { d, model: "independent", error };
}

/** The 2n bits of a mask with X on `xs` and Z on `zs`. */
function bitsOf(n: number, xs: readonly number[], zs: readonly number[]) {
  const bits = new Array<number>(2 * n).fill(0);
  for (const q of xs) bits[q] = 1;
  for (const q of zs) bits[n + q] = 1;
  return bits;
}

function hasDefect(p: Puzzle): boolean {
  const code = rotatedSurfaceCode(p.d);
  return computeSyndrome(
    code,
    p.error,
    new Uint8Array(code.stabilizers.length),
  ).some((bit) => bit === 1);
}

describe("encodePuzzle / decodePuzzle", () => {
  it("round-trips 200 random masks for every distance (fast-check)", () => {
    for (const d of DISTANCES) {
      const n = d * d;
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 1 }), {
            minLength: 2 * n,
            maxLength: 2 * n,
          }),
          (bits) => {
            const p = puzzle(d, bits);
            const back = decodePuzzle(encodePuzzle(p));
            if (!hasDefect(p)) {
              // An error with no defect (empty, a stabilizer, a logical) is
              // no puzzle: the link is rejected.
              expect(back).toBeNull();
              return;
            }
            expect(back).not.toBeNull();
            expect(back!.d).toBe(d);
            expect(back!.model).toBe("independent");
            expect(pauliEquals(back!.error, p.error)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    }
  });

  it("uses exactly ceil(2d²/6) mask characters: 3, 9, 17 and 27 for d = 3, 5, 7, 9", () => {
    const expected: Record<Distance, number> = { 3: 3, 5: 9, 7: 17, 9: 27 };
    for (const d of DISTANCES) {
      expect(maskLength(d)).toBe(expected[d]);
      const text = encodePuzzle(puzzle(d, new Array(2 * d * d).fill(0)));
      expect(text).toBe(`i${d}.${"A".repeat(expected[d])}`);
      expect(text.length).toBeLessThanOrEqual(2 + 1 + 27);
    }
  });

  it("encodes x bits first, then z bits, most significant bit first (literal vectors)", () => {
    const d = 3;
    const n = 9;
    const xOn0 = puzzle(d, [1, ...new Array(2 * n - 1).fill(0)]);
    expect(encodePuzzle(xOn0)).toBe("i3.gAA");
    const zOn8 = puzzle(d, [...new Array(2 * n - 1).fill(0), 1]);
    expect(encodePuzzle(zOn8)).toBe("i3.AAB");
    const both = decodePuzzle("i3.gAB")!;
    expect(
      pauliEquals(both.error, pauliFrom(n, [0], [8])),
      "X on qubit 0 and Z on qubit 8",
    ).toBe(true);
    // Asymmetric vectors: the qubit order of the link is row
    // major, q = row·d + col. X on q = 1 = (0, 1) is bit 1 of the first sextet
    // (010000 = "Q"); a column-major order would put it on (1, 0) = bit 3
    // ("E"). Z on q = 5 = (1, 2) is bit 14: third of the third sextet ("I").
    const xOn1 = puzzle(d, [0, 1, ...new Array(2 * n - 2).fill(0)]);
    expect(encodePuzzle(xOn1)).toBe("i3.QAA");
    expect(
      pauliEquals(decodePuzzle("i3.QAA")!.error, pauliFrom(n, [1], [])),
    ).toBe(true);
    expect(encodePuzzle(puzzle(d, bitsOf(n, [], [5])))).toBe("i3.AAI");
    expect(
      pauliEquals(decodePuzzle("i3.AAI")!.error, pauliFrom(n, [], [5])),
    ).toBe(true);
    // X on the whole first row (0,0),(0,1),(0,2): bits 0–2 = "4" (111000).
    expect(encodePuzzle(puzzle(d, bitsOf(n, [0, 1, 2], [])))).toBe("i3.4AA");
  });

  it("rejects a link whose error has no defect: empty, a stabilizer, a logical operator", () => {
    expect(decodePuzzle("i3.AAA"), "empty board").toBeNull();
    expect(
      decodePuzzle("i3.wAA"),
      "top X stabilizer on (0,0),(0,1)",
    ).toBeNull();
    expect(decodePuzzle("i3.kgA"), "X_L on column 0").toBeNull();
    expect(puzzleFromHash("#c=i3.kgA")).toBeNull();
    expect(decodePuzzle("i5.AAAAAAAAA"), "empty board, d = 5").toBeNull();
    // Controls: one X error is a puzzle; so is a logical plus one error.
    expect(decodePuzzle("i3.gAA")).not.toBeNull();
    expect(decodePuzzle("i3.kgQ")).not.toBeNull();
  });

  it("rejects anything that does not parse exactly", () => {
    const cases: [string, string][] = [
      ["x3.AAA", "unknown model letter"],
      ["I3.AAA", "upper-case model letter"],
      ["i4.AAA", "even distance"],
      ["i1.A", "distance below 3"],
      ["i11.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "distance not offered"],
      ["i3.AAA=", "padding"],
      ["i3.AA+", "character outside base64url"],
      ["i3.AA/", "character outside base64url"],
      ["i3.AA", "too short"],
      ["i3.AAAA", "too long"],
      ["i5.AAAAAAAAB", "spare bits set (50 bits in 54)"],
      ["i3AAA", "no dot"],
      ["i3.", "empty mask"],
      ["", "empty"],
      ["i3.AAA.AAA", "two masks"],
      [" i3.AAA", "leading space"],
      ["i3.AAA\n", "trailing newline"],
      ["i03.AAA", "leading zero"],
    ];
    for (const [text, why] of cases) {
      expect(decodePuzzle(text), why).toBeNull();
    }
    // The spare bits of d = 5 are the last four of the ninth character: "A"
    // (000000) is fine, anything with the low four bits set is not.
    expect(decodePuzzle("i5.AAAAAAAAw")).not.toBeNull(); // 110000: bits 48, 49
    expect(decodePuzzle("i5.AAAAAAAAI")).toBeNull(); // 001000: spare bit 50
  });

  it("puzzleFromHash reads `#c=…` and nothing else", () => {
    expect(HASH_PREFIX).toBe("#c=");
    const p = puzzleFromHash("#c=i3.gAA");
    expect(p).not.toBeNull();
    expect(p!.d).toBe(3);
    expect(weight(p!.error)).toBe(1);
    expect(puzzleFromHash("")).toBeNull();
    expect(puzzleFromHash("#")).toBeNull();
    expect(puzzleFromHash("#c=")).toBeNull();
    expect(puzzleFromHash("#c=i3.AAA=")).toBeNull();
    expect(puzzleFromHash("#x=i3.gAA")).toBeNull();
    expect(puzzleFromHash("c=i3.gAA")).toBeNull();
    expect(puzzleFromHash("#c=i3.gAA&other=1")).toBeNull();
  });

  it("returns frozen puzzles that share no buffer with the input", () => {
    const p = puzzle(3, [1, ...new Array(17).fill(0)]);
    const back = decodePuzzle(encodePuzzle(p))!;
    expect(Object.isFrozen(back)).toBe(true);
    expect(Object.isFrozen(back.error)).toBe(true);
    expect(back.error).not.toBe(p.error);
  });
});

describe("drawPuzzle", () => {
  it("never returns an error with an empty syndrome when p > 0 (50 seeds per distance)", () => {
    for (const d of [3, 5, 7, 9] as const) {
      const code = rotatedSurfaceCode(d);
      const scratch = new Uint8Array(code.stabilizers.length);
      for (let seed = 0; seed < 50; seed++) {
        let next = seed * 7919 + 1;
        const p = drawPuzzle(d, 0.05, () => next++);
        expect(p.d).toBe(d);
        expect(p.model).toBe("independent");
        const syndrome = computeSyndrome(code, p.error, scratch);
        expect(
          syndrome.some((bit) => bit === 1),
          `d = ${d}, seed ${seed}`,
        ).toBe(true);
      }
    }
  });

  it("draws another seed while the syndrome is empty, at most MAX_DRAWS times; p = 0 gives up honestly", () => {
    // Seed 0 at d = 3, p = 0.1 samples an empty error (StepsPanel.test.tsx).
    let calls = 0;
    const seeds = [0, 0, 7];
    const p = drawPuzzle(3, 0.1, () => seeds[calls++]!);
    expect(calls).toBe(3);
    expect(weight(p.error)).toBe(1);
    calls = 0;
    const empty = drawPuzzle(3, 0, () => calls++);
    expect(calls).toBe(MAX_DRAWS);
    expect(weight(empty.error)).toBe(0);
  });
});
