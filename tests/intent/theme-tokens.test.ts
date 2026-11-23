import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "../../src/ui/theme/theme";
import { parseRules, stylesheets, type Rule } from "./css-rules";

/**
 * test_intent_theme_tokens_only
 *
 * INTENCIÓN: cada color de la interfaz es un token definido para los dos temas, y nada
 *   más lleva color (tasks/plans/phase2.md D14). Alcance: toda hoja `src/⋆⋆/⋆.css`. Un
 *   token vive en un bloque `:root` de nivel superior cuyas declaraciones son todas
 *   propiedades personalizadas (más `color-scheme`). La regla sobre los tokens está
 *   INVERTIDA: un token es numérico (números, unidades, `%`, `var()`,
 *   palabras clave como `transparent`/`currentColor`/`none`/`inherit`) o es
 *   `light-dark(<claro>, <oscuro>)` con un color literal en CADA lado; cualquier otro
 *   identificador en su valor (`whitesmoke`, `#fff` suelto, `rgb(` fuera de
 *   `light-dark`) falla. Así los dos temas quedan definidos en la misma línea y no
 *   puede faltar un lado (el tema se conmuta con `color-scheme` desde `<html
 *   data-theme>`, src/ui/theme/theme.ts). Fuera de esos bloques, ningún valor lleva
 *   `#…`, `rgb(`, `hsl(`, `light-dark(` ni ninguno de los 148 nombres de color CSS ni
 *   un color de sistema; sólo `var(--…)` y palabras clave. Todo `var(--x)` resuelve a
 *   una propiedad declarada en alguna hoja. Y **Safari < 17.5 no conoce
 *   `light-dark()`**: cada hoja repite sus tokens `light-dark` en un
 *   bloque `@supports not (color: light-dark(#000, #fff)) { :root { … } }` con el valor
 *   del lado claro, ni uno más ni uno menos, para que no diverjan. (Duplicar la
 *   declaración en el mismo bloque no sirve: una propiedad personalizada acepta
 *   cualquier secuencia de tokens, la segunda declaración gana y el `var()` cae en
 *   «inválido en tiempo de cálculo».) Ese fallback lleva además `color-scheme: light` en
 *   `:root` y en `:root[data-theme="dark"]` (DESPUÉS de las reglas de `data-theme`, misma
 *   especificidad): sin `light-dark()` los tokens son los claros y un `color-scheme: dark`
 *   heredado del SO o de un «dark» guardado pintaba controles nativos oscuros sobre una
 *   página blanca (`ThemeToggle` no ofrece «dark» en ese navegador).
 * CONTEXTO: antes de los temas claro/oscuro cada hoja tenía sus tokens pero también colores sueltos
 *   (`fill: #fff`, `color: light-dark(…)` en los números de paso, el verde del veredicto
 *   repetido en tres ficheros): un tema nuevo o un ajuste de contraste tenía que
 *   encontrarlos uno a uno. Con la primera versión dos mutantes pasaban en verde:
 *   `darkslategray` (lista de 32 nombres) y `--on-pauli: whitesmoke` (un token de un
 *   solo lado caía en el `continue` de «número u opacidad»).
 * EXPIRA SI: el tema deja de resolverse con `light-dark()` (p. ej. dos bloques
 *   `:root` / `:root[data-theme="dark"]` con valores planos): entonces la segunda
 *   comprobación cambia a «mismo conjunto de nombres en ambos bloques» y el bloque
 *   `@supports` sobra.
 */

// The 148 named colours of CSS Color 4 (grey/gray aliases included).
// prettier-ignore
const NAMED_COLORS = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ");

// System colours (CSS Color 4 §6.2), matched case-insensitively like the browser does.
// prettier-ignore
const SYSTEM_COLORS = "AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas CanvasText Field FieldText GrayText Highlight HighlightText LinkText Mark MarkText SelectedItem SelectedItemText VisitedText".split(" ");

const COLOR_NAME = `\\b(?:${[...NAMED_COLORS, ...SYSTEM_COLORS].join("|")})\\b`;
const COLOR_FUNCTION =
  "\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark)\\(";
const HEX = "#[0-9a-f]{3,8}\\b";

/** Something that paints a colour, anywhere in a value. */
const LITERAL_COLOR = new RegExp(`${HEX}|${COLOR_FUNCTION}|${COLOR_NAME}`, "i");

/** Exactly one colour literal and nothing else: what each side of light-dark() must be. */
const ONE_COLOR = new RegExp(
  `^(?:${HEX}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\([^()]*\\)|${COLOR_NAME})$`,
  "i",
);

const KEYWORDS =
  /\b(?:transparent|currentcolor|inherit|initial|unset|none|auto)\b/gi;

