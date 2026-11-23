import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_BASE,
  CANONICAL_ORIGIN,
  LANGUAGE_DIRS,
  LEGACY_HOST,
} from "../../edge/paths";
import { build } from "esbuild";
import { RETIRE_SW } from "../../edge/retire-sw";
import worker, { type Env } from "../../edge/worker";
import { stageDist } from "../../tools/deploy/stage";
import { walk } from "./ui-sources";

/**
 * Syndrome vive en https://seequant.app/syndrome/ (tasks/plans/path-routing.md; docs/decisiones.md 2026-10-19). Tres tests de intención sobre
 * lo que no se ve en el navegador local: el Worker de borde (edge/worker.ts), la forma del
 * despliegue (wrangler.jsonc, edge/_headers, tools/deploy/stage.ts) y las claves de
 * localStorage. Lo que depende del build (base de Vite, manifiesto, service worker) lo fija
 * tests/intent/pwa-precache.test.ts.
 */

const ROOT = process.cwd();

function get(url: string, env: Env = {}, method = "GET"): Response {
  return worker.fetch(new Request(url, { method }), env);
}

/**
 * test_intent_legacy_origin_redirects_and_retires_its_sw
 *
 * INTENCIÓN: los enlaces ya compartidos a syndrome.seequant.app siguen funcionando (R3): toda
 *   petición al host viejo responde 301 a la MISMA ruta y query bajo
 *   https://seequant.app/syndrome/ (el puzle del reto va en el fragmento, que el navegador
 *   conserva). Y el service worker ya registrado en el origen viejo no se queda para siempre
 *   sirviendo el build antiguo (R4): su comprobación de `/sw.js` recibe 200 con un script
 *   distinto que se instala sin esperar, borra todas las cachés, se da de baja y navega cada
 *   ventana a su URL (que ya va a la red y recibe el 301). Con `LEGACY_STATUS = "302"` (fase 1
 *   del despliegue) todo es 302, `sw.js` incluido, y el SW viejo queda intacto.
 * CONTEXTO: una actualización de SW que recibe una redirección falla, así que un 301 simple de
 *   `/sw.js` dejaría la PWA vieja varada. El host se compara EXACTO: `endsWith` aceptaría
 *   cualquier subdominio.
 * EXPIRA SI: se retira el host viejo (ningún enlace compartido lo usa ya) o la app vuelve a un
 *   subdominio.
 */
