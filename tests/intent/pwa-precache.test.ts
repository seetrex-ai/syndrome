import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FORM_PATHS } from "../../src/analytics/forms";
import { buildWithEnv } from "../helpers/build-with-env";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * test_intent_pwa_precaches_every_asset
 *
 * INTENCIÓN: tras la primera visita, la app entera funciona sin red (docs/spec.md §4 fase 2,
 *   punto 8; tasks/plans/phase2.md D14): el service worker que genera `vite-plugin-pwa`
 *   existe en `dist/sw.js` y su lista de precaché contiene TODOS los `assets/*.js|css` del
 *   build (los chunks diferidos de la gráfica y del visor, el Worker de simulación, las
 *   hojas), más `index.html` y el manifiesto; el `manifest.webmanifest` lleva iconos de
 *   192 y 512 y `start_url`. Se mide sobre un `vite.build()` de producción a un directorio
 *   temporal, como `test_intent_bundle_budget`. Desde el 2026-10-19 (docs/decisiones.md) la
 *   app vive en https://seequant.app/syndrome/: `id`, `start_url`, `scope`, iconos, registro
 *   del SW, fallback de navegación y toda URL de `index.html` y de las hojas quedan bajo
 *   `/syndrome/` (H5: Vite antepone `base` a las rutas públicas absolutas del fuente), porque
 *   el resto del origen es de la web de marca. Límite del escaneo estático de cadenas de los
 *   `.js` (`assets/*.js`, `sw.js`, `workbox-*.js`): sólo ve el texto fijo de cada literal, así
 *   que una plantilla cuyo PRIMER segmento es variable (`/${x}.json`, `` `${base}/a` ``) o una
 *   URL armada por concatenación en tiempo de ejecución no se detecta; para eso no hay más
 *   prueba que el navegador.
 * CONTEXTO: un `globPatterns` sin `js` o un Worker que Vite emitiera fuera de `assets/`
 *   dejarían la rejilla operativa y la gráfica muerta sin red, y ningún otro test lo vería.
 *   La lista se compara con el contenido real de `dist/`, no con la configuración.
 * EXPIRA SI: el service worker se escribe a mano o el despliegue deja de ser estático.
 */

const ROOT = process.cwd();
/** Any origin: the paths are what is checked. */
const ORIGIN = "https://example.test";
/** A well-formed, fake Umami website ID. */
const WEBSITE_ID = "11111111-2222-4333-8444-555555555555";
let outDir = "";
let outDirWithId = "";

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "syndrome-pwa-"));
  // Production build without the Umami ID whatever the developer's
  // environment holds (tasks/plans/analytics.md §5); the build WITH it is
  // test_intent_sw_never_touches_collect below.
  outDirWithId = mkdtempSync(join(tmpdir(), "syndrome-pwa-id-"));
  await buildWithEnv({ outDir });
  await buildWithEnv({ outDir: outDirWithId, websiteId: WEBSITE_ID });
});

afterAll(() => {
  if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
  if (outDirWithId !== "")
    rmSync(outDirWithId, { recursive: true, force: true });
});

