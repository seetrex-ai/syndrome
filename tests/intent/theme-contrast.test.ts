import { describe, expect, it } from "vitest";
import { parseRules, stylesheets, type Rule } from "./css-rules";

/**
 * test_intent_theme_contrast
 *
 * INTENCIÓN: los pares de tokens que se pintan uno sobre otro en la rejilla, el paso a
 *   paso, el visor y la gráfica contrastan en LOS DOS lados de `light-dark()`: ≥ 4,5:1 el
 *   texto (WCAG 1.4.3) y ≥ 3:1 los trazos y rellenos que cuentan algo (WCAG 1.4.11: la
 *   línea de emparejamiento, las cadenas de corrección, el anillo de foco del cúbit, el
 *   borde del defecto, el residual, los colores Pauli, las lecturas y marcas del visor, la
 *   línea de la p del usuario). Los ratios se calculan desde los literales del CSS, como
 *   `test_intent_chart_text_contrast` para `chart.css`, y una paleta nueva que los rompa
 *   enrojece. **Y el ratio calculado es el pintado**: cada par gráfico
 *   nombra las reglas que pintan su marca (`via`), el test lee de ESAS reglas la `opacity`
 *   que el cascade aplica y compone `α·fg + (1 − α)·bg` antes de calcular; y ninguna regla
 *   de ninguna hoja de `src/` lleva `opacity` < 1, `filter: opacity()` ni `color-mix()`
 *   salvo las de `DIMMED` (atenuaciones deliberadas de marcas que no informan, con su
 *   motivo) y los pasos de `@keyframes`. Lo que atenúa una marca o un texto es un token
 *   (`--muted`, `--badge-dim`, `--chain-x/z`, `--measured-dim`), fijado aquí como los demás.
 *   Los tokens `rgb(… / α)` (`--hover-bg`, `--active-bg`, `--shadow`) no pintan información:
 *   se listan como excluidos y cualquier otro token no hexadecimal enrojece.
 * CONTEXTO: medido en Chrome por composición y por píxel:
 *   la línea de emparejamiento (`opacity: 0.8`) daba 2,49 sobre el defecto oscuro; el
 *   halo de foco (`opacity: 0.35`, único indicador de foco con `outline: none`) 1,58 en
 *   claro y 2,18 en oscuro; las cadenas (`0.55`) 2,36–2,49 sobre fondo y plaquetas; la
 *   lectura del visor desde el paso 2 (`0.6`) 2,24; mientras este test publicaba 8,07,
 *   4,20, 4,92 y 4,18 desde los literales. Mutantes `0.8 → 0.3` y `0.35 → 0.05` en verde.
 *   Antes: las píldoras de paso con `opacity: 0.55` pintaban el número a 2,47;
 *   `--fg` sobre `--defect` 1,36 en oscuro, `--on-badge` 1,89/2,07.
 *   No se fijan `--plaquette-stroke` ni `--border` sobre el fondo (2,07/2,29: líneas de
 *   1 px que separan rellenos ya distintos) ni el relleno `--defect` claro sobre las
 *   plaquetas (1,15: en claro la señal del defecto es su borde `--defect-stroke`).
 * EXPIRA SI: las plaquetas dejan de pintarse con relleno, el paso actual deja de pintarse
 *   con `--defect` o las marcas pasan a dibujarse en Canvas (entonces se mide el bitmap).
 */

const TEXT = 4.5;
const GRAPHIC = 3;
/** A tint that must be SEEN against its background (the sub-threshold region). */
const TINT = 1.25;
/**
 * Every pair passes its minimum by this much (d = 3's curve sat at 3.0x and the first card painted it at 2.93).
 */
const MARGIN = 0.1;

interface Pair {
  readonly fore: string;
  readonly back: string;
  readonly min: number;
  /**
   * The rules an element painted with `fore` matches, as React renders it. The
   * `opacity` the cascade applies is read from them (the last in sheet order
   * that declares one; our sheets write the more specific rule later). Text
   * pairs name none: no text container may carry `opacity` (below).
   */
  readonly via?: readonly string[];
  /** Pinned on the dark side only, with the reason the light side is not. */
  readonly darkOnly?: string;
  /** A ceiling, for a mark that must stay subtle (the gridlines on the paper). */
  readonly max?: number;
}

