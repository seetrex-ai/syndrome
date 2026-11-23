import type { i18n as I18next } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_LANGUAGE_SESSION_KEY,
  reportAppLanguage,
  type I18nSession,
} from "./session";

// The real i18next instance satisfies the interface session.ts reads.
const _i18nextFits = (instance: I18next): I18nSession => instance;
void _i18nextFits;

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

// An i18next stand-in: resolved language, and an "initialized" event that a
// test fires by hand.
function fakeI18n(resolvedLanguage: string, isInitialized = true) {
  const listeners: (() => void)[] = [];
  const instance = {
    isInitialized,
    resolvedLanguage,
    once(_event: "initialized", listener: () => void) {
      listeners.push(listener);
      return instance;
    },
    initialize() {
      instance.isInitialized = true;
      for (const listener of listeners.splice(0)) listener();
    },
  };
  return instance;
}

function fakeTracker() {
  const sent: { name: string; props: Record<string, string> }[] = [];
  vi.stubGlobal("umami", {
    track: (name: string, props: Record<string, string>) => {
      sent.push({ name, props });
    },
  });
  return sent;
}

/**
 * test_intent_app_language_once_per_session
 *
 * INTENCIÓN: `app_language` cuenta el idioma con que se usa Syndrome una vez por
 *   sesión de pestaña, con el idioma que i18next resolvió (no el del navegador:
 *   la elección guardada del usuario manda); sin tracker no se gasta la marca, y
 *   con un almacenamiento que lanza no se emite (mejor contar de menos que
 *   duplicar en cada recarga y gastar el cupo).
 * CONTEXTO: tasks/plans/analytics.md T-E3, D11. Sin la marca en sessionStorage
 *   cada recarga y cada enlace de reto abierto repetiría el evento.
 * EXPIRA SI: se sustituye por una propiedad de sesión (`umami.identify`), lo que
 *   exige versión nueva de la taxonomía.
 */
describe("test_intent_app_language_once_per_session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("first start: one event with the resolved language; second start in the same session: none", () => {
    const sent = fakeTracker();
    const storage = new MemoryStorage();
    reportAppLanguage(fakeI18n("es"), () => storage);
    expect(sent).toEqual([{ name: "app_language", props: { lang: "es" } }]);
    expect(storage.getItem(APP_LANGUAGE_SESSION_KEY)).not.toBeNull();
    reportAppLanguage(fakeI18n("en"), () => storage);
    expect(sent).toHaveLength(1);
  });

  it("waits for i18next to initialise and sends the language it resolved", () => {
    const sent = fakeTracker();
    const storage = new MemoryStorage();
    const i18n = fakeI18n("en", false);
    reportAppLanguage(i18n, () => storage);
    expect(sent).toEqual([]);
    // The user's stored choice, not the browser's language, is what resolves.
    i18n.resolvedLanguage = "es";
    i18n.initialize();
    expect(sent).toEqual([{ name: "app_language", props: { lang: "es" } }]);
  });

  it("without the tracker: neither event nor mark, so a later load still counts", () => {
    const storage = new MemoryStorage();
    reportAppLanguage(fakeI18n("es"), () => storage);
    expect(storage.length).toBe(0);
    const sent = fakeTracker();
    reportAppLanguage(fakeI18n("es"), () => storage);
    expect(sent).toHaveLength(1);
  });

  it("storage that throws (on access or on write): no event", () => {
    const sent = fakeTracker();
    reportAppLanguage(fakeI18n("es"), () => {
      throw new DOMException("blocked", "SecurityError");
    });
    const full = new MemoryStorage();
    full.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    reportAppLanguage(fakeI18n("en"), () => full);
    expect(sent).toEqual([]);
  });

  it("a language outside the app (unresolved) sends nothing", () => {
    const sent = fakeTracker();
    const storage = new MemoryStorage();
    reportAppLanguage(fakeI18n("fr"), () => storage);
    expect(sent).toEqual([]);
    expect(storage.length).toBe(0);
  });

  it("the key lives under the syndrome. prefix of the shared origin", () => {
    expect(APP_LANGUAGE_SESSION_KEY).toBe("syndrome.analytics.appLanguage");
  });
});
