// The path fixes the language (tasks/plans/syndrome-es-url.md D4): every
// language has its own indexable URL, English at the base itself (the
// x-default) and every other language in its own directory below it.
//
// Pure and import-free on purpose: it runs in the browser (the i18n detector,
// the language selector) and in Node (the dev server's head, through
// tools/seo/locale-pages.ts, compiled by tsconfig.node.json with no DOM and
// no JSON imports). The table is a copy of edge/paths.ts (APP_BASE,
// LANGUAGE_DIRS), not an import: no runtime import of src/ may leave src/
// (tests/intent/video-conventions); src/locale-path.test.ts pins the copies
// equal to the originals and the keys equal to the supported languages.

/** The app's base path: a copy of edge/paths.ts APP_BASE. */
export const APP_PATH = "/syndrome/";

/** Each language's directory under APP_PATH: a copy of edge/paths.ts LANGUAGE_DIRS. */
export const LANGUAGE_PATHS = { en: "", es: "es/" } as const;

/** A language with its own URL. */
export type PathLanguage = keyof typeof LANGUAGE_PATHS;

const ENTRIES = Object.entries(LANGUAGE_PATHS) as [PathLanguage, string][];

/**
 * The language a path fixes: the directory of a language other than the base
 * (`/syndrome/es`, `/syndrome/es/`, `/syndrome/es/index.html` → "es"); any
 * other path (the base itself, anything else) fixes none, and then the stored
 * choice or the browser decides.
 */
export function languageFromPath(pathname: string): PathLanguage | undefined {
  for (const [lang, dir] of ENTRIES) {
    if (dir === "") continue;
    const at = APP_PATH + dir;
    if (
      pathname === at.slice(0, -1) ||
      pathname === at ||
      pathname === `${at}index.html`
    ) {
      return lang;
    }
  }
  return undefined;
}

/** The canonical path of a language's page (`/syndrome/`, `/syndrome/es/`). */
export function pathForLanguage(lang: PathLanguage): string {
  return APP_PATH + LANGUAGE_PATHS[lang];
}
