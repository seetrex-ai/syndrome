import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "../../src/locales";

/**
 * test_intent_i18n_locales
 *
 * INTENCIÓN: añadir un idioma = añadir un fichero (docs/spec.md §2, i18n), y ningún idioma
 *   muestra claves sin traducir, pierde un valor interpolado ni le falta una forma plural.
 * CONTEXTO: i18next cae al inglés en silencio cuando falta una clave y deja un marcador
 *   `{{x}}` sin sustituir si el nombre no coincide; nada de eso rompe en desarrollo. Las
 *   formas plurales llevan sufijo CLDR (`_one`, `_many`, `_other`…) y las categorías
 *   difieren por idioma (`es` tiene `many`, `en` no), así que las claves se comparan por
 *   base (sin sufijo) y cada base plural debe tener exactamente las categorías que
 *   `Intl.PluralRules` da para ese idioma (más el `_zero` opcional que i18next admite en
 *   todos). El test exige: mismo conjunto de claves base en
 *   todos los `src/locales/*.json`, sin valores vacíos, mismos marcadores `{{…}}` por clave
 *   (comparando cada variante plural con la `_other` inglesa), y que los ficheros
 *   coincidan con `SUPPORTED_LANGUAGES` (derivado del mapa `LOCALES`).
 * EXPIRA SI: las traducciones pasan a cargarse de un servicio externo en lugar de JSON
 *   en el repo.
 */

const LOCALES_DIR = join(process.cwd(), "src", "locales");
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      out.set(path, value);
    } else {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    }
  }
  return out;
}

export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
    .map((m) => m[1] ?? "")
    .sort();
}

function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, "");
}

// Base keys and, for plural bases, the set of categories present.
export function shape(keys: Iterable<string>): {
  bases: string[];
  plurals: Map<string, string[]>;
} {
  const bases = new Set<string>();
  const plurals = new Map<string, string[]>();
  for (const key of keys) {
    const match = PLURAL_SUFFIX.exec(key);
    const base = baseKey(key);
    bases.add(base);
    // `_zero` is an i18next extra accepted in every language, not a CLDR category.
    if (match?.[1] !== undefined && match[1] !== "zero")
      plurals.set(base, [...(plurals.get(base) ?? []), match[1]].sort());
  }
  return { bases: [...bases].sort(), plurals };
}

function expectedCategories(code: string): string[] {
  return [
    ...new Intl.PluralRules(code).resolvedOptions().pluralCategories,
  ].sort();
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
const locales = new Map(
  files.map((f) => [
    f.replace(/\.json$/, ""),
    flatten(JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8")) as Tree),
  ]),
);
const english = locales.get("en") ?? new Map<string, string>();

describe("test_intent_i18n_locales", () => {
  it("has one JSON file per supported language and no extra files", () => {
    expect([...locales.keys()].sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it("has the same base keys in every language, with each language's own plural categories", () => {
    const reference = shape(english.keys());
    for (const [code, keys] of locales) {
      const actual = shape(keys.keys());
      expect(
        actual.bases,
        `base keys of ${code}.json differ from en.json`,
      ).toEqual(reference.bases);
      for (const base of reference.plurals.keys()) {
        expect(
          actual.plurals.get(base),
          `${code}.json: plural forms of ${base}`,
        ).toEqual(expectedCategories(code));
      }
      expect(
        [...actual.plurals.keys()].sort(),
        `${code}.json: plural bases`,
      ).toEqual([...reference.plurals.keys()].sort());
    }
  });

  it("has no empty translations", () => {
    for (const [code, keys] of locales) {
      for (const [key, value] of keys) {
        expect(value.trim(), `${code}.json: ${key} is empty`).not.toBe("");
      }
    }
  });

  it("uses the same {{placeholders}} for each key in every language", () => {
    for (const [code, keys] of locales) {
      for (const [key, value] of keys) {
        const reference =
          english.get(key) ?? english.get(`${baseKey(key)}_other`) ?? "";
        expect(
          placeholders(value),
          `${code}.json: placeholders of ${key} differ from en.json`,
        ).toEqual(placeholders(reference));
      }
    }
  });

  it("understands plural suffixes and placeholders (self-check)", () => {
    expect(placeholders("a {{x}} and {{ y }}")).toEqual(["x", "y"]);
    expect(placeholders("a and b")).toEqual([]);
    const es = shape([
      "app.shots_one",
      "app.shots_many",
      "app.shots_other",
      "app.title",
    ]);
    expect(es.bases).toEqual(["app.shots", "app.title"]);
    expect(es.plurals.get("app.shots")).toEqual(["many", "one", "other"]);
    expect(expectedCategories("es")).toEqual(["many", "one", "other"]);
    expect(expectedCategories("en")).toEqual(["one", "other"]);
  });
});
