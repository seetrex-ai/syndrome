// The brand bar (2026-10-20: Syndrome had no header of the brand site):
// the brand site's header, rebuilt here so that entering Syndrome does not
// look like leaving the site. Same structure and look as the brand site's
// (seequant.app) header, products panel and styles: the mark and "SEEQuant" link to the
// brand's home; then "Products ▾", Lab, Classroom and About; then the
// language switch "EN ES" (moved here from Syndrome's own header). No
// "Try Syndrome" pill: we are in Syndrome. Below 900 px the navigation folds
// behind a menu button with an icon and a visible name, and the products
// group is shown expanded inside the menu.
//
// The brand site does it with two <details> and a small script; here the app
// is React already (it does not run without JavaScript), so both open states
// live in React on native <button>s (Enter and Space activate them) with
// aria-expanded / aria-controls: a navigation disclosure (WAI), not
// role="menu", and no opening on hover. Escape closes the products panel
// first, else the phone menu, and gives the focus back to its button when
// the focus was inside; a click outside the group or the focus leaving it
// (Tab past its last link) closes the panel. Absolute URLs, same tab
// (src/brand-links.ts), except "Open the app": this app in the interface
// language, root-relative under /syndrome/ (it works on every host the app
// is served from) and marked as the current page (A2). The class
// `site-header` is hidden in the recordings (tools/video/hooks.ts
// APP_HIDDEN).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BRAND_NAV,
  brandHomeHref,
  brandHref,
  PRODUCTS_PAGE,
  SYNDROME_DOCS,
  SYNDROME_HUB,
} from "../../brand-links";
import { pathForLanguage } from "../../locale-path";
import { SUPPORTED_LANGUAGES, type Language } from "../../locales";
import { BrandMark } from "./Brand";
import { LangSwitch } from "./LangSwitch";

/** The products group (as on the brand site); rendered twice, so no ids inside. */
function ProductsPanel({ lang }: { readonly lang: Language }) {
  const { t } = useTranslation();
  return (
    <div className="products-panel">
      <div className="products-panel__product">
        <a
          className="products-panel__name"
          href={brandHref(SYNDROME_HUB, lang)}
        >
          <span className="products-panel__title">{t("app.title")}</span>
          <span className="products-panel__description">
            {t("siteNav.productsPanel.tagline")}
          </span>
        </a>
        <ul className="products-panel__links">
          <li>
            <a href={pathForLanguage(lang)} aria-current="page">
              {t("siteNav.productsPanel.openApp")}
            </a>
          </li>
          {SYNDROME_DOCS.map((page) => (
            <li key={page}>
              <a href={brandHref(page, lang)}>
                {t(`siteNav.productsPanel.${page}`)}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <a className="products-panel__all" href={brandHref(PRODUCTS_PAGE, lang)}>
        {t("siteNav.productsPanel.all")}
        <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

export function SiteHeader() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? SUPPORTED_LANGUAGES[0]) as Language;
  const [open, setOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLLIElement>(null);
  const groupButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open && !productsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The products panel first: it sits on top of the menu's row.
      const [owner, focusTarget, close] = productsOpen
        ? [group.current, groupButton.current, () => setProductsOpen(false)]
        : [bar.current, button.current, () => setOpen(false)];
      close();
      if (owner?.contains(document.activeElement) === true) {
        focusTarget?.focus();
      }
    };
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && group.current?.contains(target) === true);
    const onPointerDown = (event: Event) => {
      if (outside(event.target)) setProductsOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) setProductsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    if (productsOpen) {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("focusin", onFocusIn);
    }
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, productsOpen]);

  return (
    <header className="site-header">
      <div className="site-header__inner" ref={bar}>
        <a className="site-brand" href={brandHomeHref(lang)}>
          <BrandMark />
          <span className="site-brand__word">{t("siteNav.brand")}</span>
        </a>
        <button
          ref={button}
          type="button"
          className="site-menu"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((was) => !was)}
        >
          <svg
            className="site-menu__icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"}
            />
          </svg>
          <span>{t("siteNav.menu")}</span>
        </button>
        <nav className="site-nav" id="site-nav" aria-label={t("siteNav.label")}>
          <ul>
            <li className="nav-group" ref={group}>
              <button
                ref={groupButton}
                type="button"
                className="nav-group__button"
                // The brand site marks the group of the page's section
                // (`data-current`); Syndrome is always a
                // product page.
                data-current=""
                aria-expanded={productsOpen}
                aria-controls="products-panel"
                onClick={() => setProductsOpen((was) => !was)}
              >
                {t("siteNav.products")}
                <svg
                  className="nav-group__caret"
                  viewBox="0 0 12 12"
                  width="10"
                  height="10"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M2.5 4.5 6 8l3.5-3.5" />
                </svg>
              </button>
              <div
                className="nav-group__panel"
                id="products-panel"
                hidden={!productsOpen}
              >
                <ProductsPanel lang={lang} />
              </div>
            </li>
            <li className="nav-group-flat">
              <span className="nav-group-flat__label">
                {t("siteNav.products")}
              </span>
              <ProductsPanel lang={lang} />
            </li>
            {BRAND_NAV.map((page) => (
              <li key={page}>
                <a href={brandHref(page, lang)}>{t(`siteNav.nav.${page}`)}</a>
              </li>
            ))}
          </ul>
        </nav>
        <LangSwitch lang={lang} />
      </div>
    </header>
  );
}