const pair = (
  fore: string,
  back: string,
  min: number,
  via?: readonly string[],
): Pair => (via === undefined ? { fore, back, min } : { fore, back, min, via });

/**
 * The backgrounds a text token can be painted on: the page (`--bg`) and, from
 * 640 px, the panel card (`--surface`; design.md §2 B). Every token a sheet
 * uses as `color: var(--x)` is pinned on BOTH (derived below from the sheets,
 * not listed by hand: the verdicts and the stats
 * table were pinned on --bg and painted on the card at 4.1–4.4), except the
 * `--on-<x>` tokens, which sit on their own named background and are pinned
 * on it by hand.
 */
const TEXT_BACKGROUNDS = ["--bg", "--surface"] as const;

/** The viewer's "readings step back" rule, one selector list (spacetime.css). */
const READINGS_STEP_BACK = [2, 3, 4, 5]
  .map(
    (s) =>
      `.panel--spacetime[data-step="${s}"] .st-plaquette[data-measured="1"]`,
  )
  .join(", ");

const MEASURED = [".st-plaquette", '.st-plaquette[data-measured="1"]'];

const PAIRS: readonly Pair[] = [
  // Text (WCAG 1.4.3) on its own named background; the text tokens painted
  // on --bg / --surface are derived from the sheets (TEXT_PAIRS below).
  pair("--on-badge", "--plaquette-stroke", TEXT),
  pair("--on-badge-dim", "--badge-dim", TEXT),
  pair("--on-defect", "--defect", TEXT),
  pair("--on-pauli", "--pauli-x", TEXT),
  pair("--on-pauli", "--pauli-z", TEXT),
  pair("--on-pauli", "--pauli-y", TEXT),
  // The brand accent and the ink of the redesign (design.md D2, T-D6):
  // --on-accent sits on the accent, --ink paints the selected segment, the
  // primary button and the "?" disc with --on-ink on it, --ink-hover is the
  // primary button under the pointer. The accent and --residual are never
  // painted on each other (their luminance is near equal in dark: a hue apart).
  pair("--on-accent", "--accent", TEXT),
  pair("--on-ink", "--ink", TEXT),
  pair("--on-ink", "--ink-hover", TEXT),
  // The hover step of the primary button must be SEEN (1.32 / 1.25 were a
  // change nobody noticed).
  pair("--ink-hover", "--ink", 1.5),
  pair("--focus", "--surface", GRAPHIC),
  // The brand mark of the header (index.css, Brand.tsx: the light X plaquette was 1.11:1 on the paper and the qubits,
  // holes in --bg, vanished on it). The X plaquette is seen on the page and
  // the holes are seen on BOTH plaquettes, in both themes; the dark side is
  // the favicon's drawing (design-conventions pins that).
  pair("--brand-x", "--bg", 1.3, [".brand__plaquette--x"]),
  pair("--bg", "--brand-x", GRAPHIC, [".brand__qubit"]),
  pair("--bg", "--accent", GRAPHIC, [".brand__qubit"]),
  // Marks painted on the card (--surface), not inside a figure: the current
  // step pill of the stepper (its amber fill, its stroke as a hairline) and
  // the accent of the slider's track. The light amber fill is 1.3 on both
  // backgrounds and its hairline is the signal there (as in the lattice).
  {
    fore: "--defect",
    back: "--surface",
    min: GRAPHIC,
    darkOnly:
      "in light the pill's edge is --defect-stroke (below); the amber fill alone is 1.3:1 on paper, as on the lattice",
  },
  {
    fore: "--defect",
    back: "--bg",
    min: GRAPHIC,
    darkOnly: "same as on --surface",
  },
  pair("--defect-stroke", "--surface", GRAPHIC, [
    ".plaquette",
    '.plaquette[data-defect="1"]',
  ]),
  pair("--accent", "--surface", GRAPHIC, [".slider__input"]),
  pair("--border", "--surface", 1.2, [".slider__input"]),
  // The grid and the walkthrough (grid.css).
  ...["--bg", "--defect", "--plaquette-z", "--plaquette-x"].map((back) =>
    pair("--match", back, GRAPHIC, [".match"]),
  ),
  // A chain runs along the defects it joins (measured by pixel).
  ...["--bg", "--plaquette-z", "--plaquette-x", "--defect"].flatMap((back) => [
    pair("--chain-x", back, GRAPHIC, [".chain", ".chain--Z"]),
    pair("--chain-z", back, GRAPHIC, [".chain", ".chain--X"]),
  ]),
  ...["--bg", "--plaquette-z", "--plaquette-x"].flatMap((back) => [
    pair("--defect-stroke", back, GRAPHIC, [
      ".plaquette",
      '.plaquette[data-defect="1"]',
    ]),
    pair("--qubit-stroke", back, GRAPHIC, [".qubit__disc"]),
    pair("--focus", back, GRAPHIC, [
      ".qubit__focus",
      ".qubit:focus-visible .qubit__focus",
    ]),
    pair("--pauli-x", back, GRAPHIC, [
      ".qubit__disc",
      '.qubit[data-pauli="X"] .qubit__disc',
    ]),
    pair("--pauli-z", back, GRAPHIC, [
      ".qubit__disc",
      '.qubit[data-pauli="Z"] .qubit__disc',
    ]),
    pair("--pauli-y", back, GRAPHIC, [
      ".qubit__disc",
      '.qubit[data-pauli="Y"] .qubit__disc',
    ]),
  ]),
  pair("--chain-x", "--bg", GRAPHIC, [".swatch", ".swatch--chain"]),
  ...["--qubit", "--plaquette-z", "--plaquette-x"].map((back) =>
    pair("--residual", back, GRAPHIC, [
      ".qubit__halo",
      '.qubit:not([data-residual="I"]) .qubit__halo',
    ]),
  ),
  // The spacetime viewer (spacetime.css).
  pair("--measured-stroke", "--bg", GRAPHIC, MEASURED),
  pair("--measured-stroke", "--measured", GRAPHIC, MEASURED),
  pair("--measured-stroke", "--surface", GRAPHIC, MEASURED),
  pair("--measured-stroke-dim", "--bg", GRAPHIC, [
    ...MEASURED,
    READINGS_STEP_BACK,
  ]),
  pair("--measured-stroke-dim", "--surface", GRAPHIC, [
    ...MEASURED,
    READINGS_STEP_BACK,
  ]),
  pair("--measured-stroke-dim", "--measured-dim", GRAPHIC, [
    ...MEASURED,
    READINGS_STEP_BACK,
  ]),
  ...["--bg", "--measured", "--measured-dim"].map((back) =>
    pair("--flip-mark", back, GRAPHIC, [".st-flip line"]),
  ),
  pair("--time-edge", "--bg", GRAPHIC, [".st-edge", ".st-edge--time"]),
  pair("--pauli-x", "--bg", GRAPHIC, [
    ".st-edge",
    ".st-edge--space.st-edge--Z",
  ]),
  pair("--pauli-z", "--bg", GRAPHIC, [
    ".st-edge",
    ".st-edge--space.st-edge--X",
  ]),
  ...["--bg", "--qubit", "--plaquette-z", "--plaquette-x"].map((back) =>
    pair("--new-ring", back, GRAPHIC, [".st-qubit__new"]),
  ),
  pair("--residual", "--bg", GRAPHIC, [".st-qubit__residual"]),
  pair("--match", "--qubit", GRAPHIC, [".st-qubit__correction"]),
  // The chart (chart.css; the curves are test_intent_chart_text_contrast's).
  pair("--chart-user-p", "--bg", GRAPHIC, [".chart__user-p"]),
  // The sub-threshold region (design.md D5, T-D6): a tint that can be SEEN on
  // the paper (the first one was 1.05:1) and on which
  // the curves, the user's p line and the crossing marker's stroke (--fg)
  // keep their ratios.
  pair("--sub-threshold", "--bg", TINT, [".chart__region"]),
  pair("--curve-3", "--sub-threshold", GRAPHIC, [".curve__line"]),
  pair("--curve-5", "--sub-threshold", GRAPHIC, [".curve__line"]),
  pair("--curve-7", "--sub-threshold", GRAPHIC, [".curve__line"]),
  pair("--chart-user-p", "--sub-threshold", GRAPHIC, [".chart__user-p"]),
  pair("--fg", "--sub-threshold", TEXT),
  // The gridlines cross the region: seen on it (the light grid was 1.07 on the region, invisible inside it) and still a grid
  // on the paper, under 1.8 (the region is ≥ TINT from the paper, so the
  // floor on the region puts the grid at ≥ 1.25 × 1.3 = 1.625 on the paper).
  pair("--chart-grid", "--sub-threshold", 1.3, [".chart__gridline"]),
  {
    fore: "--chart-grid",
    back: "--bg",
    min: 1,
    max: 1.8,
    via: [".chart__gridline"],
  },
];

