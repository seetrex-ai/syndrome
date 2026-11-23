import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRules, stylesheets } from "./css-rules";

/**
 * test_intent_fonts_self_hosted
 *
 * INTENCIÓN: la tipografía de la interfaz es propia y cabe en el presupuesto
 *   (tasks/plans/design.md D3, T-D4): cada `url()` de un `@font-face` en `src/**\/*.css`
 *   apunta a un `/fonts/*.woff2` que existe en `public/fonts/`, sólo woff2; la suma de
 *   `public/fonts/*.woff2` es ≤ 80 000 B; cada `@font-face` declara `font-display: swap`
 *   (el texto se lee antes de que llegue la fuente); `index.html` precarga cada woff2
 *   (`rel="preload" as="font" type="font/woff2" crossorigin`); `vite.config.ts` incluye
 *   `woff2` en los `globPatterns` del service worker (y tests/intent/pwa-precache mide que
 *   el `sw.js` del build precachea cada uno); ninguna hoja ni `index.html` ni `src/` cargan
 *   nada de `fonts.googleapis.com` / `fonts.gstatic.com` ni ninguna URL externa de fuente;
 *   `public/fonts/` lleva la licencia (OFL).
 * CONTEXTO: PWA sin conexión (phase2.md D14) y el presupuesto de carga de docs/spec.md §7:
 *   una fuente de Google es una petición a un tercero, invisible en los tests de tamaño y
 *   muerta sin red; un woff2 sin precarga llega tarde y cambia la pantalla (CLS).
 * EXPIRA SI: se vuelve a la pila del sistema (entonces no hay `@font-face` que vigilar).
 */

const ROOT = process.cwd();
const FONTS_DIR = join(ROOT, "public", "fonts");
const FONTS_BUDGET_BYTES = 80_000;
const EXTERNAL_FONT_HOST =
  /fonts\.(googleapis|gstatic)\.com|https?:\/\/[^"')\s]+\.(woff2?|ttf|otf)\b/i;

interface FontFace {
  readonly file: string;
  readonly urls: string[];
  readonly display: string | undefined;
}

function fontFaces(): FontFace[] {
  const faces: FontFace[] = [];
  for (const { file, css } of stylesheets()) {
    for (const rule of parseRules(css)) {
      if (rule.selector !== "@font-face") continue;
      const src = rule.declarations.find((d) => d.property === "src");
      const urls = src
        ? [...src.value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(
            (m) => m[1]!,
          )
        : [];
      faces.push({
        file,
        urls,
        display: rule.declarations.find((d) => d.property === "font-display")
          ?.value,
      });
    }
  }
  return faces;
}

describe("test_intent_fonts_self_hosted", () => {
  const faces = fontFaces();
  const woff2 = readdirSync(FONTS_DIR).filter((f) => f.endsWith(".woff2"));
  const html = readFileSync(join(ROOT, "index.html"), "utf8");

  it("there is a @font-face to guard, and every url() is a /fonts/*.woff2 that exists", () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face.urls.length, `${face.file}: src url()`).toBeGreaterThan(0);
      for (const url of face.urls) {
        expect(url, `${face.file}: ${url}`).toMatch(/^\/fonts\/[^/]+\.woff2$/);
        expect(existsSync(join(ROOT, "public", url)), `${url} in public/`).toBe(
          true,
        );
      }
    }
  });

  it("every @font-face declares font-display: swap", () => {
    for (const face of faces) {
      expect(face.display, `${face.file}: font-display`).toBe("swap");
    }
  });

  it(`public/fonts/*.woff2 weigh ≤ ${FONTS_BUDGET_BYTES} B together, with the licence beside them`, () => {
    expect(woff2.length).toBeGreaterThan(0);
    const total = woff2.reduce(
      (sum, f) => sum + statSync(join(FONTS_DIR, f)).size,
      0,
    );
    console.info(`[fonts] ${woff2.join(", ")}: ${total} B`);
    expect(total).toBeLessThanOrEqual(FONTS_BUDGET_BYTES);
    expect(
      readdirSync(FONTS_DIR).some((f) => /^OFL.*\.txt$/.test(f)),
      "an OFL licence file in public/fonts/",
    ).toBe(true);
  });

  it("index.html preloads each woff2 as a font, crossorigin", () => {
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
    for (const font of woff2) {
      const preload = links.find(
        (l) => /rel="preload"/.test(l) && l.includes(`href="/fonts/${font}"`),
      );
      expect(preload, `preload of /fonts/${font}`).toBeDefined();
      expect(preload).toMatch(/as="font"/);
      expect(preload).toMatch(/type="font\/woff2"/);
      expect(preload).toMatch(/\bcrossorigin\b/);
    }
  });

  it("vite.config.ts precaches woff2 (globPatterns; pwa-precache measures the sw.js)", () => {
    const config = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    const glob = config.match(/globPatterns:\s*\[([^\]]*)\]/);
    expect(glob, "workbox.globPatterns").not.toBeNull();
    expect(glob![1]).toMatch(/\bwoff2\b/);
  });

  it("no stylesheet, index.html or src file loads a font from Google Fonts or any external URL", () => {
    const offenders: string[] = [];
    if (EXTERNAL_FONT_HOST.test(html)) offenders.push("index.html");
    for (const { file, css } of stylesheets()) {
      if (EXTERNAL_FONT_HOST.test(css)) offenders.push(file);
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    for (const file of walk(join(ROOT, "src"))) {
      if (!/\.(tsx?|css|json|html)$/.test(file)) continue;
      if (EXTERNAL_FONT_HOST.test(readFileSync(file, "utf8")))
        offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