/** The @supports prelude that only a browser WITHOUT light-dark() enters. */
export const NO_LIGHT_DARK = "@supports not (color: light-dark(#000, #fff))";

const isTokenDeclarations = (rule: Rule): boolean =>
  rule.selector === ":root" &&
  rule.declarations.every(
    (d) => d.property.startsWith("--") || d.property === "color-scheme",
  );

const isTokenBlock = (rule: Rule): boolean =>
  isTokenDeclarations(rule) && rule.ancestors.length === 0;

const isFallbackBlock = (rule: Rule): boolean =>
  isTokenDeclarations(rule) &&
  rule.ancestors.length === 1 &&
  rule.ancestors[0] === NO_LIGHT_DARK;

/** `:root[data-theme="dark"] { color-scheme: light }`: the one non-token rule of the fallback. */
const isForcedLightRule = (rule: Rule): boolean =>
  rule.selector === ':root[data-theme="dark"]' &&
  rule.declarations.length === 1 &&
  rule.declarations[0]!.property === "color-scheme" &&
  rule.declarations[0]!.value === "light";

/** Everything that is not a token reference or keyword: what a literal colour would hide in. */
const residue = (value: string): string =>
  value.replace(/var\(--[\w-]+\)/g, " ").replace(KEYWORDS, " ");

/** What is left of a token value once references, keywords, numbers, units and separators are gone. */
const identifiers = (value: string): string =>
  residue(value)
    .replace(/-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?/gi, " ")
    .replace(/[\s,/]/g, "");

/** `light-dark(a, b)` split on its top-level comma, or null. */
function lightDarkSides(value: string): [string, string] | null {
  const m = /^light-dark\((.*)\)$/s.exec(value);
  if (m === null) return null;
  const inner = m[1]!;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
    }
  }
  return null;
}