/**
 * SVG text is painted with `fill`, not `color` (the viewer's layer titles and the chart's axis text were derived by nobody).
 * Every rule whose selector targets `text`, `tspan`, a `__title`/`__label`
 * class or `__axis text`, and declares a `fill`, pins its token as TEXT on the
 * figure background (`--bg`); `currentColor` resolves to the nearest `color`
 * (the rule itself, an ancestor selector of it, else `body`). `--on-*` tokens
 * are pinned by hand on their own background (the Pauli label on its disc).
 */
const SVG_TEXT = /(^|[\s>+~])(text|tspan)(?![\w-])|__title|__label/;

function derivedFillTextPairs(rules: readonly SheetRule[]): Pair[] {
  const colorOf = (rule: SheetRule): string | undefined => {
    const own = rule.declarations.find((d) => d.property === "color");
    if (own !== undefined) return own.value;
    const ancestors = rules.filter(
      (r) =>
        r.ancestors.length === 0 &&
        r.selector !== rule.selector &&
        rule.selector.startsWith(`${r.selector} `) &&
        r.declarations.some((d) => d.property === "color"),
    );
    const nearest =
      ancestors[ancestors.length - 1] ?? topLevel(rules, "body")[0];
    return nearest?.declarations.find((d) => d.property === "color")?.value;
  };
  const tokens = new Set<string>();
  for (const rule of rules) {
    if (!SVG_TEXT.test(rule.selector)) continue;
    const fill = rule.declarations.find((d) => d.property === "fill");
    if (fill === undefined) continue;
    const value = fill.value === "currentColor" ? colorOf(rule) : fill.value;
    const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
    if (m === null) {
      throw new Error(
        `${rule.file} ${rule.selector}: fill ${fill.value} is not a token`,
      );
    }
    if (m[1]!.startsWith("--on-")) continue;
    tokens.add(m[1]!);
  }
  return [...tokens].sort().map((token) => pair(token, "--bg", TEXT));
}

