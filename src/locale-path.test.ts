import { describe, expect, it } from "vitest";
import { APP_BASE, LANGUAGE_DIRS } from "../edge/paths";
import {
  APP_PATH,
  LANGUAGE_PATHS,
  languageFromPath,
  pathForLanguage,
} from "./locale-path";
import { SUPPORTED_LANGUAGES } from "./locales";

describe("locale-path", () => {
  it("is a faithful copy of edge/paths.ts (the one table) over the supported languages", () => {
    expect(APP_PATH).toBe(APP_BASE);
    expect(LANGUAGE_PATHS).toEqual(LANGUAGE_DIRS);
    expect(Object.keys(LANGUAGE_PATHS).sort()).toEqual(
      [...SUPPORTED_LANGUAGES].sort(),
    );
  });

  it.each([
    ["/syndrome/es", "es"],
    ["/syndrome/es/", "es"],
    ["/syndrome/es/index.html", "es"],
    ["/syndrome/", undefined],
    ["/syndrome", undefined],
    ["/syndrome/index.html", undefined],
    ["/syndrome/en/", undefined],
    ["/syndrome/es/x", undefined],
    ["/syndrome/esx", undefined],
    ["/es/", undefined],
    ["/", undefined],
  ])("languageFromPath(%s) = %s", (path, lang) => {
    expect(languageFromPath(path)).toBe(lang);
  });

  it("pathForLanguage gives each language's canonical path, and the path gives the language back", () => {
    expect(pathForLanguage("en")).toBe("/syndrome/");
    expect(pathForLanguage("es")).toBe("/syndrome/es/");
    for (const lang of SUPPORTED_LANGUAGES) {
      const fixed = languageFromPath(pathForLanguage(lang));
      expect(fixed, lang).toBe(LANGUAGE_PATHS[lang] === "" ? undefined : lang);
    }
  });
});
