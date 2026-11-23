import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBits, encodeBits, encodedLength } from "./bits64";

describe("bits64", () => {
  it("round-trips random masks of 1 … 400 bits (fast-check) with exactly ceil(count / 6) characters", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1 }), {
          minLength: 1,
          maxLength: 400,
        }),
        (values) => {
          const bits = Uint8Array.from(values);
          const text = encodeBits(bits);
          expect(text).toHaveLength(encodedLength(bits.length));
          expect(/^[A-Za-z0-9_-]*$/.test(text)).toBe(true);
          const back = decodeBits(text, bits.length);
          expect(back).not.toBeNull();
          expect(Array.from(back!)).toEqual(values);
        },
      ),
    );
  });

  it("literal vectors: MSB first, no padding (the challenge's i3 vectors)", () => {
    const bits = new Uint8Array(18);
    bits[0] = 1;
    expect(encodeBits(bits)).toBe("gAA");
    bits[0] = 0;
    bits[1] = 1;
    expect(encodeBits(bits)).toBe("QAA");
    bits.fill(0);
    bits[9 + 5] = 1;
    expect(encodeBits(bits)).toBe("AAI");
    bits.fill(0);
    bits[0] = bits[1] = bits[2] = 1;
    expect(encodeBits(bits)).toBe("4AA");
    expect(encodeBits(new Uint8Array(0))).toBe("");
    expect(encodedLength(0)).toBe(0);
  });

  it("rejects a wrong length, a character outside base64url, padding and a spare bit set", () => {
    expect(decodeBits("AA", 18)).toBeNull();
    expect(decodeBits("AAAA", 18)).toBeNull();
    expect(decodeBits("AA+", 18)).toBeNull();
    expect(decodeBits("AA/", 18)).toBeNull();
    expect(decodeBits("AAA=", 18)).toBeNull();
    expect(decodeBits("AAA", 18)).not.toBeNull();
    // 18 bits take 3 characters exactly: no spare bit. 16 bits leave two
    // spare bits in the last character: "AAB" sets the last one.
    expect(decodeBits("AAB", 16)).toBeNull();
    expect(decodeBits("AAE", 16)).not.toBeNull();
    expect(decodeBits("", 0)).toEqual(new Uint8Array(0));
  });
});
