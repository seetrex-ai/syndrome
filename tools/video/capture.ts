// Capture (tasks/plans/video.md D3–D6, D11): one PNG per STATE under a
// settling protocol that makes the frames byte-identical across runs (M6:
// 36/40 without it, 40/40 with it). Per scene a fresh BrowserContext with the
// language, the model, the theme and the viewer's look fixed in localStorage
// before the app runs, Math.random constant (every seed of the UI is the
// scene's), no Worker (the chart draws its validated base only) and the
// service worker blocked. Buttons are hidden by the camera and pressed with
// dispatchEvent("click"), located by their accessible name from the app's own
// i18n strings. Every console error or page error, from the first byte of the
// app on, fails the variant unless --allow-console-errors; the final state of
// each scene must show every HOOKS[panel].shown hook.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { expectedFrames, listText } from "./encode";
import {
  hiddenCss,
  HOOKS,
  LAYOUT_ATTRIBUTE,
  SHOWN_ATTRIBUTE,
  STEP_ATTRIBUTE,
  type Panel,
} from "./hooks";
import { t, type Lang } from "./i18n";
import {
  SITE_URL,
  statesOf,
  totalSeconds,
  type CardScene,
  type ChartScene,
  type Format,
  type Scene,
  type StepsScene,
  type ViewerScene,
} from "./scenes";
import { APP_BASE } from "../../edge/paths";
import { DEFAULT_ORIGIN, routeDist, type DistInfo } from "./serve";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CAMERA_CSS = readFileSync(join(HERE, "camera.css"), "utf8");
const CARD_HTML = readFileSync(join(HERE, "card.html"), "utf8");
/** The app's display face (public/fonts), inlined into the card: setContent has no origin. */
export const CARD_FONT_PATH = join(
  HERE,
  "..",
  "..",
  "public",
  "fonts",
  "space-grotesk-var.woff2",
);
let cardFont: string | undefined;
const cardFontDataUrl = (): string =>
  (cardFont ??= `data:font/woff2;base64,${readFileSync(CARD_FONT_PATH).toString("base64")}`);

/** CSS pixels of the viewport per format (D7); the output is twice that. */
export const VIEWPORTS: Readonly<
  Record<Format, { readonly width: number; readonly height: number }>
> = {
  landscape: { width: 960, height: 540 },
  portrait: { width: 540, height: 960 },
};
export const DEVICE_SCALE_FACTOR = 2;

/** The app's localStorage keys (tests/intent/video-hooks.test.tsx pins them to the app's constants). */
export const STORAGE_KEYS = {
  language: "syndrome.language",
  model: "syndrome.model",
  theme: "syndrome.theme",
  view: "syndrome.spacetime.view",
  gap: "syndrome.spacetime.gap",
} as const;

export interface InitOptions {
  readonly lang: Lang;
  readonly model: string;
  readonly seed2d: number;
  readonly view: number;
  readonly gap: number;
}

/** The script run before the app on every page (D4/D5). */
export function initScript(o: InitOptions): string {
  const entries: readonly [string, string][] = [
    [STORAGE_KEYS.language, o.lang],
    [STORAGE_KEYS.model, o.model],
    [STORAGE_KEYS.theme, "light"],
    [STORAGE_KEYS.view, String(o.view)],
    [STORAGE_KEYS.gap, String(o.gap)],
  ];
  const sets = entries
    .map(
      ([k, v]) =>
        `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`,
    )
    .join("\n    ");
  return [
    "(() => {",
    "  try {",
    `    ${sets}`,
    "  } catch (e) {}",
    `  Math.random = () => ${o.seed2d} / 2 ** 53;`,
    "  delete window.Worker;",
    '  if (typeof window.Worker !== "undefined") window.Worker = undefined;',
    "})();",
  ].join("\n");
}

