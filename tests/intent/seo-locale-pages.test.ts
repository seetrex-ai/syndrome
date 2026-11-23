import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LANGUAGE_DIRS } from "../../edge/paths";
import { LOCALES, SUPPORTED_LANGUAGES } from "../../src/locales";
import { buildWithEnv } from "../helpers/build-with-env";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = process.cwd();
/** A well-formed, fake Umami website ID. */
const WEBSITE_ID = "11111111-2222-4333-8444-555555555555";

// Written out by hand, NOT derived from the generator: what Google must see.
const EXPECTED_URL: Record<string, string> = {
  en: "https://seequant.app/syndrome/",
  es: "https://seequant.app/syndrome/es/",
};
const EXPECTED_FILE: Record<string, string> = {
  en: "index.html",
  es: "es/index.html",
};
const EXPECTED_OG_LOCALE: Record<string, string> = {
  en: "en_US",
  es: "es_ES",
};
const EXPECTED_HREFLANG = {
  en: EXPECTED_URL.en,
  es: EXPECTED_URL.es,
  "x-default": EXPECTED_URL.en,
};

type Lang = (typeof SUPPORTED_LANGUAGES)[number];
interface LocaleTexts {
  app: { byline: string };
  meta: { title: string; description: string; about: string };
  language: Record<string, string>;
}
const texts = (lang: Lang) => LOCALES[lang] as unknown as LocaleTexts;

let withoutId = "";
let withId = "";

beforeAll(async () => {
  withoutId = mkdtempSync(join(tmpdir(), "syndrome-seo-"));
  withId = mkdtempSync(join(tmpdir(), "syndrome-seo-id-"));
  await buildWithEnv({ outDir: withoutId });
  await buildWithEnv({ outDir: withId, websiteId: WEBSITE_ID });
});

afterAll(() => {
  for (const dir of [withoutId, withId])
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

const decode = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** Every tag `<name …>` with its attributes (values decoded). */
function tags(html: string, name: string): Map<string, string>[] {
  const out: Map<string, string>[] = [];
  for (const m of html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))) {
    const attrs = new Map<string, string>();
    for (const a of m[1]!.matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)")?/g))
      attrs.set(a[1]!.toLowerCase(), decode(a[2] ?? ""));
    out.push(attrs);
  }
  return out;
}

/** The `content` of every `<meta {key}="{name}">`. */
const metas = (html: string, key: "name" | "property", name: string) =>
  tags(html, "meta")
    .filter((t) => t.get(key) === name)
    .map((t) => t.get("content"));

const head = (html: string) => html.slice(0, html.indexOf("</head>"));

