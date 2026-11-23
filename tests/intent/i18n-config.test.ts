import { describe, expect, it } from "vitest";
import i18n, {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  PATH_DETECTOR_NAME,
  detectionOptions,
} from "../../src/i18n";
import { LOCALES, SUPPORTED_LANGUAGES } from "../../src/locales";

/**
 * test_intent_i18n_config
 *
 * INTENCIÓN: lo que `docs/spec.md` §2 (i18n) y tasks/plans/syndrome-es-url.md D4 prometen está
 *   cableado en la instancia viva de `src/i18n.ts`: inglés por defecto, todos los idiomas de
 *   `LOCALES` cargados, y la detección en este orden: la RUTA (`syndromePath`: la URL de un
 *   idioma muestra siempre ese idioma), luego la elección guardada en `localStorage` bajo
 *   una clave fija, luego el navegador; y la detección NO guarda nada (`caches: []`): sólo
 *   el selector guarda, con `storeLanguage`.
 * CONTEXTO: quitar un idioma de `resources`, el detector de ruta o cambiar el orden no rompe
 *   ningún otro test por sí solo: i18next cae al inglés en silencio. Con
 *   `caches: ["localStorage"]` (lo que había hasta el 2026-10-20) visitar `/syndrome/es/`
 *   dejaba guardado «es» y `/syndrome/` pasaba a abrirse en español para siempre. Este test
 *   lee la configuración viva de la instancia, no el fichero; el comportamiento por ruta lo
 *   mide test_intent_path_fixes_the_language.
 * EXPIRA SI: la detección o la persistencia pasan a otro mecanismo (p. ej. una
 *   preferencia guardada en un servidor) o el idioma deja de ir en la ruta.
 */

interface DetectionOptions {
  order?: string[];
  caches?: string[];
  lookupLocalStorage?: string;
  convertDetectedLanguage?: (language: string) => string;
}

describe("test_intent_i18n_config", () => {
  const detection = (i18n.options.detection ?? {}) as DetectionOptions;

  it("loads a translation bundle for every supported language", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(2);
    for (const code of SUPPORTED_LANGUAGES) {
      expect(
        i18n.hasResourceBundle(code, "translation"),
        `bundle for ${code}`,
      ).toBe(true);
      expect(i18n.getResourceBundle(code, "translation")).toEqual(
        LOCALES[code],
      );
    }
  });

  it("falls back to English and only to supported languages", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    // i18next normalises fallbackLng to an array and appends its "cimode" pseudo-language.
    expect(i18n.options.fallbackLng).toEqual(["en"]);
    const supported = (i18n.options.supportedLngs || []).filter(
      (code) => code !== "cimode",
    );
    expect(supported).toEqual([...SUPPORTED_LANGUAGES]);
  });

  it("detects by the path first, then the stored choice, then the browser, and caches nothing", () => {
    // A fixed `lng` would make i18next ignore the detector entirely.
    expect(
      i18n.options.lng,
      "lng must stay unset so detection runs",
    ).toBeUndefined();
    expect(PATH_DETECTOR_NAME).toBe("syndromePath");
    expect(detection.order).toEqual([
      "syndromePath",
      "localStorage",
      "navigator",
    ]);
    expect(detection.caches).toEqual([]);
    expect(detection.lookupLocalStorage).toBe(LANGUAGE_STORAGE_KEY);
    expect(LANGUAGE_STORAGE_KEY).toBe("syndrome.language");
    // The live instance runs the exported options (the path test uses them).
    expect(detection).toMatchObject(detectionOptions);
  });

  it("the live detector has the path detector registered", () => {
    const detector = i18n.services.languageDetector as unknown as {
      detectors: Record<string, { lookup: unknown }>;
    };
    expect(typeof detector.detectors[PATH_DETECTOR_NAME]?.lookup).toBe(
      "function",
    );
  });

  it("stores short codes so the choice always matches a supported language", () => {
    expect(detection.convertDetectedLanguage?.("es-ES")).toBe("es");
    expect(detection.convertDetectedLanguage?.("en")).toBe("en");
  });

  it("translates the same key differently in each language", () => {
    const tagline = SUPPORTED_LANGUAGES.map((code) =>
      i18n.getFixedT(code)("app.tagline"),
    );
    expect(new Set(tagline).size).toBe(SUPPORTED_LANGUAGES.length);
  });
});
