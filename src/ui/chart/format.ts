// Number formatting of the chart panel. No DOM, no React: tested in Node.

/** Decimals a ratio may grow to before the side of 0 or 1 is said in symbols. */
const MAX_DECIMALS = 6;

// Symbol-only strings: no letters, so nothing to translate (the i18n literal
// test exempts text without letters); «< 1» reads the same in every locale.
const BELOW_ONE = "< 1";
const ABOVE_ONE = "> 1";
const ABOVE_ZERO = "> 0";

/**
 * A ratio (Λ or an end of its interval) with two decimals, or as many more as
 * it takes (up to MAX_DECIMALS) for the figure not to read as 0 or 1 when it is
 * not: the message of Λ is which side of 1 it lies, and an interval ending in
 * «1» for 0.9993, or in «1.000» for 0.99996, claims a bound it does not have
 * («0.97 to 1.000» was measured on one visit in
 * four). Past MAX_DECIMALS the side is said in symbols («< 1», «> 1», «> 0»).
 * Exact 0 and 1, and anything non-finite, keep the plain two-decimal form.
 */
export function formatRatio(v: number, lang: string): string {
  if (!Number.isFinite(v) || v === 0 || v === 1) {
    return v.toLocaleString(lang, { maximumFractionDigits: 2 });
  }
  for (let decimals = 2; decimals <= MAX_DECIMALS; decimals++) {
    const options = {
      minimumFractionDigits: decimals === 2 ? 0 : decimals,
      maximumFractionDigits: decimals,
    };
    // The side is judged on the rounded figure itself (ICU rounding, the same
    // in every locale), not on a Math.round of our own that could disagree.
    const rounded = Number(
      v.toLocaleString("en", { ...options, useGrouping: false }),
    );
    if (rounded !== 0 && rounded !== 1) return v.toLocaleString(lang, options);
  }
  return v < 0.5 ? ABOVE_ZERO : v < 1 ? BELOW_ONE : ABOVE_ONE;
}
