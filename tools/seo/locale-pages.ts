// One indexable HTML per language (tasks/plans/syndrome-es-url.md D1–D3).
//
// The source index.html carries no visible text: no <title>, no description,
// no OpenGraph text, no canonical, no `lang`. It carries a marker
// (SEO_MARKER) right after the inline theme script, and `localizeHtml` turns
// it into the head of one language: <html lang>, <title>, description,
// self-referencing canonical, the same hreflang set on every page, OpenGraph
// and Twitter tags and a WebApplication JSON-LD, plus a <noscript> summary at
// the top of <body>. Every text comes from src/locales/<lang>.json
// (`meta.title`, `meta.description`, `meta.about`, `app.byline`,
// `language.<code>`): hard rule 1 (docs/spec.md §2). The build plugin
// (locale-pages-plugin.ts) applies it to the final index.html and emits one
// copy per language directory of LANGUAGE_DIRS; the dev server applies it
// per request.
//
// Node only (the build, the dev server, the tests): never imported by the app.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_BASE,
  CANONICAL_ORIGIN,
  LANGUAGE_DIRS,
  type LanguageDir,
} from "../../edge/paths.ts";
import { languageFromPath } from "../../src/locale-path.ts";

/** The comment of the source index.html that becomes the localized head. */
export const SEO_MARKER = "<!--syndrome:seo-->";

/** Every language with its own URL, English (the base, x-default) first. */
export const LANGUAGES = (Object.keys(LANGUAGE_DIRS) as LanguageDir[]).sort(
  (a, b) => LANGUAGE_DIRS[a].length - LANGUAGE_DIRS[b].length,
);

/** The language served at the base itself (dir ""), which is also the x-default. */
export const DEFAULT_PAGE_LANGUAGE: LanguageDir = LANGUAGES[0]!;

/** OpenGraph locale of each language (`og:locale`, `og:locale:alternate`). */
export const OG_LOCALE: Readonly<Record<LanguageDir, string>> = {
  en: "en_US",
  es: "es_ES",
};

/** The share card (static, English; tasks/plans/phase2.md D14). */
export const OG_IMAGE = `${CANONICAL_ORIGIN}${APP_BASE}og.png`;
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** schema.org `browserRequirements`: machine-read, not shown to anyone. */
export const BROWSER_REQUIREMENTS = "Requires JavaScript.";

/** The texts of one language the head and the <noscript> are made of. */
export interface SeoTexts {
  readonly title: string;
  readonly description: string;
  readonly about: string;
  readonly byline: string;
  /** `language.<code>` of this locale: the name of each language. */
  readonly languageNames: Readonly<Record<string, string>>;
}

interface LocaleFile {
  readonly app: { readonly byline: string };
  readonly meta: {
    readonly title: string;
    readonly description: string;
    readonly about: string;
  };
  readonly language: Readonly<Record<string, string>>;
}

function loadTexts(lang: LanguageDir): SeoTexts {
  const file = fileURLToPath(
    new URL(`../../src/locales/${lang}.json`, import.meta.url),
  );
  const locale = JSON.parse(readFileSync(file, "utf8")) as LocaleFile;
  return {
    title: locale.meta.title,
    description: locale.meta.description,
    about: locale.meta.about,
    byline: locale.app.byline,
    languageNames: locale.language,
  };
}

/** The SEO texts of every language, read from src/locales once. */
export const SEO_TEXTS: Readonly<Record<LanguageDir, SeoTexts>> =
  Object.fromEntries(
    LANGUAGES.map((lang) => [lang, loadTexts(lang)]),
  ) as Record<LanguageDir, SeoTexts>;

/** The public, absolute URL of a language's page (its canonical). */
export function pageUrl(lang: LanguageDir): string {
  return `${CANONICAL_ORIGIN}${APP_BASE}${LANGUAGE_DIRS[lang]}`;
}

/**
 * The language a dev-server request asks for: the client's own rule
 * (src/locale-path.ts `languageFromPath`: `/syndrome/es`, `/syndrome/es/`,
 * `/syndrome/es/index.html` → es), else the base language. One rule, so the
 * head the dev server writes and the language the app renders never disagree.
 */
export function pageLanguageOfUrl(url: string): LanguageDir {
  const path = new URL(url, "http://localhost").pathname;
  return languageFromPath(path) ?? DEFAULT_PAGE_LANGUAGE;
}

