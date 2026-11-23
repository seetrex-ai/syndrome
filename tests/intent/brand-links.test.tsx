// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { SUPPORTED_LANGUAGES, type Language } from "../../src/locales";
import { App } from "../../src/ui/App";
import { fakeWorkerFactory } from "../helpers/fake-worker";

afterEach(async () => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

/**
 * The brand site's (seequant.app) URLs (products navigation; each measured
 * at 200 in production on
 * 2026-10-20 before the commit), written out here, not read from
 * src/brand-links.ts: a typo there must turn this red.
 */
const HOME: Record<Language, string> = {
  es: "https://seequant.app/es/",
  en: "https://seequant.app/en/",
};
const FOOTER: Record<Language, ReadonlyArray<readonly [string, string]>> = {
  es: [
    ["SEEQuant", "https://seequant.app/es/"],
    ["Productos", "https://seequant.app/es/productos/"],
    ["Laboratorio", "https://seequant.app/es/laboratorio/"],
    ["Privacidad", "https://seequant.app/es/legal/privacidad/"],
    ["Términos", "https://seequant.app/es/legal/terminos/"],
  ],
  en: [
    ["SEEQuant", "https://seequant.app/en/"],
    ["Products", "https://seequant.app/en/products/"],
    ["Lab", "https://seequant.app/en/lab/"],
    ["Privacy", "https://seequant.app/en/legal/privacy/"],
    ["Terms", "https://seequant.app/en/legal/terms/"],
  ],
};

/** The "Products" panel of the brand site, in its order: hub, app, chart, method, all. */
const PANEL: Record<Language, ReadonlyArray<readonly [string, string]>> = {
  es: [
    [
      "SyndromeCorrección cuántica de errores",
      "https://seequant.app/es/productos/syndrome/",
    ],
    ["Abrir la app", "/syndrome/es/"],
    [
      "Qué dice la gráfica",
      "https://seequant.app/es/productos/syndrome/grafica/",
    ],
    [
      "Cómo lo comprobamos",
      "https://seequant.app/es/productos/syndrome/metodo/",
    ],
    ["Todos los productos→", "https://seequant.app/es/productos/"],
  ],
  en: [
    [
      "SyndromeQuantum error correction",
      "https://seequant.app/en/products/syndrome/",
    ],
    ["Open the app", "/syndrome/"],
    ["What the chart says", "https://seequant.app/en/products/syndrome/chart/"],
    ["How we check it", "https://seequant.app/en/products/syndrome/method/"],
    ["All products→", "https://seequant.app/en/products/"],
  ],
};

/** The bar's sections after the products group. */
const BAR_NAV: Record<Language, ReadonlyArray<readonly [string, string]>> = {
  es: [
    ["Laboratorio", "https://seequant.app/es/laboratorio/"],
    ["Aula", "https://seequant.app/es/aula/"],
    ["Sobre SEEQuant", "https://seequant.app/es/sobre/"],
  ],
  en: [
    ["Lab", "https://seequant.app/en/lab/"],
    ["Classroom", "https://seequant.app/en/classroom/"],
    ["About SEEQuant", "https://seequant.app/en/about/"],
  ],
};
const MENU: Record<Language, string> = { es: "Menú", en: "Menu" };
const PRODUCTS: Record<Language, string> = { es: "Productos", en: "Products" };
const OTHER: Record<Language, Language> = { es: "en", en: "es" };
const NAME: Record<Language, string> = { es: "Español", en: "English" };

async function renderApp(lang: Language) {
  await i18n.changeLanguage(lang);
  render(<App createWorker={fakeWorkerFactory().create} />);
}

function bar(): HTMLElement {
  const header = document.querySelector<HTMLElement>("header.site-header");
  if (header === null) throw new Error("no brand bar");
  return header;
}

const pairs = (links: HTMLElement[]) =>
  (links as HTMLAnchorElement[]).map((a) => [
    a.textContent,
    a.getAttribute("href"),
  ]);

/** [text, href] of every link of the bar the accessibility tree has, in document order. */
const barLinks = () => pairs(within(bar()).getAllByRole("link"));

/** The desktop panel (`#products-panel`) and the phone menu's expanded copy. */
const desktopPanel = () => bar().querySelector<HTMLElement>("#products-panel")!;
const flatPanel = () =>
  bar().querySelector<HTMLElement>(".nav-group-flat .products-panel")!;
const productsButton = (lang: Language) =>
  within(bar()).getByRole("button", { name: PRODUCTS[lang] });

/**
 * test_intent_brand_bar_links
 *
 * INTENCIÓN: encima de la cabecera de Syndrome hay una barra de marca (`header.site-header`,
 *   fuera de `<main>` y antes que él) con la navegación agrupada por producto de la web de
 *   marca: la marca «SEEQuant» → portada; un botón «Productos ▾»/«Products ▾» cuyo panel
 *   lleva, en este orden, Syndrome + «Corrección cuántica de errores» → hub, «Abrir la app»
 *   (esta app en el idioma, `aria-current="page"`), «Qué dice la gráfica», «Cómo lo
 *   comprobamos» y «Todos los productos →»; después Laboratorio, Aula y Sobre SEEQuant; y el
 *   selector de idioma `EN ES`. URLs ABSOLUTAS exactas de la web EN EL IDIOMA DE LA INTERFAZ,
 *   que siguen al selector, en la misma pestaña (sin `target`); la de la app es la ruta de la
 *   app en ese idioma. Sin la píldora «Probar Syndrome»/«Try Syndrome» (ya se está en
 *   Syndrome). Cerrado, el panel de escritorio está fuera del árbol de accesibilidad y el menú
 *   de móvil lleva la misma lista desplegada. La cabecera de Syndrome lleva el `h1` «Syndrome»,
 *   ningún enlace y ya no el selector de idioma; el pie sigue diciendo «Syndrome by SEEQuant».
 * CONTEXTO: 2026-10-20: a Syndrome le faltaba la cabecera de la marca; después la web
 *   agrupó su navegación por producto (plan D10 de la web de marca,
 *   A1 «mover el selector a la barra», A2 «Abrir la app» con `aria-current`). Las URLs son
 *   absolutas porque una ruta relativa a la raíz fuera de /syndrome/ rompe en una preview o en
 *   el host viejo (tests/intent/pwa-precache); cada una se midió 200 en producción antes del
 *   commit que la puso aquí.
 * EXPIRA SI: la web de marca cambia su navegación, sus rutas o sus idiomas (se cambian aquí
 *   tras medir 200), o se quita la barra.
 */
describe("test_intent_brand_bar_links", () => {
  it.each(SUPPORTED_LANGUAGES)(
    "%s: the brand home, the products panel and the sections, exact URLs, same tab",
    async (lang) => {
      await renderApp(lang);
      // Closed: the desktop panel is hidden, the phone menu's copy is there.
      expect(desktopPanel().hidden).toBe(true);
      expect(barLinks()).toEqual([
        ["SEEQuant", HOME[lang]],
        ...PANEL[lang],
        ...BAR_NAV[lang],
      ]);
      expect(pairs(within(flatPanel()).getAllByRole("link"))).toEqual(
        PANEL[lang],
      );
      // Open: the same five links in the desktop panel.
      fireEvent.click(productsButton(lang));
      expect(desktopPanel().hidden).toBe(false);
      expect(pairs(within(desktopPanel()).getAllByRole("link"))).toEqual(
        PANEL[lang],
      );
      for (const panel of [desktopPanel(), flatPanel()]) {
        const app = within(panel).getByRole("link", {
          name: PANEL[lang][1]![0],
        });
        expect(app.getAttribute("aria-current")).toBe("page");
        const others = within(panel)
          .getAllByRole("link")
          .filter((a) => a !== app);
        for (const a of others)
          expect(a.hasAttribute("aria-current")).toBe(false);
      }
      const nav = within(bar()).getByRole("navigation", {
        name: i18n.t("siteNav.label"),
      });
      expect(nav.contains(productsButton(lang))).toBe(true);
      for (const a of within(bar()).getAllByRole("link")) {
        expect(a.hasAttribute("target")).toBe(false);
      }
      // No pill: we are in Syndrome.
      expect(bar().textContent).not.toMatch(/Probar Syndrome|Try Syndrome/);
      // The language switch is in the bar, not in Syndrome's header.
      const lang_ = within(bar()).getByRole("group", {
        name: i18n.t("language.label"),
      });
      expect(within(lang_).getByRole("button").textContent).toBe(
        `${OTHER[lang].toUpperCase()}${NAME[OTHER[lang]]}`,
      );
      // Above the app, outside <main>.
      const main = document.querySelector("main.app")!;
      expect(main.contains(bar())).toBe(false);
      expect(
        Boolean(
          bar().compareDocumentPosition(main) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(true);
      // Syndrome's own header: the product's name and the theme, no link, no language.
      const header = document.querySelector<HTMLElement>(".app__header")!;
      expect(header.querySelector("h1")!.textContent).toBe("Syndrome");
      expect(within(header).queryAllByRole("link")).toHaveLength(0);
      expect(
        within(header).queryByRole("group", { name: i18n.t("language.label") }),
      ).toBeNull();
      expect(header.textContent).not.toContain(NAME[OTHER[lang]]);
      expect(
        document.querySelector("footer.app__footer")!.textContent,
      ).toContain("Syndrome by SEEQuant");
    },
  );

  it("the links follow the language switch of the bar", async () => {
    await renderApp("en");
    expect(barLinks()).toEqual([
      ["SEEQuant", HOME.en],
      ...PANEL.en,
      ...BAR_NAV.en,
    ]);
    await act(async () => {
      fireEvent.click(within(bar()).getByRole("button", { name: /Español/ }));
    });
    await waitFor(() =>
      expect(barLinks()).toEqual([
        ["SEEQuant", HOME.es],
        ...PANEL.es,
        ...BAR_NAV.es,
      ]),
    );
  });
});

/**
 * test_intent_brand_bar_mobile_menu
 *
 * INTENCIÓN: el menú de móvil de la barra de marca se maneja como el de la web: un `<button
 *   type="button">` nativo (Intro y Espacio lo activan) con nombre visible «Menú»/«Menu»,
 *   `aria-controls` que apunta al `<nav>` de la barra y `aria-expanded` que dice si está
 *   abierto; activarlo abre y vuelve a activarlo cierra; Escape lo cierra y, si el foco
 *   estaba dentro de la barra, lo devuelve al botón; con el foco fuera, Escape cierra sin
 *   robar el foco. (El CSS oculta el `<nav>` por debajo de 900 px mientras
 *   `aria-expanded="false"`; eso se mide en navegador, no en jsdom.)
 * CONTEXTO: la cabecera de la web de marca (seequant.app, 2026-10-20): mismo umbral y mismo
 *   comportamiento de teclado; aquí el estado vive en React. Un menú que no devuelve el foco
 *   deja al usuario de teclado perdido al cerrar (WCAG 2.4.3).
 * EXPIRA SI: la web de marca cambia su menú de móvil, o la barra deja de plegarse.
 */
describe("test_intent_brand_bar_mobile_menu", () => {
  it.each(SUPPORTED_LANGUAGES)(
    "%s: opens and closes, Escape closes and gives the focus back",
    async (lang) => {
      await renderApp(lang);
      const button = within(bar()).getByRole("button", { name: MENU[lang] });
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      const nav = within(bar()).getByRole("navigation");
      expect(button.getAttribute("aria-controls")).toBe(nav.id);
      expect(nav.id).not.toBe("");
      expect(button.getAttribute("aria-expanded")).toBe("false");

      // Activate (what Enter and Space do on a native button), and again.
      button.focus();
      fireEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("false");

      // Open, move into the menu, Escape: closed and the focus on the button.
      fireEvent.click(button);
      const first = within(flatPanel()).getAllByRole("link")[0]!;
      first.focus();
      expect(document.activeElement).toBe(first);
      fireEvent.keyDown(first, { key: "Escape" });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(button);

      // Focus outside the bar: Escape closes without moving it.
      fireEvent.click(button);
      const outside = within(
        document.querySelector<HTMLElement>(".app__header")!,
      ).getAllByRole("radio")[0]!;
      outside.focus();
      fireEvent.keyDown(outside, { key: "Escape" });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(outside);
    },
  );
});

/**
 * test_intent_brand_products_panel_keyboard
 *
 * INTENCIÓN: «Productos ▾» es un disclosure de navegación (patrón WAI, no `role="menu"`): un
 *   `<button type="button">` nativo con `aria-expanded` que sigue al estado y `aria-controls`
 *   que apunta al panel; activarlo abre y vuelve a activarlo cierra; Escape lo cierra y, si el
 *   foco estaba dentro del grupo, lo devuelve al botón (con el menú de móvil abierto a la vez,
 *   Escape cierra primero el panel); un clic fuera del grupo lo cierra y uno dentro no; y el
 *   foco que sale del grupo (Tab tras su último enlace) lo cierra.
 * CONTEXTO: la web de marca (seequant.app) hace lo mismo sobre un `<details>`;
 *   aquí el estado vive en React (D10). Un panel que no se cierra con Escape ni al salir con
 *   Tab tapa la página al usuario de teclado (WCAG 2.1.2, 2.4.3).
 * EXPIRA SI: la web de marca cambia el panel, o deja de ser un disclosure.
 */
describe("test_intent_brand_products_panel_keyboard", () => {
  it.each(SUPPORTED_LANGUAGES)(
    "%s: aria-expanded, Escape, click outside and Tab out close it",
    async (lang) => {
      await renderApp(lang);
      const button = productsButton(lang);
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("aria-controls")).toBe(desktopPanel().id);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(button.getAttribute("aria-haspopup")).toBeNull();

      fireEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(desktopPanel().hidden).toBe(true);

      // Escape from a link inside: closed, focus back on the button; the
      // phone menu, open too, stays open (the panel goes first).
      const menu = within(bar()).getByRole("button", { name: MENU[lang] });
      fireEvent.click(menu);
      fireEvent.click(button);
      const link = within(desktopPanel()).getAllByRole("link")[2]!;
      link.focus();
      fireEvent.keyDown(link, { key: "Escape" });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(button);
      expect(menu.getAttribute("aria-expanded")).toBe("true");
      fireEvent.keyDown(button, { key: "Escape" });
      expect(menu.getAttribute("aria-expanded")).toBe("false");

      // A click inside keeps it open; a click outside closes it.
      fireEvent.click(button);
      fireEvent.pointerDown(desktopPanel());
      expect(button.getAttribute("aria-expanded")).toBe("true");
      fireEvent.pointerDown(document.querySelector("main.app")!);
      expect(button.getAttribute("aria-expanded")).toBe("false");

      // Focus leaving the group (Tab past the last link) closes it.
      fireEvent.click(button);
      const links = within(desktopPanel()).getAllByRole("link");
      act(() => links[links.length - 1]!.focus());
      expect(button.getAttribute("aria-expanded")).toBe("true");
      act(() =>
        within(bar()).getByRole("link", { name: BAR_NAV[lang][0]![0] }).focus(),
      );
      expect(button.getAttribute("aria-expanded")).toBe("false");
    },
  );
});

const langGroup = () =>
  within(bar()).getByRole("group", { name: i18n.t("language.label") });

/**
 * test_intent_brand_lang_switch
 *
 * INTENCIÓN: el selector de idioma de la barra es el de la web de marca: «EN ES» en ese orden
 *   fijo (inglés primero) sea cual sea el idioma de la interfaz, cada código con el `lang` de
 *   su idioma (el lector de pantalla pronuncia «Español» en español), el actual como ficha
 *   `aria-current` y el otro como botón. Cambiar de idioma desde el teclado deja el foco DENTRO
 *   del selector, en la ficha del idioma nuevo, y no en `<body>`: el botón activado desaparece
 *   (lo sustituye la ficha) y sin manejo el foco se pierde (WCAG 2.4.3). Y «Productos» lleva
 *   `data-current`, como el `summary` de la web cuando la página es de un producto: Syndrome
 *   siempre lo es.
 * CONTEXTO: barra con la navegación por producto (2026-10-20): el
 *   foco caía a `<body>` al cambiar de idioma (en `main`, con el grupo de radios, se quedaba en
 *   la radio); ni el orden ni el `lang` del botón estaban atados; faltaba la marca de
 *   sección actual de la web (`data-current`).
 * EXPIRA SI: la web de marca cambia su selector o su marca de sección, o el selector deja de
 *   sustituir el botón por la ficha.
 */
describe("test_intent_brand_lang_switch", () => {
  it.each(SUPPORTED_LANGUAGES)(
    "%s: EN ES in that order, each with its lang, the other one a button",
    async (lang) => {
      await renderApp(lang);
      const group = langGroup();
      const items = [...group.children] as HTMLElement[];
      expect(items.map((el) => el.firstElementChild!.textContent)).toEqual([
        "EN",
        "ES",
      ]);
      expect(group.textContent).toBe("ENEnglishESEspañol");
      expect(items.map((el) => el.getAttribute("lang"))).toEqual(["en", "es"]);
      const button = within(group).getByRole("button");
      expect(button.getAttribute("lang")).toBe(OTHER[lang]);
      const chip = group.querySelector<HTMLElement>('[aria-current="true"]')!;
      expect(chip.tagName).toBe("SPAN");
      expect(chip.getAttribute("lang")).toBe(lang);
    },
  );

  it.each(SUPPORTED_LANGUAGES)(
    "%s: switching from the keyboard leaves the focus on the new language's chip",
    async (lang) => {
      await renderApp(lang);
      const button = within(langGroup()).getByRole("button");
      button.focus();
      expect(document.activeElement).toBe(button);
      // Enter and Space on a native button fire its click.
      await act(async () => {
        fireEvent.click(button);
      });
      await waitFor(() => expect(i18n.resolvedLanguage).toBe(OTHER[lang]));
      const group = langGroup();
      expect(document.activeElement).not.toBe(document.body);
      expect(group.contains(document.activeElement)).toBe(true);
      expect(document.activeElement!.getAttribute("aria-current")).toBe("true");
      expect(document.activeElement!.getAttribute("lang")).toBe(OTHER[lang]);
      // Focusable by script only: not an extra Tab stop.
      expect((document.activeElement as HTMLElement).tabIndex).toBe(-1);
    },
  );

  it("a language change that is not the switch's own does not move the focus", async () => {
    await renderApp("en");
    const menu = within(bar()).getByRole("button", { name: MENU.en });
    menu.focus();
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    expect(document.activeElement).toBe(menu);
  });

  it.each(SUPPORTED_LANGUAGES)(
    "%s: Products carries the brand site's current-section mark",
    async (lang) => {
      await renderApp(lang);
      expect(productsButton(lang).hasAttribute("data-current")).toBe(true);
    },
  );
});

/**
 * test_intent_brand_links_footer
 *
 * INTENCIÓN: el pie lleva la navegación de la web de marca y sus páginas legales en el
 *   idioma de la interfaz, en este orden y con estas URLs ABSOLUTAS exactas (SEEQuant,
 *   Productos/Products, Laboratorio/Lab, Privacidad/Privacy, Términos/Terms), en la misma
 *   pestaña, en su propio `<nav>` con nombre; los enlaces de formularios siguen en el suyo y
 *   la clase `app__footer` (selector de tools/video) sigue en el pie.
 * CONTEXTO: 2026-10-20: sin pie de navegación no hay salida de la app; y
 *   Privacidad y Términos tienen que estar enlazados (LSSI, obligatorio de facto). «Herramientas»
 *   pasó a «Productos» con la navegación por producto de la web (2026-10-20). Las
 *   rutas relativas a la raíz están vetadas en el bundle fuera de /syndrome/
 *   (tests/intent/pwa-precache).
 * EXPIRA SI: la web de marca cambia sus rutas o idiomas (se cambian aquí tras medir 200),
 *   o se quita una de estas páginas del pie.
 */
describe("test_intent_brand_links_footer", () => {
  it.each(SUPPORTED_LANGUAGES)(
    "%s: the brand navigation and the legal pages, exact URLs, same tab",
    async (lang) => {
      await renderApp(lang);
      const footer = document.querySelector<HTMLElement>("footer.app__footer")!;
      expect(footer).not.toBeNull();
      const nav = within(footer).getByRole("navigation", {
        name: i18n.t("footer.brandNav"),
      });
      const links = within(nav).getAllByRole("link") as HTMLAnchorElement[];
      expect(pairs(links)).toEqual(FOOTER[lang]);
      for (const a of links) expect(a.hasAttribute("target")).toBe(false);
      // The form links stay, in their own navigation.
      const forms = within(footer).getByRole("navigation", {
        name: i18n.t("footer.links"),
      });
      expect(within(forms).getAllByRole("link")).toHaveLength(2);
    },
  );
});
