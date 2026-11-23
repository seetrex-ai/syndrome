// The Umami counter in the production HTML (tasks/plans/analytics.md D2, D3).
//
// Build only, and only when VITE_UMAMI_WEBSITE_ID is set (read the way Vite
// reads every VITE_ variable: process.env plus the .env files of the mode).
// Then the vendored tracker (vendor/umami/script.js, byte for byte) is emitted
// as a hashed asset (assets/umami-<hash>.js, immutable and precached by the
// service worker like every other asset) and ONE classic deferred <script> is
// inserted right after <meta charset> (which must stay the first thing in
// <head>) and so before the module entry Vite moves into <head>. Without the
// ID nothing is
// emitted and nothing is injected: dev, CI checks and previews never count.
//
// The attributes are the brand site's (seequant.app):
// data-exclude-hash is mandatory here, because the fragment carries the puzzle
// mask (#c=…, #v=…) that the shared taxonomy never sends; data-domains keeps
// localhost, *.workers.dev previews and the legacy host out. No imports from
// the app: this file is loaded by vite.config.ts and by tools/deploy.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** The build-time variable that carries the Umami website ID (public, not a secret). */
export const UMAMI_ENV_VAR = "VITE_UMAMI_WEBSITE_ID";

/** sha256 of vendor/umami/script.js (Umami v3.4.0, vendor/umami/README.md). */
export const TRACKER_SHA256 =
  "91a876d767646fd5b7701b6fabf97f8a99ae53b94e7e5b58d465bad1e5d763e0";

/** The vendored tracker of this repo. */
export const TRACKER_SOURCE = fileURLToPath(
  new URL("../../vendor/umami/script.js", import.meta.url),
);

/** The name the emitted asset is given (Vite turns it into assets/umami-<hash>.js). */
export const TRACKER_ASSET_NAME = "umami.js";

/** Attributes of the counter besides src, data-website-id and defer. */
export const TRACKER_ATTRS = {
  "data-host-url": "https://cloud.umami.is",
  "data-domains": "seequant.app",
  "data-exclude-hash": "true",
} as const;

const CHARSET_META = /<meta\s+charset=[^>]*>/gi;

const escapeAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `id` has the shape of an Umami website ID. */
export function isWebsiteId(id: string): boolean {
  return UUID.test(id);
}

/**
 * The trimmed website ID, `undefined` when absent or blank (a CI variable
 * that does not exist arrives as ""); throws when present but not a UUID.
 */
export function websiteIdFrom(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const id = env[UMAMI_ENV_VAR]?.trim();
  if (id === undefined || id === "") return undefined;
  if (!isWebsiteId(id)) {
    throw new Error(
      `${UMAMI_ENV_VAR} must be a UUID, got ${JSON.stringify(id)}`,
    );
  }
  return id;
}

export function umamiPlugin(trackerSource: string = TRACKER_SOURCE): Plugin {
  let id: string | undefined;
  let base = "/";
  return {
    name: "syndrome:umami",
    apply: "build",
    configResolved(config) {
      id = websiteIdFrom(config.env);
      base = config.base;
    },
    buildStart() {
      if (id === undefined) return;
      this.emitFile({
        type: "asset",
        name: TRACKER_ASSET_NAME,
        source: readFileSync(trackerSource),
      });
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (id === undefined) return;
        const assets = Object.values(ctx.bundle ?? {}).filter(
          (file) =>
            file.type === "asset" &&
            (file.names ?? []).includes(TRACKER_ASSET_NAME),
        );
        if (assets.length !== 1) {
          throw new Error(
            `expected one emitted ${TRACKER_ASSET_NAME}, found ${assets.length}`,
          );
        }
        const attrs: Record<string, string> = {
          src: base + assets[0]!.fileName,
          "data-website-id": id,
          ...TRACKER_ATTRS,
        };
        const tag = `<script defer${Object.entries(attrs)
          .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
          .join("")}></script>`;
        const charsets = [...html.matchAll(CHARSET_META)];
        if (charsets.length !== 1) {
          throw new Error(
            `expected one <meta charset> in index.html, found ${charsets.length}`,
          );
        }
        const at = charsets[0]!.index + charsets[0]![0].length;
        return html.slice(0, at) + tag + html.slice(at);
      },
    },
  };
}
