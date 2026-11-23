// The edge Worker of `syndrome` (tasks/plans/path-routing.md §1–§2;
// docs/decisiones.md 2026-10-19). Static assets go first: every file of
// dist/syndrome/ is answered by Cloudflare's asset server at /syndrome/… and
// never reaches this code. What does reach it:
//
//   - every request to the legacy host syndrome.seequant.app (it has no
//     assets at its root any more): a permanent redirect to the same path
//     under https://seequant.app/syndrome/, except /sw.js, which answers a
//     service worker that retires the old one (a SW update fetch that gets a
//     redirect fails, so the old worker would stay forever). A path already
//     under the base (/syndrome, /syndrome/…) keeps its path, never doubled.
//     ACCEPTED GAP: static assets win before this code on every host, so on
//     the legacy host a /syndrome/… path that IS an asset (/syndrome/,
//     /syndrome/index.html, /syndrome/assets/…, /syndrome/sw.js…) is served
//     as the app from syndrome.seequant.app, not redirected; only /syndrome
//     (run_worker_first) and /syndrome/… paths with no asset reach the
//     mapping. Closing it would need run_worker_first on every asset (one
//     Worker invocation per asset request); nothing ever linked to those
//     paths on the old origin;
//   - /syndrome without its slash (wrangler.jsonc `run_worker_first`): a
//     permanent redirect to /syndrome/;
//   - one URL per language (tasks/plans/syndrome-es-url.md D8): a language
//     directory without its slash (/syndrome/es, also in `run_worker_first`,
//     or the asset server would answer it with its own non-301 redirect) is a
//     permanent redirect to /syndrome/es/ with its query; the base language's
//     would-be directory (/syndrome/en, /syndrome/en/) is a permanent redirect
//     to /syndrome/, its one URL; /syndrome/es/ itself is the asset
//     es/index.html and never reaches this code;
//   - anything else under the routes (a path with no asset, /syndrome/es/x
//     included): 404.
//
// Pure fetch handler: only Request, Response and URL, so the intent tests call
// it directly (tests/intent/path-routing.test.ts).
//
// This is wrangler.jsonc's `main`: it must export nothing but `default` (type
// exports are erased). workerd reads every named export of the entry point as
// an entrypoint and refuses to start on anything else, so shared values live
// in their own modules (edge/paths.ts, edge/retire-sw.ts).

import {
  APP_BASE,
  CANONICAL_ORIGIN,
  LANGUAGE_DIRS,
  LEGACY_HOST,
} from "./paths";
import { RETIRE_SW } from "./retire-sw";

export interface Env {
  /**
   * "302" makes every legacy-host answer a temporary redirect, sw.js included
   * (the old service worker stays untouched): the first deploy phase, before
   * the new location has been measured (`wrangler deploy --var LEGACY_STATUS:302`).
   */
  readonly LEGACY_STATUS?: string;
}

function redirect(location: string, status: number): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/**
 * The canonical path a legacy-host path moves to. A path already under the
 * base (`/syndrome` itself or `/syndrome/…`, e.g. a link copied while the
 * legacy host still served the new build) keeps its path, so the base is never
 * doubled (`/syndrome/syndrome/…` would be a 404); anything else goes under
 * the base. A path that lands on one of the canonical host's redirects (`/es`
 * → `/syndrome/es`, `/en` → `/syndrome/en`) goes straight to its page, in one
 * hop instead of two.
 */
function legacyTarget(pathname: string): string {
  if (pathname === APP_BASE.slice(0, -1)) return APP_BASE;
  const target = pathname.startsWith(APP_BASE)
    ? pathname
    : APP_BASE + pathname.slice(1);
  return CANONICAL_REDIRECTS.get(target) ?? target;
}

/**
 * The permanent redirects of the canonical host: each path that is not a page
 * but names one, to that page. `/syndrome` → `/syndrome/`; per language with a
 * directory, `/syndrome/es` → `/syndrome/es/`; for the base language (dir ""),
 * `/syndrome/en` and `/syndrome/en/` → `/syndrome/`.
 */
const CANONICAL_REDIRECTS: ReadonlyMap<string, string> = new Map([
  [APP_BASE.slice(0, -1), APP_BASE],
  ...Object.entries(LANGUAGE_DIRS).flatMap(([lang, dir]): [string, string][] =>
    dir === ""
      ? [
          [APP_BASE + lang, APP_BASE],
          [`${APP_BASE}${lang}/`, APP_BASE],
        ]
      : [[APP_BASE + dir.slice(0, -1), APP_BASE + dir]],
  ),
]);

export default {
  fetch(request: Request, env: Env = {}): Response {
    const url = new URL(request.url);
    if (url.hostname === LEGACY_HOST) {
      const permanent = env.LEGACY_STATUS !== "302";
      if (permanent && url.pathname === "/sw.js") {
        return new Response(RETIRE_SW, {
          status: 200,
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }
      return redirect(
        CANONICAL_ORIGIN + legacyTarget(url.pathname) + url.search,
        permanent ? 301 : 302,
      );
    }
    const target = CANONICAL_REDIRECTS.get(url.pathname);
    if (target !== undefined) {
      return redirect(target + url.search, 301);
    }
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