/** Every .html file of a build, relative and with forward slashes. */
function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".html"))
        out.push(relative(dir, path).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * test_intent_each_language_has_its_own_indexable_html
 *
 * INTENCIÓN: cada idioma tiene un HTML propio que un buscador indexa sin ejecutar nada
 *   (tasks/plans/syndrome-es-url.md D1–D2): `index.html` en inglés y `es/index.html` en
 *   español, cada uno con su `<html lang>`, su `<title>` y su description sacados de
 *   `meta.title`/`meta.description` del locale, canonical a SU propia URL, el MISMO
 *   conjunto `hreflang` (en, es, x-default → inglés) en todos, recíproco (cada página se
 *   lista a sí misma con su idioma), OpenGraph con `og:url` = canonical, título,
 *   descripción y `og:locale`/`og:locale:alternate` del idioma, y un JSON-LD
 *   `WebApplication` parseable con `url` = canonical e `inLanguage` = idioma. Las dos
 *   cargan el mismo módulo de entrada y, con el ID de Umami, exactamente un contador con
 *   `data-exclude-hash="true"` cada una. Se mide sobre dos `vite.build()` reales (con y
 *   sin ID): lo que se despliega, no la configuración.
 * CONTEXTO: auditoría SEO del 2026-10-20: una sola URL con el idioma en el cliente;
 *   Google renderiza con en-US y sin localStorage, así que el español no existía para él.
 *   Las URL esperadas están escritas a mano aquí, no derivadas del generador: un error en
 *   la tabla o en el generador no se valida a sí mismo.
 * EXPIRA SI: el idioma deja de ir en la ruta, o las páginas pasan a renderizarse en el
 *   servidor (entonces se mide la respuesta, no el fichero).
 */
describe("test_intent_each_language_has_its_own_indexable_html", () => {
  it("the build has exactly one HTML per language, at the expected paths (both builds)", () => {
    for (const dir of [withoutId, withId]) {
      expect(htmlFiles(dir)).toEqual(
        SUPPORTED_LANGUAGES.map((l) => EXPECTED_FILE[l]).sort(),
      );
    }
    // The table the build reads agrees with the paths written here.
    for (const lang of SUPPORTED_LANGUAGES)
      expect(`${LANGUAGE_DIRS[lang]}index.html`).toBe(EXPECTED_FILE[lang]);
  });

  it.each([...SUPPORTED_LANGUAGES])(
    "%s: lang, one title and one description from the locale, self canonical",
    (lang) => {
      for (const dir of [withoutId, withId]) {
        const html = readFileSync(join(dir, EXPECTED_FILE[lang]!), "utf8");
        expect(tags(html, "html")).toHaveLength(1);
        expect(tags(html, "html")[0]!.get("lang")).toBe(lang);
        const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)];
        expect(titles).toHaveLength(1);
        expect(decode(titles[0]![1]!)).toBe(texts(lang).meta.title);
        expect(metas(html, "name", "description")).toEqual([
          texts(lang).meta.description,
        ]);
        const canonical = tags(html, "link").filter(
          (t) => t.get("rel") === "canonical",
        );
        expect(canonical.map((t) => t.get("href"))).toEqual([
          EXPECTED_URL[lang],
        ]);
      }
    },
  );

  it("every page carries the same, reciprocal hreflang set (en, es, x-default)", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const html = readFileSync(join(withoutId, EXPECTED_FILE[lang]!), "utf8");
      const alternates = tags(head(html), "link").filter(
        (t) => t.get("rel") === "alternate" && t.has("hreflang"),
      );
      const set = Object.fromEntries(
        alternates.map((t) => [t.get("hreflang"), t.get("href")]),
      );
      expect(alternates.length, lang).toBe(Object.keys(set).length);
      expect(set, lang).toEqual(EXPECTED_HREFLANG);
      // Reciprocal: the page lists itself under its own language.
      expect(set[lang], lang).toBe(EXPECTED_URL[lang]);
    }
  });

  it.each([...SUPPORTED_LANGUAGES])(
    "%s: OpenGraph of its language (og:url = canonical, og:locale and alternates)",
    (lang) => {
      const html = readFileSync(join(withoutId, EXPECTED_FILE[lang]!), "utf8");
      expect(metas(html, "property", "og:type")).toEqual(["website"]);
      expect(metas(html, "property", "og:url")).toEqual([EXPECTED_URL[lang]]);
      expect(metas(html, "property", "og:title")).toEqual([
        texts(lang).meta.title,
      ]);
      expect(metas(html, "property", "og:description")).toEqual([
        texts(lang).meta.description,
      ]);
      expect(metas(html, "property", "og:locale")).toEqual([
        EXPECTED_OG_LOCALE[lang],
      ]);
      expect(metas(html, "property", "og:locale:alternate").sort()).toEqual(
        SUPPORTED_LANGUAGES.filter((l) => l !== lang)
          .map((l) => EXPECTED_OG_LOCALE[l])
          .sort(),
      );
      expect(metas(html, "property", "og:image")).toEqual([
        "https://seequant.app/syndrome/og.png",
      ]);
      expect(metas(html, "name", "twitter:card")).toEqual([
        "summary_large_image",
      ]);
    },
  );

  it.each([...SUPPORTED_LANGUAGES])(
    "%s: one parseable WebApplication JSON-LD (url = canonical, inLanguage = lang)",
    (lang) => {
      const html = readFileSync(join(withoutId, EXPECTED_FILE[lang]!), "utf8");
      const blocks = [
        ...head(html).matchAll(
          /<script type="application\/ld\+json">([^]*?)<\/script>/g,
        ),
      ];
      expect(blocks).toHaveLength(1);
      const ld = JSON.parse(blocks[0]![1]!) as Record<string, unknown>;
      expect(ld).toMatchObject({
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Syndrome",
        alternateName: texts(lang).app.byline,
        url: EXPECTED_URL[lang],
        description: texts(lang).meta.description,
        inLanguage: lang,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Any",
        offers: { price: "0", priceCurrency: "EUR" },
        isAccessibleForFree: true,
        image: "https://seequant.app/syndrome/og.png",
        author: { name: "SEEQuant", url: "https://seequant.app/" },
        publisher: { name: "Seetrex", url: "https://seetrex.com" },
      });
      expect(typeof ld.browserRequirements).toBe("string");
    },
  );

  it("every page loads the same module entry, which exists (both builds)", () => {
    for (const dir of [withoutId, withId]) {
      const entries = SUPPORTED_LANGUAGES.map((lang) => {
        const html = readFileSync(join(dir, EXPECTED_FILE[lang]!), "utf8");
        const modules = tags(html, "script").filter(
          (t) => t.get("type") === "module",
        );
        expect(modules, lang).toHaveLength(1);
        return modules[0]!.get("src")!;
      });
      expect(new Set(entries).size).toBe(1);
      expect(entries[0]).toMatch(/^\/syndrome\/assets\/index-[\w-]+\.js$/);
      expect(
        existsSync(join(dir, entries[0]!.slice("/syndrome/".length))),
      ).toBe(true);
    }
  });

  it("with the website ID, every page has exactly one counter with data-exclude-hash; without it, none", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const counters = (dir: string) =>
        tags(
          readFileSync(join(dir, EXPECTED_FILE[lang]!), "utf8"),
          "script",
        ).filter(
          (t) => t.has("data-website-id") || /umami/i.test(t.get("src") ?? ""),
        );
      const withCounter = counters(withId);
      expect(withCounter, lang).toHaveLength(1);
      expect(withCounter[0]!.get("data-website-id")).toBe(WEBSITE_ID);
      expect(withCounter[0]!.get("data-exclude-hash")).toBe("true");
      expect(counters(withoutId), lang).toEqual([]);
    }
  });
});

