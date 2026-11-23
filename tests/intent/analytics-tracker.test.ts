import { createHash } from "node:crypto";
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
import { gzipSync } from "node:zlib";
import { createServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWithEnv } from "../helpers/build-with-env";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = process.cwd();
const TRACKER = join(ROOT, "vendor", "umami", "script.js");
/** Literal on purpose: never imported from tools/deploy, or a changed pin would follow. */
const TRACKER_SHA256 =
  "91a876d767646fd5b7701b6fabf97f8a99ae53b94e7e5b58d465bad1e5d763e0";
const TRACKER_BYTES = 4810;
const LICENSE_SHA256 =
  "d59f69c3a56253a150adfc42b41acd49e9024410ad087c58a23d506623258dfe";
/** A well-formed, fake Umami website ID. */
const WEBSITE_ID = "11111111-2222-4333-8444-555555555555";

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

interface Tag {
  readonly index: number;
  readonly attrs: ReadonlyMap<string, string>;
}

/** Every <script> opening tag of the HTML, in document order, with its attributes. */
function scriptTags(html: string): Tag[] {
  const tags: Tag[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of match[1]!.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      attrs.set(a[1]!.toLowerCase(), a[2] ?? "");
    }
    tags.push({ index: match.index, attrs });
  }
  return tags;
}

/**
 * test_intent_tracker_copy_is_pinned
 *
 * INTENCIÓN: el contador de Umami que sirve Syndrome es exactamente el que se revisó
 *   (tasks/plans/analytics.md D15, T-I2): `vendor/umami/script.js` es la copia byte a byte
 *   de la web de marca (Umami v3.4.0, 4 810 bytes, sha256 fijado aquí como literal), con su
 *   `LICENSE` MIT intacta, y el código lee los atributos de los que depende la privacidad
 *   (`data-exclude-hash`, `data-host-url`, `data-domains`).
 * CONTEXTO: es código de terceros que se ejecuta en cada visita; un refresco descuidado,
 *   un `npm run format` o una copia con CRLF (Windows) cambiarían lo que se ejecuta sin
 *   que nadie lo lea. `.gitattributes` normaliza a LF y `.prettierignore`/ESLint ignoran
 *   `vendor/`; este test es lo que lo comprueba.
 * EXPIRA SI: se actualiza deliberadamente el contador (nuevo sha256 aquí, en
 *   `tools/deploy/umami-plugin.ts`, en `vendor/umami/README.md` y en `docs/decisiones.md`)
 *   o se deja de servir un contador propio.
 */
describe("test_intent_tracker_copy_is_pinned", () => {
  it("vendor/umami/script.js is the pinned Umami v3.4.0 build, byte for byte (LF, 4 810 bytes)", () => {
    const bytes = readFileSync(TRACKER);
    expect(bytes.length).toBe(TRACKER_BYTES);
    expect(bytes.includes(0x0d), "a CR byte (CRLF checkout)").toBe(false);
    expect(sha256(bytes)).toBe(TRACKER_SHA256);
  });

  it("its MIT LICENSE is the one of the v3.4.0 tag, untouched", () => {
    expect(sha256(readFileSync(join(ROOT, "vendor", "umami", "LICENSE")))).toBe(
      LICENSE_SHA256,
    );
  });

  it("the tracker reads the attributes the privacy of Syndrome depends on", () => {
    const code = readFileSync(TRACKER, "utf8");
    for (const attribute of ["exclude-hash", "host-url", "domains"]) {
      expect(code, attribute).toContain(`"${attribute}"`);
    }
  });

  it("the provenance README states the same sha256", () => {
    const readme = readFileSync(
      join(ROOT, "vendor", "umami", "README.md"),
      "utf8",
    );
    expect(readme).toContain(TRACKER_SHA256);
    expect(readme).toContain(LICENSE_SHA256);
  });
});

/**
 * test_intent_tracker_once
 *
 * INTENCIÓN: el contador entra en el HTML de producción una sola vez, como la web lo
 *   carga y sólo cuando hay ID (tasks/plans/analytics.md D2, D3, T-I5). Build con ID:
 *   exactamente un `<script>` clásico con ese `data-website-id`, `defer`, `src`
 *   `/syndrome/assets/umami-<hash>.js` (servido por la app, sha256 = el fijado: Vite no lo
 *   transforma), `data-host-url="https://cloud.umami.is"`, `data-domains="seequant.app"`,
 *   `data-exclude-hash="true"` (el fragmento lleva la máscara del puzle), sin
 *   `data-exclude-search`, después de `<meta charset>` (que sigue siendo lo primero del
 *   `<head>`) y antes del `<script type="module">` de entrada. Sin ID: ni tag,
 *   ni `umami` en el HTML, ni fichero `umami-*` en `assets/`. Nunca el script de
 *   `cloud.umami.is`. ID mal formado: el build falla. En `npm run dev`, nada.
 * CONTEXTO: un tag duplicado cuenta cada visita dos veces; sin `exclude-hash` cada página
 *   vista enviaría `#c=<máscara>`; un contador tras la entrada llega tarde a `app_language`;
 *   inyectarlo en dev o sin ID contaría el tráfico del propio desarrollo. El cupo de Umami
 *   (100 000 eventos/mes) es compartido con la web.
 * EXPIRA SI: el contador deja de inyectarse en el build (p. ej. otro proveedor de
 *   analítica) o la app deja de servirse bajo `/syndrome/`.
 */
