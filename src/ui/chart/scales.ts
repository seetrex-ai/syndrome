// Pure scales of the threshold chart (tasks/plans/ui.md D4): a linear x for p,
// a logarithmic y for P_L (docs/spec.md §3: in linear the sub-threshold
// separation, the message of the product, is invisible below 5 %), decade
// ticks and the y domain of a set of points. No DOM, no React: tested in Node.

export interface Domain {
  readonly min: number;
  readonly max: number;
}

/** Pixel range: `min` is where domain.min lands, `max` where domain.max lands. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** Linear map of p to pixels. */
export function xScale(p: number, domain: Domain, range: Range): number {
  const t = (p - domain.min) / (domain.max - domain.min);
  return range.min + t * (range.max - range.min);
}

/**
 * Tick values of the x axis: every 5 % on a domain wider than 10 % (the
 * slider's 0–20 %), every 1 % on a narrower one (the phenomenological model's
 * 0–5 %, tasks/plans/phase2.md), from the domain's start to its end,
 * rounded to the thousandth so 0.1 + 0.2 reads as 0.3.
 */
export function xTicks(domain: Domain): number[] {
  const step = domain.max > 0.1 ? 0.05 : 0.01;
  const ticks: number[] = [];
  for (
    let k = Math.ceil(domain.min / step);
    k * step <= domain.max + 1e-9;
    k++
  ) {
    ticks.push(Math.round(k * step * 1000) / 1000);
  }
  return ticks;
}

/**
 * Logarithmic map of P_L to pixels: domain.max lands on range.min (the top of
 * the plot) and domain.min on range.max (the bottom). RangeError for y ≤ 0 or
 * a domain that is not 0 < min < max: a zero has no place on this axis.
 */
export function logYScale(y: number, domain: Domain, range: Range): number {
  if (!(domain.min > 0) || !(domain.max > domain.min)) {
    throw new RangeError(
      `log domain must satisfy 0 < min < max, got [${domain.min}, ${domain.max}]`,
    );
  }
  if (!(y > 0)) {
    throw new RangeError(`log scale needs y > 0, got ${y}`);
  }
  const t =
    (Math.log10(domain.max) - Math.log10(y)) /
    (Math.log10(domain.max) - Math.log10(domain.min));
  return range.min + t * (range.max - range.min);
}

export interface Ticks {
  /** Powers of ten covering [min, max]: 10^floor(log min) … 10^ceil(log max). */
  readonly major: readonly number[];
  /** 2·10^k … 9·10^k inside [min, max]. */
  readonly minor: readonly number[];
}

/** Decade ticks that cover [min, max]; RangeError unless 0 < min ≤ max. */
export function decadeTicks(min: number, max: number): Ticks {
  if (!(min > 0) || !(max >= min)) {
    throw new RangeError(`decadeTicks needs 0 < min ≤ max, got ${min}, ${max}`);
  }
  const lo = Math.floor(Math.log10(min) + 1e-9);
  const hi = Math.ceil(Math.log10(max) - 1e-9);
  const major: number[] = [];
  const minor: number[] = [];
  for (let e = lo; e <= hi; e++) {
    major.push(10 ** e);
    if (e < hi) {
      for (let m = 2; m <= 9; m++) {
        const v = m * 10 ** e;
        if (v >= min && v <= max) minor.push(v);
      }
    }
  }
  return { major, minor };
}

/** Lowest P_L the axis ever shows (docs/spec.md §3: a point with no failure is a bound, never 0). */
export const Y_FLOOR = 1e-6;
export const Y_CEILING = 1;
/** The axis always spans at least this many decades. */
export const MIN_DECADES = 2;

export interface YPoint {
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly upperBoundOnly: boolean;
}

/**
 * Decade-aligned y domain of a set of points: from the lowest positive drawn
 * value to the highest `high`, snapped outwards to powers of ten, never below
 * Y_FLOOR nor above Y_CEILING, at least MIN_DECADES decades wide. A measured
 * point draws `low`, `estimate` and `high`; an upper-bound-only point draws
 * ONLY its `high`, which therefore bounds the domain on both sides: a bound
 * below every measured point (0 of 10⁵ shots next to 10 % points) lands at its
 * real value, not on the axis floor, where it would read as a measurement.
 * A non-positive value (Wilson's low = 0 at k = 0) is ignored. With no
 * usable value: [10⁻², 1].
 */
export function yDomain(points: readonly YPoint[]): Domain {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = 0;
  for (const pt of points) {
    if (pt.high > 0) highest = Math.max(highest, Math.min(pt.high, Y_CEILING));
    const drawn = pt.upperBoundOnly ? [pt.high] : [pt.low, pt.estimate];
    for (const v of drawn) {
      if (v > 0) lowest = Math.min(lowest, v);
    }
  }
  if (highest === 0) {
    return { min: 10 ** -MIN_DECADES, max: Y_CEILING };
  }
  let max = Math.min(Y_CEILING, 10 ** Math.ceil(Math.log10(highest) - 1e-9));
  let min = Number.isFinite(lowest)
    ? Math.max(Y_FLOOR, 10 ** Math.floor(Math.log10(lowest) + 1e-9))
    : max / 10 ** MIN_DECADES;
  if (min >= max) max = Math.min(Y_CEILING, min * 10);
  // Bounded: at most MIN_DECADES widenings are ever needed.
  for (
    let i = 0;
    i < MIN_DECADES && Math.log10(max / min) < MIN_DECADES - 1e-9;
    i++
  ) {
    // Widen upwards first (100 % on top reads as the ceiling), then downwards.
    if (max < Y_CEILING) max *= 10;
    else min /= 10;
  }
  return { min, max };
}