/** The URLs of the precache manifest injected into sw.js (workbox: `{url:"…",revision:…}`). */
function precachedUrls(sw: string): Set<string> {
  const urls = new Set<string>();
  for (const m of sw.matchAll(/["']?url["']?\s*:\s*"([^"]+)"/g))
    urls.add(m[1]!);
  return urls;
}

interface Manifest {
  readonly name?: string;
  readonly short_name?: string;
  readonly id?: string;
  readonly start_url?: string;
  readonly scope?: string;
  readonly display?: string;
  readonly icons?: readonly {
    sizes?: string;
    src?: string;
    purpose?: string;
  }[];
}

describe("test_intent_pwa_precaches_every_asset", () => {
  it("emits sw.js with a navigate fallback bound to /syndrome/index.html and allowed only under /syndrome/ (a NavigationRoute, not just the precache entry)", () => {
    const file = join(outDir, "sw.js");
    expect(existsSync(file), "dist/sw.js").toBe(true);
    const sw = readFileSync(file, "utf8");
    // `toContain("index.html")` was satisfied by the precache
    // list alone; the fallback is the route workbox builds from `navigateFallback`.
    // Path routing (docs/decisiones.md 2026-10-19): the fallback and its
    // allowlist live under the base, never at the brand site's root.
    expect(sw).toMatch(
      /NavigationRoute\(\s*\w+\.createHandlerBoundToURL\("\/syndrome\/index\.html"\)\s*,\s*\{\s*allowlist:\s*\[\s*\/\^\\\/syndrome\\\/\/\s*\]/,
    );
    console.info(
      `[pwa] sw.js ${statSync(file).size} B, ${precachedUrls(sw).size} precached URL(s)`,
    );
  });

  it("waits for the user (registerType prompt): skipWaiting only on the SKIP_WAITING message, never at install, and no clientsClaim", () => {
    // `autoUpdate` emitted `self.skipWaiting(), clientsClaim()` at
    // the top level, so a new build reloaded EVERY open tab and the toast could
    // never open (needRefresh is not raised in auto mode). In prompt mode the
    // only skipWaiting() call sits inside the message listener the reload
    // button targets through updateServiceWorker(true).
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    const listener =
      /self\.addEventListener\("message",[^]*?"SKIP_WAITING"[^]*?self\.skipWaiting\(\)[^]*?\}\)/;
    expect(sw, "a SKIP_WAITING message listener").toMatch(listener);
    const rest = sw.replace(listener, "");
    expect(rest, "skipWaiting() outside the listener").not.toContain(
      "skipWaiting(",
    );
    expect(rest, "clientsClaim()").not.toContain("clientsClaim(");
  });

  it("precaches every assets/*.js and *.css of the build, the Worker included, plus index.html and the manifest", () => {
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    const urls = precachedUrls(sw);
    const assets = readdirSync(join(outDir, "assets")).filter((f) =>
      /\.(js|css)$/.test(f),
    );
    expect(assets.length).toBeGreaterThan(3);
    expect(
      assets.some((f) => /sim\.worker.*\.js$/.test(f)),
      "a Worker asset",
    ).toBe(true);
    const missing = assets.filter((f) => !urls.has(`assets/${f}`));
    expect(missing, `not precached: ${missing.join(", ")}`).toEqual([]);
    expect(urls.has("index.html")).toBe(true);
    expect(urls.has("manifest.webmanifest")).toBe(true);
  });

  it("precaches every public/fonts/*.woff2 (design.md D3, T-D4): the display face works offline", () => {
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    const urls = precachedUrls(sw);
    const fonts = readdirSync(join(ROOT, "public", "fonts")).filter((f) =>
      f.endsWith(".woff2"),
    );
    expect(fonts.length).toBeGreaterThan(0);
    const missing = fonts.filter((f) => !urls.has(`fonts/${f}`));
    expect(missing, `fonts not precached: ${missing.join(", ")}`).toEqual([]);
  });

  it("manifest.webmanifest names the app, is scoped to /syndrome/ and has 192 and 512 icons (one maskable) that resolve under it", () => {
    const file = join(outDir, "manifest.webmanifest");
    expect(existsSync(file), "dist/manifest.webmanifest").toBe(true);
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
    expect(manifest.name).toBe("Syndrome by SEEQuant");
    expect(manifest.short_name).toBe("Syndrome");
    // Path routing (docs/decisiones.md 2026-10-19): the installed app is the
    // directory /syndrome/, never the brand site at the root of seequant.app.
    expect(manifest.id).toBe("/syndrome/");
    expect(manifest.start_url).toBe("/syndrome/");
    expect(manifest.scope).toBe("/syndrome/");
    expect(manifest.display).toBe("standalone");
    const sizes = (manifest.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((manifest.icons ?? []).some((i) => i.purpose === "maskable")).toBe(
      true,
    );
    // Each icon as the browser resolves it: against the manifest's own URL.
    const manifestUrl = new URL("/syndrome/manifest.webmanifest", ORIGIN);
    for (const icon of manifest.icons ?? []) {
      const path = new URL(icon.src!, manifestUrl).pathname;
      expect(path.startsWith("/syndrome/"), `${icon.src} → ${path}`).toBe(true);
      expect(
        existsSync(join(outDir, path.slice("/syndrome/".length))),
        path,
      ).toBe(true);
    }
  });

  it("registers /syndrome/sw.js with scope /syndrome/ (never the root)", () => {
    const scripts = readdirSync(join(outDir, "assets"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(outDir, "assets", f), "utf8"));
    const registration =
      /new \w+\(\s*[`"']\/syndrome\/sw\.js[`"']\s*,\s*\{\s*scope\s*:\s*[`"']\/syndrome\/[`"']/;
    expect(scripts.some((js) => registration.test(js))).toBe(true);
    // No other registration of a worker script outside the base.
    for (const js of scripts) {
      expect(js).not.toMatch(/[`"']\/sw\.js[`"']/);
    }
  });

  it("no URL of either language's HTML or of a stylesheet escapes /syndrome/ (Vite's base on every public path)", () => {
    const escapes: string[] = [];
    // Every language's HTML (tasks/plans/syndrome-es-url.md D1): the copy in
    // es/ carries the same root-relative paths, which resolve the same there.
    const pages = ["index.html", "es/index.html"];
    const htmls = new Map(
      pages.map((page) => [page, readFileSync(join(outDir, page), "utf8")]),
    );
    for (const [page, html] of htmls) {
      for (const m of html.matchAll(/\s(?:href|src|content)="([^"]*)"/g)) {
        const value = m[1]!;
        if (value.startsWith("/") && !value.startsWith("/syndrome/"))
          escapes.push(`${page} ${value}`);
        if (
          /^https?:\/\//.test(value) &&
          !value.startsWith("https://seequant.app/syndrome/")
        )
          escapes.push(`${page} ${value}`);
      }
    }
    const html = htmls.get("index.html")!;
    const css = readdirSync(join(outDir, "assets")).filter((f) =>
      f.endsWith(".css"),
    );
    expect(css.length).toBeGreaterThan(0);
    const cssPaths: string[] = [];
    for (const file of css) {
      const text = readFileSync(join(outDir, "assets", file), "utf8");
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/g)) {
        const value = m[1]!;
        if (value.startsWith("data:")) continue;
        const path = new URL(value, `${ORIGIN}/syndrome/assets/${file}`)
          .pathname;
        cssPaths.push(path);
        if (!path.startsWith("/syndrome/")) escapes.push(`${file} ${value}`);
      }
    }
    expect(escapes).toEqual([]);
    // Positive controls (a scan that finds nothing proves nothing): the HTML scan saw the font preload and the CSS scan saw the
    // @font-face url(), both resolved under the base.
    expect(html).toContain('href="/syndrome/fonts/space-grotesk-var.woff2"');
    expect(cssPaths).toContain("/syndrome/fonts/space-grotesk-var.woff2");
    // And in each language's page: the preload, its canonical (absolute, under
    // the base) and the link of its <noscript> to the other language.
    for (const [page, other] of [
      ["index.html", "/syndrome/es/"],
      ["es/index.html", "/syndrome/"],
    ] as const) {
      const text = htmls.get(page)!;
      expect(text, page).toContain(
        'href="/syndrome/fonts/space-grotesk-var.woff2"',
      );
      expect(text, page).toMatch(
        /<link rel="canonical" href="https:\/\/seequant\.app\/syndrome\/(?:es\/)?"/,
      );
      expect(text, page).toContain(`<a href="${other}"`);
    }
  });

  it("no root-relative string in the built assets/*.js, sw.js or workbox-*.js escapes /syndrome/", () => {
    // Every string the bundles carry, read from the parsed program (string
    // literals, template literals and the static parts of templates), so a
    // regex literal or a comment is never mistaken for a URL. A value that
    // starts with "/" and a path character is a root-relative URL (fetch,
    // new URL, import(), new Worker, SW registration, importScripts…) and must
    // sit under the base; "/", "/${x}" and the like are not paths and are
    // skipped. The service worker and its workbox runtime are scanned too:
    // their precache entries are relative to /syndrome/sw.js, so a
    // root-relative string there escapes the base just the same.
    // The one exception: the brand-site form pages of FORM_PATHS, which
    // formHref always prefixes with FORMS_ORIGIN (an absolute URL, never a
    // same-origin fetch); exactly those values, read from the module, and only
    // in the app's bundles (in sw.js they would be same-origin routes).
    const formPaths = new Set(
      Object.values(FORM_PATHS).flatMap((byLang) =>
        Object.values(byLang).filter((path) => path !== null),
      ),
    );
    const escapes: string[] = [];
    const seen: string[] = [];
    const swSeen: string[] = [];
    const scripts = readdirSync(join(outDir, "assets"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => `assets/${f}`);
    expect(scripts.length).toBeGreaterThan(3);
    const swScripts = readdirSync(outDir).filter(
      (f) => f === "sw.js" || /^workbox-.*\.js$/.test(f),
    );
    expect(swScripts, "sw.js and its workbox runtime").toContain("sw.js");
    expect(swScripts.length, "a workbox-*.js runtime").toBeGreaterThan(1);
    for (const file of [...scripts, ...swScripts]) {
      const strings = swScripts.includes(file) ? swSeen : seen;
      const source = ts.createSourceFile(
        file,
        readFileSync(join(outDir, file), "utf8"),
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.JS,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          const value = node.text;
          if (/^\/[\w.~-]/.test(value)) {
            strings.push(value);
            const formLink = strings === seen && formPaths.has(value);
            if (!value.startsWith("/syndrome/") && !formLink)
              escapes.push(`${file} ${value}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(escapes).toEqual([]);
    // The scan read the registration and the Worker URL (it can see URLs at all).
    expect(seen).toContain("/syndrome/sw.js");
    expect(
      seen.some((v) => /^\/syndrome\/assets\/sim\.worker.*\.js$/.test(v)),
    ).toBe(true);
    // And it read the service worker: its navigation fallback.
    expect(swSeen).toContain("/syndrome/index.html");
    // The exception is not a blind spot: the scan did see the form paths.
    for (const path of formPaths) expect(seen).toContain(path);
  });
});

/**
 * test_intent_sw_never_touches_collect
 *
 * INTENCIÓN: el service worker no se mete jamás en la analítica ni en la web de marca
 *   (tasks/plans/analytics.md T-I8, D6): `sw.js` no tiene `runtimeCaching` (su única ruta
 *   es la navegación de `/syndrome/`, así que un `POST` a `https://cloud.umami.is` nunca
 *   pasa por una estrategia de Workbox que lo cachee, lo reintente o lo tire) ni nombra el
 *   colector; la navegación sólo se sirve del SW bajo `^/syndrome/`, de modo que los enlaces
 *   a los formularios propios de la web (`https://seequant.app/es/…`) llegan a la red. Con
 *   el ID en el build, el contador (`assets/umami-*.js`) está en la precaché como cualquier
 *   otro activo: la app sin red no lo pide a ningún sitio.
 * CONTEXTO: hoy `vite.config.ts` no declara `runtimeCaching`; una regla «para todo»
 *   añadida para ir más rápido interceptaría el colector, y un `navigateFallbackAllowlist`
 *   a la raíz serviría la app en lugar de la página del formulario. Se mide en los dos
 *   builds (sin y con ID).
 * EXPIRA SI: el service worker se escribe a mano, o la analítica deja de ser un contador
 *   de terceros llamado desde el navegador.
 */
describe("test_intent_sw_never_touches_collect", () => {
  const swOf = (dir: string): string =>
    readFileSync(join(dir, "sw.js"), "utf8");
  const workboxOf = (dir: string): string =>
    readdirSync(dir)
      .filter((f) => /^workbox-.*\.js$/.test(f))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");

  it("sw.js registers exactly one route, the navigation of /syndrome/, and no runtime-caching strategy (both builds)", () => {
    for (const dir of [outDir, outDirWithId]) {
      const sw = swOf(dir);
      expect(sw.match(/registerRoute\(/g) ?? [], dir).toHaveLength(1);
      expect(sw).toMatch(
        /registerRoute\(\s*new \w+\.NavigationRoute\([^]*?\{\s*allowlist:\s*\[\s*\/\^\\\/syndrome\\\/\/\s*\]\s*(?:,\s*denylist:\s*\[[^\]]*\]\s*)?\}\s*\)\s*\)/,
      );
      for (const strategy of [
        "NetworkFirst",
        "NetworkOnly",
        "CacheFirst",
        "CacheOnly",
        "StaleWhileRevalidate",
      ]) {
        expect(sw, `${dir}: ${strategy}`).not.toContain(strategy);
      }
    }
  });

  it("neither sw.js (besides the counter's precache entry) nor its workbox runtime mentions umami (both builds)", () => {
    for (const dir of [outDir, outDirWithId]) {
      const rest = swOf(dir).replace(
        /\{url:"assets\/umami-[\w-]+\.js"[^}]*\}/g,
        "",
      );
      expect(rest, `${dir}/sw.js`).not.toMatch(/umami/i);
      expect(workboxOf(dir), `${dir}/workbox-*.js`).not.toMatch(/umami/i);
    }
  });

  it("with the website ID, the counter assets/umami-*.js is in the precache; without it, there is none", () => {
    const withId = [...precachedUrls(swOf(outDirWithId))].filter((u) =>
      /^assets\/umami-[\w-]+\.js$/.test(u),
    );
    expect(withId).toHaveLength(1);
    expect(existsSync(join(outDirWithId, withId[0]!))).toBe(true);
    const without = [...precachedUrls(swOf(outDir))].filter((u) =>
      /umami/.test(u),
    );
    expect(without).toEqual([]);
  });
});

/** The navigation route's `{allowlist, denylist}` as written in sw.js, as RegExps. */
function navigationLists(sw: string): {
  allowlist: string[];
  denylist: string[];
} {
  const m =
    /NavigationRoute\([^]*?\{\s*allowlist:\s*\[([^\]]*)\]\s*(?:,\s*denylist:\s*\[([^\]]*)\]\s*)?\}\s*\)/.exec(
      sw,
    );
  expect(m, "the NavigationRoute options").not.toBeNull();
  const literals = (list: string | undefined) =>
    list === undefined || list.trim() === ""
      ? []
      : list.split(/,(?=\/)/).map((s) => s.trim());
  return { allowlist: literals(m![1]), denylist: literals(m![2]) };
}

/**
 * test_intent_sw_serves_each_language_html
 *
 * INTENCIÓN: sin red, cada idioma abre en su idioma (tasks/plans/syndrome-es-url.md D7):
 *   la precaché del SW contiene `index.html` Y `es/index.html` (una entrada por directorio
 *   de `LANGUAGE_DIRS`), la navegación de reserva sigue siendo la inglesa con `allowlist`
 *   `^/syndrome/` y una `denylist` que aparta EXACTAMENTE `/syndrome/es(?:$|\?|\/.)` (el
 *   301 y el 404 del borde van a la red; `/syndrome/es/` lo sirve la precaché), la
 *   precaché ignora todo parámetro (`ignoreURLParametersMatching: [/.*\/]`, para que
 *   `/syndrome/es/?utm_source=x` encuentre su HTML), y sigue habiendo UNA sola
 *   `registerRoute` en `sw.js` y ninguna estrategia de `runtimeCaching`.
 * CONTEXTO: H2 del plan (el `es/index.html` emitido en `generateBundle` entra en la
 *   precaché porque vite-plugin-pwa genera el SW en `closeBundle`) y H3 (la ruta de
 *   precaché va antes que la de navegación y resuelve `directoryIndex`): sin la entrada,
 *   un `/syndrome/es/` sin red caería en la reserva inglesa; sin la `denylist`,
 *   `/syndrome/es` y `/syndrome/es/x` recibirían el inglés en vez del 301 y el 404.
 * EXPIRA SI: el SW se escribe a mano o el idioma deja de ir en la ruta.
 */
describe("test_intent_sw_serves_each_language_html", () => {
  it("precaches one HTML per language directory", () => {
    const urls = precachedUrls(readFileSync(join(outDir, "sw.js"), "utf8"));
    expect([...urls].filter((u) => u.endsWith(".html")).sort()).toEqual([
      "es/index.html",
      "index.html",
    ]);
    expect(existsSync(join(outDir, "es", "index.html"))).toBe(true);
  });

  it("keeps the English fallback under ^/syndrome/ and denies exactly the language directory's other paths", () => {
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    expect(sw).toContain('createHandlerBoundToURL("/syndrome/index.html")');
    expect(navigationLists(sw)).toEqual({
      allowlist: ["/^\\/syndrome\\//"],
      denylist: ["/^\\/syndrome\\/es(?:$|\\?|\\/.)/"],
    });
  });

  it("ignores every URL parameter in the precache lookup, with one registerRoute and no strategy", () => {
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    expect(sw).toMatch(
      /precacheAndRoute\(\[[^]*?\],\s*\{\s*ignoreURLParametersMatching:\s*\[\s*\/\.\*\/\s*\]\s*\}\s*\)/,
    );
    expect(sw.match(/registerRoute\(/g) ?? []).toHaveLength(1);
    // The precache route is set up before the navigation route (H3).
    expect(sw.indexOf("precacheAndRoute(")).toBeLessThan(
      sw.indexOf("registerRoute("),
    );
    for (const strategy of [
      "NetworkFirst",
      "NetworkOnly",
      "CacheFirst",
      "CacheOnly",
      "StaleWhileRevalidate",
    ])
      expect(sw).not.toContain(strategy);
  });
});

/** What a navigation got from the service worker. */
type Served = { from: "network" } | { from: "precache"; file: string };

/**
 * Run the BUILT sw.js and its workbox runtime in a VM, as a browser would
 * (AMD loader, importScripts, the fetch listener), with a cache that answers
 * every precached key with the key itself; then navigate.
 */
async function serviceWorker(
  dir: string,
): Promise<(path: string) => Promise<Served>> {
  const scope = `${ORIGIN}/syndrome/`;
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  class FetchEvent {
    readonly type = "fetch";
    response: Promise<Response> | undefined;
    readonly request: unknown;
    constructor(request: unknown) {
      this.request = request;
    }
    respondWith(response: Promise<Response>) {
      this.response = response;
    }
    waitUntil() {}
  }
  // A worker's Request resolves a relative URL against its location; Node's
  // does not (createHandlerBoundToURL passes "/syndrome/index.html").
  class WorkerRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, scope) : input, init);
    }
  }
  const answer = async (request: Request | string) => {
    const key = typeof request === "string" ? request : request.url;
    return new Response(key, { status: 200 });
  };
  const context: Record<string, unknown> = {
    console,
    URL,
    Request: WorkerRequest,
    Response,
    Headers,
    FetchEvent,
    Promise,
    setTimeout,
    clearTimeout,
    location: new URL(`${scope}sw.js`),
    registration: { scope },
    __WB_DISABLE_DEV_LOGS: true,
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    skipWaiting() {},
    fetch: () => Promise.reject(new Error("network: not in this test")),
    caches: {
      open: async () => ({ match: answer, put: async () => {} }),
      match: answer,
      keys: async () => [],
      delete: async () => true,
    },
  };
  context.self = context;
  context.importScripts = (...urls: string[]) => {
    for (const url of urls) {
      const file = new URL(url).pathname.slice("/syndrome/".length);
      runInContext(readFileSync(join(dir, file), "utf8"), context, {
        filename: file,
      });
    }
  };
  createContext(context);
  runInContext(readFileSync(join(dir, "sw.js"), "utf8"), context, {
    filename: "sw.js",
  });
  // The AMD loader resolves the runtime asynchronously.
  for (let i = 0; i < 20 && !listeners.has("fetch"); i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  expect(listeners.get("fetch"), "the SW's fetch listener").toBeDefined();
  return async (path: string) => {
    const event = new FetchEvent({
      url: `${ORIGIN}${path}`,
      mode: "navigate",
      method: "GET",
      destination: "document",
    });
    for (const listener of listeners.get("fetch")!) listener(event);
    if (event.response === undefined) return { from: "network" };
    const key = new URL(await (await event.response).text());
    return { from: "precache", file: key.pathname.slice("/syndrome/".length) };
  };
}

/**
 * test_scenario_sw_routes_language_navigations
 *
 * INTENCIÓN: el SW construido, ejecutado de verdad (su cargador AMD, el runtime de
 *   Workbox del build y su `fetch` listener en una VM), sirve cada navegación como dice
 *   D7: `/syndrome/es/` (con o sin consulta) → `es/index.html` de la precaché;
 *   `/syndrome/` y `/syndrome/?c=…` → `index.html`; `/syndrome/es` y `/syndrome/es/x` → la
 *   red (el 301 y el 404 del borde); `/syndrome/x` → la reserva inglesa; fuera de
 *   `/syndrome/` (la web de marca) → la red. Es la interacción de tres decisiones (entrada
 *   en la precaché, `ignoreURLParametersMatching`, `denylist`) con el orden de rutas de
 *   Workbox, que ningún test de configuración ve.
 * CONTEXTO: H3 del plan: la ruta de precaché se registra antes que la de navegación y
 *   resuelve `directoryIndex`; si no fuera así, `/syndrome/es/` sin red recibiría el inglés.
 *   La caché falsa devuelve la clave pedida, así que el resultado dice QUÉ fichero
 *   precacheado sirvió el SW.
 * EXPIRA SI: el SW se escribe a mano, o Workbox cambia su formato AMD (entonces este arnés
 *   se rehace, no se borra).
 */
describe("test_scenario_sw_routes_language_navigations", () => {
  it.each<[string, Served]>([
    ["/syndrome/", { from: "precache", file: "index.html" }],
    ["/syndrome/?c=AAAA", { from: "precache", file: "index.html" }],
    ["/syndrome/#c=AAAA", { from: "precache", file: "index.html" }],
    ["/syndrome/es/", { from: "precache", file: "es/index.html" }],
    ["/syndrome/es/?utm_source=x", { from: "precache", file: "es/index.html" }],
    ["/syndrome/es/#c=AAAA", { from: "precache", file: "es/index.html" }],
    ["/syndrome/es", { from: "network" }],
    ["/syndrome/es?a=1", { from: "network" }],
    ["/syndrome/es/x", { from: "network" }],
    ["/syndrome/x", { from: "precache", file: "index.html" }],
    ["/syndrome/esx", { from: "precache", file: "index.html" }],
    ["/es/", { from: "network" }],
  ])("%s → %o", async (path, expected) => {
    const navigate = await serviceWorker(outDir);
    expect(await navigate(path)).toEqual(expected);
  });
});
