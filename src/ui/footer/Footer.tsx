// The page footer: the brand site's navigation and legal pages
// (2026-10-20: once in the app there was no way out; privacy and terms are
// due under LSSI), the form links (tasks/plans/analytics.md D6, D7) and the
// byline. The brand links are absolute URLs in the interface language, same
// tab, from src/brand-links.ts. The class `app__footer` is a hook of
// tools/video (hidden in the recordings): keep it.
import { useTranslation } from "react-i18next";
import { BRAND_PAGES, brandHref } from "../../brand-links";
import { SUPPORTED_LANGUAGES, type Language } from "../../locales";
import { FormLinks } from "./FormLinks";

export function Footer() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? SUPPORTED_LANGUAGES[0]) as Language;
  return (
    <footer className="app__footer">
      <nav aria-label={t("footer.brandNav")}>
        <ul className="brand-links">
          {BRAND_PAGES.map((page) => (
            <li key={page}>
              <a href={brandHref(page, lang)}>{t(`footer.brand.${page}`)}</a>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label={t("footer.links")}>
        <FormLinks from="syndrome_footer" />
      </nav>
      <p className="app__byline">{t("app.byline")}</p>
    </footer>
  );
}
