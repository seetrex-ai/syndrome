// @vitest-environment jsdom
// The small-phone fixes of 2026-10-20 (branch fix/small-phones). jsdom does
// not lay out, so these tests read the cascade of the stylesheets at a given
// width (the same reading as brand-bar-layout) and the markup the components
// render; the boxes themselves were measured in Chrome with Playwright at
// 320 × 640, 360 × 740, 375 × 667 and 390 × 844 (es and en, light and dark).
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { Chart } from "../../src/ui/chart/Chart";
import { ModelSelect } from "../../src/ui/controls/ModelSelect";
import { ThemeToggle } from "../../src/ui/theme/ThemeToggle";
import { parseRules, selectorsOf, SRC_DIR, type Rule } from "./css-rules";

afterEach(cleanup);

const sheet = (path: string): Rule[] =>
  parseRules(readFileSync(join(SRC_DIR, path), "utf8"));
const INDEX = sheet("index.css");
const CONTROLS = sheet("ui/controls/controls.css");
const CHART = sheet("ui/chart/chart.css");
const GRID = sheet("ui/grid/grid.css");
const SPACETIME = sheet("ui/spacetime/spacetime.css");

/** Whether every at-rule around `rule` is a width media query that holds at `width`. */
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

/** The cascaded value of `property` on exactly `selector` at `width` (last rule wins; same specificity). */
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
    }
  }
  return value;
}

const PHONES = [320, 360, 375, 390, 639] as const;

/**
 * test_intent_header_prefs_one_row_on_phone
 *
 * INTENCIÓN: en un móvil el tema cabe en la MISMA fila que «Syndrome», hasta 320 px y en los
 *   dos idiomas, sin segmentos apretados: el tema muestra sólo su icono (44 × 44) y su texto
 *   queda oculto a la vista pero sigue siendo el nombre accesible de cada opción, y las
 *   preferencias ya no ocupan una fila entera propia; desde 640 px el tema vuelve a mostrar el
 *   texto y no el icono.
 * CONTEXTO: 2026-10-20, problema observado (no se veía bien en pantallas pequeñas): a 320 px
 *   tema e idioma ocupaban dos filas y el lema empezaba a 265 px; se dejaron en una fila bajo el
 *   nombre (tema 144 + idioma 134 + hueco 8 = 286 de 288 px; lema a 195 px). El mismo día el
 *   selector de idioma pasó a la barra de marca (decisión del 2026-10-20) y
 *   el tema subió a la fila del nombre: medido en Chrome a 320, 360, 375 y 390 px en es y en,
 *   «Syndrome» (105 px) y el tema (144 px) en una fila; lema a 161 px.
 * EXPIRA SI: las preferencias salen de la cabecera (p. ej. a un menú) o el tema deja de ser un
 *   control segmentado.
 */
describe("test_intent_header_prefs_one_row_on_phone", () => {
  it("every theme option draws a decorative icon and keeps its i18n label as its accessible name", async () => {
    for (const lang of ["en", "es"]) {
      await i18n.changeLanguage(lang);
      const { unmount } = render(createElement(ThemeToggle));
      for (const theme of ["auto", "light", "dark"]) {
        const radio = screen.getByRole("radio", {
          name: i18n.t(`theme.${theme}`),
        });
        const label = document.querySelector(`label[for="${radio.id}"]`)!;
        expect(label.classList.contains("segmented__option--icon")).toBe(true);
        expect(label.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
          "true",
        );
        expect(label.querySelector(".segmented__text")!.textContent).toBe(
          i18n.t(`theme.${theme}`),
        );
      }
      unmount();
    }
    await i18n.changeLanguage("en");
  });

  it.each(PHONES)(
    "at %i px the theme text is visually hidden, the theme shares the name's row, the icon segment keeps no padding",
    (width) => {
      const text = ".segmented__option--icon .segmented__text";
      expect(valueAt(CONTROLS, text, "clip-path", width)).toBe("inset(50%)");
      expect(valueAt(CONTROLS, text, "position", width)).toBe("absolute");
      expect(
        valueAt(
          CONTROLS,
          ".segmented__option--icon .btn__icon",
          "display",
          width,
        ),
      ).toBeUndefined();
      // No full-width row of its own any more (the language moved out, A1).
      expect(valueAt(INDEX, ".app__prefs", "flex", width)).toBeUndefined();
      expect(valueAt(INDEX, ".app__header", "flex-wrap", width)).toBe("wrap");
      expect(
        valueAt(INDEX, ".app__prefs .segmented__options", "flex-wrap", width),
      ).toBe("nowrap");
      expect(
        valueAt(
          INDEX,
          ".app__prefs .segmented__option--icon",
          "padding",
          width,
        ),
      ).toBe("0");
    },
  );

  it.each([640, 1024, 1440])(
    "at %i px the theme shows its text and not its icon",
    (width) => {
      const text = ".segmented__option--icon .segmented__text";
      expect(valueAt(CONTROLS, text, "clip-path", width)).toBeUndefined();
      expect(
        valueAt(
          CONTROLS,
          ".segmented__option--icon .btn__icon",
          "display",
          width,
        ),
      ).toBe("none");
    },
  );
});

