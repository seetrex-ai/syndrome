// The language selector moves the URL to the chosen language's page
// (tasks/plans/syndrome-es-url.md D6), without reloading: d, p, the chart and
// a challenge in progress with its timer stay as they are.
//
// `replaceState`, not `pushState`: changing the language is not navigating,
// so Back does not walk through languages. The query and the fragment are
// kept (`#c=` puzzle, `#v=` shot, `#panel-…` anchor; campaign parameters).
// The explicit choice is stored (storeLanguage); detection never stores
// (src/i18n.ts `caches: []`).
//
// Back and Forward walk through entries the selector never rewrote: an entry
// of another language's page (`/syndrome/es/` before a `#panel-…` push and a
// switch to English) must show what loading it would show, not the language
// of the moment (followPathLanguage). It is not a choice:
// nothing is stored and no lang_switch is sent.
import type { i18n as I18n } from "i18next";
import { storeLanguage } from "../i18n";
import { pathForLanguage } from "../locale-path";
import type { Language } from "../locales";

/**
 * On every popstate whose path is not the shown language's own page, runs the
 * start-up detection again (src/i18n.ts D4: the path, then the stored choice,
 * then the browser; `caches: []`, so nothing is stored): `/syndrome/es/` shows
 * Spanish, `/syndrome/` what a fresh load of it would. Returns the function
 * that stops listening.
 */
export function followPathLanguage(
  i18n: Pick<I18n, "resolvedLanguage" | "changeLanguage">,
): () => void {
  const onPopState = () => {
    const shown = i18n.resolvedLanguage as Language | undefined;
    if (
      shown !== undefined &&
      pathForLanguage(shown) === window.location.pathname
    ) {
      return;
    }
    void i18n.changeLanguage();
  };
  window.addEventListener("popstate", onPopState);
  return () => window.removeEventListener("popstate", onPopState);
}

/** Stores the choice and moves the URL to that language's page. */
export function applyLanguageChoice(code: Language): void {
  storeLanguage(code);
  const path = pathForLanguage(code);
  const { pathname, search, hash } = window.location;
  if (path !== pathname) {
    window.history.replaceState(window.history.state, "", path + search + hash);
  }
}