describe("test_intent_legacy_origin_redirects_and_retires_its_sw", () => {
  const legacy = `https://${LEGACY_HOST}`;
  const target = `${CANONICAL_ORIGIN}${APP_BASE}`;

  it.each([
    ["/", target],
    ["/x?y=1", `${target}x?y=1`],
    ["/?a=1&b=2", `${target}?a=1&b=2`],
    ["/index.html", `${target}index.html`],
    ["/assets/index-abc.js", `${target}assets/index-abc.js`],
  ])(
    "%s answers 301 to the same path and query under the new base",
    (path, location) => {
      for (const method of ["GET", "HEAD"]) {
        const response = get(`${legacy}${path}`, {}, method);
        expect(response.status, method).toBe(301);
        expect(response.headers.get("Location"), method).toBe(location);
      }
    },
  );

  // A path already under the base keeps its path (no
  // /syndrome/syndrome/…). Only /syndrome (run_worker_first) and /syndrome/…
  // paths without an asset reach the Worker in production; the asset paths are
  // served as assets on the legacy host (accepted gap, edge/worker.ts).
  it.each([
    ["/syndrome", target],
    ["/syndrome?a=1", `${target}?a=1`],
    ["/syndrome/", target],
    ["/syndrome/x?y=1", `${target}x?y=1`],
    ["/syndrome/syndrome/x", `${target}syndrome/x`],
    ["/syndromeX", `${target}syndromeX`],
  ])("%s answers 301 to %s (the base is never doubled)", (path, location) => {
    for (const env of [{}, { LEGACY_STATUS: "302" }] as Env[]) {
      const response = get(`${legacy}${path}`, env);
      expect(response.status, path).toBe(env.LEGACY_STATUS ? 302 : 301);
      expect(response.headers.get("Location"), path).toBe(location);
    }
  });

  it.each(["/sw.js", "/sw.js?v=1"])(
    "%s answers 200 with the retiring script, JavaScript, no-cache, no redirect",
    async (path) => {
      const response = get(`${legacy}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.get("Content-Type")).toMatch(/^text\/javascript/);
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(await response.text()).toBe(RETIRE_SW);
    },
  );

  it('LEGACY_STATUS "302" (deploy phase 1): every legacy answer is a 302, sw.js included', () => {
    const env: Env = { LEGACY_STATUS: "302" };
    for (const [path, location] of [
      ["/x?y=1", `${target}x?y=1`],
      ["/sw.js", `${target}sw.js`],
    ] as const) {
      const response = get(`${legacy}${path}`, env);
      expect(response.status, path).toBe(302);
      expect(response.headers.get("Location"), path).toBe(location);
    }
  });

  it("matches the legacy host exactly: another host is not redirected to the app", () => {
    for (const url of [
      `https://www.${LEGACY_HOST}/x`,
      `https://not${LEGACY_HOST}/x`,
      `${CANONICAL_ORIGIN}/syndrome/x`,
      `${CANONICAL_ORIGIN}/sw.js`,
    ]) {
      const response = get(url);
      expect(response.status, url).toBe(404);
      expect(response.headers.get("Location"), url).toBeNull();
    }
  });

  it("the retiring script skips waiting, deletes every cache, unregisters, then navigates each window to its own URL", async () => {
    const order: string[] = [];
    const handlers = new Map<string, (event: unknown) => void>();
    const windows = ["https://a/x#c=i3.gAA", "https://a/"].map((url) => ({
      url,
      navigate: vi.fn(async () => {
        order.push(`navigate ${url}`);
      }),
    }));
    const fakeSelf = {
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        handlers.set(type, handler),
      skipWaiting: vi.fn(async () => {
        order.push("skipWaiting");
      }),
      caches: {
        keys: vi.fn(async () => ["workbox-precache-v2", "other"]),
        delete: vi.fn(async (key: string) => {
          order.push(`delete ${key}`);
          return true;
        }),
      },
      registration: {
        unregister: vi.fn(async () => {
          order.push("unregister");
          return true;
        }),
      },
      clients: {
        matchAll: vi.fn(async () => windows),
      },
    };
    // The script as served, run against a fake `self` (it touches no other global).
    new Function("self", RETIRE_SW)(fakeSelf);
    handlers.get("install")!({});
    expect(order).toEqual(["skipWaiting"]);
    let done: Promise<unknown> | undefined;
    handlers.get("activate")!({
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    expect(done, "activate waits on its work").toBeDefined();
    await done;
    expect(fakeSelf.clients.matchAll).toHaveBeenCalledWith({ type: "window" });
    expect(order).toEqual([
      "skipWaiting",
      "delete workbox-precache-v2",
      "delete other",
      "unregister",
      "navigate https://a/x#c=i3.gAA",
      "navigate https://a/",
    ]);
  });
});

/**
 * test_intent_root_belongs_to_the_brand_site
 *
 * INTENCIÓN: https://seequant.app/ es de la web de marca (otro repo, ruta `seequant.app/*`) y
 *   este Worker no la toca: ni ruta propia en wrangler.jsonc (la más específica gana y taparía
 *   la portada de la marca; lo fija test_intent_deploy_layout_keeps_everything_under_syndrome)
 *   ni redirección si una petición a la raíz llegara aquí. `/syndrome` sin barra acaba en
 *   `/syndrome/` (R1) conservando la query, y una ruta que sólo comparte el prefijo
 *   (`/syndromeX`, que la ruta `seequant.app/syndrome*` también atrapa) es 404, no la app.
 * CONTEXTO: la raíz dio un 302 provisional a /syndrome/ (2026-10-19) hasta que la web de
 *   marca se publicó el 2026-10-20; entonces se borraron la rama y la ruta.
 * EXPIRA SI: se vuelve a dar la raíz a una app.
 */
describe("test_intent_root_belongs_to_the_brand_site", () => {
  it.each(["", "?utm=x"])(
    "the root%s is not redirected to the app",
    (query) => {
      const response = get(`${CANONICAL_ORIGIN}/${query}`);
      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
    },
  );

  it.each([
    ["/syndrome", "/syndrome/"],
    ["/syndrome?a=1", "/syndrome/?a=1"],
  ])("%s answers 301 to %s", (path, location) => {
    const response = get(`${CANONICAL_ORIGIN}${path}`);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(location);
  });

  it.each(["/syndromeX", "/syndrome2/x", "/other"])("%s is a 404", (path) => {
    const response = get(`${CANONICAL_ORIGIN}${path}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
  });
});

/**
 * test_intent_each_language_has_one_url_at_the_edge
 *
 * INTENCIÓN: cada idioma tiene UNA URL canónica y el borde manda ahí todo lo que la nombra
 *   sin serlo (tasks/plans/syndrome-es-url.md D8): `/syndrome/es` → 301 `/syndrome/es/`
 *   con la consulta (un 301, no el 307 de la barra final del servidor de activos: por eso
 *   `/syndrome/es` está en `run_worker_first`, lo fija
 *   test_intent_deploy_layout_keeps_everything_under_syndrome); `/syndrome/en` y
 *   `/syndrome/en/` → 301 `/syndrome/` (el inglés es la base, sin duplicado indexable);
 *   `/syndrome/es/<otra cosa>` y `/syndrome/esx` son 404, no la app; y el host viejo lleva
 *   `/es/` a `https://seequant.app/syndrome/es/`. Se recorre la tabla `LANGUAGE_DIRS`, así
 *   que un idioma nuevo hereda las mismas reglas.
 * CONTEXTO: auditoría SEO del 2026-10-20. Un 302 o un 307 no consolidan la señal en la
 *   URL de destino; dos URLs con el mismo contenido (`/syndrome/en/` y `/syndrome/`) son un
 *   duplicado.
 * EXPIRA SI: el idioma deja de ir en la ruta.
 */
describe("test_intent_each_language_has_one_url_at_the_edge", () => {
  const others = Object.entries(LANGUAGE_DIRS).filter(([, dir]) => dir !== "");
  const base = Object.entries(LANGUAGE_DIRS).filter(([, dir]) => dir === "");

  it("the table has a language with a directory and English as the base", () => {
    expect(others.map(([lang]) => lang)).toEqual(["es"]);
    expect(base.map(([lang]) => lang)).toEqual(["en"]);
  });

  it.each(["", "?a=1", "?utm_source=x&b=2"])(
    "each language directory without its slash%s answers 301 to the directory, query kept",
    (query) => {
      for (const [, dir] of others) {
        for (const method of ["GET", "HEAD"]) {
          const response = get(
            `${CANONICAL_ORIGIN}${APP_BASE}${dir.slice(0, -1)}${query}`,
            {},
            method,
          );
          expect(response.status, `${dir} ${method}`).toBe(301);
          expect(response.headers.get("Location")).toBe(
            `${APP_BASE}${dir}${query}`,
          );
        }
      }
    },
  );

  it("/syndrome/es literally: 301 to /syndrome/es/", () => {
    const response = get(`${CANONICAL_ORIGIN}/syndrome/es?x=1`);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/syndrome/es/?x=1");
  });

  it.each([
    "/syndrome/en",
    "/syndrome/en/",
    "/syndrome/en?a=1",
    "/syndrome/en/?a=1",
  ])(
    "%s (the base language's would-be directory) answers 301 to /syndrome/",
    (path) => {
      const response = get(`${CANONICAL_ORIGIN}${path}`);
      expect(response.status).toBe(301);
      const query = path.includes("?") ? path.slice(path.indexOf("?")) : "";
      expect(response.headers.get("Location")).toBe(`/syndrome/${query}`);
    },
  );

  it.each([
    "/syndrome/es/x",
    "/syndrome/es/x/",
    "/syndrome/esx",
    "/syndrome/en/x",
    "/syndrome/es//",
  ])("%s is a 404", (path) => {
    const response = get(`${CANONICAL_ORIGIN}${path}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("the legacy host sends /es/ to the Spanish page", () => {
    const response = get(`https://${LEGACY_HOST}/es/?a=1`);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(
      `${CANONICAL_ORIGIN}/syndrome/es/?a=1`,
    );
  });

  // One hop, never legacy → /syndrome/es → 301 → /syndrome/es/.
  it.each([
    ...others.flatMap(([, dir]) => [
      [`/${dir.slice(0, -1)}`, `${APP_BASE}${dir}`],
      [`/${dir.slice(0, -1)}?a=1`, `${APP_BASE}${dir}`],
      [`${APP_BASE}${dir.slice(0, -1)}`, `${APP_BASE}${dir}`],
    ]),
    ...base.flatMap(([lang]) => [
      [`/${lang}`, APP_BASE],
      [`/${lang}/`, APP_BASE],
    ]),
  ])("the legacy host sends %s straight to %s (one redirect)", (path, page) => {
    const response = get(`https://${LEGACY_HOST}${path}`);
    expect(response.status).toBe(301);
    const query = path.includes("?") ? path.slice(path.indexOf("?")) : "";
    expect(response.headers.get("Location")).toBe(
      `${CANONICAL_ORIGIN}${page}${query}`,
    );
  });
});

/**
 * test_intent_deploy_layout_keeps_everything_under_syndrome
 *
 * INTENCIÓN: nada de esta app se sirve ni se controla desde fuera de /syndrome/ (R1, R6),
 *   porque el resto de seequant.app es de la web de marca y de otras apps. Se fija la forma
 *   del despliegue: `wrangler.jsonc` con el Worker, los activos de `./dist` por ruta completa,
 *   `not_found_handling: "none"` (con SPA una navegación sin activo nunca llegaría al Worker),
 *   `run_worker_first` sólo en rutas exactas, `/syndrome` y cada directorio de idioma sin su
 *   barra (`/syndrome/es`, tasks/plans/syndrome-es-url.md D8; con `true` cada activo sería una
 *   invocación) y EXACTAMENTE las dos rutas (la app y el host viejo; la raíz es de la marca);`edge/_headers` sólo con rutas bajo /syndrome/ y sin
 *   `Service-Worker-Allowed` (el SW no puede ampliar su scope a la raíz); `public/_headers`
 *   no existe (Vite lo copiaría a dist/syndrome/, donde no aplica); `stageDist` deja en dist/
 *   sólo `syndrome/` y `_headers` (un dist/ viejo con `sw.js` en la raíz lo serviría el
 *   servidor de activos antes que el Worker en el host viejo, y el retiro del SW no ocurriría
 *   nunca); y toda clave de localStorage del código lleva el prefijo `syndrome.`, leído del
 *   TIPO de cada argumento de `getItem`/`setItem`/`removeItem` (y de `lookupLocalStorage`):
 *   un `string` que no sea literal también falla, porque no demuestra el prefijo.
 * CONTEXTO: el origen seequant.app lo comparten todas las apps de SEEQuant (docs/decisiones.md
 *   2026-10-19).
 * EXPIRA SI: la app vuelve a un origen propio.
 */
describe("test_intent_deploy_layout_keeps_everything_under_syndrome", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const dir of tmp.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("wrangler.jsonc: the Worker, assets by full path, exact run_worker_first, exactly the two routes", () => {
    const text = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
    const { config, error } = ts.parseConfigFileTextToJson(
      "wrangler.jsonc",
      text,
    );
    expect(error).toBeUndefined();
    expect(config.main).toBe("edge/worker.ts");
    // Derived from the one table: the base and every language directory
    // without its slash; the literal pins the derivation itself.
    const languageDirs = Object.values(LANGUAGE_DIRS)
      .filter((dir) => dir !== "")
      .map((dir) => APP_BASE + dir.slice(0, -1));
    expect(languageDirs).toEqual(["/syndrome/es"]);
    expect(config.assets).toEqual({
      directory: "./dist",
      not_found_handling: "none",
      run_worker_first: [APP_BASE.slice(0, -1), ...languageDirs],
    });
    expect(config.routes).toEqual([
      { pattern: "seequant.app/syndrome*", zone_name: "seequant.app" },
      { pattern: LEGACY_HOST, custom_domain: true },
    ]);
  });

  /**
   * test_intent_worker_main_exports_only_default
   *
   * INTENCIÓN: el módulo `main` de wrangler.jsonc, empaquetado como lo empaqueta wrangler
   *   (esbuild, ESM), no exporta nada salvo `default`.
   * CONTEXTO: workerd trata cada export con nombre del punto de entrada como un entrypoint y
   *   se niega a arrancar ante una cadena («Incorrect type for map entry
   *   'RETIRE_SW'»): los tests llamaban a `fetch` directamente y nunca lo vieron. Los tipos
   *   (`export interface Env`) se borran al empaquetar y no cuentan.
   * EXPIRA SI: el Worker exporta a propósito otro entrypoint (Durable Object, WorkerEntrypoint),
   *   que entonces se añade aquí por nombre.
   */
  it("test_intent_worker_main_exports_only_default: the bundled main module exports only default", async () => {
    const text = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
    const { config } = ts.parseConfigFileTextToJson("wrangler.jsonc", text);
    const result = await build({
      entryPoints: [join(ROOT, config.main as string)],
      bundle: true,
      format: "esm",
      platform: "neutral",
      write: false,
      metafile: true,
      outfile: "worker.js",
      logLevel: "silent",
    });
    const outputs = Object.values(result.metafile.outputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.exports).toEqual(["default"]);
  });

  it("edge/_headers: every path under /syndrome/, no Service-Worker-Allowed; public/_headers is gone", () => {
    const lines = readFileSync(join(ROOT, "edge", "_headers"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
    // Every rule with its full headers (pinning only the paths let a header
    // value drift, e.g. the immutable assets losing their max-age).
    const rules: [string, string[]][] = [];
    for (const line of lines) {
      if (/^\s/.test(line)) rules.at(-1)![1].push(line.trim());
      else rules.push([line, []]);
    }
    expect(rules).toEqual([
      ["/syndrome/sw.js", ["Cache-Control: no-cache"]],
      [
        "/syndrome/manifest.webmanifest",
        ["Cache-Control: no-cache", "Content-Type: application/manifest+json"],
      ],
      [
        "/syndrome/assets/*",
        ["Cache-Control: public, max-age=31536000, immutable"],
      ],
    ]);
    for (const line of lines) {
      expect(line, "Service-Worker-Allowed").not.toMatch(
        /service-worker-allowed/i,
      );
    }
    expect(existsSync(join(ROOT, "public", "_headers"))).toBe(false);
  });

  it("stageDist leaves only syndrome/ and _headers (edge/_headers) and keeps the build", () => {
    const dist = mkdtempSync(join(tmpdir(), "syndrome-stage-"));
    tmp.push(dist);
    mkdirSync(join(dist, "syndrome", "assets"), { recursive: true });
    mkdirSync(join(dist, "syndrome", "es"));
    mkdirSync(join(dist, "assets"));
    for (const file of [
      "syndrome/index.html",
      "syndrome/es/index.html",
      "syndrome/sw.js",
      "syndrome/assets/index-new.js",
      "index.html",
      "sw.js",
      "assets/index-old.js",
      "_headers",
    ]) {
      writeFileSync(join(dist, file), file);
    }
    stageDist(dist);
    expect(readdirSync(dist).sort()).toEqual(["_headers", "syndrome"]);
    expect(readFileSync(join(dist, "_headers"), "utf8")).toBe(
      readFileSync(join(ROOT, "edge", "_headers"), "utf8"),
    );
    expect(readdirSync(join(dist, "syndrome")).sort()).toEqual([
      "assets",
      "es",
      "index.html",
      "sw.js",
    ]);
  });

  it("stageDist refuses an incomplete build: no service worker, or a language without its HTML (syndrome-es-url.md D8)", () => {
    const build = (files: string[]): string => {
      const dist = mkdtempSync(join(tmpdir(), "syndrome-stage-"));
      tmp.push(dist);
      mkdirSync(join(dist, "syndrome", "es"), { recursive: true });
      for (const file of files) writeFileSync(join(dist, "syndrome", file), "");
      return dist;
    };
    expect(() => stageDist(build(["index.html", "es/index.html"]))).toThrow(
      /sw\.js not found/,
    );
    expect(() => stageDist(build(["index.html", "sw.js"]))).toThrow(
      /es[\\/]index\.html not found/,
    );
    expect(() => stageDist(build(["es/index.html", "sw.js"]))).toThrow(
      /index\.html not found/,
    );
    // Control: complete, it stages.
    expect(() =>
      stageDist(build(["index.html", "es/index.html", "sw.js"])),
    ).not.toThrow();
  });

  it("npm run build ends with the staging step and npm run deploy runs that build", () => {
    // stageDist is only a guarantee if the pipeline runs it: without the last
    // step, dist/ would be Vite's raw output (no _headers, a stale dist/sw.js
    // could survive at the root) and `wrangler deploy` would publish it.
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toMatch(/&& tsx tools\/deploy\/stage\.ts$/);
    expect(pkg.scripts.build).toMatch(/^tsc -b && vite build && /);
    // The production gate sits between the build and the upload
    // (tasks/plans/analytics.md D9; pinned by test_intent_production_gate).
    expect(pkg.scripts.deploy).toMatch(
      /^npm run build && tsx tools\/deploy\/check-prod\.ts --production && wrangler deploy\b/,
    );
  });

  it("production cannot stay in deploy phase 1: no LEGACY_STATUS in wrangler.jsonc vars, plain deploy script, CI production step without --var", () => {
    // Phase 1 (302 everywhere, old SW untouched) is a one-off command-line
    // `--var`. Written into the config, the script or CI it would become the
    // permanent state and the old service worker would never be retired.
    const text = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
    const { config } = ts.parseConfigFileTextToJson("wrangler.jsonc", text);
    const withVars = [config, ...Object.values(config.env ?? {})] as {
      vars?: unknown;
    }[];
    for (const scope of withVars) {
      expect(JSON.stringify(scope.vars ?? {}), "wrangler vars").not.toMatch(
        /LEGACY_STATUS/,
      );
    }
    expect(JSON.stringify(config), "wrangler.jsonc").not.toMatch(
      /LEGACY_STATUS/,
    );
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.deploy).toBe(
      "npm run build && tsx tools/deploy/check-prod.ts --production && wrangler deploy",
    );
    // npm runs pre/post hooks around `npm run deploy` on its own, and
    // `keep_vars` would carry a phase-1 `--var` into every later deploy.
    expect(pkg.scripts.predeploy, "predeploy").toBeUndefined();
    expect(pkg.scripts.postdeploy, "postdeploy").toBeUndefined();
    expect(config.keep_vars, "keep_vars").not.toBe(true);
    // The `run:` of the CI step named "production (main)" (line-based: the
    // repo has no YAML parser, and the step is three flat lines).
    const ci = readFileSync(
      join(ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    ).split(/\r?\n/);
    const start = ci.findIndex((line) =>
      /^\s*- name:\s*production \(main\)\s*$/.test(line),
    );
    expect(start, "CI step 'production (main)'").toBeGreaterThanOrEqual(0);
    const indent = ci[start]!.indexOf("-");
    const step: string[] = [];
    for (const line of ci.slice(start + 1)) {
      if (line.trim() !== "" && line.search(/\S/) <= indent) break;
      step.push(line.trim());
    }
    const runs = step.filter((line) => line.startsWith("run:"));
    expect(runs).toEqual(["run: npx wrangler deploy"]);
  });

  it("every localStorage key of src/ and index.html is a literal starting with syndrome.", () => {
    const files = walk(join(ROOT, "src")).filter(
      (f) =>
        /\.(ts|tsx)$/.test(f) &&
        !/\.test\.(ts|tsx)$/.test(f) &&
        !f.endsWith(".d.ts"),
    );
    const program = ts.createProgram(files, {
      strict: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2023,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
    });
    const checker = program.getTypeChecker();
    const keys: string[] = [];
    const bad: string[] = [];
    const check = (node: ts.Expression, source: ts.SourceFile): void => {
      const type = checker.getTypeAtLocation(node);
      const parts = type.isUnion() ? type.types : [type];
      const where = `${source.fileName.slice(ROOT.length)}: ${node.getText(source)}`;
      for (const part of parts) {
        if (part.isStringLiteral() && part.value.startsWith("syndrome.")) {
          keys.push(part.value);
        } else {
          bad.push(`${where} (${checker.typeToString(part)})`);
        }
      }
    };
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile || source.fileName.includes("node_modules"))
        continue;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["getItem", "setItem", "removeItem"].includes(
            node.expression.name.text,
          ) &&
          node.arguments[0] !== undefined
        ) {
          check(node.arguments[0], source);
        }
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText(source) === "lookupLocalStorage"
        ) {
          check(node.initializer, source);
        }
        if (
          ts.isElementAccessExpression(node) &&
          /Storage$/.test(node.expression.getText(source))
        ) {
          check(node.argumentExpression, source);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    // index.html's inline theme script (no TypeScript): its literal keys.
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    for (const m of html.matchAll(/Storage\.\w+Item\(\s*([^,)]+)/g)) {
      const literal = /^["']([^"']*)["']$/.exec(m[1]!.trim());
      if (literal?.[1]?.startsWith("syndrome.")) keys.push(literal[1]);
      else bad.push(`index.html: ${m[1]}`);
    }
    expect(bad).toEqual([]);
    // The keys the scan must have seen (a scan that finds nothing proves nothing).
    expect(new Set(keys)).toEqual(
      new Set([
        "syndrome.language",
        "syndrome.theme",
        "syndrome.model",
        "syndrome.challenge",
        "syndrome.challenge.open",
        "syndrome.spacetime.view",
        "syndrome.spacetime.gap",
        // sessionStorage (tasks/plans/analytics.md D11).
        "syndrome.analytics.appLanguage",
      ]),
    );
  });
});
