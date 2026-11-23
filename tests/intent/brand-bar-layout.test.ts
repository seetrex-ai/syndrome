import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_HIDDEN } from "../../tools/video/hooks";
import { parseRules, selectorsOf, SRC_DIR, type Rule } from "./css-rules";

/** Whether every `@media (min-width|max-width: …px)` around a rule holds at `width`. */
function appliesAt(rule: Rule, width: number): boolean {
  return rule.ancestors.every((prelude) => {
    if (!prelude.startsWith("@media")) return false;
    const min = /min-width:\s*([\d.]+)px/.exec(prelude);
    const max = /max-width:\s*([\d.]+)px/.exec(prelude);
    if (min === null && max === null) return false;
    return (
      (min === null || width >= Number(min[1])) &&
      (max === null || width <= Number(max[1]))
    );
  });
}

interface Box {
  maxWidth?: string;
  left?: string;
  right?: string;
  boxSizing?: string;
}

/** The cascaded max-width, side padding and box-sizing of `selector` at `width`. */
function boxAt(rules: readonly Rule[], selector: string, width: number): Box {
  const box: Box = {};
  for (const rule of rules) {
    if (!selectorsOf(rule.selector).includes(selector)) continue;
    if (!appliesAt(rule, width)) continue;
    for (const { property, value } of rule.declarations) {
      if (property === "max-width") box.maxWidth = value;
      if (property === "box-sizing") box.boxSizing = value;
      if (property === "padding-left") box.left = value;
      if (property === "padding-right") box.right = value;
      if (property === "padding") {
        const parts = value.split(/\s+/);
        box.right = parts[1] ?? parts[0];
        box.left = parts[3] ?? parts[1] ?? parts[0];
      }
    }
  }
  return box;
}

/**
 * test_intent_brand_bar_follows_the_app_container
 *
 * INTENCIÓN: la barra de marca (`.site-header__inner`) tiene, a cada ancho, el mismo ancho
 *   máximo, el mismo relleno lateral y la misma caja que el contenedor de la app (`.app`), así
 *   que sus bordes caen sobre los del contenido de Syndrome: ni descuadrada a la derecha en
 *   escritorio ni más ancha en el móvil.
 * CONTEXTO: 2026-10-20, la barra copiada de la web de marca quedó a 64 rem con `border-box`
 *   mientras el contenido de Syndrome pasa a 80 rem desde 1 024 px: medido 96 frente a 72 px a
 *   1 440 px. Se alineó con `.app` (medido 72/72, 24/24 y 16/16 a 1 440, 1 000 y 390 px); ningún
 *   test lo ataba.
 * EXPIRA SI: la barra deja de ir encima del contenido de la app o el diseño pide otra
 *   alineación (entrada en docs/decisiones.md).
 */
describe("test_intent_brand_bar_follows_the_app_container", () => {
  const rules = parseRules(readFileSync(join(SRC_DIR, "index.css"), "utf8"));

  it.each([320, 390, 700, 960, 1000, 1024, 1440])(
    "at %i px the bar and .app share max-width, side padding and box-sizing",
    (width) => {
      const app = boxAt(rules, ".app", width);
      const bar = boxAt(rules, ".site-header__inner", width);
      expect(app.maxWidth, ".app max-width").toBeDefined();
      expect(app.left, ".app padding").toBeDefined();
      expect(bar.maxWidth).toBe(app.maxWidth);
      expect(bar.left).toBe(app.left);
      expect(bar.right).toBe(app.right);
      expect(bar.boxSizing ?? "content-box").toBe(
        app.boxSizing ?? "content-box",
      );
    },
  );
});

/**
 * test_intent_brand_bar_is_hidden_in_the_video
 *
 * INTENCIÓN: el vídeo (tools/video) graba sólo los paneles: la barra de marca está en la lista
 *   de lo que oculta (`APP_HIDDEN`), como la cabecera y el pie de la app.
 * CONTEXTO: test_intent_video_hooks_exist sólo comprueba que cada selector de la lista existe,
 *   no que la barra esté en ella: quitarla dejaba la suite en verde (observado el
 *   2026-10-20).
 * EXPIRA SI: el vídeo pasa a mostrar la navegación de la marca a propósito.
 */
