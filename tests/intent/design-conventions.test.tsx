// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { wilsonInterval } from "../../src/core";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import { BASELINES } from "../../src/ui/chart/baseline";
import { Chart } from "../../src/ui/chart/Chart";
import {
  crossingOf,
  poolPoints,
  type CurvePoint,
} from "../../src/ui/chart/curves";
import { Clamp } from "../../src/ui/controls/Clamp";
import { Disclosure } from "../../src/ui/controls/Disclosure";
import { Slider } from "../../src/ui/controls/Slider";
import { SectionNav } from "../../src/ui/nav/SectionNav";
import { GAP_DEFAULT } from "../../src/ui/spacetime/projection";
import { SpacetimePanel } from "../../src/ui/spacetime/SpacetimePanel";
import * as fingerprintModule from "../../tools/locales/fingerprint";
import { fingerprints } from "../../tools/locales/fingerprint";
import { parseRules, selectorsOf, stylesheets } from "./css-rules";
import { uiSourceFiles } from "./ui-sources";

const ROOT = process.cwd();

// The deferred panels (chart, viewer) take a while under a full, parallel
// run of the suite: a longer wait than testing-library's second.
const wait = (check: () => void) => waitFor(check, { timeout: 4000 });

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

/**
 * test_intent_no_native_select_or_details
 *
 * INTENCIÓN: ningún `<select>`, `<details>`, `<summary>` ni `<input type="radio">` en
 *   `src/ui/**`, salvo el radio de `src/ui/controls/SegmentedControl.tsx` (lista blanca por
 *   fichero, nunca lista negra: la excepción es finita y visible en el diff). Se recorre el JSX con la
 *   API de TypeScript, no con una expresión regular: un comentario que nombre `<details>`
 *   no cuenta, una etiqueta sí.
 * CONTEXTO: la spec del rediseño («desplegables y botones de los años 2000»,
 *   tasks/plans/design.md D4): los tres controles del rediseño van sobre elementos nativos
 *   ocultos; un `<select>` «temporal» en un panel nuevo volvería sin que nadie lo viera.
 * EXPIRA SI: se decide volver a controles nativos.
 */
