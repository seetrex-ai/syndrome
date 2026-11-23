import { describe, expect, it } from "vitest";
import { formatRatio } from "./format";

describe("formatRatio", () => {
  it("two decimals in the common case, trailing zeros trimmed", () => {
    expect(formatRatio(2, "en")).toBe("2");
    expect(formatRatio(2.146, "en")).toBe("2.15");
    expect(formatRatio(0.5, "en")).toBe("0.5");
    expect(formatRatio(1.2, "es")).toBe("1,2");
  });

  // A bound of 0.99996 was shown as «1.000». Decimals grow
  // until the rounded figure is neither 0 nor 1 (mutant: a cap of 3 decimals
  // → red on 0.9995, 0.99996, 1.0004 and 0.0004).
  it.each([
    [0.994, "0.99", "0,99"],
    [0.995, "0.995", "0,995"],
    [0.9995, "0.9995", "0,9995"],
    [0.99996, "0.99996", "0,99996"],
    [1.0004, "1.0004", "1,0004"],
    [1.004, "1.004", "1,004"],
    [1.005, "1.01", "1,01"],
    [0.004, "0.004", "0,004"],
    [0.005, "0.01", "0,01"],
    [0.0004, "0.0004", "0,0004"],
    [0, "0", "0"],
  ])("%f never reads as 0 or 1 unless it is: en %s, es %s", (v, en, es) => {
    expect(formatRatio(v, "en")).toBe(en);
    expect(formatRatio(v, "es")).toBe(es);
  });

  it("past six decimals the side is said in symbols, never «1.000000»", () => {
    expect(formatRatio(0.9999999, "en")).toBe("< 1");
    expect(formatRatio(1.0000001, "es")).toBe("> 1");
    expect(formatRatio(1e-8, "en")).toBe("> 0");
    expect(formatRatio(0.9999995, "en")).toBe("< 1");
    expect(formatRatio(0.999999, "en")).toBe("0.999999");
  });

  it("exact 0 and 1 stay plain; non-finite values are not promoted", () => {
    expect(formatRatio(1, "en")).toBe("1");
    expect(formatRatio(0, "en")).toBe("0");
    expect(formatRatio(Number.POSITIVE_INFINITY, "en")).toBe("∞");
    expect(formatRatio(Number.NaN, "en")).toBe("NaN");
  });
});