describe("test_intent_brand_bar_is_hidden_in_the_video", () => {
  it("APP_HIDDEN hides the brand bar", () => {
    expect(APP_HIDDEN).toContain(".site-header");
  });
});

/** The cascaded value of `property` on exactly `selector` at `width` (last rule wins). */
function valueAt(
  rules: readonly Rule[],
  selector: string,
  property: string,
  width: number,
): string | undefined {
  let value: string | undefined;
  for (const rule of rules) {
    if (!selectorsOf(rule.selector).includes(selector)) continue;
    if (!appliesAt(rule, width)) continue;
    for (const d of rule.declarations) {
      if (d.property === property) value = d.value;
      if (d.property === "padding" && property.startsWith("padding-")) {
        const [top, right = top, bottom = top] = d.value.split(/\s+/);
        if (property === "padding-top") value = top;
        if (property === "padding-bottom") value = bottom;
        if (property === "padding-right") value = right;
      }
    }
  }
  return value;
}

/**
 * test_intent_brand_bar_matches_the_brand_header
 *
 * INTENCIÓN: la barra de marca tiene la fila de la cabecera de la web: desde 900 px
 *   0,875 rem de relleno arriba y abajo alrededor de controles de 44 px (73 px con la línea),
 *   por debajo 0,5 rem (61 px); la navegación y el botón «Productos» en `--muted` desde 900 px
 *   (en `--fg` abierto); los objetivos de la marca, el menú, los enlaces, «Productos» y el
 *   selector de idioma de ≥ 44 px; y el botón «Menú» muestra su nombre a todos los anchos de
 *   móvil (no se oculta por debajo de 390 px como en la web).
 * CONTEXTO: navegación por producto de la web de marca (2026-10-20): la misma altura que la web medida a 1 440 px
 *   (73 ± 1) y a 390 px (61 ± 1); medido en Chrome 72,8 / 60,8 px en la web y aquí. La barra
 *   anterior no tenía relleno vertical desde 960 px (45 px) y el «Menú» era sólo un icono por
 *   debajo de 390 px.
 * EXPIRA SI: la web de marca cambia su cabecera (alturas, color de la navegación) o el
 *   se decide otra fila para Syndrome.
 */
describe("test_intent_brand_bar_matches_the_brand_header", () => {
  const rules = parseRules(readFileSync(join(SRC_DIR, "index.css"), "utf8"));
  const inner = ".site-header__inner";

  it.each([900, 1024, 1440])(
    "at %i px: 0.875rem rows, the navigation in --muted",
    (width) => {
      expect(valueAt(rules, inner, "padding-top", width)).toBe("0.875rem");
      expect(valueAt(rules, inner, "padding-bottom", width)).toBe("0.875rem");
      expect(valueAt(rules, ".site-nav a", "color", width)).toBe(
        "var(--muted)",
      );
      expect(valueAt(rules, ".nav-group__button", "color", width)).toBe(
        "var(--muted)",
      );
      expect(
        valueAt(
          rules,
          '.nav-group__button[aria-expanded="true"]',
          "color",
          width,
        ),
      ).toBe("var(--fg)");
      expect(valueAt(rules, ".site-menu", "display", width)).toBe("none");
      expect(valueAt(rules, ".nav-group-flat", "display", width)).toBe("none");
    },
  );

  it.each([320, 360, 375, 390, 640, 899])(
    "at %i px: 0.5rem rows, the menu button labelled, the desktop group not rendered",
    (width) => {
      expect(valueAt(rules, inner, "padding-top", width)).toBe("0.5rem");
      expect(valueAt(rules, inner, "padding-bottom", width)).toBe("0.5rem");
      expect(valueAt(rules, ".nav-group", "display", width)).toBe("none");
      expect(
        valueAt(rules, ".site-menu span", "clip-path", width),
      ).toBeUndefined();
      expect(
        valueAt(rules, ".site-menu span", "position", width),
      ).toBeUndefined();
      expect(valueAt(rules, ".site-menu", "width", width)).toBeUndefined();
    },
  );

  it.each([320, 390, 1440])("at %i px the targets are 44 px", (width) => {
    for (const selector of [
      ".site-brand",
      ".site-menu",
      ".site-nav a",
      ".nav-group__button",
      ".lang-switch__option",
    ]) {
      expect(valueAt(rules, selector, "min-height", width), selector).toBe(
        "2.75rem",
      );
    }
    expect(valueAt(rules, ".lang-switch__option", "min-width", width)).toBe(
      "2.75rem",
    );
  });
});

