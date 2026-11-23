// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import { VIEWER_LAST_STEP } from "../../src/ui/spacetime/viewer-steps";
import { LAST_STEP } from "../../src/ui/steps/step-machine";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CAMERA_CSS,
  CARD_FONT_PATH,
  cardHtml,
} from "../../tools/video/capture";
import {
  HOOKS,
  LAYOUT_ATTRIBUTE,
  PANELS,
  SHOWN_ATTRIBUTE,
  type Panel,
} from "../../tools/video/hooks";
import { t } from "../../tools/video/i18n";
import { SCENES } from "../../tools/video/scenes";

const ROOT = process.cwd();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute(LAYOUT_ATTRIBUTE);
});

/**
 * Every selector of a stylesheet, one per entry of each selector list, with the
 * bodies of `@media` / `@supports` blocks walked and comments dropped. The
 * sheets under test use no `:is(a, b)`; a selector that does not parse makes
 * `querySelector` throw, which fails the test loudly.
 */
export function selectorsOf(css: string): string[] {
  const found: string[] = [];
  const walk = (text: string): void => {
    let rest = text;
    for (;;) {
      const open = rest.indexOf("{");
      if (open < 0) break;
      const prelude = rest.slice(0, open).trim();
      let depth = 0;
      let close = -1;
      for (let i = open; i < rest.length; i++) {
        if (rest[i] === "{") depth++;
        else if (rest[i] === "}" && --depth === 0) {
          close = i;
          break;
        }
      }
      if (close < 0) throw new Error("unbalanced braces in the stylesheet");
      const body = rest.slice(open + 1, close);
      if (prelude.startsWith("@")) walk(body);
      else {
        found.push(
          ...prelude
            .split(",")
            .map((s) => s.replace(/\s+/g, " ").trim())
            .filter((s) => s !== ""),
        );
      }
      rest = rest.slice(close + 1);
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return found;
}

/** The selector without pseudo-classes and pseudo-elements: what must EXIST in the DOM. */
export const structural = (selector: string): string =>
  selector
    .replace(/::?[a-z-]+(\([^)]*\))?/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The panel a camera selector targets, by the class prefix it names; `undefined` = every panel. */
const PANEL_MARKS: Readonly<Record<Panel, readonly string[]>> = {
  steps: ["steps__", "svg.grid"],
  spacetime: ["spacetime__"],
  chart: ["chart"],
};
export function panelOf(selector: string): Panel | undefined {
  const panels = PANELS.filter((panel) =>
    PANEL_MARKS[panel].some((mark) => selector.includes(mark)),
  );
  if (panels.length > 1) {
    throw new Error(`${selector} names more than one panel: ${panels.join()}`);
  }
  return panels[0];
}

const layoutOf = (selector: string): string | undefined =>
  /data-video-layout="(landscape|portrait)"/.exec(selector)?.[1];

const press = (root: Element, text: string): void => {
  const button = [...root.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  if (button === undefined) throw new Error(`button "${text}" not rendered`);
  fireEvent.click(button);
};

/**
 * test_intent_video_camera_selectors_resolve
 *
 * INTENCIÓN: cada selector de `tools/video/camera.css` (listas separadas, bloques `@media`
 *   recorridos, pseudoclases y pseudoelementos quitados) resuelve en el DOM renderizado de la
 *   app sobre el último paso de cada recorrido, con el panel que nombra marcado
 *   `data-video-shown` y `<html>` en el `data-video-layout` que el selector nombra (o en los
 *   dos si no nombra ninguno). Un selector que nombra un panel (`steps__`/`svg.grid`,
 *   `spacetime__`, `chart`) debe resolver en ESE panel; uno que no nombra ninguno (`.app`,
 *   `.panel[data-video-shown] > h2`, `html`, `body`) debe resolver con cada uno de los tres
 *   marcado. Las dos constantes del script (`data-video-shown`, `data-video-layout`) aparecen
 *   en la hoja. La tarjeta (`card.html`) no recibe `camera.css` (capture.ts la carga con
 *   `setContent` y sin `addStyleTag`): su propia hoja se comprueba contra su propio DOM.
 * CONTEXTO: `test_intent_video_hooks_exist` cubre `HOOKS`, pero la cámara nombra clases que
 *   ningún gancho pinza (`figure.chart`, `.app`, `.panel > h2`, `svg.grid`, …): renombrar
 *   `className="chart"` dejaba la suite verde y `npm run video` con exit 0 sobre un fotograma
 *   roto (gráfica recortada, título ausente); observado el 2026-10-18.
 * EXPIRA SI: el vídeo deja de depender del DOM o la cámara deja de ser una hoja de estilos.
 */
describe("test_intent_video_camera_selectors_resolve", () => {
  const steps = SCENES.find((s) => s.panel === "steps");
  if (steps === undefined || steps.panel !== "steps") {
    throw new Error("the scenes have no steps2d scene");
  }

  it("selectorsOf splits lists, walks @media and drops comments; structural strips pseudos", () => {
    const css =
      "/* c */ a, b > c { x: 1 } @media (min-width: 1px) { d::before, e:not([f]) { y: 2 } }";
    expect(selectorsOf(css)).toEqual(["a", "b > c", "d::before", "e:not([f])"]);
    expect(structural("e:not([f])")).toBe("e");
    expect(structural("*::before")).toBe("*");
    expect(structural(".url:empty")).toBe(".url");
    expect(panelOf(".panel[data-video-shown] figure.chart")).toBe("chart");
    expect(panelOf('html[data-video-layout="portrait"] .panel svg.grid')).toBe(
      "steps",
    );
    expect(panelOf(".panel[data-video-shown] > h2")).toBeUndefined();
    expect(layoutOf('html[data-video-layout="portrait"] .panel')).toBe(
      "portrait",
    );
  });

  it("every camera.css selector resolves in the panel and the layout it targets", async () => {
    expect(CAMERA_CSS).toContain(`[${SHOWN_ATTRIBUTE}]`);
    expect(CAMERA_CSS).toContain(`[${LAYOUT_ATTRIBUTE}=`);
    const selectors = selectorsOf(CAMERA_CSS);
    expect(selectors.length).toBeGreaterThan(20);

    await i18n.changeLanguage("en");
    vi.spyOn(Math, "random").mockReturnValue(steps.seed2d / 2 ** 53);
    const { container } = render(<App createWorker={() => null} />);
    for (const panel of PANELS) {
      await waitFor(() => {
        expect(
          container.querySelector(`${HOOKS[panel].root} ${HOOKS[panel].ready}`),
          panel,
        ).not.toBeNull();
      });
    }
    const viewer = container.querySelector(HOOKS.spacetime.root)!;
    press(viewer, t("en", "spacetime.preset.both"));
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      press(viewer, t("en", "spacetime.next"));
    const walkthrough = container.querySelector(HOOKS.steps.root)!;
    for (let i = 0; i < LAST_STEP; i++)
      press(walkthrough, t("en", "steps.next"));
    await waitFor(() => {
      expect(
        container.querySelector(`${HOOKS.chart.root} .chart__status`)
          ?.textContent,
      ).toBe(t("en", "chart.unavailable"));
    });

    const missing: string[] = [];
    for (const panel of PANELS) {
      for (const section of container.querySelectorAll(".panel"))
        section.removeAttribute(SHOWN_ATTRIBUTE);
      container
        .querySelector(HOOKS[panel].root)!
        .setAttribute(SHOWN_ATTRIBUTE, "1");
      for (const layout of ["landscape", "portrait"]) {
        document.documentElement.setAttribute(LAYOUT_ATTRIBUTE, layout);
        for (const selector of selectors) {
          const target = panelOf(selector);
          if (target !== undefined && target !== panel) continue;
          const wanted = layoutOf(selector);
          if (wanted !== undefined && wanted !== layout) continue;
          if (document.querySelector(structural(selector)) === null) {
            missing.push(`${selector} (panel ${panel}, ${layout})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The card is the app's light theme (it was once plain
   * white, #212529 and a green URL in the system font): every colour literal
   * of card.html is the LIGHT side of a token of src/index.css, its background
   * is the paper (--bg; white since the decision of 2026-10-20: the old "never
   * #ffffff" rule guarded the warm paper and went with it), the titles name the display face and
   * cardHtml inlines the app's own woff2 as a data URL (setContent has no
   * origin to fetch /fonts from).
   */
  it("card.html paints only with light token sides on the paper, titles in the app's display face, inlined by cardHtml", () => {
    const raw = readFileSync(join(ROOT, "tools", "video", "card.html"), "utf8");
    const index = readFileSync(join(ROOT, "src", "index.css"), "utf8");
    const light = new Set(
      [...index.matchAll(/light-dark\((#[0-9a-f]{6}),\s*#[0-9a-f]{6}\)/gi)].map(
        (m) => m[1]!.toLowerCase(),
      ),
    );
    const bg = /light-dark\((#[0-9a-f]{6}),/i
      .exec(/--bg:[^;]+/.exec(index)![0])![1]!
      .toLowerCase();
    const colours = [...raw.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) =>
      m[0].toLowerCase(),
    );
    expect(colours.length).toBeGreaterThan(2);
    expect(colours.filter((c) => !light.has(c))).toEqual([]);
    expect(/background:\s*(#[0-9a-f]{6})/i.exec(raw)?.[1]?.toLowerCase()).toBe(
      bg,
    );
    // The page's text is the ink (--fg), never white on the white paper
    // (checked when the paper turned white).
    const fg = /light-dark\((#[0-9a-f]{6}),/i
      .exec(/--fg:[^;]+/.exec(index)![0])![1]!
      .toLowerCase();
    expect(
      /body\s*\{[^}]*?\scolor:\s*(#[0-9a-f]{6})/i.exec(raw)?.[1]?.toLowerCase(),
    ).toBe(fg);
    expect(raw).toMatch(/\.line1\s*\{[^}]*font-family:\s*"Space Grotesk"/);
    expect(raw).toMatch(/@font-face\s*\{[^}]*src:\s*url\("\{\{font\}\}"\)/);
    const outro = SCENES.find((s) => s.id === "outro")!;
    if (outro.panel !== "card") throw new Error("no outro card");
    const html = cardHtml(outro, "es");
    expect(html).toContain('src: url("data:font/woff2;base64,');
    expect(html).not.toContain("{{");
    expect(statSync(CARD_FONT_PATH).size).toBeLessThanOrEqual(80_000);
  });

  it("every selector of card.html's own stylesheet resolves in the card's DOM", () => {
    const outro = SCENES.find((s) => s.id === "outro")!;
    if (outro.panel !== "card") throw new Error("no outro card");
    const doc = new DOMParser().parseFromString(
      cardHtml(outro, "en"),
      "text/html",
    );
    const css = [...doc.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n");
    const selectors = selectorsOf(css);
    expect(selectors.length).toBeGreaterThan(4);
    const missing = selectors.filter(
      (s) => doc.querySelector(structural(s)) === null,
    );
    expect(missing).toEqual([]);
  });
});