describe("test_intent_no_native_select_or_details", () => {
  const RADIO_ALLOWED = new Set(["src/ui/controls/SegmentedControl.tsx"]);
  const FORBIDDEN_TAGS = new Set(["select", "details", "summary"]);

  function offenders(file: string): string[] {
    const rel = relative(ROOT, file).split("\\").join("/");
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (FORBIDDEN_TAGS.has(tag)) found.push(`${rel}: <${tag}>`);
        if (tag === "input" && !RADIO_ALLOWED.has(rel)) {
          for (const attr of node.attributes.properties) {
            if (
              ts.isJsxAttribute(attr) &&
              attr.name.getText(source) === "type" &&
              attr.initializer !== undefined &&
              ts.isStringLiteral(attr.initializer) &&
              attr.initializer.text === "radio"
            ) {
              found.push(`${rel}: <input type="radio">`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  }

  it("src/ui has no <select>, <details>, <summary>, nor a radio outside SegmentedControl", () => {
    const files = uiSourceFiles().filter((f) => !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap(offenders)).toEqual([]);
  });

  it("the detector sees a tag (control: SegmentedControl's radio is the one allowed)", () => {
    const seg = join(ROOT, "src", "ui", "controls", "SegmentedControl.tsx");
    expect(readFileSync(seg, "utf8")).toContain('type="radio"');
    expect(offenders(seg)).toEqual([]);
  });
});

/**
 * test_intent_segmented_control_is_native_radios
 *
 * INTENCIÓN: cada control segmentado de la página (tema, idioma, distancia, modelo, vista
 *   del visor) es un `fieldset[data-segmented]` con `legend` no vacía, una `input[type=radio]`
 *   por opción con `label` asociada por `for`, exactamente una marcada, `name` único por
 *   grupo (dos grupos no se roban la selección) y un clic en la etiqueta cambia el valor;
 *   el radio no lleva `display: none` ni `visibility: hidden` en `controls.css` (se lee la
 *   hoja): se oculta con `clip-path` + `position: absolute`.
 * CONTEXTO: design.md D4; un radio con `display: none` sale del orden de tabulación y pierde
 *   las flechas; el nombre accesible y el estado vienen de la plataforma, no de ARIA a mano.
 * EXPIRA SI: los controles pasan a ARIA manual (`role="radiogroup"` sobre botones).
 */
describe("test_intent_segmented_control_is_native_radios", () => {
  it("every fieldset[data-segmented] of the page: legend, labelled radios, one checked, unique names, click changes", async () => {
    render(<App createWorker={() => null} />);
    // Theme, distance, the chart's model and the viewer's view: the last two
    // arrive with their deferred panels. (The language was a fifth until
    // 2026-10-20: it moved to the brand bar as "EN ES".)
    await wait(() =>
      expect(
        document.querySelectorAll("fieldset[data-segmented]").length,
      ).toBeGreaterThanOrEqual(4),
    );
    const groups = [...document.querySelectorAll("fieldset[data-segmented]")];
    const names = new Set<string>();
    for (const group of groups) {
      const legend = group.querySelector("legend");
      expect(legend?.textContent?.trim(), "legend").not.toBe("");
      const radios = [
        ...group.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ];
      expect(radios.length).toBeGreaterThanOrEqual(2);
      const name = radios[0]!.name;
      expect(name).not.toBe("");
      expect(names.has(name), `name ${name} reused`).toBe(false);
      names.add(name);
      for (const radio of radios) {
        expect(radio.name).toBe(name);
        expect(radio.style.display).not.toBe("none");
        const label = group.querySelector(`label[for="${radio.id}"]`);
        expect(label, `label for ${radio.id}`).not.toBeNull();
        expect(label!.textContent?.trim()).not.toBe("");
      }
      expect(radios.filter((r) => r.checked)).toHaveLength(1);
      const other = radios.find((r) => !r.checked)!;
      fireEvent.click(group.querySelector(`label[for="${other.id}"]`)!);
      expect(other.checked).toBe(true);
      expect(radios.filter((r) => r.checked)).toHaveLength(1);
    }
  });

  it("controls.css hides .segmented__input by clip-path, never display: none / visibility: hidden", () => {
    const sheet = stylesheets().find(
      (s) => s.file === "src/ui/controls/controls.css",
    )!;
    const rules = parseRules(sheet.css).filter(
      (r) => r.selector === ".segmented__input",
    );
    expect(rules.length).toBeGreaterThan(0);
    const declarations = rules.flatMap((r) => r.declarations);
    expect(declarations.some((d) => d.property === "clip-path")).toBe(true);
    expect(
      declarations.filter(
        (d) =>
          (d.property === "display" && d.value === "none") ||
          (d.property === "visibility" && d.value === "hidden"),
      ),
    ).toEqual([]);
  });
});

/**
 * test_intent_disclosure_and_clamp_keep_content_in_dom
 *
 * INTENCIÓN: `Disclosure` y `Clamp` renderizan `button[aria-expanded][aria-controls]` cuyo
 *   `aria-controls` resuelve a un elemento presente, con `hidden` / `data-clamped="1"` al
 *   cerrar y sin él al abrir; el contenido está en el DOM en los dos estados; los
 *   `[data-layer-summary]` del visor existen cerrados; el toggle de `Clamp` lleva el nombre
 *   `a11y.showMore` / `a11y.showLess` y sólo se muestra si el texto desborda (con
 *   `scrollHeight` simulado: jsdom nunca desborda).
 * CONTEXTO: el patrón de `Explain`; el `<details>` sustituido dejaba el contenido en el DOM
 *   y los scripts del vídeo y los tests lo leen (`[data-layer-summary]`).
 * EXPIRA SI: nunca.
 */
describe("test_intent_disclosure_and_clamp_keep_content_in_dom", () => {
  it("Disclosure: closed = body hidden but present; open = visible; aria-controls resolves", () => {
    render(
      <Disclosure summary="Layers">
        <span data-probe>inside</span>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "Layers" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const body = document.getElementById(button.getAttribute("aria-controls")!);
    expect(body).not.toBeNull();
    expect(body!.hidden).toBe(true);
    expect(body!.querySelector("[data-probe]")).not.toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(body!.hidden).toBe(false);
    expect(body!.querySelector("[data-probe]")).not.toBeNull();
  });

  it("the viewer's [data-layer-summary] exist while the disclosure is closed", async () => {
    render(<App createWorker={() => null} />);
    await wait(() =>
      expect(document.querySelector(".spacetime__layers")).not.toBeNull(),
    );
    const layers = document.querySelector(".spacetime__layers")!;
    expect(
      layers.querySelector("button[aria-expanded='false']"),
    ).not.toBeNull();
    expect(layers.querySelectorAll("[data-layer-summary]").length).toBe(4);
  });

  it("Clamp: no toggle without overflow; with overflow a named toggle that unfolds the same text", () => {
    const text = "A long paragraph that the clamp would cut.";
    const { unmount } = render(<Clamp>{text}</Clamp>);
    expect(screen.getByText(text)).not.toBeNull();
    const toggle = document.querySelector<HTMLButtonElement>(".clamp__toggle");
    expect(toggle?.hidden).toBe(true);
    unmount();

    const descriptor = (value: number) => ({
      configurable: true,
      get: () => value,
    });
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollHeight",
      descriptor(80),
    );
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      descriptor(40),
    );
    try {
      render(<Clamp>{text}</Clamp>);
      const wrapper = document.querySelector(".clamp")!;
      expect(wrapper.getAttribute("data-clamped")).toBe("1");
      const button = screen.getByRole("button", {
        name: i18n.t("a11y.showMore"),
      });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      const body = document.getElementById(
        button.getAttribute("aria-controls")!,
      );
      expect(body?.textContent).toBe(text);
      fireEvent.click(button);
      expect(wrapper.getAttribute("data-clamped")).toBe("0");
      expect(button.getAttribute("aria-label")).toBe(i18n.t("a11y.showLess"));
      expect(body?.textContent).toBe(text);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  });
});

/**
 * test_intent_motion_is_short_and_cancellable
 *
 * INTENCIÓN: ninguna `transition`/`animation` de `src/**\/*.css` dura más de 400 ms; cada
 *   `@keyframes` declarado se usa en alguna regla; `ChainLayer` pone `pathLength="1"` en cada
 *   `.chain` (lo que hace posible el trazo que se dibuja). `reduced-motion` sigue derivando
 *   la lista de lo que hay que anular.
 * CONTEXTO: design.md D6, «movimiento con intención»: corto y ligado a un cambio de paso.
 * EXPIRA SI: una animación larga deliberada (un vídeo dentro de la app).
 */
describe("test_intent_motion_is_short_and_cancellable", () => {
  const MAX_MS = 400;
  const durations = (value: string): number[] =>
    [...value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map(([, n, unit]) =>
      unit === "s" ? Number(n) * 1000 : Number(n),
    );

  it(`no transition or animation lasts more than ${MAX_MS} ms`, () => {
    const long: string[] = [];
    let seen = 0;
    for (const { file, css } of stylesheets()) {
      for (const rule of parseRules(css)) {
        for (const d of rule.declarations) {
          if (!/^(transition|animation)(-duration)?$/.test(d.property))
            continue;
          for (const ms of durations(d.value)) {
            seen++;
            if (ms > MAX_MS) long.push(`${file} ${rule.selector}: ${ms} ms`);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(long).toEqual([]);
  });

  it("every @keyframes is used by a rule of its sheet", () => {
    for (const { file, css } of stylesheets()) {
      const rules = parseRules(css);
      const declared = new Set(
        rules
          .flatMap((r) => r.ancestors)
          .filter((a) => a.startsWith("@keyframes"))
          .map((a) => a.replace("@keyframes", "").trim()),
      );
      const used = rules
        .filter((r) => !r.ancestors.some((a) => a.startsWith("@keyframes")))
        .flatMap((r) => r.declarations)
        .filter((d) => /^animation(-name)?$/.test(d.property))
        .map((d) => d.value);
      for (const name of declared) {
        expect(
          used.some((v) => v.split(/\s+/).includes(name)),
          `${file}: @keyframes ${name} unused`,
        ).toBe(true);
      }
    }
  });

  // Motion belongs to a step change, not to the pointer: no `:hover` rule moves anything, no transition names a transform,
  // and every transition (colour, border, shadow) is ≤ 150 ms.
  const MOVES = /^(transform|scale|translate|rotate)$/;
  const MAX_TRANSITION_MS = 150;

  it("no :hover rule transforms, no transition names a transform, every transition ≤ 150 ms", () => {
    const offenders: string[] = [];
    let transitions = 0;
    for (const { file, css } of stylesheets()) {
      for (const rule of parseRules(css)) {
        for (const d of rule.declarations) {
          if (rule.selector.includes(":hover") && MOVES.test(d.property)) {
            offenders.push(`${file} ${rule.selector}: ${d.property} on hover`);
          }
          if (!/^transition(-property|-duration)?$/.test(d.property)) continue;
          if (d.value === "none") continue;
          transitions++;
          if (/\b(transform|scale|translate|rotate|all)\b/.test(d.value)) {
            offenders.push(`${file} ${rule.selector}: transition ${d.value}`);
          }
          for (const ms of durations(d.value)) {
            if (ms > MAX_TRANSITION_MS) {
              offenders.push(`${file} ${rule.selector}: transition ${ms} ms`);
            }
          }
        }
      }
    }
    expect(transitions).toBeGreaterThan(3);
    expect(offenders).toEqual([]);
  });

  it("the correction chains of the lattice carry pathLength=1", () => {
    render(<App createWorker={() => null} />);
    const grid = document.querySelector("section.panel--grid")!;
    // A tap on the first qubit (the grid listens to pointer events): an X
    // error on a corner lights one Z defect and the decoder draws a chain.
    const qubit = grid.querySelector("[data-qubit]")!;
    fireEvent.pointerDown(qubit, {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    fireEvent.pointerUp(qubit, { pointerId: 1 });
    const chains = grid.querySelectorAll(".chain");
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      expect(chain.getAttribute("pathLength")).toBe("1");
    }
  });
});

/**
 * test_intent_first_screen_carries_the_message
 *
 * INTENCIÓN: en orden de documento, `.app__header` (con el `h1` = `app.title`),
 *   `.app__tagline` (= `app.tagline`) y `section.panel--chart.panel--hero` con un
 *   `[data-lambda-ratio]` no vacío para d = 3 y d = 5 en el p por defecto preceden a
 *   `section.panel--grid`. Un número calculado no es texto nuevo. La `nav.app__nav` lleva
 *   cinco enlaces, uno por `section.panel`, en el orden del documento, cuyo texto es el `h2`
 *   de su sección y cuyo `href` resuelve a su `id`; nada más entre el hero y la rejilla.
 * CONTEXTO: medida M4 de design.md: la gráfica y Λ empezaban a 4 234 px (séptima
 *   pantalla). La nav pegajosa (D1) da a cada sección un enlace sin texto nuevo.
 * EXPIRA SI: se elige otro hero (design.md §8.5).
 */
describe("test_intent_first_screen_carries_the_message", () => {
  it("the section nav links every panel, in order, with its own heading", async () => {
    render(<App createWorker={() => null} />);
    await wait(() =>
      expect(
        document.querySelector("section.panel--chart.panel--hero"),
      ).not.toBeNull(),
    );
    const nav = document.querySelector("nav.app__nav")!;
    expect(nav).not.toBeNull();
    const links = [...nav.querySelectorAll<HTMLAnchorElement>("a[href^='#']")];
    const panels = [...document.querySelectorAll("section.panel")];
    expect(panels).toHaveLength(5);
    expect(links).toHaveLength(5);
    links.forEach((link, i) => {
      const id = link.getAttribute("href")!.slice(1);
      const target = document.getElementById(id);
      expect(target, `#${id}`).not.toBeNull();
      expect(target).toBe(panels[i]);
      expect(link.textContent).toBe(target!.querySelector("h2")!.textContent);
    });
    // The nav sits between the hero and the lattice.
    const hero = document.querySelector("section.panel--hero")!;
    const grid = document.querySelector("section.panel--grid")!;
    expect(
      Boolean(
        hero.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        nav.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("header, tagline and the hero chart with Λ come before the lattice", async () => {
    render(<App createWorker={() => null} />);
    await wait(() =>
      expect(
        document.querySelector("section.panel--chart.panel--hero"),
      ).not.toBeNull(),
    );
    const header = document.querySelector(".app__header")!;
    expect(header.querySelector("h1")?.textContent).toBe(i18n.t("app.title"));
    const tagline = document.querySelector(".app__tagline")!;
    expect(tagline.textContent).toBe(i18n.t("app.tagline"));
    const hero = document.querySelector("section.panel--chart.panel--hero")!;
    const grid = document.querySelector("section.panel--grid")!;
    const before = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(header, tagline)).toBe(true);
    expect(before(tagline, hero)).toBe(true);
    expect(before(hero, grid)).toBe(true);
    for (const d of [3, 5]) {
      const ratio = hero.querySelector(
        `[data-lambda-d="${d}"] [data-lambda-ratio]`,
      );
      expect(
        ratio?.getAttribute("data-lambda-ratio"),
        `Λ for d = ${d}`,
      ).not.toBe("");
      expect(Number(ratio!.getAttribute("data-lambda-ratio"))).toBeGreaterThan(
        1,
      );
    }
  });
});

/**
 * test_intent_no_visible_text_changed
 *
 * INTENCIÓN: las cadenas VISIBLES de `src/locales/en.json` y `es.json` son las de `main`
 *   al empezar el rediseño: la huella sha256 de cada fichero sin la rama `a11y` (sólo
 *   nombres aria: el toggle de `Clamp`, la nav), con las claves ordenadas, es la del
 *   fixture `tests/fixtures/locales-main.sha256.json`; la rama `a11y` lleva exactamente las
 *   claves listadas. Sin git (`git show main:…` dependía del
 *   checkout y fallaba en un checkout sin `main` o en CI con un clon superficial).
 *   Refrescar el fixture cuando un cambio de texto sea deliberado:
 *   `node tools/locales/fingerprint.ts tests/fixtures/locales-main.sha256.json`.
 * CONTEXTO: la spec del rediseño («no quiero cambiar física ni textos»); design.md D8.
 * EXPIRA SI: una iteración posterior toca textos a propósito (entonces se refresca el
 *   fixture en el mismo commit y se dice en el mensaje).
 */
describe("test_intent_no_visible_text_changed", () => {
  const ARIA_ONLY = ["sectionNav", "showLess", "showMore"];
  const expected = JSON.parse(
    readFileSync(
      join(ROOT, "tests", "fixtures", "locales-main.sha256.json"),
      "utf8",
    ),
  ) as Record<string, string>;
  const actual = fingerprints(ROOT);

  it.each(["en", "es"])(
    "%s.json: the visible strings are main's (fixture) and a11y has only the aria names",
    (code) => {
      const current = JSON.parse(
        readFileSync(join(ROOT, "src", "locales", `${code}.json`), "utf8"),
      );
      expect(Object.keys(current.a11y ?? {}).sort()).toEqual(ARIA_ONLY);
      expect(actual[code]).toBe(expected[code]);
    },
  );

  it("the fingerprint ignores key order and whitespace, not a text", () => {
    const { visibleFingerprint } = fingerprintModule;
    const a = visibleFingerprint(
      '{"b": {"y": 1, "x": "t"}, "a": "s", "a11y": {"k": "v"}}',
    );
    const b = visibleFingerprint('{"a11y":{},"a":"s","b":{"x":"t","y":1}}');
    const c = visibleFingerprint('{"a": "S", "b": {"x": "t", "y": 1}}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

/**
 * test_intent_crossing_is_where_the_curves_cross
 *
 * INTENCIÓN: `crossingOf(points, 3, 5)` sobre cada base validada cae dentro del intervalo
 *   de la malla donde `P_L(3) − P_L(5)` cambia de signo (la misma cifra por dos caminos:
 *   el test de explicaciones la usa para el texto del umbral), y lo mismo para (5, 7);
 *   dos curvas que no se cruzan dan `null`, y con menos de dos p comunes también.
 * CONTEXTO: design.md D5: la región sub-umbral se sombrea hasta el cruce (3, 5) medido en
 *   esta geometría, no hasta el umbral asintótico de la literatura (docs/spec.md §3: «el
 *   valor exacto lo dicta el script»).
 * EXPIRA SI: la región pasa a dibujarse hasta un valor fijado a mano.
 */
describe("test_intent_crossing_is_where_the_curves_cross", () => {
  it.each(Object.keys(BASELINES))(
    "%s: the crossings (3, 5) and (5, 7) lie in their sign-change interval",
    (model) => {
      const base = BASELINES[model as keyof typeof BASELINES];
      const points = poolPoints(base.points, []);
      for (const [a, b] of [
        [3, 5],
        [5, 7],
      ] as const) {
        const at = (d: number, p: number) =>
          base.points.find((pt) => pt.d === d && pt.p === p)!.estimate;
        const grid = base.probabilities;
        const signs = grid.map((p) => Math.sign(at(a, p) - at(b, p)));
        const i = grid.findIndex((_, k) => k > 0 && signs[k] !== signs[k - 1]);
        expect(i).toBeGreaterThan(0);
        const crossing = crossingOf(points, a, b);
        expect(crossing).not.toBeNull();
        expect(crossing!).toBeGreaterThanOrEqual(grid[i - 1]!);
        expect(crossing!).toBeLessThanOrEqual(grid[i]!);
      }
    },
  );

  it("curves that never cross, or with one common p, give null", () => {
    const base = BASELINES.independent;
    const points = poolPoints(base.points, []);
    // d = 3 against itself never changes sign.
    expect(crossingOf(points, 3, 3)).toBeNull();
    const one = points.filter((pt) => pt.p === base.probabilities[0]);
    expect(crossingOf(one, 3, 5)).toBeNull();
  });
});

/**
 * test_intent_identity_uses_the_tokens
 *
 * INTENCIÓN: `public/favicon.svg`, `tools/og/icon-maskable.svg` y `tools/og/og.svg` sólo
 *   pintan con colores que son el lado claro u oscuro de algún token de `src/index.css`,
 *   `src/ui/grid/grid.css` o `src/ui/chart/chart.css`. Se leen TODOS los valores de
 *   `fill`, `stroke`, `stop-color` y `color` (atributos, `style=""` y bloques `<style>`),
 *   sin los comentarios: un color con nombre (`red`), `rgb()`, un hex de 3 dígitos o
 *   `currentColor` no pasan, porque no son un lado de token (la
 *   expresión `#rrggbb` anterior no veía nada de eso). `none` y `url(#…)` no son colores.
 * CONTEXTO: design.md D7: la marca nace de la paleta; un icono con un azul de otra época
 *   (el favicon anterior, `#1b1f3b`/`#7aa2ff`) no se nota en ningún test de contraste.
 * EXPIRA SI: la marca pasa a tener colores propios registrados fuera de los tokens.
 */
describe("test_intent_identity_uses_the_tokens", () => {
  const sides = new Set<string>();
  for (const sheet of [
    "src/index.css",
    "src/ui/grid/grid.css",
    "src/ui/chart/chart.css",
  ]) {
    const css = readFileSync(join(ROOT, sheet), "utf8");
    for (const m of css.matchAll(
      /light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi,
    )) {
      sides.add(m[1]!.toLowerCase());
      sides.add(m[2]!.toLowerCase());
    }
  }

  /** Every paint value of an SVG's text (comments removed): attribute or CSS. */
  const paints = (svg: string): string[] =>
    [
      ...svg
        .replace(/<!--[\s\S]*?-->/g, "")
        .matchAll(
          /(?:^|[\s;"'{])(?:fill|stroke|stop-color|color)\s*[=:]\s*["']?\s*([^"';}>]+?)\s*(?=["';}>]|$)/gim,
        ),
    ].map((m) => m[1]!.trim());
  const offenders = (svg: string): string[] =>
    paints(svg).filter(
      (v) =>
        v !== "none" &&
        !/^url\(#[\w-]+\)$/.test(v) &&
        !sides.has(v.toLowerCase()),
    );

  it.each([
    "public/favicon.svg",
    "tools/og/icon-maskable.svg",
    "tools/og/og.svg",
  ])("%s paints only with token sides", (file) => {
    const svg = readFileSync(join(ROOT, file), "utf8");
    expect(paints(svg).length).toBeGreaterThan(3);
    expect(offenders(svg)).toEqual([]);
  });

  it("the favicon is the header's brand mark on the dark side: Z plaquettes --accent, X plaquettes --brand-x, qubits and badge --bg", () => {
    const index = readFileSync(join(ROOT, "src", "index.css"), "utf8");
    const darkSide = (token: string): string => {
      const m = new RegExp(
        `${token}: light-dark\\(#[0-9a-f]{6},\\s*(#[0-9a-f]{6})\\)`,
        "i",
      ).exec(index);
      if (m === null) throw new Error(`${token} is not a light-dark token`);
      return m[1]!.toLowerCase();
    };
    const tokenOf = (cls: string): string => {
      const m = new RegExp(
        `\\.${cls}\\s*\\{[^}]*fill:\\s*var\\((--[\\w-]+)\\)`,
      ).exec(index);
      if (m === null) throw new Error(`.${cls} paints no token`);
      return m[1]!;
    };
    const brand = readFileSync(
      join(ROOT, "src", "ui", "brand", "Brand.tsx"),
      "utf8",
    );
    expect(brand).toContain("brand__plaquette--z");
    expect(brand).toContain("brand__plaquette--x");
    expect(brand).toContain("brand__qubit");
    const favicon = readFileSync(join(ROOT, "public", "favicon.svg"), "utf8");
    const rects = [
      ...favicon.matchAll(/<rect[^>]*fill="(#[0-9a-f]{6})"/gi),
    ].map((m) => m[1]!.toLowerCase());
    const circles = /<g fill="(#[0-9a-f]{6})">\s*<circle/i.exec(favicon);
    const z = darkSide(tokenOf("brand__plaquette--z"));
    const x = darkSide(tokenOf("brand__plaquette--x"));
    const hole = darkSide(tokenOf("brand__qubit"));
    expect(rects).toEqual([hole, z, x, x, z]);
    expect(circles?.[1]?.toLowerCase()).toBe(hole);
    expect(hole).toBe(darkSide("--bg"));
  });

  it("the reader sees a named colour, rgb(), a 3-digit hex, currentColor and a style property (control)", () => {
    const mutant = [
      '<svg><!-- fill="#000000" --><rect fill="red"/>',
      '<circle stroke="rgb(0,200,255)"/>',
      "<path fill='#f00'/>",
      '<g style="fill: currentColor; stroke:#123456"/>',
      "<style>.a { stop-color: hsl(1 2% 3%) }</style></svg>",
    ].join("");
    expect(offenders(mutant)).toEqual([
      "red",
      "rgb(0,200,255)",
      "#f00",
      "currentColor",
      "#123456",
      "hsl(1 2% 3%)",
    ]);
    expect(offenders('<rect fill="none" stroke="url(#bg)"/>')).toEqual([]);
  });
});

/**
 * test_intent_ui_paints_with_tokens
 *
 * INTENCIÓN: ningún componente de `src/ui/**\/*.tsx` pinta un color a mano: ni un atributo
 *   JSX `fill=` / `stroke=` / `color=` / `stop-color=` ni una propiedad `fill`, `stroke`,
 *   `color` o `stopColor` dentro de `style={{ … }}` llevan otro valor que `currentColor`,
 *   `none` o `var(--…)`. Los colores viven en las hojas como tokens `light-dark()` y los
 *   fija `theme-contrast`; un literal en el TSX se escapa de todo eso (y de los dos temas).
 *   Se recorre el texto de cada fuente (no los tests), sin comentarios, con las claves de
 *   `style` leídas como palabra entera (`"--fill"` no es `fill`).
 * CONTEXTO: nada impedía un `fill="#fff"` en un componente.
 * EXPIRA SI: los colores pasan a un sistema de temas en TS (hoy son CSS, design.md D2).
 */
describe("test_intent_ui_paints_with_tokens", () => {
  const PAINT_ATTR =
    /(?<![\w-])(fill|stroke|color|stop-color|stopColor)\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/g;
  const PAINT_STYLE =
    /(?<![\w-])(fill|stroke|color|stopColor)\s*:\s*["'`]([^"'`]*)["'`]/g;
  const allowed = (value: string): boolean =>
    value === "currentColor" ||
    value === "none" ||
    /^var\(--[\w-]+\)$/.test(value);
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  /** Every literal paint of a TSX source: `file: attr=value`. */
  const literalPaints = (file: string, source: string): string[] => {
    const text = stripComments(source);
    const out: string[] = [];
    for (const re of [PAINT_ATTR, PAINT_STYLE]) {
      for (const m of text.matchAll(re)) {
        const value = m[2]!.trim();
        if (!allowed(value)) out.push(`${file}: ${m[1]}=${value}`);
      }
    }
    return out;
  };

  it("no src/ui component paints with a literal colour: attributes and style objects use currentColor, none or var(--…)", () => {
    const files = uiSourceFiles().filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap((file) =>
      literalPaints(relative(ROOT, file), readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the detector sees a hex, a named colour and an rgb() in an attribute, in a braced string and in a style object; lets the three allowed forms and a `--fill` custom property be (control)", () => {
    const mutant = [
      '<rect fill="#fff" />',
      "<circle stroke={'red'} />",
      '<g style={{ fill: "rgb(0, 0, 0)" }} />',
      '<text style={{ color: "#123456", fontSize: 12 }} />',
      '<stop stopColor="#abcdef" />',
      '<stop stop-color="blue" />',
    ].join("\n");
    expect(literalPaints("m.tsx", mutant)).toEqual([
      "m.tsx: fill=#fff",
      "m.tsx: stroke=red",
      "m.tsx: stopColor=#abcdef",
      "m.tsx: stop-color=blue",
      "m.tsx: fill=rgb(0, 0, 0)",
      "m.tsx: color=#123456",
    ]);
    const fine = [
      '<rect fill="none" stroke="currentColor" />',
      '<path fill="var(--curve)" />',
      '<div style={{ "--fill": `${fill}%` } as CSSProperties} />',
      '// fill="#000" in a comment',
      '<span className="fill" data-color="x" />',
    ].join("\n");
    expect(literalPaints("f.tsx", fine)).toEqual([]);
  });
});

/**
 * test_intent_links_open_their_panel
 *
 * INTENCIÓN: montar `App` con un hash `#v=…` llama a `scrollIntoView` sobre
 *   `.panel--spacetime` y con `#c=…` sobre `.panel--challenge`; un hash de ancla o vacío no
 *   llama a nada.
 * CONTEXTO: design.md D1 mueve esos paneles por debajo del hero; un enlace compartido
 *   abría antes la página por arriba.
 * EXPIRA SI: los paneles vuelven arriba.
 */
describe("test_intent_links_open_their_panel", () => {
  function mountWith(hash: string): string[] {
    const calls: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push(this.className);
    };
    try {
      window.location.hash = hash;
      render(<App createWorker={() => null} />);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    return calls;
  }

  it("#v= scrolls the viewer, #c= the challenge, an anchor nothing", () => {
    expect(mountWith("#v=f3.gAAAAAAAAAAAA").join(" ")).toContain(
      "panel--spacetime",
    );
    cleanup();
    expect(mountWith("#c=3.AAAA").join(" ")).toContain("panel--challenge");
    cleanup();
    expect(mountWith("#panel-grid")).toEqual([]);
    cleanup();
    expect(mountWith("")).toEqual([]);
  });
});

/**
 * test_intent_touch_targets_on_phone
 *
 * INTENCIÓN: en `controls.css` y `nav.css`, la regla BASE (fuera de toda media query, la que
 *   rige en un móvil) de cada control da ≥ 2,75 rem (44 px) de alto: `.segmented__option`
 *   (también de ancho: los segmentos de distancia «3», «5», «7» medían 37 px),
 *   `.btn`, `.btn--chip`, `.clamp__toggle`, `.disclosure__toggle`, `.app__nav-link`; los
 *   valores menores sólo viven bajo `@media (min-width: …)`. Y en TODAS las hojas de `src/`
 *   (un `.btn { min-height: 1rem }` en `challenge.css` sobrevivía), ninguna
 *   regla cuyo selector nombre un control interactivo (`.btn`, `.segmented__option`,
 *   `.app__nav-link`, `.clamp__toggle`, `.disclosure__toggle`, `.stepper__step` o el
 *   elemento `button`; los pseudoelementos `::before`/`::after` no son el control) declara
 *   `min-height`, `height`, `min-width` o `width` **ni sus formas lógicas** (`min-block-size`,
 *   `block-size`, `min-inline-size`, `inline-size`) por debajo de 2,75 rem /
 *   44 px fuera de un bloque `@media (min-width: ≥ 640px)`; y **todo valor que el paseo no sepa
 *   medir** (`em`, `calc()`, `vw`, un porcentaje distinto de 100 %, `var()`) cuenta como pequeño:
 *   sólo `rem`/`px` se miden y sólo `auto`, `100%`, `fit-content`, `max-content`, `min-content`
 *   y las palabras clave de herencia se dejan pasar. jsdom no mide cajas: se lee la hoja.
 * CONTEXTO: los segmentos, los chips y el toggle de `Clamp`
 *   medían 36–38 px en el móvil, una regresión del `main` que daba 44 a todo botón.
 * EXPIRA SI: los controles compactos pasan a ser un ajuste del usuario.
 */
describe("test_intent_touch_targets_on_phone", () => {
  const MIN_REM = 2.75;
  const CONTROLS = [
    ["src/ui/controls/controls.css", ".segmented__option", "min-height"],
    ["src/ui/controls/controls.css", ".segmented__option", "min-width"],
    ["src/ui/controls/controls.css", ".btn", "min-height"],
    ["src/ui/controls/controls.css", ".btn--chip", "min-height"],
    ["src/ui/controls/controls.css", ".clamp__toggle", "min-height"],
    ["src/ui/controls/controls.css", ".clamp__toggle", "height"],
    ["src/ui/controls/controls.css", ".disclosure__toggle", "min-height"],
    ["src/ui/nav/nav.css", ".app__nav-link", "min-height"],
  ] as const;
  const rem = (value: string): number => {
    const m = /^(\d*\.?\d+)rem$/.exec(value);
    expect(m, `${value} in rem`).not.toBeNull();
    return Number(m![1]);
  };

  it.each(CONTROLS)(
    "%s %s: the base %s is ≥ 2.75rem; smaller only under min-width media",
    (file, selector, property) => {
      const sheet = stylesheets().find((s) => s.file === file)!;
      const rules = parseRules(sheet.css).filter(
        (r) => r.selector === selector,
      );
      const base = rules.filter((r) => r.ancestors.length === 0);
      const declared = base.flatMap((r) =>
        r.declarations.filter((d) => d.property === property),
      );
      expect(declared.length, `${selector} ${property} at top level`).toBe(1);
      expect(rem(declared[0]!.value)).toBeGreaterThanOrEqual(MIN_REM);
      for (const rule of rules.filter((r) => r.ancestors.length > 0)) {
        for (const d of rule.declarations) {
          if (d.property !== property || rem(d.value) >= MIN_REM) continue;
          expect(
            rule.ancestors.every((a) => /^@media \(min-width:/.test(a)),
            `${selector} ${property} ${d.value} under ${rule.ancestors.join(" / ")}`,
          ).toBe(true);
        }
      }
    },
  );

  const INTERACTIVE =
    /\.(btn|segmented__option|app__nav-link|clamp__toggle|disclosure__toggle|stepper__step)(?![\w-])|(^|[\s>+~])button(?![\w-])/;
  // The physical sizes AND their logical spellings
  // (`min-block-size: 1.5rem` walked past the test).
  const SIZES = new Set([
    "min-height",
    "height",
    "min-width",
    "width",
    "min-block-size",
    "block-size",
    "min-inline-size",
    "inline-size",
  ]);
  /** Values that are not a length the control could shrink to. */
  const NOT_A_LENGTH = new Set([
    "auto",
    "100%",
    "fit-content",
    "max-content",
    "min-content",
    "inherit",
    "initial",
    "unset",
  ]);
  /**
   * A size under 44 px. `rem` and `px` are measured; the keywords above are
   * let be; ANY other value (em, calc(), vw, a percentage under 100, a
   * var()) is one the walk cannot measure and counts as small
   * (`min-height: 1.5em` was read as "not a size" and passed).
   */
  const small = (value: string): boolean => {
    if (NOT_A_LENGTH.has(value)) return false;
    const m = /^(\d*\.?\d+)(rem|px)$/.exec(value);
    if (m === null) return true;
    return m[2] === "rem" ? Number(m[1]) < MIN_REM : Number(m[1]) < 44;
  };
  const compact = (ancestors: readonly string[]): boolean =>
    ancestors.length > 0 &&
    ancestors.every((a) => {
      const m = /^@media \(min-width: (\d*\.?\d+)px\)$/.exec(a);
      return m !== null && Number(m[1]) >= 640;
    });

  /** Every rule of every sheet that sizes an interactive control under 44 px outside a compact block. */
  const shrinking = (sheets: { file: string; css: string }[]): string[] =>
    sheets.flatMap(({ file, css }) =>
      parseRules(css)
        .filter((rule) =>
          selectorsOf(rule.selector).some(
            (s) => INTERACTIVE.test(s) && !/::?(before|after)/.test(s),
          ),
        )
        .flatMap((rule) =>
          rule.declarations
            .filter((d) => SIZES.has(d.property) && small(d.value))
            .filter(() => !compact(rule.ancestors))
            .map(
              (d) =>
                `${file} ${rule.selector}: ${d.property} ${d.value} under [${rule.ancestors.join(" / ")}]`,
            ),
        ),
    );

  it("no rule of any sheet sizes an interactive control under 44 px outside a ≥ 640 px block", () => {
    expect(shrinking(stylesheets())).toEqual([]);
  });

  /**
   * The stepper's connector: drawn OUTSIDE the pill
   * (absolute from its right edge, in the row gap) so the current pill's
   * fill never encloses it, and only from 1024 px, where both walkthroughs
   * fit on one row (measured in Chrome, en and es); below, no dash dangles
   * at a line wrap.
   */
  it("the stepper connector is absolute outside the pill, inside a row gap that holds it, only from 1024 px", () => {
    const sheet = stylesheets().find(
      (s) => s.file === "src/ui/controls/controls.css",
    )!;
    const rules = parseRules(sheet.css);
    const connectors = rules.filter((r) =>
      /\.stepper__step.*::after/.test(r.selector),
    );
    expect(connectors).toHaveLength(1);
    const [connector] = connectors;
    expect(connector!.ancestors).toEqual(["@media (min-width: 1024px)"]);
    const decl = (property: string) =>
      connector!.declarations.find((d) => d.property === property)?.value;
    expect(decl("position")).toBe("absolute");
    expect(decl("left")).toBe("100%");
    const width = Number.parseFloat(decl("width")!);
    const offset = Number.parseFloat(decl("margin")!.split(" ")[3]!);
    expect(width).toBeGreaterThan(0);
    const stepper = rules.find(
      (r) =>
        r.selector === ".stepper" &&
        r.ancestors[0] === "@media (min-width: 1024px)",
    )!;
    const columnGap = Number.parseFloat(
      stepper.declarations
        .find((d) => d.property === "gap")!
        .value.split(" ")[1]!,
    );
    expect(columnGap).toBeGreaterThanOrEqual(width + offset);
    expect(
      rules
        .find(
          (r) => r.selector === ".stepper__step" && r.ancestors.length === 0,
        )!
        .declarations.find((d) => d.property === "position")?.value,
    ).toBe("relative");
  });

  it("the walk sees a small .btn in another sheet, a px height on a button, a logical property, an em or calc() it cannot measure, and lets the compact block and the pseudo-element be (control)", () => {
    const sheet = (css: string) => [{ file: "x.css", css }];
    expect(shrinking(sheet(".btn { min-height: 1rem }"))).toHaveLength(1);
    expect(shrinking(sheet("button { height: 40px }"))).toHaveLength(1);
    // Two mutants that used to pass: a logical size and an em size.
    expect(shrinking(sheet(".btn { min-block-size: 1.5rem }"))).toHaveLength(1);
    expect(shrinking(sheet(".btn { min-height: 1.5em }"))).toHaveLength(1);
    expect(
      shrinking(sheet(".segmented__option { inline-size: 2rem }")),
    ).toHaveLength(1);
    expect(
      shrinking(sheet(".btn { min-height: calc(2rem + 4px) }")),
    ).toHaveLength(1);
    expect(shrinking(sheet(".btn { height: 10vw }"))).toHaveLength(1);
    expect(shrinking(sheet(".btn { width: 50% }"))).toHaveLength(1);
    expect(shrinking(sheet(".btn { min-height: var(--x) }"))).toHaveLength(1);
    expect(shrinking(sheet(".btn { min-block-size: 2.75rem }"))).toEqual([]);
    expect(shrinking(sheet(".btn { height: auto }"))).toEqual([]);
    expect(
      shrinking(
        sheet(
          "@media (max-width: 639.98px) { .app__nav-link { width: 2rem } }",
        ),
      ),
    ).toHaveLength(1);
    expect(
      shrinking(
        sheet("@media (min-width: 400px) { .btn { min-height: 2rem } }"),
      ),
    ).toHaveLength(1);
    expect(
      shrinking(
        sheet("@media (min-width: 640px) { .btn { min-height: 2rem } }"),
      ),
    ).toEqual([]);
    expect(
      shrinking(sheet(".stepper__step::before { width: 1.5rem }")),
    ).toEqual([]);
    expect(shrinking(sheet(".btn { width: 100% }"))).toEqual([]);
  });
});

/**
 * test_intent_step_texts_are_never_clamped
 *
 * INTENCIÓN: los textos de los pasos (`steps.explain.*`, `spacetime.explain.*`) no se
 *   recortan: ninguna regla de ninguna hoja aplica `line-clamp`/`-webkit-line-clamp` a
 *   `.steps__explain`, `.spacetime__explain`, `.steps__text` o `.spacetime__text`, la única
 *   regla con `line-clamp` es la de `Clamp` (`.clamp[data-clamped="1"] .clamp__text`), y en
 *   `StepsPanel.tsx`/`SpacetimePanel.tsx` ningún elemento `<Clamp>` envuelve una clave
 *   `explain.` (se recorre el JSX con la API de TypeScript).
 * CONTEXTO: design.md D8 lo prometía y nada lo protegía.
 * EXPIRA SI: se decide recortar también los pasos (design.md §8.7 c).
 */
describe("test_intent_step_texts_are_never_clamped", () => {
  const STEP_TEXT = /\.(steps|spacetime)__(explain|text|name)\b/;
  const CLAMP_RULE = '.clamp[data-clamped="1"] .clamp__text';

  it("no line-clamp outside Clamp's rule, none on a step text selector", () => {
    const clamps: string[] = [];
    for (const { file, css } of stylesheets()) {
      for (const rule of parseRules(css)) {
        const clamped = rule.declarations.some((d) =>
          /line-clamp$/.test(d.property),
        );
        if (clamped) clamps.push(`${file} ${rule.selector}`);
        expect(
          clamped && STEP_TEXT.test(rule.selector),
          `${file} ${rule.selector} clamps a step text`,
        ).toBe(false);
      }
    }
    expect(clamps).toEqual([`src/ui/controls/controls.css ${CLAMP_RULE}`]);
  });

  const clampedKeys = (file: string): string[] => {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxElement(node) &&
        node.openingElement.tagName.getText(source) === "Clamp"
      ) {
        for (const m of node
          .getText(source)
          .matchAll(/\bt\(\s*["'`]([\w.]*explain[\w.]*)/g)) {
          found.push(m[1]!);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };

  it.each([
    "src/ui/steps/StepsPanel.tsx",
    "src/ui/spacetime/SpacetimePanel.tsx",
  ])(
    "%s: no <Clamp> wraps an explain.* key (and the panel does render it in a Clamp-free element)",
    (rel) => {
      const file = join(ROOT, rel);
      const text = readFileSync(file, "utf8");
      expect(text).toContain("explain.${step}");
      expect(text).toContain("<Clamp");
      expect(clampedKeys(file)).toEqual([]);
    },
  );

  it("the detector sees a Clamp around an explain key (control)", () => {
    const mutant = join(ROOT, "tests", "fixtures", "clamped-step.tsx.txt");
    expect(clampedKeys(mutant)).toEqual(["steps.explain.errors"]);
  });
});

/**
 * test_intent_section_nav_follows_the_lazy_sections
 *
 * INTENCIÓN: `SectionNav` observa (IntersectionObserver) las cinco secciones REALES también
 *   después de que las diferidas (gráfica, visor) sustituyan a sus esqueletos: el nodo que
 *   hoy lleva `#panel-chart` está entre los observados, y una entrada del observador sobre
 *   él pone `aria-current="true"` en su enlace y en ningún otro. La nav tiene nombre
 *   accesible (`a11y.sectionNav`). La altura de la barra va a `--nav-height` en `<html>`
 *   (ResizeObserver) y `nav.css` la usa como `scroll-padding-top` del documento desde 640 px.
 * CONTEXTO: observado una vez al montar (deps `[]`), el observador
 *   seguía a los esqueletos y la gráfica y el visor nunca eran actuales; con un
 *   `scroll-margin-top` fijo de 52 px la barra de 93 px (640–799) tapaba el título y el
 *   foco de Mayús+Tab.
 * EXPIRA SI: las secciones dejan de ser diferidas o la nav deja de ser pegajosa.
 */
describe("test_intent_section_nav_follows_the_lazy_sections", () => {
  type Callback = (entries: IntersectionObserverEntry[]) => void;
  class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];
    readonly observed = new Set<Element>();
    readonly callback: Callback;
    constructor(callback: Callback) {
      this.callback = callback;
      FakeIntersectionObserver.instances.push(this);
    }
    observe(el: Element) {
      this.observed.add(el);
    }
    unobserve(el: Element) {
      this.observed.delete(el);
    }
    disconnect() {
      this.observed.clear();
    }
    fire(target: Element, ratio: number) {
      this.callback([
        { target, intersectionRatio: ratio } as IntersectionObserverEntry,
      ]);
    }
  }
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    readonly observed: Element[] = [];
    readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      FakeResizeObserver.instances.push(this);
    }
    observe(el: Element) {
      this.observed.push(el);
    }
    disconnect() {}
  }

  const withFakes = async (run: () => Promise<void>) => {
    const g = globalThis as Record<string, unknown>;
    const io = g["IntersectionObserver"];
    const ro = g["ResizeObserver"];
    FakeIntersectionObserver.instances = [];
    FakeResizeObserver.instances = [];
    g["IntersectionObserver"] = FakeIntersectionObserver;
    g["ResizeObserver"] = FakeResizeObserver;
    try {
      await run();
    } finally {
      g["IntersectionObserver"] = io;
      g["ResizeObserver"] = ro;
    }
  };

  const IDS = [
    "panel-chart",
    "panel-grid",
    "panel-steps",
    "panel-spacetime",
    "panel-challenge",
  ];

  /** The links current right now, by href. */
  const current = () =>
    [...document.querySelectorAll("nav.app__nav a")]
      .filter((a) => a.getAttribute("aria-current") === "true")
      .map((a) => a.getAttribute("href"));

  it("a section replaced after mount (skeleton → panel) is observed too, and aria-current follows the live node", async () => {
    await withFakes(async () => {
      // A <main> like App's: five sections and, beside them, the nav's React
      // root (a child div: React empties the container it renders into).
      const main = document.createElement("main");
      for (const id of IDS) {
        const section = document.createElement("section");
        section.id = id;
        main.append(section);
      }
      const root = document.createElement("div");
      main.append(root);
      document.body.append(main);
      render(<SectionNav />, { container: root });
      const io = FakeIntersectionObserver.instances.find(
        (i) => i.observed.size > 0,
      )!;
      expect(io).toBeDefined();
      expect(io.observed.size).toBe(5);
      // The two deferred panels arrive: new nodes with the same ids.
      for (const id of ["panel-chart", "panel-spacetime"]) {
        const fresh = document.createElement("section");
        fresh.id = id;
        document.getElementById(id)!.replaceWith(fresh);
      }
      for (const id of IDS) {
        const section = document.getElementById(id)!;
        await wait(() =>
          expect(
            io.observed.has(section),
            `${id} (the live node) observed`,
          ).toBe(true),
        );
        io.fire(section, 1);
        await wait(() => expect(current()).toEqual([`#${id}`]));
        io.fire(section, 0);
      }
      expect(io.observed.size).toBe(7);
      const nav = document.querySelector("nav.app__nav")!;
      expect(nav.getAttribute("aria-label")).toBe(i18n.t("a11y.sectionNav"));
      main.remove();
    });
  });

  it("in the app, once the deferred panels resolve, the live chart and viewer sections are observed", async () => {
    await withFakes(async () => {
      render(<App createWorker={() => null} />);
      await wait(() =>
        expect(
          document.querySelector("section.panel--chart.panel--hero"),
        ).not.toBeNull(),
      );
      await wait(() =>
        expect(document.querySelector(".spacetime__layers")).not.toBeNull(),
      );
      // The nav's observer: the one watching a section that is never deferred
      // (the chart's engagement hook observes its figure with another one,
      // tasks/plans/analytics.md D12).
      const io = FakeIntersectionObserver.instances.find((i) =>
        [...i.observed].some((el) => el.id === "panel-grid"),
      )!;
      for (const id of IDS) {
        const section = document.getElementById(id)!;
        await wait(() =>
          expect(io.observed.has(section), `${id} observed`).toBe(true),
        );
      }
      const chart = document.querySelector("section.panel--chart.panel--hero")!;
      io.fire(chart, 1);
      await wait(() => expect(current()).toEqual(["#panel-chart"]));
    });
  });

  it("the bar's measured height is written to --nav-height on <html>", async () => {
    await withFakes(async () => {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          return (this as HTMLElement).classList.contains("app__nav") ? 93 : 0;
        },
      });
      try {
        const { unmount } = render(<SectionNav />);
        const root = document.documentElement;
        expect(root.style.getPropertyValue("--nav-height")).toBe("93px");
        const ro = FakeResizeObserver.instances.find((r) =>
          r.observed.some((el) => el.classList.contains("app__nav")),
        )!;
        expect(ro).toBeDefined();
        ro.callback();
        expect(root.style.getPropertyValue("--nav-height")).toBe("93px");
        unmount();
        expect(root.style.getPropertyValue("--nav-height")).toBe("");
      } finally {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      }
    });
  });

  it("nav.css: scroll-padding-top of html is var(--nav-height) from 640 px, with a fallback per breakpoint", () => {
    const sheet = stylesheets().find((s) => s.file === "src/ui/nav/nav.css")!;
    const rules = parseRules(sheet.css).filter((r) => r.selector === "html");
    const sticky = rules.find((r) =>
      r.ancestors.some((a) => a === "@media (min-width: 640px)"),
    );
    expect(sticky).toBeDefined();
    expect(
      sticky!.declarations.find((d) => d.property === "scroll-padding-top")
        ?.value,
    ).toBe("var(--nav-height)");
    // The fallbacks are the bar's measured heights (two rows of 44 px links
    // + 1 px rule at 640–799 px, one row from 800: 93 / 47 px): a browser
    // without ResizeObserver scrolls by them.
    const fallbacks = rules
      .filter((r) => r.declarations.some((d) => d.property === "--nav-height"))
      .map((r) => [
        r.ancestors.join(" "),
        r.declarations.find((d) => d.property === "--nav-height")!.value,
      ]);
    expect(fallbacks).toEqual([
      ["", "0px"],
      ["@media (min-width: 640px)", "5.8125rem"],
      ["@media (min-width: 800px)", "2.9375rem"],
    ]);
    // The panel's own margin is a breath, not the bar (the two would add up).
    const panel = parseRules(sheet.css).find((r) => r.selector === ".panel")!;
    const margin = panel.declarations.find(
      (d) => d.property === "scroll-margin-top",
    )!;
    expect(Number.parseFloat(margin.value)).toBeLessThanOrEqual(0.5);
  });
});

/**
 * test_intent_chart_marks_read_apart
 *
 * INTENCIÓN: la región sub-umbral es el PRIMER hijo del svg (debajo de la cuadrícula y de
 *   las curvas); dos cruces a menos de 8 px se dibujan como un solo marcador con los dos
 *   nombres en `data-crossing`, y dos cruces separados como dos. `Slider` expone el valor
 *   formateado como `aria-valuetext`.
 * CONTEXTO: la región tapaba la cuadrícula, y había defectos menores en
 *   los marcadores de cruce superpuestos en el modelo independiente y del deslizador.
 * EXPIRA SI: la gráfica pasa a Canvas.
 */
describe("test_intent_chart_marks_read_apart", () => {
  const point = (d: number, p: number, estimate: number): CurvePoint => {
    const shots = 100_000;
    const failures = Math.round(estimate * shots);
    const { low, high } = wilsonInterval(failures, shots);
    return {
      d,
      p,
      shots,
      failures,
      estimate,
      low,
      high,
      upperBoundOnly: false,
      live: false,
      liveShots: 0,
      stopReason: null,
      rate: 0,
    };
  };
  const chart = (p7: readonly [number, number]) =>
    render(
      <Chart
        points={[
          point(3, 0.05, 0.01),
          point(3, 0.1, 0.04),
          point(5, 0.05, 0.02),
          point(5, 0.1, 0.02),
          point(7, 0.05, p7[0]),
          point(7, 0.1, p7[1]),
        ]}
        distances={[3, 5, 7]}
        userP={0.02}
        model="independent"
      />,
    );

  it("the region is the svg's first child, before the gridlines", () => {
    chart([0.04, 0.01]);
    const svg = document.querySelector("svg.chart__svg")!;
    expect(svg.firstElementChild?.getAttribute("data-region")).toBe(
      "sub-threshold",
    );
    const grid = svg.querySelector(".chart__grid")!;
    expect(
      Boolean(
        svg.firstElementChild!.compareDocumentPosition(grid) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("two crossings on the same pixel draw one marker named after both; apart, two", () => {
    chart([0.04, 0.01]);
    let markers = [...document.querySelectorAll(".chart__crossing")];
    expect(markers.map((m) => m.getAttribute("data-crossing"))).toEqual([
      "3-5 5-7",
    ]);
    cleanup();
    chart([0.04, 0.005]);
    markers = [...document.querySelectorAll(".chart__crossing")];
    expect(markers.map((m) => m.getAttribute("data-crossing"))).toEqual([
      "3-5",
      "5-7",
    ]);
  });

  it("Slider: aria-valuetext is the formatted value", () => {
    render(
      <Slider
        label="p"
        min={0}
        max={1}
        step={0.01}
        value={0.1}
        onChange={() => {}}
        valueText="10 %"
      />,
    );
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe(
      "10 %",
    );
  });

  it("the viewer's gap slider carries aria-valuetext too, the gap formatted in the language", async () => {
    await i18n.changeLanguage("en");
    render(<SpacetimePanel d={3} />);
    const gap = document.querySelector<HTMLInputElement>(
      ".spacetime__gap input[type=range]",
    )!;
    expect(gap).not.toBeNull();
    expect(gap.getAttribute("aria-valuetext")).toBe(
      GAP_DEFAULT.toLocaleString("en", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
    expect(gap.getAttribute("aria-valuetext")).toBe("1.75");
  });
});

/**
 * test_intent_desktop_two_columns_figure_fits
 *
 * INTENCIÓN: desde 1024 px los paneles de la rejilla, el paso a paso, el visor espacio-tiempo
 *   y el reto (en juego) son una cuadrícula de dos columnas, la figura a la izquierda y todo
 *   lo demás a la derecha, y la altura de cada figura está topada por la del viewport
 *   (`100dvh` menos `--nav-height`), de modo que al saltar a un panel la figura se ve entera
 *   bajo la barra (constante 3 rem = scroll-margin de nav.css + relleno del panel + 1 rem
 *   libre, leída de las dos hojas), topada además a 32 rem en las rejillas 2D y a 60 rem en el
 *   visor; la figura es pegajosa bajo la barra y la última fila `1fr` absorbe su altura. Cada
 *   regla cuelga directamente del bloque de 1024 px (anidada en otra consulta no aplicaría
 *   desde 1024). Por debajo de 1024 px ninguna de esas reglas existe: el móvil y la tableta
 *   conservan su maqueta de una columna.
 * CONTEXTO: 2026-10-18: los gráficos eran demasiado grandes y Espacio y tiempo
 *   no cabía en un monitor de PC (en móvil se veía mejor). Medido en Chrome: a 1440×900 y
 *   1920×1080 el visor medía 640×987 px (más alto que la ventana) dentro de un panel de
 *   1 695 px. El encaje real se mide en el navegador (docs/decisiones.md, «Maquetación de
 *   escritorio en dos columnas»); jsdom no maqueta, así que aquí se fija la regla, no el píxel.
 * EXPIRA SI: se decide otra maqueta de escritorio, o las figuras dejan de ser SVG
 *   con viewBox que escalan por altura.
 */
describe("test_intent_desktop_two_columns_figure_fits", () => {
  const DESKTOP = "@media (min-width: 1024px)";
  const rules = stylesheets().flatMap(({ file, css }) =>
    parseRules(css).map((r) => ({ ...r, file })),
  );
  // Desktop rules count only when the 1024 px block is their ONLY ancestor: a rule
  // nested in a further @media / @supports inside it would not apply from 1024 px
  // (a mutant with the cap under a nested 1200 px query left the viewer
  // 0 × 0 between 1024 and 1199 px).
  const at = (selector: string, desktop: boolean) =>
    rules.filter(
      (r) =>
        selectorsOf(r.selector).includes(selector) &&
        (desktop
          ? r.ancestors.length === 1 && r.ancestors[0] === DESKTOP
          : !r.ancestors.includes(DESKTOP)),
    );
  const rem = (value: string): number => {
    const m = /^([\d.]+)rem$/.exec(value);
    if (!m) throw new Error(`not a rem length: "${value}"`);
    return Number(m[1]);
  };
  // The breath under the bar: `.panel { scroll-margin-top }` in nav.css, outside any query.
  const scrollMargin = (): number => {
    const values = rules
      .filter(
        (r) =>
          r.file.endsWith("src/ui/nav/nav.css") &&
          r.selector === ".panel" &&
          r.ancestors.length === 0,
      )
      .flatMap((r) => r.declarations)
      .filter((d) => d.property === "scroll-margin-top")
      .map((d) => d.value);
    expect(values.length).toBe(1);
    return rem(values[0]!);
  };
  // The card's padding-top from 640 px (the `.panel` rule under the 640 px query).
  const panelPaddingTop = (): number => {
    const values = rules
      .filter(
        (r) =>
          r.file.endsWith("src/index.css") &&
          r.selector === ".panel" &&
          r.ancestors.length === 1 &&
          r.ancestors[0] === "@media (min-width: 640px)",
      )
      .flatMap((r) => r.declarations)
      .filter((d) => d.property === "padding")
      .map((d) => d.value);
    expect(values.length).toBe(1);
    return rem(values[0]!.split(" ")[0]!);
  };
  // 1 rem stays free under the panel's padding (src/index.css, desktop block comment).
  const SLACK_REM = 1;
  const CAP_2D_REM = 32;
  const CAP_VIEWER_REM = 60;
  const decl = (selector: string, property: string) =>
    at(selector, true)
      .flatMap((r) => r.declarations)
      .filter((d) => d.property === property)
      .map((d) => d.value);

  const PANELS = [
    ".panel--grid",
    ".panel--steps",
    ".panel--spacetime",
    '.panel--challenge:not([data-phase="idle"])',
  ];
  const FIGURES = [
    ".panel--grid > svg.grid",
    ".panel--steps > svg.grid",
    ".panel--spacetime > svg.spacetime__svg",
    ".panel--challenge > .challenge__figure",
  ];
  const SVGS = [
    ".panel--grid > svg.grid",
    ".panel--steps > svg.grid",
    ".panel--spacetime > svg.spacetime__svg",
    ".panel--challenge > .challenge__figure > svg.grid",
  ];

  it("≥ 1024 px: each of the four panels is a two-column grid, its children in the right column", () => {
    for (const panel of PANELS) {
      expect(decl(panel, "display"), panel).toContain("grid");
      const columns = decl(panel, "grid-template-columns");
      expect(columns.length, panel).toBe(1);
      // Two tracks: the figure's, then the text's.
      expect(columns[0]!.match(/minmax\(/g)?.length, panel).toBe(2);
      expect(decl(`${panel} > *`, "grid-column"), panel).toContain("2");
      // 24 auto rows for the right-hand items, then a 1fr one that takes the
      // figure's height (without it the items spread 486–779 px apart).
      expect(decl(panel, "grid-template-rows"), panel).toEqual([
        "repeat(24, auto) 1fr",
      ]);
    }
  });

  it("≥ 1024 px: each figure is sticky under the bar, at the same breath the panel lands at", () => {
    const top = `calc(var(--nav-height) + ${scrollMargin()}rem)`;
    for (const figure of FIGURES) {
      expect(decl(figure, "position"), figure).toEqual(["sticky"]);
      expect(decl(figure, "top"), figure).toEqual([top]);
    }
  });

  it("≥ 1024 px: each figure sits in the left column across every row, and its height is capped by the viewport under the bar", () => {
    for (const figure of FIGURES) {
      expect(decl(figure, "grid-column"), figure).toContain("1");
      expect(decl(figure, "grid-row"), figure).toContain("1 / -1");
    }
    // The constant is the sum it encodes, read from the two sheets: landing
    // breath (nav.css scroll-margin) + card padding + free slack. A drift in
    // either file, or a hand-edited constant (0rem overflowed the window),
    // fails here.
    const constant = scrollMargin() + panelPaddingTop() + SLACK_REM;
    const viewport = `calc(100dvh - var(--nav-height) - ${constant}rem)`;
    for (const svg of SVGS) {
      const cap =
        svg === ".panel--spacetime > svg.spacetime__svg"
          ? CAP_VIEWER_REM
          : CAP_2D_REM;
      expect(decl(svg, "height"), svg).toEqual([`min(${cap}rem, ${viewport})`]);
      expect(decl(svg, "width"), svg).toContain("auto");
      expect(decl(svg, "max-width"), svg).toContain("100%");
    }
  });

  it("below 1024 px none of it exists: no two-column grid nor viewport cap on these panels outside the desktop block", () => {
    for (const selector of [...PANELS, ...FIGURES, ...SVGS]) {
      for (const rule of at(selector, false)) {
        const props = rule.declarations.map((d) => d.property);
        expect(props, `${rule.file}: ${selector}`).not.toContain(
          "grid-template-columns",
        );
        expect(
          rule.declarations.some((d) => d.value.includes("100dvh")),
          `${rule.file}: ${selector}`,
        ).toBe(false);
      }
    }
  });

  it("the challenge's figure carries the class the stylesheet places", () => {
    const source = readFileSync(
      join(ROOT, "src/ui/challenge/ChallengePanel.tsx"),
      "utf8",
    );
    expect(source).toMatch(/ref=\{gridHost\} className="challenge__figure"/);
  });
});