/**
 * Text tokens derived from the sheets: every `color: var(--x)` of every rule
 * (the `--curve-text` indirection of chart.css resolved to the three curve
 * text tokens), pinned on both TEXT_BACKGROUNDS. `--on-*` tokens are pinned
 * by hand above on their named background.
 */
function derivedTextPairs(rules: readonly SheetRule[]): Pair[] {
  const tokens = new Set<string>();
  for (const rule of rules) {
    for (const d of rule.declarations) {
      if (d.property !== "color") continue;
      const m = /^var\((--[\w-]+)\)$/.exec(d.value);
      if (m === null) continue;
      const token = m[1]!;
      if (token.startsWith("--on-")) continue;
      if (token === "--curve-text") {
        for (const d of [3, 5, 7]) tokens.add(`--curve-${d}-text`);
      } else if (token === "--defect") {
        // The step number on the current pill: --defect on --on-defect, the
        // inverse of the pinned pair (same ratio).
        continue;
      } else {
        tokens.add(token);
      }
    }
  }
  const out: Pair[] = [];
  for (const token of [...tokens].sort()) {
    for (const back of TEXT_BACKGROUNDS) out.push(pair(token, back, TEXT));
  }
  return out;
}

/**
 * Text on the background its own rule paints (the current language's
 * chip, --on-ink on --ink, was pinned by nobody, and a
 * `color: var(--muted)` there would have been derived only on --bg and
 * --surface, where it passes). Every rule that declares both `color: var(--x)`
 * and `background(-color): var(--y)` with `--y` a hex token pins x on y as
 * TEXT; a translucent feedback background (--hover-bg, --active-bg) is not a
 * hex token and leaves the text on the page, where derivedTextPairs pins it.
 */
