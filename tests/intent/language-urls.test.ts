import { describe, expect, it } from "vitest";
import { LANGUAGE_DIRS } from "../../edge/paths";
import { LOCALES, SUPPORTED_LANGUAGES } from "../../src/locales";

/**
 * test_intent_language_dirs_cover_every_locale
 *
 * INTENCIÓN: cada idioma de la interfaz tiene su propia URL indexable bajo `/syndrome/`
 *   (tasks/plans/syndrome-es-url.md D4): la tabla única `LANGUAGE_DIRS` de `edge/paths.ts`
 *   tiene exactamente las claves de `SUPPORTED_LANGUAGES`, el inglés es la base misma
 *   (`""`, que además es el x-default) y cada otro idioma es un subdirectorio de un solo
 *   segmento con su barra final (`"es/"`), distinto de los demás.
 * CONTEXTO: auditoría SEO del 2026-10-20: con una sola URL y el idioma
 *   decidido en el cliente, Google sólo veía el inglés. La tabla la leen el build (los dos
 *   HTML), el service worker, el Worker de borde y el cliente; añadir un idioma al mapa
 *   `LOCALES` sin darle directorio dejaría ese idioma sin URL, y nada más lo notaría.
 * EXPIRA SI: el idioma deja de ir en la ruta (subdominio por idioma, dominio propio) o
 *   el inglés deja de ser la URL base.
 */
describe("test_intent_language_dirs_cover_every_locale", () => {
  it("has exactly the supported languages as keys", () => {
    expect(Object.keys(LANGUAGE_DIRS).sort()).toEqual(
      [...SUPPORTED_LANGUAGES].sort(),
    );
  });

  it("serves English at the base itself (the x-default)", () => {
    expect(LANGUAGE_DIRS.en).toBe("");
  });

  it("gives every other language one distinct path segment with its trailing slash", () => {
    const others = Object.entries(LANGUAGE_DIRS).filter(([l]) => l !== "en");
    expect(others.length).toBeGreaterThan(0);
    for (const [lang, dir] of others) {
      expect(dir, lang).toMatch(/^[a-z]{2}(?:-[a-z]{2})?\/$/);
    }
    const dirs = Object.values(LANGUAGE_DIRS);
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});

/**
 * test_intent_seo_texts_fit_search_results
 *
 * INTENCIÓN: el título y la descripción que ve un buscador salen de los locales
 *   (`meta.title`, `meta.description`, `meta.about`; regla dura 1) y caben en un resultado
 *   de búsqueda sin cortarse: la descripción entre 70 y 155 caracteres, el título como
 *   mucho 65 y con «Syndrome» y «SEEQuant»; cada idioma tiene SU texto (título y
 *   descripción distintos de los del inglés), porque un español con el título inglés no
 *   es una página española para Google; `meta.about` son dos frases.
 * CONTEXTO: tasks/plans/syndrome-es-url.md D2 y D3. Los textos se pueden retocar
 *   editando el JSON; este test es lo que impide que un retoque los alargue
 *   hasta el corte o copie el inglés en otro idioma.
 * EXPIRA SI: los buscadores cambian sus cortes (unos 155 caracteres de descripción y unos
 *   600 px de título) o la cabecera deja de generarse desde los locales.
 */
describe("test_intent_seo_texts_fit_search_results", () => {
  const meta = (lang: keyof typeof LOCALES) =>
    (LOCALES[lang] as { meta: Record<string, string> }).meta;

  it.each([...SUPPORTED_LANGUAGES])(
    "%s: description 70–155, title ≤ 65 naming Syndrome and SEEQuant, about of two sentences",
    (lang) => {
      const { title, description, about } = meta(lang);
      expect(description!.length, description).toBeGreaterThanOrEqual(70);
      expect(description!.length, description).toBeLessThanOrEqual(155);
      expect(title!.length, title).toBeLessThanOrEqual(65);
      expect(title).toContain("Syndrome");
      expect(title).toContain("SEEQuant");
      const sentences = about!.trim().split(/(?<=[.!?])\s+/);
      expect(sentences, about).toHaveLength(2);
    },
  );

  it.each(SUPPORTED_LANGUAGES.filter((l) => l !== "en"))(
    "%s: title and description differ from English",
    (lang) => {
      expect(meta(lang).title).not.toBe(meta("en").title);
      expect(meta(lang).description).not.toBe(meta("en").description);
      expect(meta(lang).about).not.toBe(meta("en").about);
    },
  );
});