describe("test_intent_tracker_once", () => {
  let withId = "";
  let withoutId = "";

  beforeAll(async () => {
    withId = mkdtempSync(join(tmpdir(), "syndrome-umami-id-"));
    withoutId = mkdtempSync(join(tmpdir(), "syndrome-umami-none-"));
    await buildWithEnv({ outDir: withId, websiteId: ` ${WEBSITE_ID} ` });
    await buildWithEnv({ outDir: withoutId });
  });

  afterAll(() => {
    for (const dir of [withId, withoutId]) {
      if (dir !== "") rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with the ID: exactly one counter, with the brand site's attributes, before the module entry", () => {
    const html = readFileSync(join(withId, "index.html"), "utf8");
    const tags = scriptTags(html);
    const counters = tags.filter(
      (t) =>
        t.attrs.has("data-website-id") ||
        /umami/i.test(t.attrs.get("src") ?? ""),
    );
    expect(counters).toHaveLength(1);
    const counter = counters[0]!;
    expect(counter.attrs.get("data-website-id")).toBe(WEBSITE_ID);
    expect(counter.attrs.has("defer")).toBe(true);
    expect(counter.attrs.has("type"), "a classic script, never a module").toBe(
      false,
    );
    expect(counter.attrs.get("src")).toMatch(
      /^\/syndrome\/assets\/umami-[\w-]+\.js$/,
    );
    expect(counter.attrs.get("data-host-url")).toBe("https://cloud.umami.is");
    expect(counter.attrs.get("data-domains")).toBe("seequant.app");
    expect(counter.attrs.get("data-exclude-hash")).toBe("true");
    expect(counter.attrs.has("data-exclude-search")).toBe(false);
    const entry = tags.find((t) => t.attrs.get("type") === "module");
    expect(entry, "the module entry").toBeDefined();
    expect(counter.index).toBeLessThan(entry!.index);
    expect(counter.index).toBeLessThan(html.indexOf("</head>"));
    // <meta charset> stays the first element of <head> (the encoding must be
    // declared before anything else is parsed); the counter follows it.
    const charset = /<meta\s+charset=[^>]*>/i.exec(html);
    expect(charset, "<meta charset>").not.toBeNull();
    expect(
      html.slice(html.indexOf("<head>") + "<head>".length, charset!.index),
    ).toMatch(/^\s*$/);
    expect(counter.index).toBeGreaterThan(charset!.index);
    expect(html).not.toContain("cloud.umami.is/script.js");
  });

  it("with the ID: the served file is the vendored tracker, untransformed (same sha256)", () => {
    const html = readFileSync(join(withId, "index.html"), "utf8");
    const src = scriptTags(html)
      .map((t) => t.attrs.get("src") ?? "")
      .find((s) => s.includes("umami"))!;
    const file = join(withId, src.slice("/syndrome/".length));
    const bytes = readFileSync(file);
    expect(sha256(bytes)).toBe(TRACKER_SHA256);
    const files = readdirSync(join(withId, "assets")).filter((f) =>
      f.startsWith("umami"),
    );
    expect(files).toHaveLength(1);
    console.info(
      `[analytics-tracker] ${src} ${statSync(file).size} B, ${gzipSync(bytes).length} B gzip, sha256 ${sha256(bytes)}`,
    );
  });

  it("without the ID: no counter, no umami in the HTML, no umami-* file", () => {
    const html = readFileSync(join(withoutId, "index.html"), "utf8");
    expect(html).not.toMatch(/umami|data-website-id/i);
    expect(
      readdirSync(join(withoutId, "assets")).filter((f) => /umami/i.test(f)),
    ).toEqual([]);
  });

  it("a malformed ID fails the build", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "syndrome-umami-bad-"));
    try {
      await expect(
        buildWithEnv({ outDir, websiteId: "not-a-uuid" }),
      ).rejects.toThrow(/VITE_UMAMI_WEBSITE_ID must be a UUID/);
      expect(existsSync(join(outDir, "index.html"))).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("the dev server never injects it, even with the ID set", async () => {
    const previous = process.env.VITE_UMAMI_WEBSITE_ID;
    process.env.VITE_UMAMI_WEBSITE_ID = WEBSITE_ID;
    const server = await createServer({
      root: ROOT,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: "custom",
    });
    try {
      const source = readFileSync(join(ROOT, "index.html"), "utf8");
      const html = await server.transformIndexHtml("/syndrome/", source);
      expect(html).toContain('type="module"');
      expect(html).not.toMatch(/umami|data-website-id/i);
    } finally {
      await server.close();
      if (previous === undefined) delete process.env.VITE_UMAMI_WEBSITE_ID;
      else process.env.VITE_UMAMI_WEBSITE_ID = previous;
    }
  });
});