describe("test_intent_theme_tokens_only", () => {
  const sheets = stylesheets().map((s) => ({ ...s, rules: parseRules(s.css) }));
  expect(sheets.length).toBeGreaterThan(0);

  const defined = new Set<string>();
  for (const { rules } of sheets) {
    for (const rule of rules) {
      for (const d of rule.declarations) {
        if (d.property.startsWith("--")) defined.add(d.property);
      }
    }
  }

  it("knows the 148 named colours of CSS Color 4", () => {
    expect(new Set(NAMED_COLORS).size).toBe(148);
    for (const name of ["darkslategray", "whitesmoke", "rebeccapurple"]) {
      expect(LITERAL_COLOR.test(`fill: ${name}`), name).toBe(true);
    }
  });

  it.each(sheets.map((s) => [s.file, s] as const))(
    "%s: no literal colour outside its :root token block (and its no-light-dark fallback)",
    (_file, sheet) => {
      const offenders: string[] = [];
      for (const rule of sheet.rules) {
        if (isTokenBlock(rule) || isFallbackBlock(rule)) continue;
        for (const d of rule.declarations) {
          if (LITERAL_COLOR.test(residue(d.value))) {
            offenders.push(`${rule.selector} { ${d.property}: ${d.value} }`);
          }
        }
      }
      expect(offenders, offenders.join("\n")).toEqual([]);
    },
  );

  it("every token is numeric or light-dark(<colour>, <colour>): any other identifier fails, a single side fails", () => {
    const offenders: string[] = [];
    let colourTokens = 0;
    for (const { file, rules } of sheets) {
      for (const rule of rules.filter(isTokenBlock)) {
        for (const d of rule.declarations) {
          if (!d.property.startsWith("--")) continue;
          if (identifiers(d.value) === "") continue; // a number, an opacity, a var()
          const sides = lightDarkSides(d.value);
          if (
            sides === null ||
            !ONE_COLOR.test(sides[0]) ||
            !ONE_COLOR.test(sides[1])
          ) {
            offenders.push(`${file}: ${d.property}: ${d.value}`);
          } else colourTokens++;
        }
      }
    }
    expect(colourTokens).toBeGreaterThan(20);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it.each(sheets.map((s) => [s.file, s] as const))(
    "%s: every light-dark token has a plain fallback equal to its light side under @supports not (light-dark), no more and no fewer (Safari < 17.5)",
    (_file, sheet) => {
      const light = new Map<string, string>();
      for (const rule of sheet.rules.filter(isTokenBlock)) {
        for (const d of rule.declarations) {
          const sides = lightDarkSides(d.value);
          if (d.property.startsWith("--") && sides !== null)
            light.set(d.property, sides[0]);
        }
      }
      const fallback = new Map<string, string>();
      for (const rule of sheet.rules.filter(isFallbackBlock)) {
        for (const d of rule.declarations) {
          if (!d.property.startsWith("--")) continue;
          expect(fallback.has(d.property), `${d.property} twice`).toBe(false);
          fallback.set(d.property, d.value);
          expect(d.value, `${d.property} fallback uses light-dark`).not.toMatch(
            /light-dark\(/,
          );
        }
      }
      expect([...fallback.keys()].sort()).toEqual([...light.keys()].sort());
      for (const [name, side] of light) {
        expect(fallback.get(name), `${name} fallback ≠ light side`).toBe(side);
      }
      // The fallback block is a leaf of exactly that @supports; the only other
      // rule allowed there is index.css forcing a light color-scheme (below).
      for (const rule of sheet.rules) {
        if (rule.ancestors.includes(NO_LIGHT_DARK)) {
          expect(
            isFallbackBlock(rule) || isForcedLightRule(rule),
            `${rule.selector} under @supports`,
          ).toBe(true);
        }
      }
    },
  );

  it("without light-dark() the page is light whatever the OS or a stored dark theme says: color-scheme light in the fallback, after the data-theme rules (Safari < 17.5)", () => {
    const index = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    const rules = parseRules(index);
    const fallback = rules.find(isFallbackBlock);
    expect(fallback, "fallback token block").toBeDefined();
    expect(
      fallback!.declarations.find((d) => d.property === "color-scheme")?.value,
    ).toBe("light");
    const forced = rules.findIndex(
      (r) => r.ancestors[0] === NO_LIGHT_DARK && isForcedLightRule(r),
    );
    expect(forced, ':root[data-theme="dark"] { color-scheme: light }').not.toBe(
      -1,
    );
    // Same specificity as the top-level dark rule: it must come later to win.
    const dark = rules.findIndex(
      (r) =>
        r.selector === ':root[data-theme="dark"]' && r.ancestors.length === 0,
    );
    expect(dark).not.toBe(-1);
    expect(forced).toBeGreaterThan(dark);
  });

  it("every var(--x) refers to a declared custom property", () => {
    const missing: string[] = [];
    for (const { file, rules } of sheets) {
      for (const rule of rules) {
        for (const d of rule.declarations) {
          for (const m of d.value.matchAll(/var\((--[\w-]+)\)/g)) {
            if (!defined.has(m[1]!))
              missing.push(`${file}: ${rule.selector} uses ${m[1]}`);
          }
        }
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("the theme is switched by color-scheme from <html data-theme>, auto by the OS", () => {
    const index = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    const rules = parseRules(index);
    const scheme = (selector: string) =>
      rules
        .find((r) => r.selector === selector && r.ancestors.length === 0)
        ?.declarations.find((d) => d.property === "color-scheme")?.value;
    expect(scheme(":root")).toBe("light dark");
    expect(scheme(':root[data-theme="light"]')).toBe("light");
    expect(scheme(':root[data-theme="dark"]')).toBe("dark");
  });

  it("the two theme-color metas of index.html are the two sides of --bg", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    const index = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    const bg = lightDarkSides(
      parseRules(index)
        .filter(isTokenBlock)
        .flatMap((r) => r.declarations)
        .find((d) => d.property === "--bg")?.value ?? "",
    );
    expect(bg).not.toBeNull();
    const metas = [
      ...html.matchAll(/<meta\s+name="theme-color"\s+([^>]*?)\/?>/g),
    ].map((m) => m[1]!);
    expect(metas).toHaveLength(2);
    const content = (scheme: string) => {
      const meta = metas.find((m) => m.includes(`data-scheme="${scheme}"`));
      expect(meta, `meta for ${scheme}`).toBeDefined();
      expect(meta).toContain(`media="(prefers-color-scheme: ${scheme})"`);
      return /content="([^"]+)"/.exec(meta!)?.[1];
    };
    expect(content("light")).toBe(bg![0]);
    expect(content("dark")).toBe(bg![1]);
  });
});

/**
 * test_intent_theme_before_first_paint
 *
 * INTENCIÓN: el tema guardado se aplica antes del primer render, desde un script en línea
 *   de `index.html` (la única excepción a «todo en React», docs/decisiones.md 2026-10-18),
 *   leyendo la MISMA clave de `localStorage` que `src/ui/theme/theme.ts` y poniendo el
 *   mismo atributo `data-theme`; así una página oscura no destella en claro al recargar.
 *   El test EJECUTA el script con un `localStorage` y un `document`
 *   falsos: `light` y `dark` guardados ponen ese `data-theme` Y el `media` de los dos
 *   `<meta name="theme-color">` (`all` / `not all`, como `applyTheme`:
 *   antes el color del marco del navegador seguía al SO hasta que React montaba);
 *   `auto`, un valor corrupto, nada guardado y un `localStorage` que lanza no tocan nada
 *   ni rompen.
 * CONTEXTO: D14. Si el script y el módulo divergen (clave renombrada en uno solo), la
 *   elección se pierde en la primera pintura y vuelve con React: el destello que D14 evita.
 *   La versión anterior sólo buscaba subcadenas: `dataset.theme = "light"` fijo o `||`
 *   cambiado por `&&` seguían en verde.
 * EXPIRA SI: el tema se sirve desde el servidor (cookie, cabecera) o el navegador aplica
 *   `color-scheme` desde el almacenamiento sin script.
 */
describe("test_intent_theme_before_first_paint", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const head = html.slice(0, html.indexOf("<body"));
  const scripts = [...head.matchAll(/<script>([^]*?)<\/script>/g)];
  const inline = scripts[0]?.[1];

  /** A fake `<meta name="theme-color" data-scheme>` with its attributes. */
  const fakeMeta = (scheme: string) => {
    const attrs: Record<string, string> = {
      "data-scheme": scheme,
      media: `(prefers-color-scheme: ${scheme})`,
    };
    return {
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute(name: string, value: string) {
        attrs[name] = value;
      },
      media: () => attrs["media"],
    };
  };

  /**
   * Run the inline script against a fake page; the data-theme and the metas'
   * media it leaves. `lightDark` stubs `CSS.supports`; left
   * out, the script sees Node's global scope, where `CSS` is undefined and
   * counts as supported (as `supportsLightDark` does).
   */
  function run(
    stored: string | null | (() => never),
    lightDark?: boolean,
  ): {
    theme: string | undefined;
    media: [light: string | undefined, dark: string | undefined];
  } {
    const root = {
      dataset: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        if (name === "data-theme") this.dataset.theme = value;
      },
    };
    const metas = [fakeMeta("light"), fakeMeta("dark")];
    const localStorage = {
      getItem(key: string): string | null {
        if (typeof stored === "function") stored();
        return key === THEME_STORAGE_KEY && typeof stored !== "function"
          ? stored
          : null;
      },
    };
    const page = {
      documentElement: root,
      querySelectorAll(selector: string) {
        expect(selector).toBe('meta[name="theme-color"][data-scheme]');
        return metas;
      },
    };
    if (lightDark === undefined) {
      new Function("localStorage", "document", inline!)(localStorage, page);
    } else {
      const supports = (property: string, value: string) => {
        expect([property, value]).toEqual(["color", "light-dark(#000, #fff)"]);
        return lightDark;
      };
      new Function("localStorage", "document", "CSS", inline!)(
        localStorage,
        page,
        { supports },
      );
    }
    return {
      theme: root.dataset.theme,
      media: [metas[0]!.media(), metas[1]!.media()],
    };
  }

  const AUTO_MEDIA = [
    "(prefers-color-scheme: light)",
    "(prefers-color-scheme: dark)",
  ];

  it("index.html carries exactly one inline script in <head>", () => {
    expect(scripts).toHaveLength(1);
    expect(inline).toBeDefined();
  });

  it("applies a stored light or dark theme as data-theme AND to the theme-color metas' media, like applyTheme", () => {
    expect(run("dark")).toEqual({ theme: "dark", media: ["not all", "all"] });
    expect(run("light")).toEqual({ theme: "light", media: ["all", "not all"] });
  });

  it("leaves auto, garbage and nothing to the OS", () => {
    for (const stored of ["auto", "sepia", "", null]) {
      expect(run(stored)).toEqual({ theme: undefined, media: AUTO_MEDIA });
    }
  });

  it("without light-dark() (CSS.supports false): light meta always, dark never, a stored dark applied as auto, light still light; with it, as above", () => {
    const LIGHT_ONLY = ["all", "not all"];
    expect(run("dark", false)).toEqual({ theme: undefined, media: LIGHT_ONLY });
    expect(run(null, false)).toEqual({ theme: undefined, media: LIGHT_ONLY });
    expect(run("auto", false)).toEqual({ theme: undefined, media: LIGHT_ONLY });
    expect(run("light", false)).toEqual({ theme: "light", media: LIGHT_ONLY });
    expect(run("dark", true)).toEqual({
      theme: "dark",
      media: ["not all", "all"],
    });
    expect(run(null, true)).toEqual({ theme: undefined, media: AUTO_MEDIA });
  });

  it("survives a localStorage that throws (privacy modes)", () => {
    expect(
      run(() => {
        throw new Error("denied");
      }),
    ).toEqual({ theme: undefined, media: AUTO_MEDIA });
  });
});
