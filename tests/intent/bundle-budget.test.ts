import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWithEnv } from "../helpers/build-with-env";

// A production build takes a few seconds; well below this, but not below 5 s.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * test_intent_bundle_budget
 *
 * INTENCIÓN: medir el presupuesto de carga, no fiarlo (docs/spec.md §7): `vite.build()`
 *   programático EN MODO PRODUCCIÓN (`mode` y `NODE_ENV`, lo que `npm run build` sirve)
 *   a un `outDir` temporal con manifiesto; el chunk de entrada y lo que importa
 *   estáticamente pesan ≤ 200 kB gzip y no llevan `jsxDEV`; el chunk de la gráfica sólo
 *   aparece como `dynamicImports`; existe un activo propio del Worker.
 * CONTEXTO: tasks/plans/ui.md M1 (87 kB gzip en `main` antes de la interfaz) y D4/D6. Una
 *   dependencia de gráfica (recharts, chart.js: 100–150 kB gzip) o un import estático del
 *   panel lo romperían sin que ningún otro test lo note; aquí se ve la cifra en cada
 *   `npm test`. Cifra tras la PWA (phase2.md D14):
 *   entrada 118,5 kB gzip en tres chunks (`index` 91,7 + `noise-kinds`
 *   26,5 + runtime 0,4; antes de la PWA: 90,1 + 26,5 + 0,4), más `workbox-window` 2,2 kB gzip
 *   que el registro del service worker carga en diferido (no entra en la entrada).
 * EXPIRA SI: el despliegue deja de ser un sitio estático de Vite (otro bundler, otro
 *   manifiesto) o cambia el presupuesto de §7.
 */

// kB as docs/spec.md §7 and Vite count them: 1 000 bytes.
// Tightened by the redesign (tasks/plans/design.md D9, T-D5): 118.47 kB
// before, 119.60 after the four stages (entry + noise-kinds + runtime).
const BUDGET_GZIP_BYTES = 126 * 1000;
// The stylesheets (every chunk's CSS): 4,92 kB gzip before the PWA and themes,
// 5,69 after their `@supports not` fallbacks, 5,8 after the dimming tokens;
// a ceiling with room for a panel or two, not for a framework.
// 10 kB since the redesign (design.md D9, T-D5): controls.css and the
// duplicated fallback tokens, 7.83 kB after the four stages.
// 11 kB since the brand bar with the products navigation (2026-10-20,
// docs/decisiones.md): 9 877 B with 123 B left;
// deduplicating its rules did not shrink the gzip (9 896 B after it, the
// repeats already compress), so the ceiling moves by one brand bar's worth.
const CSS_BUDGET_GZIP_BYTES = 11 * 1000;
// The deferred chart chunk (design.md D5, T-D5): 11.8 kB gzip before the
// redesign, 12.18 after the sub-threshold region and the crossings; a ceiling
// that admits a marker or two, not a charting library.
const CHART_BUDGET_GZIP_BYTES = 14 * 1000;

interface ManifestChunk {
  readonly file: string;
  readonly src?: string;
  readonly isEntry?: boolean;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
  readonly css?: readonly string[];
}

type Manifest = Readonly<Record<string, ManifestChunk>>;

let outDir = "";
let manifest: Manifest = {};
let assets: string[] = [];

const gzipOf = (file: string): number =>
  gzipSync(readFileSync(join(outDir, file))).length;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "syndrome-bundle-"));
  // Vitest runs with NODE_ENV=test and vite.build() inherits it: React's
  // development build (jsxDEV, 159 kB gzip) instead of what `npm run build`
  // ships. The helper forces production on both
  // knobs and builds without the Umami ID whatever the developer's
  // environment holds (tasks/plans/analytics.md §5): the counter is a
  // separate deferred script, not part of the initial JavaScript.
  await buildWithEnv({ outDir, manifest: true });
  manifest = JSON.parse(
    readFileSync(join(outDir, ".vite", "manifest.json"), "utf8"),
  ) as Manifest;
  assets = readdirSync(join(outDir, "assets"));
});

afterAll(() => {
  if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
});

function entryChunk(): [key: string, chunk: ManifestChunk] {
  const entry = Object.entries(manifest).find(([, c]) => c.isEntry === true);
  if (entry === undefined) throw new Error("no entry chunk in the manifest");
  return entry;
}

/** The entry chunk plus everything it imports statically (transitively). */
function initialChunks(): string[] {
  const [key] = entryChunk();
  const seen = new Set<string>();
  const queue = [key];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i]!;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const dep of manifest[k]?.imports ?? []) queue.push(dep);
  }
  return [...seen];
}

