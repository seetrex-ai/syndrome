// Fixture for tests/intent/i18n-literal-text.test.ts: a plain .ts module under
// the UI layer. Constants and templates with letters are reported; comparisons
// and lookup keys are not.
export const BYLINE = "Module constant";

export function describeCount(count: number): string {
  return `Pluralised ${count} times`;
}

export function isSpanish(
  code: string,
  table: Record<string, boolean>,
): boolean {
  return code === "es" || table["es-ES"] === true;
}