function derivedOwnBackgroundPairs(
  rules: readonly SheetRule[],
  hexTokens: ReadonlyMap<string, unknown>,
): { pair: Pair; selector: string }[] {
  const tokenOf = (value: string | undefined) =>
    /^var\((--[\w-]+)\)$/.exec(value ?? "")?.[1];
  const out: { pair: Pair; selector: string }[] = [];
  for (const rule of rules) {
    const fore = tokenOf(
      rule.declarations.find((d) => d.property === "color")?.value,
    );
    const back = tokenOf(
      rule.declarations.find(
        (d) => d.property === "background" || d.property === "background-color",
      )?.value,
    );
    if (fore === undefined || back === undefined) continue;
    if (!hexTokens.has(back)) continue;
    out.push({ pair: pair(fore, back, TEXT), selector: rule.selector });
  }
  return out;
}

/**
 * Rules that MAY paint with `opacity` < 1: de-emphasis of marks that carry no
 * information at that moment, each with the reason. Anything else that dims by
 * `opacity`, `filter: opacity()` or `color-mix()` is an offender.
 */
const DIMMED: readonly [selector: string, reason: string][] = [
  [
    ".st-plaquette",
    "the planes of the viewer are translucent so the stack reads as layers; a quiet plaquette's fill is décor, readings are opaque below",
  ],
  [
    '.st-layer:not(.st-layer--final) .st-qubit[data-rest="1"] .st-qubit__disc',
    "a qubit at rest on a plane: its history is drawn in the overlay at opacity 1",
  ],
  [
    ".st-edge--dim",
    "once the correction is shown the space edges are redundant with the correction rings (SpacetimeSvg: dim = showCorrection && space)",
  ],
  [
    ".chart__gridline--minor",
    "minor gridlines of the log axis; the labelled major lines carry the scale",
  ],
];

/** Tokens written as `rgb(… / α)`: feedback and shadow, never information. */
const NON_INFORMATIVE_TOKENS: readonly [token: string, reason: string][] = [
  ["--hover-bg", "hover feedback over a control that has its own border"],
  ["--active-bg", "press feedback over a control that has its own border"],
  ["--shadow", "the toast's drop shadow"],
];

const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(n >> 16) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
};

export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** `fore` painted at opacity `alpha` over `back`, as the compositor does it. */
export const compose = (fore: string, back: string, alpha: number): string => {
  const f = parseInt(fore.slice(1), 16);
  const b = parseInt(back.slice(1), 16);
  const mix = (shift: number): string =>
    Math.round(
      alpha * ((f >> shift) & 255) + (1 - alpha) * ((b >> shift) & 255),
    )
      .toString(16)
      .padStart(2, "0");
  return `#${mix(16)}${mix(8)}${mix(0)}`;
};

const HEX_PAIR = /^light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)$/i;

/**
 * Every `--token: light-dark(a, b)` of a top-level :root block across src/:
 * hex pairs by token, and the tokens whose sides are not hex (to be excluded
 * with a reason, never skipped in silence).
 */