describe("test_intent_bundle_budget", () => {
  it("the initial JavaScript (entry + static imports) is ≤ 200 kB gzip", () => {
    const chunks = initialChunks();
    const sizes = chunks.map((k) => ({
      chunk: k,
      file: manifest[k]!.file,
      gzip: gzipOf(manifest[k]!.file),
    }));
    const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
    // The figure for the report (docs/decisiones.md), visible in the test log.
    console.info(
      `[bundle-budget] initial gzip ${total} B over ${sizes.length} chunk(s): ${sizes
        .map((s) => `${s.file} ${s.gzip} B`)
        .join(", ")}`,
    );
    expect(total).toBeLessThanOrEqual(BUDGET_GZIP_BYTES);
  });

  it("measures the production build: no jsxDEV (React's development runtime) in the initial chunks", () => {
    for (const k of initialChunks()) {
      const code = readFileSync(join(outDir, manifest[k]!.file), "utf8");
      expect(code, `${manifest[k]!.file} carries jsxDEV`).not.toContain(
        "jsxDEV",
      );
    }
  });

  it("the chart chunk exists and is reachable only through dynamicImports", () => {
    const chartKey = Object.keys(manifest).find((k) =>
      k.replace(/\\/g, "/").endsWith("src/ui/chart/ChartPanel.tsx"),
    );
    expect(chartKey, "chart chunk in the manifest").toBeDefined();
    const [entryKey, entry] = entryChunk();
    expect(entry.dynamicImports ?? []).toContain(chartKey);
    for (const [key, chunk] of Object.entries(manifest)) {
      expect(
        chunk.imports ?? [],
        `${key} imports the chart chunk statically`,
      ).not.toContain(chartKey);
    }
    expect(initialChunks()).not.toContain(chartKey);
    const chartGzip = gzipOf(manifest[chartKey!]!.file);
    console.info(
      `[bundle-budget] entry ${entryKey} → ${manifest[entryKey]!.file}; chart ${manifest[chartKey!]!.file} ${chartGzip} B gzip`,
    );
    expect(chartGzip).toBeLessThanOrEqual(CHART_BUDGET_GZIP_BYTES);
  });

  it("the spacetime viewer chunk exists and is reachable only through dynamicImports (phase2-g.md D9)", () => {
    const viewerKey = Object.keys(manifest).find((k) =>
      k.replace(/\\/g, "/").endsWith("src/ui/spacetime/SpacetimePanel.tsx"),
    );
    expect(viewerKey, "viewer chunk in the manifest").toBeDefined();
    const [, entry] = entryChunk();
    expect(entry.dynamicImports ?? []).toContain(viewerKey);
    for (const [key, chunk] of Object.entries(manifest)) {
      expect(
        chunk.imports ?? [],
        `${key} imports the viewer chunk statically`,
      ).not.toContain(viewerKey);
    }
    expect(initialChunks()).not.toContain(viewerKey);
    // The figure for the report: the viewer chunk and what it pulls in that
    // the entry does not (rolldown may share the 3D core with the Worker).
    const own = manifest[viewerKey!]!;
    const shared = (own.imports ?? []).filter(
      (k) => !initialChunks().includes(k),
    );
    console.info(
      `[bundle-budget] spacetime ${own.file} ${gzipOf(own.file)} B gzip${
        shared.length > 0
          ? `; shared chunks ${shared
              .map((k) => `${manifest[k]!.file} ${gzipOf(manifest[k]!.file)} B`)
              .join(", ")}`
          : ""
      }`,
    );
  });

  it("the stylesheets together are ≤ 11 kB gzip", () => {
    const sheets = assets.filter((f) => f.endsWith(".css"));
    expect(sheets.length).toBeGreaterThan(0);
    const sizes = sheets.map((f) => ({
      file: f,
      gzip: gzipSync(readFileSync(join(outDir, "assets", f))).length,
    }));
    const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
    console.info(
      `[bundle-budget] css gzip ${total} B over ${sizes.length} file(s): ${sizes
        .map((s) => `${s.file} ${s.gzip} B`)
        .join(", ")}`,
    );
    expect(total).toBeLessThanOrEqual(CSS_BUDGET_GZIP_BYTES);
  });

  it("the Worker is emitted as its own asset", () => {
    const workers = assets.filter((f) => /sim\.worker.*\.js$/.test(f));
    expect(workers).toHaveLength(1);
    const size = gzipSync(
      readFileSync(join(outDir, "assets", workers[0]!)),
    ).length;
    console.info(`[bundle-budget] worker ${workers[0]} ${size} B gzip`);
    expect(size).toBeGreaterThan(1000);
  });
});