/**
 * test_intent_source_html_carries_no_visible_text
 *
 * INTENCIÓN: el `index.html` fuente no lleva texto propio que un idioma pueda heredar
 *   (D1; regla dura 1): ni `lang`, ni `<title>`, ni description, ni OpenGraph textual, ni
 *   canonical, ni `hreflang`, ni texto fuera de las etiquetas; lleva exactamente un
 *   marcador `<!--syndrome:seo-->`, en `<head>` y DETRÁS del script del tema, que sigue
 *   siendo el primer `<script>` (test_intent_theme_before_first_paint).
 * CONTEXTO: si el fuente conservara su `<title>` inglés, cada idioma acabaría con dos
 *   títulos (o con el inglés, según quién ganara), y un texto escrito aquí a mano no
 *   pasaría por los locales.
 * EXPIRA SI: la cabecera deja de generarse en el build.
 */
describe("test_intent_source_html_carries_no_visible_text", () => {
  const source = readFileSync(join(ROOT, "index.html"), "utf8");

  it("has no lang, title, description, OpenGraph text, canonical or hreflang", () => {
    expect(tags(source, "html")).toHaveLength(1);
    expect(tags(source, "html")[0]!.has("lang")).toBe(false);
    const withoutComments = source.replace(/<!--[^]*?-->/g, "");
    expect(withoutComments).not.toMatch(/<title\b/i);
    expect(metas(source, "name", "description")).toEqual([]);
    for (const property of [
      "og:title",
      "og:description",
      "og:url",
      "og:locale",
      "og:type",
      "og:image",
    ])
      expect(metas(source, "property", property), property).toEqual([]);
    expect(withoutComments).not.toMatch(/rel="canonical"|hreflang/i);
  });

  it("has no text outside tags, comments and the inline script", () => {
    const text = source
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<script\b[^>]*>[^]*?<\/script>/gi, "")
      .replace(/<!doctype[^>]*>/i, "")
      .replace(/<[^>]*>/g, "");
    expect(text.trim()).toBe("");
  });

  it("has one marker, in <head>, after the first (theme) script", () => {
    const markers = [...source.matchAll(/<!--syndrome:seo-->/g)];
    expect(markers).toHaveLength(1);
    const at = markers[0]!.index;
    const firstScript = source.search(/<script>/);
    expect(firstScript).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(source.indexOf("</script>", firstScript));
    expect(at).toBeLessThan(source.indexOf("</head>"));
  });
});

/**
 * test_intent_noscript_summary_from_locales
 *
 * INTENCIÓN: sin JavaScript (lector, rastreador que no lo ejecuta) cada página dice qué es
 *   Syndrome en su idioma (D3): un único `<noscript>` al principio de `<body>`, FUERA de
 *   `#root` (que sigue vacío: sin destello ni coste de LCP), con `meta.about` del locale y
 *   un enlace a cada otra versión con `hreflang`, `lang` y el nombre `language.<código>`.
 * CONTEXTO: el `#root` vacío era lo único que veía quien no ejecuta JS; un texto ahí
 *   dentro lo pintaría React encima en cada carga.
 * EXPIRA SI: las páginas se prerenderizan (el contenido real sustituye al resumen).
 */
describe("test_intent_noscript_summary_from_locales", () => {
  it.each([...SUPPORTED_LANGUAGES])(
    "%s: one <noscript> before #root with meta.about and links to the other languages",
    (lang) => {
      const html = readFileSync(join(withoutId, EXPECTED_FILE[lang]!), "utf8");
      const body = html.slice(html.indexOf("<body"));
      const blocks = [...html.matchAll(/<noscript>([^]*?)<\/noscript>/g)];
      expect(blocks).toHaveLength(1);
      const at = html.indexOf("<noscript>");
      expect(at).toBeGreaterThan(html.indexOf("<body"));
      expect(at).toBeLessThan(html.indexOf('<div id="root">'));
      expect(body).toContain('<div id="root"></div>');
      const inner = blocks[0]![1]!;
      const paragraph = /<p>([^<]*)<\/p>/.exec(inner)?.[1];
      expect(decode(paragraph ?? "")).toBe(texts(lang).meta.about);
      const links = [
        ...inner.matchAll(
          /<a href="([^"]*)" hreflang="([^"]*)" lang="([^"]*)">([^<]*)<\/a>/g,
        ),
      ].map((m) => ({ href: m[1], hreflang: m[2], lang: m[3], text: m[4] }));
      expect(links).toEqual(
        SUPPORTED_LANGUAGES.filter((l) => l !== lang).map((other) => ({
          href: new URL(EXPECTED_URL[other]!).pathname,
          hreflang: other,
          lang: other,
          text: texts(other).language[other],
        })),
      );
    },
  );
});
