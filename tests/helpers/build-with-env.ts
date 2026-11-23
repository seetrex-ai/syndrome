import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { UMAMI_ENV_VAR } from "../../tools/deploy/umami-plugin";

export interface BuildOptions {
  /** Temporary output directory (the app directory, i.e. what dist/syndrome/ holds). */
  readonly outDir: string;
  /** The Umami website ID the build sees; `undefined` = absent. */
  readonly websiteId?: string;
  /** Write .vite/manifest.json (bundle-budget). */
  readonly manifest?: boolean;
}

/**
 * A production `vite.build()` (what `npm run build` ships: `mode` and
 * `NODE_ENV` production; vitest runs with NODE_ENV=test, which would build
 * React's development runtime) whose Umami environment is exactly
 * `websiteId`: an empty `envDir` of its own (no `.env.production.local` of
 * the developer) and `VITE_UMAMI_WEBSITE_ID` set or deleted in process.env,
 * restored afterwards. Builds measured by the intent tests are thereby immune
 * to an ID in the developer's environment (tasks/plans/analytics.md §5).
 */
export async function buildWithEnv({
  outDir,
  websiteId,
  manifest = false,
}: BuildOptions): Promise<void> {
  const envDir = mkdtempSync(join(tmpdir(), "syndrome-env-"));
  const previousNodeEnv = process.env.NODE_ENV;
  const previousId = process.env[UMAMI_ENV_VAR];
  process.env.NODE_ENV = "production";
  if (websiteId === undefined) delete process.env[UMAMI_ENV_VAR];
  else process.env[UMAMI_ENV_VAR] = websiteId;
  try {
    await build({
      root: process.cwd(),
      mode: "production",
      envDir,
      logLevel: "silent",
      build: { outDir, emptyOutDir: true, write: true, manifest },
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousId === undefined) delete process.env[UMAMI_ENV_VAR];
    else process.env[UMAMI_ENV_VAR] = previousId;
    rmSync(envDir, { recursive: true, force: true });
  }
}
