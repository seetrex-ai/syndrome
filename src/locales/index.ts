import en from "./en.json";
import es from "./es.json";

// Adding a language = adding `src/locales/<code>.json` and one line here.
// Tests (tests/intent/i18n-locales.test.ts, i18n-config.test.ts) fail if this
// map and the JSON files disagree, if a key exists in one language and not
// another, or if a listed language is not loaded into i18next.
export const LOCALES = { en, es } as const;

export type Language = keyof typeof LOCALES;
export const SUPPORTED_LANGUAGES = Object.keys(LOCALES) as readonly Language[];
