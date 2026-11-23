import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  jsonLd,
  localizeHtml,
  pageLanguageOfUrl,
  SEO_MARKER,
  SEO_TEXTS,
  seoHead,
  type SeoTexts,
} from "./locale-pages";
import type { LanguageDir } from "../../edge/paths";

// Unit tests of the generator (tasks/plans/syndrome-es-url.md D1, D2). What a
// built page must carry is tests/intent/seo-locale-pages.test.ts.

const SOURCE = readFileSync(join(process.cwd(), "index.html"), "utf8");
const MINIMAL = `<!doctype html><html><head>${SEO_MARKER}</head><body><div id="root"></div></body></html>`;

describe("localizeHtml", () => {
  it("localizes the real source in every language", () => {
    for (const lang of ["en", "es"] as const) {
      const html = localizeHtml(SOURCE, lang);
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).not.toContain(SEO_MARKER);
      expect(html.indexOf("<noscript>")).toBeGreaterThan(
        html.indexOf("<body>"),
      );
      expect(html.indexOf("<noscript>")).toBeLessThan(
        html.indexOf('<div id="root">'),
      );
    }
  });

  it("throws without the marker, with two markers, with two <body> or with a hand-written lang", () => {
    expect(() => localizeHtml(MINIMAL.replace(SEO_MARKER, ""), "en")).toThrow(
      /expected one <!--syndrome:seo-->/,
    );
    expect(() =>
      localizeHtml(MINIMAL.replace(SEO_MARKER, SEO_MARKER + SEO_MARKER), "en"),
    ).toThrow(/found 2/);
    expect(() =>
      localizeHtml(MINIMAL.replace("<body>", "<body><body>"), "en"),
    ).toThrow(/<body>/);
    expect(() =>
      localizeHtml(MINIMAL.replace("<html>", '<html lang="en">'), "es"),
    ).toThrow(/must not set lang/);
  });

  it("leaves the rest of the document byte for byte", () => {
    const html = localizeHtml(MINIMAL, "es");
    expect(
      html.startsWith('<!doctype html><html lang="es"><head><title>'),
    ).toBe(true);
    expect(html.endsWith('<div id="root"></div></body></html>')).toBe(true);
  });
});

describe("seoHead", () => {
  it("embeds the JSON-LD parseable, equal to jsonLd(), with no '<' inside the script", () => {
    for (const lang of ["en", "es"] as const) {
      const head = seoHead(lang);
      const body =
        /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(
          head,
        )?.[1];
      expect(body).toBeDefined();
      expect(body).not.toContain("<");
      expect(JSON.parse(body!)).toEqual(jsonLd(lang));
    }
  });

  // The escapes only matter for a text that would break
  // out, so one is fed in. The locale texts are swapped in place and restored.
  it("a text with </script> and quotes cannot close the JSON-LD script nor an attribute", () => {
    const texts = SEO_TEXTS as Record<LanguageDir, SeoTexts>;
    const original = texts.en;
    const hostile = 'Say "hi" </script><script>alert(1)</script> & go';
    texts.en = { ...original, title: hostile, description: hostile };
    try {
      const head = seoHead("en");
      const scripts = [...head.matchAll(/<script\b[^>]*>([^]*?)<\/script>/g)];
      expect(scripts).toHaveLength(1);
      const body = scripts[0]![1]!;
      expect(body).not.toContain("<");
      expect(JSON.parse(body)).toEqual(jsonLd("en"));
      expect((jsonLd("en") as { description: string }).description).toBe(
        hostile,
      );
      const decode = (value: string) =>
        value
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&");
      for (const [key, name] of [
        ["name", "description"],
        ["property", "og:title"],
        ["property", "og:description"],
      ] as const) {
        const content = new RegExp(
          `<meta ${key}="${name}" content="([^"]*)" />`,
        ).exec(head)?.[1];
        expect(content, name).toBeDefined();
        expect(decode(content!), name).toBe(hostile);
      }
      const title = /<title>([^<]*)<\/title>/.exec(head)?.[1];
      expect(decode(title!)).toBe(hostile);
    } finally {
      texts.en = original;
    }
  });
});

describe("pageLanguageOfUrl (dev server)", () => {
  it.each([
    ["/syndrome/", "en"],
    ["/syndrome/index.html", "en"],
    ["/syndrome/?x=1", "en"],
    ["/syndrome/es", "es"],
    ["/syndrome/es/", "es"],
    ["/syndrome/es/index.html", "es"],
    ["/syndrome/es/?utm_source=x", "es"],
    ["/syndrome/esx", "en"],
    ["/es/", "en"],
  ])("%s → %s", (url, lang) => {
    expect(pageLanguageOfUrl(url)).toBe(lang);
  });
});