/**
 * test_intent_brand_bar_panel_closed_and_marks
 *
 * INTENCIÓN: (1) el panel de «Productos» cerrado queda oculto aunque el CSS le dé una
 *   caja: una regla `.nav-group__panel[hidden] { display: none }` a todos los anchos hace
 *   ganar al atributo, y ninguna otra regla que apunte al panel declara `display` (una con
 *   más especificidad o posterior le ganaría al atributo); (2) los enlaces del panel miden con
 *   `border-box`, así que su relleno izquierdo no los saca del menú de móvil; (3) «Productos»
 *   con `data-current` lleva el subrayado de acento de la página actual y, desde 900 px, el
 *   color `--fg`, como el `summary[data-current]` de la web.
 * CONTEXTO: 2026-10-20: el panel cerrado sólo era invisible porque
 *   ninguna regla le ponía `display` (los tests miraban el atributo, no lo pintado); los
 *   enlaces sobresalían 12 px de su contenedor a 320 px (la web va de 16 a 304); faltaba la marca
 *   de sección de la web (`site.css` `.nav-group summary[data-current]`).
 * EXPIRA SI: el panel deja de ocultarse con `hidden`, o la web de marca cambia su marca de
 *   sección.
 */
describe("test_intent_brand_bar_panel_closed_and_marks", () => {
  const rules = parseRules(readFileSync(join(SRC_DIR, "index.css"), "utf8"));
  const hiddenRule = ".nav-group__panel[hidden]";

  it("the closed panel is display: none at every width, and nothing else sets the panel's display", () => {
    const own = rules.filter((r) =>
      selectorsOf(r.selector).includes(hiddenRule),
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.ancestors).toEqual([]);
    expect(own[0]!.declarations).toContainEqual({
      property: "display",
      value: "none",
    });
    const offenders = rules
      .filter((r) =>
        selectorsOf(r.selector).some(
          (s) => s.includes("nav-group__panel") && s !== hiddenRule,
        ),
      )
      .filter((r) => r.declarations.some((d) => d.property === "display"))
      .map((r) => `${r.ancestors.join(" ")} ${r.selector}`);
    expect(offenders, offenders.join(" | ")).toEqual([]);
  });

  it.each([320, 390, 899, 900, 1440])(
    "at %i px the panel's links are border-box at full width",
    (width) => {
      const a = ".site-nav .products-panel a";
      expect(valueAt(rules, a, "box-sizing", width)).toBe("border-box");
      expect(valueAt(rules, a, "width", width)).toBe("100%");
    },
  );

  it.each([320, 900, 1440])(
    "at %i px Products as the current section: the accent underline",
    (width) => {
      const current = ".nav-group__button[data-current]";
      expect(valueAt(rules, current, "text-decoration", width)).toBe(
        "underline",
      );
      expect(valueAt(rules, current, "text-decoration-color", width)).toBe(
        "var(--accent)",
      );
      expect(valueAt(rules, current, "text-decoration-thickness", width)).toBe(
        "2px",
      );
      if (width >= 900) {
        expect(valueAt(rules, current, "color", width)).toBe("var(--fg)");
      }
    },
  );
});
