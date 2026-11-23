// dist/ served from inside the script (tasks/plans/video.md D1): a route on the
// browser context answers every request to a fake origin with the file of
// dist/syndrome/ under the app's base path (edge/paths.ts), index.html for a
// path under the base that is not a file, and 404 outside the base. No server, no port, no process to kill
// (nothing left running after the script ends). The script never builds: a missing
// dist/syndrome/index.html stops it with the command to run.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { BrowserContext } from "playwright";
import { APP_BASE } from "../../edge/paths";

export const DEFAULT_ORIGIN = "http://syndrome.video";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

/** The media type of a file by extension; octet-stream for an unknown one. */
export function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

export interface DistInfo {
  readonly indexSha256: string;
  readonly indexMtime: string;
}

/** dist/index.html exists: its hash and mtime for the manifest. Throws otherwise. */
export function assertDist(distDir: string): DistInfo {
  const index = join(distDir, "index.html");
  if (!existsSync(index)) {
    throw new Error(
      `${index} not found: run \`npm run build\` first (the video script never builds)`,
    );
  }
  return {
    indexSha256: createHash("sha256").update(readFileSync(index)).digest("hex"),
    indexMtime: statSync(index).mtime.toISOString(),
  };
}

/**
 * The file of the app's build directory (dist/syndrome/) a URL path names, or
 * index.html when a path under the base names none (SPA fallback). The app is
 * built with Vite's `base` (edge/paths.ts APP_BASE), so every URL it asks for
 * starts with it: the prefix is stripped. A path outside the base is null (a
 * 404, as in production, where the rest of the origin is not this app's), so
 * a URL that escaped the base fails loudly instead of getting index.html.
 */
export function fileFor(
  appDir: string,
  pathname: string,
  base: string = APP_BASE,
): string | null {
  const root = normalize(appDir + sep);
  const index = join(appDir, "index.html");
  if (!pathname.startsWith(base)) return null;
  const rest = pathname.slice(base.length);
  const candidate = normalize(join(appDir, decodeURIComponent(rest)));
  if (
    candidate.startsWith(root) &&
    existsSync(candidate) &&
    statSync(candidate).isFile()
  ) {
    return candidate;
  }
  return index;
}

/** Answer every request to `origin` from `distDir`. */
export async function routeDist(
  context: BrowserContext,
  distDir: string,
  origin: string = DEFAULT_ORIGIN,
): Promise<void> {
  await context.route(`${origin}/**`, async (route) => {
    const file = fileFor(distDir, new URL(route.request().url()).pathname);
    if (file === null) {
      await route.fulfill({
        status: 404,
        contentType: "text/plain; charset=utf-8",
        body: "Not found",
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: mimeOf(file),
      body: readFileSync(file),
    });
  });
}
