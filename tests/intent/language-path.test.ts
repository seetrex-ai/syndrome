// @vitest-environment jsdom
import i18next from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LANGUAGE_STORAGE_KEY,
  createLanguageDetector,
  i18nOptions,
  storeLanguage,
} from "../../src/i18n";

/**
 * test_intent_path_fixes_the_language
 *
 * INTENCIÓN: cada idioma tiene su URL y esa URL muestra SIEMPRE su idioma
 *   (tasks/plans/syndrome-es-url.md D4): `/syndrome/es/` (con o sin barra, o
 *   `index.html`) arranca en español aunque el navegador sea en-US y no haya nada guardado
 *   (el caso de Googlebot, que renderiza con en-US y sin localStorage) y aunque lo guardado
 *   sea «en»; `/syndrome/` sin nada guardado sigue al navegador, y con algo guardado, a lo
 *   guardado. Visitar `/syndrome/es/` NO escribe en localStorage: sólo el gesto del
 *   selector guarda (`storeLanguage`), así que quien llega desde Google al español no
 *   encuentra `/syndrome/` en español la próxima vez.
 * CONTEXTO: auditoría SEO del 2026-10-20: con el idioma decidido sólo por
 *   localStorage y navegador, Google indexaba el inglés en las dos URLs. Cada caso arranca
 *   una instancia nueva de i18next con las opciones y el detector EXPORTADOS por
 *   `src/i18n.ts` (los mismos que la instancia viva, test_intent_i18n_config).
 * EXPIRA SI: el idioma deja de ir en la ruta (subdominio, `?lang=`), o un idioma deja de
 *   tener URL propia.
 */

interface Case {
  readonly path: string;
  readonly stored?: string;
  readonly browser: readonly string[];
  readonly expected: string;
  readonly why: string;
}

const CASES: readonly Case[] = [
  {
    path: "/syndrome/es/",
    browser: ["en-US", "en"],
    expected: "es",
    why: "Googlebot on the Spanish page",
  },
  {
    path: "/syndrome/",
    browser: ["en-US", "en"],
    expected: "en",
    why: "Googlebot on the English page",
  },
  {
    path: "/syndrome/es",
    browser: ["en-US"],
    expected: "es",
    why: "no slash",
  },
  {
    path: "/syndrome/es/index.html",
    browser: ["en-US"],
    expected: "es",
    why: "index.html",
  },
  {
    path: "/syndrome/es/",
    stored: "en",
    browser: ["en-US"],
    expected: "es",
    why: "the path beats the stored choice",
  },
  {
    path: "/syndrome/",
    stored: "es",
    browser: ["en-US"],
    expected: "es",
    why: "the stored choice beats the browser at the base",
  },
  {
    path: "/syndrome/",
    browser: ["es-ES", "es"],
    expected: "es",
    why: "a Spanish browser at the base, nothing stored",
  },
  {
    path: "/syndrome/",
    stored: "en",
    browser: ["es-ES"],
    expected: "en",
    why: "the stored English beats a Spanish browser",
  },
];

async function startAt(c: Case): Promise<string | undefined> {
  window.history.replaceState(null, "", c.path);
  localStorage.clear();
  if (c.stored !== undefined)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, c.stored);
  vi.spyOn(navigator, "languages", "get").mockReturnValue([...c.browser]);
  vi.spyOn(navigator, "language", "get").mockReturnValue(c.browser[0]!);
  const instance = i18next.createInstance();
  await instance.use(createLanguageDetector()).init(i18nOptions);
  return instance.resolvedLanguage;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("test_intent_path_fixes_the_language", () => {
  it.each(CASES)(
    "$path, stored $stored, browser $browser → $expected ($why)",
    async (c) => {
      expect(await startAt(c)).toBe(c.expected);
    },
  );

  it("detection never writes the language to localStorage, on any page", async () => {
    for (const c of CASES) {
      await startAt(c);
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      expect(stored, `${c.path} (${c.why})`).toBe(c.stored ?? null);
      expect(localStorage.length, c.why).toBe(c.stored === undefined ? 0 : 1);
    }
  });

  it("the explicit choice is stored by storeLanguage, and a throwing store is ignored", () => {
    storeLanguage("es");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeLanguage("en")).not.toThrow();
  });
});
