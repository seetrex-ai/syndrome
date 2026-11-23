import { describe, expect, it } from "vitest";
import {
  createSpacetimeHistory,
  rotatedSurfaceCode,
  type Distance,
  type SpacetimeHistory,
} from "../../core";
import { randomHistory } from "../model/spacetime-trace";
import {
  decodeHistory,
  encodeHistory,
  historyBits,
  historyFromHash,
  historyMaskLength,
  isViewerLink,
  VIEWER_HASH_PREFIX,
} from "./link";

function same(a: SpacetimeHistory, b: SpacetimeHistory): boolean {
  if (a.cycles !== b.cycles) return false;
  for (let r = 0; r < a.cycles; r++) {
    const ea = a.cycleErrors[r]!;
    const eb = b.cycleErrors[r]!;
    if (Array.from(ea.x).join() !== Array.from(eb.x).join()) return false;
    if (Array.from(ea.z).join() !== Array.from(eb.z).join()) return false;
    const fa = a.flips[r]!;
    const fb = b.flips[r]!;
    if (Array.from(fa.Z).join() !== Array.from(fb.Z).join()) return false;
    if (Array.from(fa.X).join() !== Array.from(fb.X).join()) return false;
  }
  return true;
}

describe("T-G6 viewer link: the history itself, never a seed", () => {
  it("uses exactly 13 / 62 / 171 / 363 mask characters for d = 3 / 5 / 7 / 9 (M6)", () => {
    expect([3, 5, 7, 9].map(historyBits)).toEqual([78, 370, 1022, 2178]);
    expect([3, 5, 7, 9].map(historyMaskLength)).toEqual([13, 62, 171, 363]);
  });

  for (const d of [3, 5, 7, 9] as const) {
    it(`d = ${d}: 200 random histories round-trip, with the exact length and the f${d}. prefix`, () => {
      for (let i = 0; i < 200; i++) {
        const p = 0.02 + (i % 7) * 0.05;
        const history = randomHistory(d, p, 1000 * d + i);
        const text = encodeHistory(d, history);
        expect(text.startsWith(`f${d}.`)).toBe(true);
        expect(text.length).toBe(`f${d}.`.length + historyMaskLength(d));
        const back = decodeHistory(text);
        expect(back).not.toBeNull();
        expect(back!.d).toBe(d);
        expect(same(back!.history, history)).toBe(true);
        expect(historyFromHash(`${VIEWER_HASH_PREFIX}${text}`)).not.toBeNull();
      }
    });
  }

  it("bit order per cycle: x[0..n), z[0..n), fZ[0..m), fX[0..m) (the shot's PRNG order), MSB first", () => {
    const code = rotatedSurfaceCode(3);
    const h = createSpacetimeHistory(code, 3);
    // Per cycle 26 bits: 9 x, 9 z, 4 fZ, 4 fX. Cycle 1 starts at bit 0.
    h.cycleErrors[0]!.x[0] = 1; // bit 0 → first character "g" (100000)
    expect(encodeHistory(3, h).slice(3, 4)).toBe("g");
    h.cycleErrors[0]!.x[0] = 0;
    h.cycleErrors[0]!.z[0] = 1; // bit 9 → second character bit 3 → "E" (000100)
    expect(encodeHistory(3, h).slice(4, 5)).toBe("E");
    h.cycleErrors[0]!.z[0] = 0;
    h.flips[0]!.Z[0] = 1; // bit 18 → fourth character "g"
    expect(encodeHistory(3, h).slice(6, 7)).toBe("g");
    h.flips[0]!.Z[0] = 0;
    h.flips[0]!.X[0] = 1; // bit 22 → fourth character bit 4 → "C" (000010)
    expect(encodeHistory(3, h).slice(6, 7)).toBe("C");
    h.flips[0]!.X[0] = 0;
    h.flips[2]!.X[3] = 1; // bit 77, the last: 78 bits = 13 characters exactly
    const text = encodeHistory(3, h);
    expect(text).toBe(`f3.${"A".repeat(12)}B`);
    expect(same(decodeHistory(text)!.history, h)).toBe(true);
    expect(decodeHistory(`f3.${"A".repeat(13)}`)).not.toBeNull();
  });

  it("rejects: another letter, an even or unknown d, a wrong length, a bad character, padding, a spare bit, no prefix", () => {
    const good = encodeHistory(3, randomHistory(3, 0.1, 5));
    const mask = good.slice(3);
    for (const [text, why] of [
      [`i3.${mask}`, "challenge letter"],
      [`f4.${mask}`, "even d"],
      [`f11.${mask}`, "unknown d"],
      [`f3.${mask.slice(1)}`, "too short"],
      [`f3.${mask}A`, "too long"],
      [`f3.${mask.slice(0, -1)}+`, "character outside base64url"],
      [`f3.${mask}=`, "padding"],
      [`f3.`, "empty mask"],
      [`f3.${mask}.${mask}`, "two masks"],
      [` ${good}`, "leading space"],
      [`${good}\n`, "trailing newline"],
      ["f3", "no mask"],
    ] as const) {
      expect(decodeHistory(text), why).toBeNull();
    }
    // 370 bits for d = 5 leave two spare bits in the 62nd character.
    expect(decodeHistory(`f5.${"A".repeat(61)}B`)).toBeNull();
    expect(decodeHistory(`f5.${"A".repeat(61)}E`)).not.toBeNull();
    expect(historyFromHash(`#c=${good}`)).toBeNull();
    expect(historyFromHash(`v=${good}`)).toBeNull();
    expect(historyFromHash(`#v=${good}&x=1`)).toBeNull();
    expect(isViewerLink("#v=zzz")).toBe(true);
    expect(isViewerLink("#c=i3.gAA")).toBe(false);
  });

  it("encodeHistory refuses a history whose cycles ≠ d", () => {
    const code = rotatedSurfaceCode(3);
    expect(() =>
      encodeHistory(3 as Distance, createSpacetimeHistory(code, 2)),
    ).toThrow(RangeError);
  });

  it("decoded histories are fresh objects: editing one does not change a second decode", () => {
    const text = encodeHistory(3, randomHistory(3, 0.1, 9));
    const a = decodeHistory(text)!.history;
    a.cycleErrors[0]!.x.fill(1);
    const b = decodeHistory(text)!.history;
    expect(same(a, b)).toBe(false);
  });
});
