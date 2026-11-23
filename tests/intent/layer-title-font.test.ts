import { describe, expect, it } from "vitest";
import { parseRules, selectorsOf, stylesheets } from "./css-rules";

/**
 * Whether a selector can match the layer title's <text> (class
 * st-layer__title) or one of its <tspan> lines: its last compound has no id,
 * no class other than st-layer__title and a type that is absent, text, tspan
 * or *. `:root` / `html` / `body` compounds and keyframe steps never do.
 */
function reachesTitle(selector: string): boolean {
  const last = selector.split(/\s*[>+~]\s*|\s+/).pop() ?? "";
  if (last === "" || /^(:root|html|body)\b/i.test(last)) return false;
  if (/^(from|to|\d+(\.\d+)?%)$/i.test(last)) return false;
  if (/#[\w-]/.test(last)) return false;
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (classes.some((c) => c !== "st-layer__title")) return false;
  const type = /^([a-zA-Z][\w-]*|\*)/.exec(last)?.[1]?.toLowerCase();
  return type === undefined || ["text", "tspan", "*"].includes(type);
}

const FONT_PROPERTIES = new Set([
  "font",
  "font-size",
  "font-family",
  "font-weight",
  "font-stretch",
  "letter-spacing",
  "word-spacing",
]);

describe("layer titles of the spacetime viewer", () => {
  /**
   * test_intent_no_stylesheet_sets_the_layer_title_font
   * INTENCIÓN: ninguna hoja de estilo declara la letra (tamaño, cara, peso,
   * espaciado) de un rótulo de capa del visor: el margen izquierdo que los
   * aparta de la pila se dimensiona en projection.ts con TITLE_FONT_SIZE,
   * TITLE_FONT_WEIGHT, la cara `var(--font-display)` y TITLE_EM, y SpacetimeSvg los pone
   * en línea en el <text>.
   * CONTEXTO: un `font-size: 24px`
   * en `.st-layer__title` ganaba al atributo `fontSize` y devolvía 470 solapes
   * en Chrome con toda la suite en verde.
   * EXPIRA SI: los rótulos salen del SVG o su tamaño deja de dimensionarse en
   * projection.ts.
   */
  it("test_intent_no_stylesheet_sets_the_layer_title_font: no rule that can match .st-layer__title or a text/tspan declares a font property", () => {
    const offenders: string[] = [];
    let rules = 0;
    for (const { file, css } of stylesheets()) {
      for (const rule of parseRules(css)) {
        rules++;
        if (rule.selector.startsWith("@")) continue;
        if (rule.ancestors.some((a) => a.startsWith("@keyframes"))) continue;
        const reaching = selectorsOf(rule.selector).filter(reachesTitle);
        if (reaching.length === 0) continue;
        for (const { property } of rule.declarations)
          if (FONT_PROPERTIES.has(property.toLowerCase()))
            offenders.push(`${file}: ${reaching.join(", ")} { ${property} }`);
      }
    }
    expect(rules).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
    // The inline face is the display stack, and that stack starts with the
    // self-hosted face whose widths TITLE_EM bounds (projection.ts).
    const display = stylesheets()
      .flatMap(({ css }) => parseRules(css))
      .flatMap((r) => r.declarations)
      .filter((d) => d.property === "--font-display")
      .map((d) => d.value);
    expect(display).toHaveLength(1);
    expect(display[0]!.startsWith('"Space Grotesk",')).toBe(true);
  });

  it("the selector reader recognises what reaches a title and what does not", () => {
    for (const s of [
      ".st-layer__title",
      "text",
      ".spacetime__svg text",
      ".st-layer > .st-layer__title",
      ".st-layer__title tspan",
      "svg *",
      "text.st-layer__title:hover",
      "[dy]",
    ])
      expect(reachesTitle(s), s).toBe(true);
    for (const s of [
      ":root",
      "html",
      ".chart__axis text.chart__tick",
      ".btn",
      "#id",
      "from",
      "50%",
      ".spacetime__svg",
    ])
      expect(reachesTitle(s), s).toBe(false);
  });
});
