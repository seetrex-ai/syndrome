// npm run build, last step (tasks/plans/path-routing.md §3.4): shape dist/ into
// exactly what wrangler uploads as assets (wrangler.jsonc `assets.directory`):
//
//   dist/_headers     copied from edge/_headers
//   dist/syndrome/    the Vite build (base /syndrome/)
//
// Anything else under dist/ is deleted. Vite only empties dist/syndrome/, so a
// dist/ left by an older build (index.html, sw.js at the root) would otherwise
// be uploaded, served by the asset server ahead of the Worker on the legacy
// host, and the old service worker would never be retired (R4, silently).
// Throws when the build is incomplete. Usage: tsx tools/deploy/stage.ts [DIST]

import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_BASE, LANGUAGE_DIRS } from "../../edge/paths";

/** The directory of dist/ the app is built into: "syndrome". */
export const APP_DIR = APP_BASE.replace(/^\/|\/$/g, "");

/**
 * The files a complete build has under APP_DIR: one HTML per language
 * (index.html, es/index.html; tasks/plans/syndrome-es-url.md D8) and the
 * service worker.
 */
export const REQUIRED_FILES: readonly string[] = [
  ...Object.values(LANGUAGE_DIRS).map((dir) => `${dir}index.html`),
  "sw.js",
];

/** edge/_headers of this repo. */
export const HEADERS_SOURCE = fileURLToPath(
  new URL("../../edge/_headers", import.meta.url),
);

/** Leave only `APP_DIR/` and `_headers` in `distDir`; returns what was removed. */
export function stageDist(
  distDir: string,
  headersSource: string = HEADERS_SOURCE,
): string[] {
  for (const required of REQUIRED_FILES) {
    const file = join(distDir, APP_DIR, required);
    if (!existsSync(file)) {
      throw new Error(`${file} not found: the build is incomplete`);
    }
  }
  const removed: string[] = [];
  for (const entry of readdirSync(distDir)) {
    if (entry === APP_DIR || entry === "_headers") continue;
    rmSync(join(distDir, entry), { recursive: true, force: true });
    removed.push(entry);
  }
  copyFileSync(headersSource, join(distDir, "_headers"));
  return removed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const distDir = resolve(process.argv[2] ?? "dist");
    const removed = stageDist(distDir);
    console.log(
      `staged ${distDir}: ${APP_DIR}/ + _headers` +
        (removed.length > 0 ? ` (removed ${removed.join(", ")})` : ""),
    );
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
