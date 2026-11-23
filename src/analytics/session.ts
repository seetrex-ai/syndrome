// `app_language`: once per tab session, the language i18next resolved
// (tasks/plans/analytics.md D11). The session mark lives in sessionStorage
// under a `syndrome.` key, because the origin is shared with the brand site.
// No tracker: neither event nor mark (a later load with the tracker still
// counts). Storage that throws: no event (counting less beats duplicating the
// monthly quota).
import { SUPPORTED_LANGUAGES, type Language } from "../locales";
import { trackAppLanguage, trackerLoaded } from "./events";

export const APP_LANGUAGE_SESSION_KEY = "syndrome.analytics.appLanguage";

/** The part of an i18next instance this module reads. */
export interface I18nSession {
  readonly isInitialized: boolean;
  readonly resolvedLanguage?: string;
  once(event: "initialized", listener: () => void): unknown;
}

function sessionStore(): Storage {
  // Reading the property itself throws when storage is blocked.
  return globalThis.sessionStorage;
}

function isLanguage(value: string | undefined): value is Language {
  return (SUPPORTED_LANGUAGES as readonly (string | undefined)[]).includes(
    value,
  );
}

function report(i18n: I18nSession, storage: () => Storage): void {
  if (!trackerLoaded()) return;
  const lang = i18n.resolvedLanguage;
  if (!isLanguage(lang)) return;
  try {
    const store = storage();
    if (store.getItem(APP_LANGUAGE_SESSION_KEY) !== null) return;
    store.setItem(APP_LANGUAGE_SESSION_KEY, lang);
  } catch {
    return;
  }
  trackAppLanguage(lang);
}

/**
 * Emits `app_language` once per tab session, after i18next has initialised
 * (now if it already has). Called by src/main.tsx before rendering.
 */
export function reportAppLanguage(
  i18n: I18nSession,
  storage: () => Storage = sessionStore,
): void {
  if (i18n.isInitialized) {
    report(i18n, storage);
  } else {
    i18n.once("initialized", () => report(i18n, storage));
  }
}
