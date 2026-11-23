// Where the app lives (docs/decisiones.md 2026-10-19; tasks/plans/path-routing.md):
// every SEEQuant app is served under a path of the brand domain. These three
// constants are shared by the build (vite.config.ts), the edge Worker
// (edge/worker.ts) and the video tool (tools/video), so the base path is
// written once. No imports: this file runs in Node, in Vite's config loader and
// in the Workers runtime alike.

/** The path the app is served under, with both slashes (Vite's `base`). */
export const APP_BASE = "/syndrome/";

/** The brand origin the app lives on. */
export const CANONICAL_ORIGIN = "https://seequant.app";

/** The origin the app was served from until 2026-10-19; it now only redirects. */
export const LEGACY_HOST = "syndrome.seequant.app";

/**
 * One indexable URL per language (tasks/plans/syndrome-es-url.md D4): the
 * directory of each language under APP_BASE, with its trailing slash. English
 * is the base itself (and the x-default); every other language is a
 * subdirectory. Read by the build (tools/seo), the service worker's denylist
 * (vite.config.ts), the edge Worker, the staging step and the client; its keys
 * are exactly the supported languages (tests/intent/language-urls.test.ts).
 */
export const LANGUAGE_DIRS = { en: "", es: "es/" } as const;

/** A language with its own URL. */
export type LanguageDir = keyof typeof LANGUAGE_DIRS;