function tokens(): {
  hex: Map<string, [string, string]>;
  other: string[];
} {
  const hex = new Map<string, [string, string]>();
  const other: string[] = [];
  for (const { css } of stylesheets()) {
    for (const rule of parseRules(css)) {
      if (rule.selector !== ":root" || rule.ancestors.length > 0) continue;
      for (const d of rule.declarations) {
        if (!d.value.startsWith("light-dark(")) continue;
        const m = HEX_PAIR.exec(d.value);
        if (m !== null) hex.set(d.property, [m[1]!, m[2]!]);
        else other.push(d.property);
      }
    }
  }
  return { hex, other };
}

interface SheetRule extends Rule {
  readonly file: string;
  /** Position across the sheets, in the order the bundle concatenates them. */
  readonly order: number;
}

function allRules(): SheetRule[] {
  const out: SheetRule[] = [];
  for (const { file, css } of stylesheets()) {
    for (const rule of parseRules(css)) {
      out.push({ ...rule, file, order: out.length });
    }
  }
  return out;
}

const topLevel = (rules: readonly SheetRule[], selector: string): SheetRule[] =>
  rules.filter((r) => r.selector === selector && r.ancestors.length === 0);

/**
 * The opacity the cascade applies to an element matching `via`: the last rule
 * in sheet order that declares one, 1 when none does. `var()` cannot be
 * composed: such a rule must be in DIMMED and no pinned pair may end on it.
 */
function paintedOpacity(rules: readonly SheetRule[], via: readonly string[]) {
  let applied = "1";
  let last = -1;
  for (const selector of via) {
    const matching = topLevel(rules, selector);
    expect(matching, `rule "${selector}" exists at top level`).not.toEqual([]);
    for (const rule of matching) {
      const decl = rule.declarations.find((d) => d.property === "opacity");
      if (decl === undefined || rule.order < last) continue;
      last = rule.order;
      applied = decl.value;
    }
  }
  const alpha = Number(applied);
  expect(
    alpha,
    `opacity "${applied}" applied through ${via.join(" / ")} is a number`,
  ).not.toBeNaN();
  return alpha;
}

const dims = (d: { property: string; value: string }): boolean =>
  (d.property === "opacity" && d.value !== "1") ||
  (d.property === "filter" && d.value.includes("opacity(")) ||
  d.value.includes("color-mix(");