const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (value: string): string =>
  escapeText(value).replace(/"/g, "&quot;");

const meta = (key: "name" | "property", name: string, content: string) =>
  `<meta ${key}="${name}" content="${escapeAttr(content)}" />`;

/** The schema.org WebApplication of one language's page. */
export function jsonLd(lang: LanguageDir): Record<string, unknown> {
  const texts = SEO_TEXTS[lang];
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Syndrome",
    alternateName: texts.byline,
    url: pageUrl(lang),
    description: texts.description,
    inLanguage: lang,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any",
    browserRequirements: BROWSER_REQUIREMENTS,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    isAccessibleForFree: true,
    image: OG_IMAGE,
    author: {
      "@type": "Organization",
      name: "SEEQuant",
      url: `${CANONICAL_ORIGIN}/`,
    },
    publisher: {
      "@type": "Organization",
      name: "Seetrex",
      url: "https://seetrex.com",
    },
  };
}

/** The head of one language (what replaces SEO_MARKER). */
export function seoHead(lang: LanguageDir): string {
  const texts = SEO_TEXTS[lang];
  const url = pageUrl(lang);
  const alternates = [
    ...LANGUAGES.map(
      (other) =>
        `<link rel="alternate" hreflang="${other}" href="${pageUrl(other)}" />`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${pageUrl(DEFAULT_PAGE_LANGUAGE)}" />`,
  ];
  // "<" escaped inside the JSON so no text can close the <script> element.
  const ld = JSON.stringify(jsonLd(lang)).replace(/</g, "\\u003c");
  return [
    `<title>${escapeText(texts.title)}</title>`,
    meta("name", "description", texts.description),
    `<link rel="canonical" href="${url}" />`,
    ...alternates,
    meta("property", "og:type", "website"),
    meta("property", "og:url", url),
    meta("property", "og:title", texts.title),
    meta("property", "og:description", texts.description),
    meta("property", "og:locale", OG_LOCALE[lang]),
    ...LANGUAGES.filter((other) => other !== lang).map((other) =>
      meta("property", "og:locale:alternate", OG_LOCALE[other]),
    ),
    meta("property", "og:image", OG_IMAGE),
    meta("property", "og:image:width", String(OG_IMAGE_WIDTH)),
    meta("property", "og:image:height", String(OG_IMAGE_HEIGHT)),
    meta("name", "twitter:card", "summary_large_image"),
    `<script type="application/ld+json">${ld}</script>`,
  ].join("\n    ");
}

/** What a reader without JavaScript (or a crawler that does not run it) gets. */
export function noscriptSummary(lang: LanguageDir): string {
  const texts = SEO_TEXTS[lang];
  const links = LANGUAGES.filter((other) => other !== lang).map(
    (other) =>
      `<a href="${APP_BASE}${LANGUAGE_DIRS[other]}" hreflang="${other}" lang="${other}">${escapeText(
        SEO_TEXTS[other].languageNames[other] ?? other,
      )}</a>`,
  );
  return `<noscript><p>${escapeText(texts.about)}</p><p>${links.join(" · ")}</p></noscript>`;
}

function single(html: string, pattern: RegExp, what: string): RegExpExecArray {
  const found = [...html.matchAll(pattern)];
  if (found.length !== 1) {
    throw new Error(
      `expected one ${what} in index.html, found ${found.length}`,
    );
  }
  return found[0]!;
}

/**
 * index.html in one language: `<html lang>`, the head at SEO_MARKER and the
 * <noscript> right after `<body>`. Throws when the source is not shaped as
 * expected (no marker, two <body>, a `lang` already written by hand).
 */
export function localizeHtml(html: string, lang: LanguageDir): string {
  single(html, /<!--syndrome:seo-->/g, SEO_MARKER);
  const root = single(html, /<html\b[^>]*>/gi, "<html>");
  if (/\slang\s*=/i.test(root[0])) {
    throw new Error(
      `index.html must not set lang by hand (${root[0]}): the build writes it per language`,
    );
  }
  const body = single(html, /<body\b[^>]*>/gi, "<body>");
  // Function replacers: a "$" in a text must never be read as a pattern.
  return html
    .replace(root[0], () => `<html lang="${lang}">`)
    .replace(SEO_MARKER, () => seoHead(lang))
    .replace(body[0], () => `${body[0]}\n    ${noscriptSummary(lang)}`);
}
