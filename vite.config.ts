import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { APP_BASE, LANGUAGE_DIRS } from "./edge/paths.ts";
import { umamiPlugin } from "./tools/deploy/umami-plugin.ts";
import { localePagesPlugin } from "./tools/seo/locale-pages-plugin.ts";

/**
 * The service worker's navigation denylist (tasks/plans/syndrome-es-url.md
 * D7): for each language directory but the base, `^/syndrome/es(?:$|\?|\/.)`
 * — the directory without its slash (with or without a query) and anything
 * below it, but not the directory itself, which the precache serves.
 */
function languageDenylist(): RegExp[] {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return Object.values(LANGUAGE_DIRS)
    .filter((dir) => dir !== "")
    .map(
      (dir) =>
        new RegExp(
          `^${escape(APP_BASE + dir.slice(0, -1))}(?:$|\\?|${escape("/")}.)`,
        ),
    );
}

// https://vite.dev/config/ — Vitest reads the `test` block from the same file.
export default defineConfig({
  // The app lives at https://seequant.app/syndrome/ (docs/decisiones.md
  // 2026-10-19): every URL Vite writes (index.html, CSS url(), chunks, the
  // Worker, public/ files) carries the base, and the build lands in
  // dist/syndrome/ so wrangler's asset tree mirrors the served paths
  // (tools/deploy/stage.ts adds dist/_headers and removes anything else).
  base: APP_BASE,
  build: { outDir: "dist/syndrome" },
  plugins: [
    react(),
    // Umami counter (tasks/plans/analytics.md D2): build only, and only with
    // VITE_UMAMI_WEBSITE_ID; tools/deploy/check-prod.ts is the production gate.
    umamiPlugin(),
    // One indexable HTML per language (tasks/plans/syndrome-es-url.md D1):
    // the final index.html in English and es/index.html in Spanish, both with
    // the counter above, before the service worker precaches dist/.
    ...localePagesPlugin(),
    // PWA (tasks/plans/phase2.md D14): the whole site is precached (every
    // chunk, the Worker, the chart's base curves), so after the first visit the
    // grid, the walkthrough, the viewer and the chart work without network.
    // `prompt` (decision of 2026-10-18): a new
    // build installs and WAITS; the toast (src/ui/pwa/UpdateToast.tsx) offers
    // the reload, which posts SKIP_WAITING and reloads this tab. `autoUpdate`
    // would have workbox-window reload EVERY open tab the moment any tab saw
    // the new worker (a grid or a chart lost mid-way), never show the toast
    // (needRefresh is never raised in auto mode) and claim clients whose old
    // JS still asks for old chunk hashes. tests/intent/pwa-precache pins it.
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",
      manifest: {
        name: "Syndrome by SEEQuant",
        short_name: "Syndrome",
        description:
          "More qubits, fewer errors: an interactive surface-code visualizer and game.",
        // The app's own directory, never the brand site at the root: id,
        // start_url and scope are the base; the icons are relative to the
        // manifest, which is served from the base too.
        id: APP_BASE,
        start_url: APP_BASE,
        scope: APP_BASE,
        display: "standalone",
        // The light theme's canvas (src/index.css --bg); index.html repeats it.
        theme_color: "#ffffff",
        background_color: "#ffffff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // woff2: the display face (design.md D3) works offline too.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        // Navigations inside the scope only (the app routes by hash).
        navigateFallback: `${APP_BASE}index.html`,
        navigateFallbackAllowlist: [new RegExp(`^${APP_BASE}`)],
        // One HTML per language (tasks/plans/syndrome-es-url.md D7). The
        // precache route (registered first) serves /syndrome/es/ from the
        // precached es/index.html (directoryIndex), whatever the query: every
        // parameter is ignored for the lookup. Each language directory is
        // denied to the English fallback: /syndrome/es (the edge's 301) and
        // /syndrome/es/<anything else> (the edge's 404) go to the network.
        ignoreURLParametersMatching: [/.*/],
        navigateFallbackDenylist: languageDenylist(),
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    // Pure-core and intent tests run in Node; UI tests (phase 1) will opt into
    // jsdom per file with `// @vitest-environment jsdom`.
    environment: "node",
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
      "tools/**/*.test.ts",
    ],
    // testing-library's waitFor at 4 s instead of 1 s: the deferred panels
    // (chart, viewer) time out under a full parallel run (tests/helpers/setup.ts).
    setupFiles: ["tests/helpers/setup.ts"],
    // The plugin's virtual module exists for the bundler only; under Node the
    // UI tests get an inert hook (tests/helpers/pwa-register-stub.ts).
    alias: {
      "virtual:pwa-register/react": fileURLToPath(
        new URL("./tests/helpers/pwa-register-stub.ts", import.meta.url),
      ),
    },
    // npm run bench (tools/bench): shots per second of the core, docs/spec.md §7.
    benchmark: { include: ["tools/bench/**/*.bench.ts"] },
  },
});