describe("test_intent_theme_contrast", () => {
  const { hex, other } = tokens();
  const rules = allRules();

  it("no `opacity` < 1, `filter: opacity()` or `color-mix()` outside DIMMED and @keyframes: what dims is a token, so the ratios below are what is painted", () => {
    const allowed = new Set(DIMMED.map(([selector]) => selector));
    const offenders: string[] = [];
    for (const rule of rules) {
      if (!rule.declarations.some(dims)) continue;
      if (rule.ancestors.some((a) => a.startsWith("@keyframes"))) continue;
      if (allowed.has(rule.selector)) continue;
      offenders.push(`${rule.file}: ${rule.selector}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    // No stale entry: each deliberate de-emphasis still exists and still dims.
    for (const [selector] of DIMMED) {
      const own = topLevel(rules, selector);
      expect(own, `${selector} in a sheet`).not.toEqual([]);
      expect(
        own.some((r) => r.declarations.some(dims)),
        `${selector} dims`,
      ).toBe(true);
    }
    // The marks that motivated this are NOT in the list.
    for (const cls of [
      ".match",
      ".chain",
      ".qubit:focus-visible .qubit__focus",
    ]) {
      expect(allowed.has(cls), cls).toBe(false);
    }
  });

  // The panel card must still read as a card on the white page (decision of
  // 2026-10-20: white paper). Light side only: the
  // dark pair has been 1.08 since the redesign and nobody asked to change it.
  it("the light card (--surface) stands apart from the white page (--bg)", () => {
    const { hex } = tokens();
    const [surface] = hex.get("--surface")!;
    const [bg] = hex.get("--bg")!;
    expect(bg.toLowerCase()).toBe("#ffffff");
    expect(contrast(surface, bg)).toBeGreaterThanOrEqual(1.1);
  });

  it("every non-hex light-dark token is excluded on purpose, with its reason", () => {
    const excluded = NON_INFORMATIVE_TOKENS.map(([token]) => token).sort();
    expect([...new Set(other)].sort()).toEqual(excluded);
    for (const token of excluded) expect(hex.has(token)).toBe(false);
  });

  const ownBackground = derivedOwnBackgroundPairs(rules, hex);
  const textPairs = [
    ...derivedTextPairs(rules),
    ...derivedFillTextPairs(rules),
    ...ownBackground.map((p) => p.pair),
  ];

  it("the derived own-background pairs cover the current language's chip", () => {
    const chip = ownBackground.filter(
      (p) => p.selector === ".lang-switch__current",
    );
    expect(chip.map((p) => `${p.pair.fore} on ${p.pair.back}`)).toEqual([
      "--on-ink on --ink",
    ]);
  });

  it("the derived fill pairs cover the viewer's layer title and the chart's axis text", () => {
    const derived = derivedFillTextPairs(rules).map((p) => p.fore);
    // .st-layer__title { fill: var(--muted) }; .chart__axis text { fill: currentColor } → body's --fg.
    expect(derived).toContain("--muted");
    expect(derived).toContain("--fg");
    expect(derived.some((t) => t.startsWith("--on-"))).toBe(false);
  });

  it("the derived text pairs cover the tokens found painted on the card", () => {
    const derived = new Set(textPairs.map((p) => `${p.fore} on ${p.back}`));
    for (const token of [
      "--fg",
      "--muted",
      "--accent",
      "--ok",
      "--residual",
      "--curve-3-text",
      "--curve-5-text",
      "--curve-7-text",
    ]) {
      for (const back of TEXT_BACKGROUNDS) {
        expect(derived.has(`${token} on ${back}`), `${token} on ${back}`).toBe(
          true,
        );
      }
    }
  });

  it.each(
    [...PAIRS, ...textPairs].map(
      (p) =>
        [
          p.fore,
          p.back,
          p.min,
          p.via ?? [],
          p.darkOnly ?? "",
          p.max ?? Infinity,
        ] as const,
    ),
  )(
    "%s on %s reaches %s:1 (+ margin) in both themes, painted through %j %s (≤ %s)",
    (fore, back, minimum, via, darkOnly, max) => {
      const f = hex.get(fore);
      const b = hex.get(back);
      expect(f, `${fore} as light-dark(#hex, #hex)`).toBeDefined();
      expect(b, `${back} as light-dark(#hex, #hex)`).toBeDefined();
      const alpha = via.length === 0 ? 1 : paintedOpacity(rules, via);
      const light = contrast(compose(f![0], b![0], alpha), b![0]);
      const dark = contrast(compose(f![1], b![1], alpha), b![1]);
      // The margin is for the WCAG thresholds; a tint's 1.25 is exact.
      const required = minimum >= GRAPHIC ? minimum + MARGIN : minimum;
      console.info(
        `[contrast] ${fore} / ${back} (α ${alpha}): light ${light.toFixed(2)}, dark ${dark.toFixed(2)} (≥ ${required})`,
      );
      if (darkOnly === "") {
        expect(light, `${fore} on ${back}, light side`).toBeGreaterThanOrEqual(
          required,
        );
      }
      expect(dark, `${fore} on ${back}, dark side`).toBeGreaterThanOrEqual(
        required,
      );
      expect(
        light,
        `${fore} on ${back}, light side ceiling`,
      ).toBeLessThanOrEqual(max);
      expect(dark, `${fore} on ${back}, dark side ceiling`).toBeLessThanOrEqual(
        max,
      );
    },
  );

  it("composition is the compositor's: full opacity is the colour itself, zero is the background", () => {
    expect(compose("#1c7ed6", "#ffffff", 1)).toBe("#1c7ed6");
    expect(compose("#1c7ed6", "#ffffff", 0)).toBe("#ffffff");
    // The measured figure for the old focus halo (0.35 over white): 1.58:1.
    expect(
      contrast(compose("#1c7ed6", "#ffffff", 0.35), "#ffffff"),
    ).toBeCloseTo(1.58, 1);
  });
});