/** fonts.ready, then two animation frames: the frame is painted and still (D4, M6). */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.fonts.ready.then(
      () =>
        new Promise<void>((resolve) => {
          // Two frames after layout, a pause for the compositor to finish
          // rasterising a layer a click just created (measured 2026-10-18:
          // with two frames alone the "correction" state of the 2D scene
          // differed by a few anti-aliased pixels in 1 of 6 captures), and
          // one more frame.
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              setTimeout(() => requestAnimationFrame(() => resolve()), 150),
            ),
          );
        }),
    ),
  );
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The card page of a CardScene in `lang`, texts from the app's locale. */
export function cardHtml(scene: CardScene, lang: Lang): string {
  const [line1 = "", line2 = ""] = scene.lines.map((key) => t(lang, key));
  const url = scene.url ? SITE_URL.replace(/^https?:\/\//, "") : "";
  return CARD_HTML.replace("{{lang}}", lang)
    .replace("{{font}}", cardFontDataUrl())
    .replace("{{line1}}", escapeHtml(line1))
    .replace("{{line2}}", escapeHtml(line2))
    .replace("{{url}}", escapeHtml(url));
}

export interface FrameRecord {
  readonly index: number;
  readonly scene: string;
  readonly label: string;
  readonly seconds: number;
  readonly file: string;
  readonly sha256: string;
}

export interface Manifest {
  readonly lang: Lang;
  readonly format: Format;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly browser: { readonly channel: string; readonly version: string };
  readonly ffmpeg: string | null;
  readonly dist: DistInfo;
  readonly totalSeconds: number;
  readonly expectedFrames: number;
  readonly frames: readonly FrameRecord[];
  readonly consoleErrors: readonly string[];
  readonly createdAt: string;
}

export interface CaptureOptions {
  readonly fps: number;
  readonly distDir: string;
  readonly dist: DistInfo;
  readonly browser: { readonly channel: string; readonly version: string };
  readonly ffmpeg: string | null;
  readonly origin?: string;
  /** Smoke test only: a smaller viewport and scale. */
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor?: number;
  /** Record console errors and page errors in the manifest instead of failing the variant. */
  readonly allowConsoleErrors?: boolean;
}

class Shooter {
  private readonly page: Page;
  private readonly framesDir: string;
  private readonly scene: string;
  /** Shared across scenes: frames are numbered through the whole variant. */
  readonly frames: FrameRecord[];

  constructor(
    page: Page,
    framesDir: string,
    scene: string,
    frames: FrameRecord[],
  ) {
    this.page = page;
    this.framesDir = framesDir;
    this.scene = scene;
    this.frames = frames;
  }

  async shoot(label: string, seconds: number): Promise<void> {
    await settle(this.page);
    const png = await this.page.screenshot({ type: "png" });
    const index = this.frames.length + 1;
    const name = `${String(index).padStart(4, "0")}.png`;
    writeFileSync(join(this.framesDir, name), png);
    this.frames.push({
      index,
      scene: this.scene,
      label,
      seconds,
      file: `frames/${name}`,
      sha256: createHash("sha256").update(png).digest("hex"),
    });
  }
}

const button = (page: Page, root: string, lang: Lang, key: string) =>
  page.locator(root).getByRole("button", {
    name: t(lang, key),
    exact: true,
    includeHidden: true,
  });

/** Set a React-controlled range input: the native setter, then the input and change events. */
async function setRange(
  page: Page,
  selector: string,
  value: number,
): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (setter === undefined)
      throw new Error("no value setter on HTMLInputElement");
    setter.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

function fail(scene: string, message: string): never {
  throw new Error(`scene ${scene}: ${message}`);
}

async function count(page: Page, selector: string): Promise<number> {
  return page.locator(selector).count();
}

/** The final state of a scene shows everything the camera keeps (HOOKS[panel].shown). */
async function assertShown(
  page: Page,
  panel: Panel,
  scene: string,
): Promise<void> {
  const { root, shown } = HOOKS[panel];
  const missing: string[] = [];
  for (const selector of shown) {
    if ((await count(page, `${root} ${selector}`)) === 0)
      missing.push(selector);
  }
  if (missing.length > 0) {
    fail(scene, `the final state lacks ${missing.join(", ")}`);
  }
}

async function runActions(
  page: Page,
  shooter: Shooter,
  scene: StepsScene | ViewerScene,
  lang: Lang,
): Promise<void> {
  const root = HOOKS[scene.panel].root;
  for (const action of scene.actions) {
    if (action.kind === "hold") {
      const step = await page.locator(root).getAttribute(STEP_ATTRIBUTE);
      await shooter.shoot(`step ${step}`, action.seconds);
    } else if (action.kind === "next") {
      const k = Number(await page.locator(root).getAttribute(STEP_ATTRIBUTE));
      await button(page, root, lang, `${scene.panel}.next`).dispatchEvent(
        "click",
      );
      await page.waitForSelector(`${root}[${STEP_ATTRIBUTE}="${k + 1}"]`, {
        state: "attached",
      });
    } else {
      await setRange(page, `${root} .spacetime__gap input`, action.value);
      await page.waitForSelector(`${root}[data-gap="${action.value}"]`, {
        state: "attached",
      });
      const step = await page.locator(root).getAttribute(STEP_ATTRIBUTE);
      await shooter.shoot(`step ${step} gap ${action.value}`, action.seconds);
    }
  }
}

async function loadPanel(
  context: BrowserContext,
  scene: StepsScene | ViewerScene | ChartScene,
  lang: Lang,
  format: Format,
  o: CaptureOptions,
): Promise<Page> {
  const origin = o.origin ?? DEFAULT_ORIGIN;
  const panel: Panel = scene.panel;
  await context.addInitScript(
    initScript({
      lang,
      model: scene.panel === "chart" ? scene.model : "independent",
      seed2d: scene.panel === "steps" ? scene.seed2d : 1,
      view: scene.panel === "spacetime" ? scene.view : 0,
      gap: scene.panel === "spacetime" ? scene.gap : 1.75,
    }),
  );
  await routeDist(context, o.distDir, origin);
  const page = await context.newPage();
  const hash =
    scene.panel === "spacetime" && "link" in scene.shot ? scene.shot.link : "";
  await page.goto(`${origin}${APP_BASE}${hash}`, { waitUntil: "load" });
  // The chart and the viewer are lazy and their Suspense fallbacks render the
  // same `section.panel--…`: wait for a hook only the real panel has and mark
  // THAT panel (the skeleton, marked, would be replaced by a hidden panel).
  const { root, ready } = HOOKS[panel];
  await page.waitForSelector(`${root} ${ready}`, { state: "attached" });
  await page.evaluate(
    ([
      rootSelector,
      readySelector,
      shownAttribute,
      layoutAttribute,
      layout,
    ]) => {
      document.documentElement.setAttribute(layoutAttribute!, layout!);
      const section = document
        .querySelector(`${rootSelector} ${readySelector}`)
        ?.closest(rootSelector!);
      if (section === null || section === undefined) {
        throw new Error(`no ${rootSelector} around ${readySelector}`);
      }
      section.setAttribute(shownAttribute!, "1");
    },
    [root, ready, SHOWN_ATTRIBUTE, LAYOUT_ATTRIBUTE, format] as const,
  );
  await page.addStyleTag({ content: `${CAMERA_CSS}\n${hiddenCss(panel)}` });
  return page;
}

async function captureSteps(
  page: Page,
  shooter: Shooter,
  scene: StepsScene,
  lang: Lang,
): Promise<void> {
  const root = HOOKS.steps.root;
  await runActions(page, shooter, scene, lang);
  await assertShown(page, "steps", scene.id);
  // On the last step every layer is drawn: the DOM must agree with the core.
  const w = await count(page, `${root} [data-qubit]:not([data-pauli="I"])`);
  if (w !== scene.expect.weight) {
    fail(
      scene.id,
      `the grid shows ${w} errors, the scene expects ${scene.expect.weight}`,
    );
  }
  const verdict = await page
    .locator(`${root} .steps__verdict`)
    .getAttribute("data-verdict");
  if (verdict !== String(scene.expect.verdict)) {
    fail(
      scene.id,
      `verdict ${verdict}, the scene expects ${scene.expect.verdict}`,
    );
  }
}

async function captureViewer(
  page: Page,
  shooter: Shooter,
  scene: ViewerScene,
  lang: Lang,
): Promise<void> {
  const root = HOOKS.spacetime.root;
  if ("preset" in scene.shot) {
    await page
      .locator(`${root} [data-preset="${scene.shot.preset}"]`)
      .dispatchEvent("click");
    await page.waitForSelector(
      `${root}[data-from-link="0"][${STEP_ATTRIBUTE}="0"]`,
      {
        state: "attached",
      },
    );
    if (scene.shot.preset === "both") {
      // The preset with both mechanisms: exactly one new data error and one
      // measurement failure in the whole history (spacetime-trace.presetHistory).
      const fresh = await count(
        page,
        `${root} [data-overlay] [data-qubit][data-new="1"]`,
      );
      const flips = await count(page, `${root} [data-overlay] [data-flip="1"]`);
      if (fresh !== 1 || flips !== 1) {
        fail(
          scene.id,
          `preset both shows ${fresh} new error(s) and ${flips} flip(s), expected 1 and 1`,
        );
      }
    }
  } else {
    await page.waitForSelector(`${root}[data-from-link="1"]`, {
      state: "attached",
    });
  }
  const gap = await page.locator(root).getAttribute("data-gap");
  if (gap !== String(scene.gap))
    fail(scene.id, `gap ${gap} at load, expected ${scene.gap}`);
  const d = await page.locator(root).getAttribute("data-distance");
  if (d !== String(scene.d))
    fail(scene.id, `distance ${d}, expected ${scene.d}`);
  await runActions(page, shooter, scene, lang);
  await assertShown(page, "spacetime", scene.id);
}

async function captureChart(
  page: Page,
  shooter: Shooter,
  scene: ChartScene,
  lang: Lang,
): Promise<void> {
  const root = HOOKS.chart.root;
  const status = page.locator(`${root} .chart__status`);
  await status.waitFor({ state: "attached" });
  // No Worker: the chart draws the validated base only (D5). Anything else
  // would refine live and the frames would not be reproducible.
  await page.waitForFunction(
    ([selector, text]) =>
      document.querySelector(selector!)?.textContent === text,
    [`${root} .chart__status`, t(lang, "chart.unavailable")] as const,
  );
  const model = await page
    .locator(`${root} .chart__model`)
    .getAttribute("data-model");
  if (model !== scene.model)
    fail(scene.id, `the chart shows ${model}, expected ${scene.model}`);
  await assertShown(page, "chart", scene.id);
  await shooter.shoot(scene.model, scene.seconds);
}

/** Capture every scene of one (lang, format) variant into `variantDir`: frames/, list.txt, manifest.json. */
export async function captureVariant(
  browser: Browser,
  scenes: readonly Scene[],
  lang: Lang,
  format: Format,
  variantDir: string,
  o: CaptureOptions,
): Promise<Manifest> {
  const framesDir = join(variantDir, "frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const viewport = o.viewport ?? VIEWPORTS[format];
  const scale = o.deviceScaleFactor ?? DEVICE_SCALE_FACTOR;
  const frames: FrameRecord[] = [];
  const consoleErrors: string[] = [];
  for (const scene of scenes) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      colorScheme: "light",
      reducedMotion: "reduce",
      locale: lang === "es" ? "es-ES" : "en-US",
      serviceWorkers: "block",
    });
    // Listeners on the context, before any page exists: an error thrown while
    // the app loads is seen too (a page listener added after goto misses it).
    context.on("weberror", (e) =>
      consoleErrors.push(`${scene.id}: ${e.error().message}`),
    );
    context.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`${scene.id}: ${m.text()}`);
    });
    try {
      let page: Page;
      if (scene.panel === "card") {
        page = await context.newPage();
        await page.setContent(cardHtml(scene, lang), { waitUntil: "load" });
      } else {
        page = await loadPanel(context, scene, lang, format, o);
      }
      const shooter = new Shooter(page, framesDir, scene.id, frames);
      if (scene.panel === "card") await shooter.shoot("card", scene.seconds);
      else if (scene.panel === "steps")
        await captureSteps(page, shooter, scene, lang);
      else if (scene.panel === "spacetime")
        await captureViewer(page, shooter, scene, lang);
      else await captureChart(page, shooter, scene, lang);
    } finally {
      await context.close();
    }
  }
  if (consoleErrors.length > 0 && o.allowConsoleErrors !== true) {
    throw new Error(
      `${consoleErrors.length} console/page error(s) during ${lang}-${format} (--allow-console-errors records them instead):\n  ${consoleErrors.join("\n  ")}`,
    );
  }
  const states = scenes.reduce((n, s) => n + statesOf(s).length, 0);
  if (frames.length !== states) {
    throw new Error(
      `${frames.length} frames captured, the scenes have ${states} states`,
    );
  }
  const expected = expectedFrames(frames, o.fps);
  const manifest: Manifest = {
    lang,
    format,
    width: viewport.width * scale,
    height: viewport.height * scale,
    fps: o.fps,
    browser: o.browser,
    ffmpeg: o.ffmpeg,
    dist: o.dist,
    totalSeconds: totalSeconds(scenes),
    expectedFrames: expected,
    frames,
    consoleErrors,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(variantDir, "list.txt"), listText(frames));
  writeFileSync(
    join(variantDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}
