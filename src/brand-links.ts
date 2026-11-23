// Links from Syndrome to the brand site (2026-10-20: without them there
// was no navigation once inside the app): the brand bar above the app (src/ui/brand/
// SiteHeader.tsx: the mark and "SEEQuant" to the brand's home, the
// "Products" group with Syndrome's hub and documentation pages, then the
// brand's other sections) and the brand navigation plus the legal pages in
// the footer. The brand site shares the origin but is another repo, so every
// href is ABSOLUTE on the one brand origin the app knows, FORMS_ORIGIN: a
// root-relative path would 404 on a preview or the legacy host, and
// tests/intent/pwa-precache rejects root-relative strings in the bundle
// outside /syndrome/. The paths carry no leading slash for the same reason.
//
// A pinned copy of the brand site's (seequant.app) own routes and products
// (products navigation of 2026-10-20): a page moved
// there is moved here too, after measuring 200 in production
// (test_intent_brand_bar_links).
import { FORMS_ORIGIN } from "./analytics/forms";
import type { Language } from "./locales";

/** Every brand-site page Syndrome links to. */
export type BrandPage =
  | "home"
  | "products"
  | "syndrome"
  | "syndromeChart"
  | "syndromeMethod"
  | "lab"
  | "classroom"
  | "about"
  | "privacy"
  | "terms";

/** The brand bar's sections after the "Products" group (as on the brand site). */
export const BRAND_NAV = ["lab", "classroom", "about"] as const;

/** The products panel's own pages: Syndrome's hub and the catalogue ("All products"). */
export const SYNDROME_HUB = "syndrome" satisfies BrandPage;
export const PRODUCTS_PAGE = "products" satisfies BrandPage;

/** The language switch's fixed order, English first, as on the brand site. */
export const BRAND_LANGUAGE_ORDER = [
  "en",
  "es",
] as const satisfies readonly Language[];

/** Syndrome's documentation pages, in the "Products" panel's order (products.ts docs). */
export const SYNDROME_DOCS = ["syndromeChart", "syndromeMethod"] as const;

/** The brand-site pages the footer links to, in their order there. */
export const BRAND_PAGES = [
  "home",
  "products",
  "lab",
  "privacy",
  "terms",
] as const;

/** Path of each page on the brand site, per language, without leading slash. */
export const BRAND_PATHS: Readonly<
  Record<Language, Readonly<Record<BrandPage, string>>>
> = {
  es: {
    home: "es/",
    products: "es/productos/",
    syndrome: "es/productos/syndrome/",
    syndromeChart: "es/productos/syndrome/grafica/",
    syndromeMethod: "es/productos/syndrome/metodo/",
    lab: "es/laboratorio/",
    classroom: "es/aula/",
    about: "es/sobre/",
    privacy: "es/legal/privacidad/",
    terms: "es/legal/terminos/",
  },
  en: {
    home: "en/",
    products: "en/products/",
    syndrome: "en/products/syndrome/",
    syndromeChart: "en/products/syndrome/chart/",
    syndromeMethod: "en/products/syndrome/method/",
    lab: "en/lab/",
    classroom: "en/classroom/",
    about: "en/about/",
    privacy: "en/legal/privacy/",
    terms: "en/legal/terms/",
  },
};

/** The absolute URL of a brand-site page in `lang`. */
export function brandHref(page: BrandPage, lang: Language): string {
  return `${FORMS_ORIGIN}/${BRAND_PATHS[lang][page]}`;
}

/** The brand site's home in `lang` (the brand bar's mark and wordmark). */
export function brandHomeHref(lang: Language): string {
  return brandHref("home", lang);
}
