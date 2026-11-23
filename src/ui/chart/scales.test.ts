import { describe, expect, it } from "vitest";
import {
  decadeTicks,
  logYScale,
  MIN_DECADES,
  xScale,
  xTicks,
  Y_CEILING,
  Y_FLOOR,
  yDomain,
} from "./scales";

const RANGE = { min: 10, max: 210 }; // 200 px tall plot, top at 10

describe("xScale", () => {
  it("is linear from domain.min at range.min to domain.max at range.max", () => {
    const domain = { min: 0, max: 0.2 };
    expect(xScale(0, domain, RANGE)).toBe(10);
    expect(xScale(0.2, domain, RANGE)).toBe(210);
    expect(xScale(0.1, domain, RANGE)).toBe(110);
  });
});

describe("xTicks", () => {
  it("every 5 % on the slider's 0–20 %, every 1 % on the phenomenological 0–5 %, exact decimals", () => {
    expect(xTicks({ min: 0, max: 0.2 })).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
    expect(xTicks({ min: 0, max: 0.05 })).toEqual([
      0, 0.01, 0.02, 0.03, 0.04, 0.05,
    ]);
    // A domain stretched to a user's p: ticks up to and including it.
    expect(xTicks({ min: 0, max: 0.08 })).toEqual([
      0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08,
    ]);
    expect(xTicks({ min: 0, max: 0.12 })).toEqual([0, 0.05, 0.1]);
    expect(xTicks({ min: 0, max: 0.075 })).toEqual([
      0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07,
    ]);
  });
});

describe("logYScale", () => {
  const domain = { min: 1e-2, max: 1 };

  it("puts domain.max at the top (range.min) and domain.min at the bottom", () => {
    expect(logYScale(1, domain, RANGE)).toBe(RANGE.min);
    expect(logYScale(1e-2, domain, RANGE)).toBe(RANGE.max);
  });

  it("one decade is half the height over two decades", () => {
    expect(logYScale(1e-1, domain, RANGE)).toBeCloseTo(110, 9);
  });

  it("rejects y ≤ 0 and a domain without 0 < min < max: a zero has no place on a log axis", () => {
    expect(() => logYScale(0, domain, RANGE)).toThrow(RangeError);
    expect(() => logYScale(-1, domain, RANGE)).toThrow(RangeError);
    expect(() => logYScale(0.5, { min: 0, max: 1 }, RANGE)).toThrow(RangeError);
    expect(() => logYScale(0.5, { min: 1, max: 1 }, RANGE)).toThrow(RangeError);
  });
});

describe("decadeTicks", () => {
  it("covers [3e-3, 0.4] with majors 1e-3 … 1 and minors 2…9 per decade inside", () => {
    const { major, minor } = decadeTicks(3e-3, 0.4);
    expect(major).toEqual([1e-3, 1e-2, 1e-1, 1]);
    expect(minor[0]).toBeCloseTo(3e-3, 12);
    expect(minor.at(-1)).toBeCloseTo(0.4, 12);
    expect(minor.every((v) => v >= 3e-3 && v <= 0.4)).toBe(true);
    // 3…9 at 1e-3 (7), 2…9 at 1e-2 (8), 2…4 at 1e-1 (3)
    expect(minor).toHaveLength(18);
  });

  it("exact powers of ten are their own bounds", () => {
    expect(decadeTicks(1e-2, 1).major).toEqual([1e-2, 1e-1, 1]);
  });

  it("rejects min ≤ 0 or max < min", () => {
    expect(() => decadeTicks(0, 1)).toThrow(RangeError);
    expect(() => decadeTicks(1, 0.5)).toThrow(RangeError);
  });
});

describe("yDomain", () => {
  const pt = (low: number, estimate: number, high: number) => ({
    low,
    estimate,
    high,
    upperBoundOnly: false,
  });

  it("snaps outwards to decades and never exceeds [Y_FLOOR, Y_CEILING]", () => {
    expect(yDomain([pt(0.003, 0.004, 0.005), pt(0.2, 0.3, 0.4)])).toEqual({
      min: 1e-3,
      max: 1,
    });
    expect(yDomain([pt(1e-9, 1e-8, 1e-7)]).min).toBe(Y_FLOOR);
    expect(yDomain([pt(0.5, 0.9, 1)]).max).toBe(Y_CEILING);
  });

  it("spans at least MIN_DECADES decades", () => {
    const d = yDomain([pt(0.02, 0.03, 0.04)]);
    expect(Math.log10(d.max / d.min)).toBeGreaterThanOrEqual(MIN_DECADES);
    expect(d).toEqual({ min: 1e-2, max: 1 });
  });

  it("an upper-bound-only point contributes only its high, to BOTH ends; a zero low is ignored", () => {
    const bound = { low: 0, estimate: 0, high: 3e-4, upperBoundOnly: true };
    const d = yDomain([bound, pt(0.02, 0.03, 0.04)]);
    expect(d.min).toBeGreaterThan(0);
    // The bound's high (3·10⁻⁴) is drawn, so the domain reaches down to it;
    // its zero low and estimate are not drawn and do not pull it to Y_FLOOR.
    expect(d).toEqual({ min: 1e-4, max: 1e-1 });
    expect(yDomain([{ ...bound, high: 0.03 }, pt(0.02, 0.03, 0.04)])).toEqual({
      min: 1e-2,
      max: 1,
    });
    // Alone, the bound still yields a usable log domain containing its high.
    const alone = yDomain([bound]);
    expect(alone.min).toBeGreaterThan(0);
    expect(alone.min).toBeLessThanOrEqual(3e-4);
    expect(alone.max).toBeGreaterThanOrEqual(3e-4);
    // A non-bound point with a Wilson low of 0 never pushes the domain to 0.
    expect(yDomain([{ ...pt(0, 0.01, 0.02) }]).min).toBeGreaterThan(0);
  });

  it("with no usable value gives [10^-MIN_DECADES, 1]", () => {
    expect(yDomain([])).toEqual({ min: 10 ** -MIN_DECADES, max: 1 });
  });
});