/**
 * test_intent_y_title_centred_inside_the_svg
 *
 * INTENCIÓN: el título vertical del eje Y («Tasa de error lógico P_L») está centrado en su
 *   eje (`text-anchor: middle` gana a la regla `end` de las marcas del eje Y) y su caja empieza
 *   dentro del SVG.
 * CONTEXTO: 2026-10-20: `.chart__axis--y text` (0,1,1) ganaba a `.chart__axis-label` (0,1,0) y
 *   el título colgaba del centro hacia abajo; en la primera pantalla de un móvil su comienzo
 *   («Tas…») quedaba bajo el pliegue y se veía cortado. Su caja empezaba en
 *   x = −1 (medido en Chrome: la caja del texto llega ≈ 1,08 em a la izquierda de la línea
 *   base). Tras el cambio: centrado (119,8–249 de un eje 16–352) y la caja en x = 1.
 * EXPIRA SI: el título del eje Y deja de ser vertical o sale del SVG.
 */
describe("test_intent_y_title_centred_inside_the_svg", () => {
  /** Classes and attributes count 10, element names 1 (no ids in these sheets). */
  const specificity = (selector: string): number =>
    (selector.match(/[.[:]/g)?.length ?? 0) * 10 +
    (selector.match(/(^|[\s>+~])[a-z]+/g)?.length ?? 0);

  it("the rule that centres the axis titles outranks the y ticks' text-anchor rule", () => {
    const anchors = CHART.filter((r) => r.ancestors.length === 0).flatMap((r) =>
      r.declarations
        .filter((d) => d.property === "text-anchor")
        .flatMap((d) =>
          selectorsOf(r.selector).map((s) => ({ selector: s, value: d.value })),
        ),
    );
    const ticks = anchors.find((a) => a.selector === ".chart__axis--y text")!;
    const title = anchors.filter((a) =>
      a.selector.endsWith(".chart__axis-label"),
    );
    expect(ticks.value).toBe("end");
    expect(title.length).toBe(1);
    expect(title[0]!.value).toBe("middle");
    expect(specificity(title[0]!.selector)).toBeGreaterThan(
      specificity(ticks.selector),
    );
  });

  it("the title's baseline leaves its 1.08 em box inside the svg", () => {
    const fontSize = Number(
      CHART.find((r) => r.selector === ".chart__svg")!
        .declarations.find((d) => d.property === "font-size")!
        .value.replace("px", ""),
    );
    const { container } = render(
      createElement(Chart, {
        points: [],
        distances: [3],
        userP: 0.1,
        model: "independent",
      }),
    );
    const title = container.querySelector(
      ".chart__axis--y .chart__axis-label",
    )!;
    const tx = Number(
      /translate\(([\d.]+) /.exec(title.getAttribute("transform")!)![1],
    );
    expect(tx - 1.08 * fontSize).toBeGreaterThanOrEqual(0);
  });
});

/**
 * test_intent_long_segmented_labels_keep_one_line
 *
 * INTENCIÓN: los dos controles segmentados de etiquetas largas (modelo de ruido de la gráfica,
 *   vista del visor) ocupan el ancho y en un móvil, con la letra por defecto, cada etiqueta va
 *   en una línea: segmentos lado a lado desde 360 px, apilados por debajo. Sin `nowrap`: con la
 *   letra del navegador ampliada la etiqueta se parte dentro de su segmento, nunca lo desborda
 *   (medido con la raíz a 20 px). En escritorio, la misma talla compacta
 *   (2026-10-27): en la columna derecha de la primera figura «Perfect measurements» se
 *   partía entre ~960 y ~1 080 px a 1 rem; medido en una línea de 640 a 1 500 px en es y en.
 * CONTEXTO: 2026-10-20: «Mediciones perfectas» / «Fallos de medición» se partían en dos líneas a
 *   todos los anchos de móvil (también en inglés a 390), y la «Vista» del visor apilaba sus dos
 *   opciones dentro de una píldora deforme a 320. Medido en Chrome: «Perfect measurements»
 *   141 px a 0,875 rem en un segmento de 147 px a 360.
 * EXPIRA SI: alguno de los dos controles cambia de forma (p. ej. a un desplegable).
 */
describe("test_intent_long_segmented_labels_keep_one_line", () => {
  const option = ".segmented--fill .segmented__option";
  const options = ".segmented--fill .segmented__options";

  it("the model select and the viewer's view carry the full-width modifier", () => {
    const { container } = render(
      createElement(ModelSelect, { value: "independent", onChange: () => {} }),
    );
    expect(
      container.querySelector("fieldset.model-select.segmented--fill"),
    ).not.toBeNull();
    const viewer = readFileSync(
      join(SRC_DIR, "ui", "spacetime", "SpacetimePanel.tsx"),
      "utf8",
    );
    expect(viewer).toContain('className="spacetime__view segmented--fill"');
  });

  it.each(PHONES)("at %i px each label keeps one line", (width) => {
    // The compact size that fits the widest label in one line (141 of 147 px
    // at 360); no nowrap, so an enlarged browser font wraps inside the
    // segment instead of overflowing it.
    expect(valueAt(CONTROLS, option, "font-size", width)).toBe("0.875rem");
    expect(valueAt(CONTROLS, option, "padding", width)).toBe("0 0.375rem");
    expect(valueAt(CONTROLS, option, "white-space", width)).toBeUndefined();
    expect(valueAt(CONTROLS, options, "flex-wrap", width)).toBe("nowrap");
  });

  it.each([640, 960, 1080, 1440])(
    "at %i px the labels keep the compact size too (wrapped from 960 to ~1 080 px)",
    (width) => {
      // Measured in Chrome: segment 165–168 px at 960 px (with or without a
      // scrollbar); "Perfect measurements" 141 px at 0.875 rem + 16 px of side
      // padding = 157 px (162 px of text at 1 rem). No nowrap here either:
      // at a 20 px root font the label wraps inside its segment.
      expect(valueAt(CONTROLS, option, "font-size", width)).toBe("0.875rem");
      expect(valueAt(CONTROLS, option, "padding", width)).toBe(
        "0.375rem 0.5rem",
      );
      expect(valueAt(CONTROLS, option, "white-space", width)).toBeUndefined();
    },
  );

  it.each([
    [320, "column"],
    [359, "column"],
    [360, undefined],
    [390, undefined],
  ] as const)("at %i px the segments' direction is %s", (width, direction) => {
    expect(valueAt(CONTROLS, options, "flex-direction", width)).toBe(direction);
  });
});

/**
 * test_intent_no_horizontal_scroll_640_to_1023
 *
 * INTENCIÓN: entre 640 y 1 023 px no hay scroll horizontal: la fila «vista + separar capas» del
 *   visor es de UNA columna a todo ancho, porque al lado de la vista el deslizador (pista fija
 *   de 10 rem más su valor) no cabía.
 * CONTEXTO: deuda pendiente del 2026-10-20: `scrollWidth` 733 frente a 640–700 px en español
 *   y 670 en inglés, causado por `.spacetime__gap .control__value`. Medido tras el cambio:
 *   `scrollWidth === clientWidth` a 320, 360, 390, 640, 660, 670, 700 y 1 024 px en es y en.
 * EXPIRA SI: la fila del visor se rediseña.
 */
describe("test_intent_no_horizontal_scroll_640_to_1023", () => {
  it("no rule gives .spacetime__look more than one column", () => {
    for (const rules of [SPACETIME, INDEX]) {
      for (const rule of rules) {
        if (!rule.selector.includes(".spacetime__look")) continue;
        for (const d of rule.declarations) {
          if (d.property !== "grid-template-columns") continue;
          expect(d.value, rule.selector).toBe("minmax(0, 1fr)");
        }
      }
    }
  });
});

/**
 * test_intent_phone_sliders_and_footer_targets
 *
 * INTENCIÓN: en un móvil la etiqueta de cada deslizador va en su propia fila y la pista ocupa el
 *   ancho bajo ella; y los enlaces del pie miden ≥ 44 px también de ancho.
 * CONTEXTO: 2026-10-20: a 320 px las etiquetas se partían junto a la pista y la del visor
 *   («Probabilidad de error p de la tirada aleatoria») dejaba 45 px de pista; en inglés «Lab»
 *   y «Tools» medían 22 y 32 px de ancho.
 * EXPIRA SI: los deslizadores o el pie cambian de forma.
 */
describe("test_intent_phone_sliders_and_footer_targets", () => {
  it.each(PHONES)("at %i px the slider label takes its own row", (width) => {
    expect(valueAt(GRID, ".control", "flex-wrap", width)).toBe("wrap");
    expect(valueAt(GRID, ".control__label", "flex", width)).toBe("1 0 100%");
  });

  it("the footer links are at least 44 px wide", () => {
    for (const selector of [".brand-links a", ".form-links a"]) {
      const value = valueAt(INDEX, selector, "min-width", 320)!;
      expect(Number(value.replace("px", ""))).toBeGreaterThanOrEqual(44);
    }
  });
});
