// The production gate (tasks/plans/analytics.md D9): is the built dist/ what
// production should serve, analytics-wise? Runs between `npm run build` and
// `wrangler deploy` (package.json `deploy`, CI's production step).
//
//   UMAMI_READY  website ID         each language's HTML         result
//   false        absent             0 counters                   pass, warning (provisional)
//   false        UUID               1 counter, that ID, sha256   pass, warning (set UMAMI_READY)
//   true         UUID               1 counter, that ID, sha256   pass
//   true         absent             —                            BLOCK
//   any          not a UUID         —                            BLOCK
//   any          UUID               ≠ 1 counter / ID / sha256    BLOCK (stale dist or no ID at build)
//   false        absent             ≥ 1 counter                  BLOCK (inconsistent dist)
//
// "Each language's HTML" is every page of LANGUAGE_DIRS (dist/syndrome/
// index.html and dist/syndrome/es/index.html; tasks/plans/syndrome-es-url.md
// D8): each must exist and pass on its own, so a page without the counter, or
// with another one, blocks even when the other page is right.
//
// The ID is read as Vite reads it (loadEnv of the production mode: process.env
// plus .env, .env.production and their .local variants), so a local
// `.env.production.local` counts the same in the build and here.
//
// Usage: tsx tools/deploy/check-prod.ts [--production] [--dist DIR] [--env-dir DIR]
// Without --production it reports and exits 0; with it, a BLOCK exits 1.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "vite";
import { APP_BASE, LANGUAGE_DIRS } from "../../edge/paths";
import { UMAMI_READY } from "./accounts";
import { TRACKER_SHA256, UMAMI_ENV_VAR, websiteIdFrom } from "./umami-plugin";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** dist/syndrome under `distDir`. */
const appDir = (distDir: string): string =>
  join(distDir, APP_BASE.replace(/^\/|\/$/g, ""));

export interface GateInput {
  /** UMAMI_READY of tools/deploy/accounts.ts. */
  readonly ready: boolean;
  /** The environment as Vite loads it for production. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The staged dist/ (the one that holds syndrome/ and _headers). */
  readonly distDir: string;
}

export interface GateResult {
  /** false = the deploy must not go ahead. */
  readonly ok: boolean;
  readonly blocks: readonly string[];
  readonly warnings: readonly string[];
}

interface Counter {
  readonly id: string | undefined;
  readonly src: string | undefined;
}

/** Every <script> of the HTML that is an Umami counter (website ID or umami in its src). */
export function countersIn(html: string): Counter[] {
  const counters: Counter[] = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const id = /\sdata-website-id="([^"]*)"/i.exec(tag)?.[1];
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1];
    if (id !== undefined || /umami/i.test(src ?? "")) {
      counters.push({ id, src });
    }
  }
  return counters;
}

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** Exactly one counter in `htmlFile`, with `id` and the pinned tracker; else a block. */
function checkCounter(
  htmlFile: string,
  id: string,
  distDir: string,
  blocks: string[],
): void {
  const counters = countersIn(readFileSync(htmlFile, "utf8"));
  if (counters.length !== 1) {
    blocks.push(
      `${htmlFile} has ${counters.length} Umami counter(s), expected exactly 1: dist/ is stale or was built without the ID, rebuild`,
    );
    return;
  }
  const [counter] = counters as [Counter];
  if (counter.id !== id) {
    blocks.push(
      `the counter in ${htmlFile} carries website ID ${JSON.stringify(counter.id)}, the environment ${JSON.stringify(id)}: rebuild`,
    );
  }
  const src = counter.src ?? "";
  const file = src.startsWith(APP_BASE)
    ? join(appDir(distDir), src.slice(APP_BASE.length))
    : undefined;
  if (file === undefined || !existsSync(file)) {
    blocks.push(
      `the counter's src ${JSON.stringify(src)} in ${htmlFile} is not a file of ${appDir(distDir)}`,
    );
  } else if (sha256(file) !== TRACKER_SHA256) {
    blocks.push(
      `${file} is not the pinned tracker (sha256 ${sha256(file)}, expected ${TRACKER_SHA256})`,
    );
  }
}

export function evaluateGate({ ready, env, distDir }: GateInput): GateResult {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const done = (): GateResult => ({
    ok: blocks.length === 0,
    blocks,
    warnings,
  });

  let id: string | undefined;
  try {
    id = websiteIdFrom(env);
  } catch (error: unknown) {
    blocks.push(error instanceof Error ? error.message : String(error));
    return done();
  }
  if (ready && id === undefined) {
    blocks.push(
      `UMAMI_READY is true (tools/deploy/accounts.ts) but ${UMAMI_ENV_VAR} is not set: production would ship without analytics`,
    );
    return done();
  }

  const pages = Object.values(LANGUAGE_DIRS).map((dir) =>
    join(appDir(distDir), `${dir}index.html`),
  );
  const missing = pages.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    for (const file of missing)
      blocks.push(`${file} not found: run npm run build first`);
    return done();
  }

  if (id === undefined) {
    for (const htmlFile of pages) {
      const counters = countersIn(readFileSync(htmlFile, "utf8"));
      if (counters.length > 0) {
        blocks.push(
          `${htmlFile} has ${counters.length} Umami counter(s) but ${UMAMI_ENV_VAR} is not set: dist/ was built with another environment, rebuild`,
        );
      }
    }
    if (blocks.length === 0) {
      warnings.push(
        "production without analytics (provisional state decided on 2026-10-19, UMAMI_READY = false)",
      );
    }
    return done();
  }

  for (const htmlFile of pages) checkCounter(htmlFile, id, distDir, blocks);
  if (blocks.length === 0 && !ready) {
    warnings.push(
      "analytics is built in but UMAMI_READY is false: set UMAMI_READY = true in tools/deploy/accounts.ts so a missing ID blocks from now on",
    );
  }
  return done();
}

/** The CLI; returns the exit code. */
export function runCli(
  argv: readonly string[],
  ready: boolean = UMAMI_READY,
): number {
  const production = argv.includes("--production");
  const option = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const distDir = resolve(option("--dist") ?? join(ROOT, "dist"));
  const envDir = resolve(option("--env-dir") ?? ROOT);
  const env = loadEnv("production", envDir, "VITE_");
  const result = evaluateGate({ ready, env, distDir });
  for (const warning of result.warnings) console.warn(`check:prod: ${warning}`);
  for (const block of result.blocks)
    console.error(`check:prod: BLOCK: ${block}`);
  if (result.ok) {
    console.log("check:prod: ok");
    return 0;
  }
  if (!production) {
    console.log("check:prod: would block a production deploy (--production)");
    return 0;
  }
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runCli(process.argv.slice(2));
}
