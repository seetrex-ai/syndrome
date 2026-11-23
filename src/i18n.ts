import i18n, { type InitOptions } from "i18next";
import LanguageDetector, {
  type CustomDetector,
  type DetectorOptions,
} from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { languageFromPath } from "./locale-path";
import { LOCALES, SUPPORTED_LANGUAGES, type Language } from "./locales";

// The user's explicit choice (the language selector) is persisted under this
// key; docs/spec.md §2, i18n.
export const LANGUAGE_STORAGE_KEY = "syndrome.language";

export const DEFAULT_LANGUAGE = "en";

/** The detector of the path (tasks/plans/syndrome-es-url.md D4): /syndrome/es/ is Spanish. */
export const PATH_DETECTOR_NAME = "syndromePath";

const pathDetector: CustomDetector = {
  name: PATH_DETECTOR_NAME,
  lookup: () =>
    typeof window === "undefined"
      ? undefined
      : languageFromPath(window.location.pathname),
};

/**
 * Which language the app starts in (D4): the path first (a language's own URL
 * always shows that language, also to a crawler with an en-US browser and no
 * storage), then the stored explicit choice, then the browser. Nothing is
 * cached on detection (`caches: []`): visiting /syndrome/es/ must not turn
 * /syndrome/ Spanish on the next visit; only the selector stores, through
 * storeLanguage.
 */
export const detectionOptions = {
  order: [PATH_DETECTOR_NAME, "localStorage", "navigator"],
  caches: [],
  lookupLocalStorage: LANGUAGE_STORAGE_KEY,
  // "es-ES" from the browser resolves to "es".
  convertDetectedLanguage: (language: string) =>
    language.split("-")[0] ?? language,
} satisfies DetectorOptions;

/** The i18next options of the app (also used by tests on a fresh instance). */
export const i18nOptions: InitOptions = {
  resources: Object.fromEntries(
    Object.entries(LOCALES).map(([code, translation]) => [
      code,
      { translation },
    ]),
  ),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  // "es-ES" from the browser resolves to "es".
  load: "languageOnly",
  nonExplicitSupportedLngs: true,
  interpolation: { escapeValue: false },
  detection: detectionOptions,
};

/** A language detector with the path detector added (D4). */
export function createLanguageDetector(): LanguageDetector {
  const detector = new LanguageDetector();
  detector.addDetector(pathDetector);
  return detector;
}

/**
 * Persists the user's explicit choice (the selector, D6). A store that throws
 * (private window, blocked storage) is ignored: the choice lives in the page.
 */
export function storeLanguage(code: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // The choice lives in the session only.
  }
}

void i18n.use(createLanguageDetector()).use(initReactI18next).init(i18nOptions);

export default i18n;
