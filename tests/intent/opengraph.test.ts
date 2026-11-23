import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ogSvg } from "../../tools/og/og-svg";
import { localizeHtml } from "../../tools/seo/locale-pages";

/**
 * test_intent_opengraph_meta
 *
 * INTENCIÓN: un enlace compartido a seequant.app/syndrome/ (o a /syndrome/es/) lleva tarjeta
 *   (tasks/plans/phase2.md D14): la cabecera de CADA idioma (`localizeHtml` sobre el
 *   `index.html` fuente: lo que el build escribe en `index.html` y `es/index.html`,
 *   tasks/plans/syndrome-es-url.md D2) declara `og:title`, `og:description`, `og:image` con URL ABSOLUTA
 *   (los agregadores no resuelven relativas), `og:url`, `og:type` y `twitter:card =
 *   summary_large_image`, y la imagen existe en `public/og.png` con 1200 × 630 píxeles
 *   leídos de su cabecera IHDR, no supuestos. Los iconos de la PWA (192, 512 y el
 *   enmascarable de 512) se leen igual.
 * CONTEXTO: la imagen es estática y en inglés (decisión D14 del plan de fase 2); se
 *   renderiza una vez desde un SVG propio y se commitea, así que nada en el build la
 *   regenera y sólo este test nota que falta o que cambió de tamaño. El SVG commiteado
 *   (`tools/og/og.svg`) debe ser EXACTAMENTE lo que `tools/og/og-svg.ts` genera hoy desde
 *   los tokens: si cambia la paleta y nadie regenera la tarjeta, esto enrojece (el
 *   generador llegó a llevar un token borrado y no arrancaba).
 * EXPIRA SI: la imagen de la tarjeta se genera por idioma o en el servidor.
 */

const ROOT = process.cwd();
const source = readFileSync(join(ROOT, "index.html"), "utf8");
/** The head each language ships with (what the build writes). */
const PAGES = {
  en: {
    html: localizeHtml(source, "en"),
    url: "https://seequant.app/syndrome/",
  },
  es: {
    html: localizeHtml(source, "es"),
    url: "https://seequant.app/syndrome/es/",
  },
} as const;
const html = PAGES.en.html;

function meta(
  attribute: "property" | "name",
  key: string,
  page: string = html,
): string | undefined {
  const re = new RegExp(
    `<meta\\s+(?:[^>]*?\\s)?${attribute}="${key}"\\s+content="([^"]*)"|<meta\\s+content="([^"]*)"\\s+${attribute}="${key}"`,
    "s",
  );
  const m = re.exec(page);
  return m?.[1] ?? m?.[2];
}

/** Width and height from a PNG's IHDR chunk (bytes 16–23, big-endian). */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.subarray(0, 8).equals(signature), `${file} is a PNG`).toBe(true);
  expect(bytes.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("test_intent_opengraph_meta", () => {
  it.each(Object.entries(PAGES))(
    "the %s page declares the OpenGraph and Twitter card tags",
    (_lang, { html: page, url }) => {
      expect(meta("property", "og:type", page)).toBe("website");
      expect(meta("property", "og:url", page)).toBe(url);
      expect(page).toContain(`<link rel="canonical" href="${url}" />`);
      expect(meta("property", "og:title", page)).toMatch(
        /^Syndrome: .+ · SEEQuant$/,
      );
      expect(
        meta("property", "og:description", page)?.length ?? 0,
      ).toBeGreaterThan(20);
      expect(meta("property", "og:image", page)).toBe(
        "https://seequant.app/syndrome/og.png",
      );
      expect(meta("name", "twitter:card", page)).toBe("summary_large_image");
    },
  );

  it("tools/og/og.svg is what the generator produces from today's tokens (regenerate it and the PNG otherwise)", () => {
    expect(readFileSync(join(ROOT, "tools", "og", "og.svg"), "utf8")).toBe(
      ogSvg(),
    );
  });

  it("public/og.png is a 1200 × 630 PNG (IHDR)", () => {
    expect(pngSize(join(ROOT, "public", "og.png"))).toEqual({
      width: 1200,
      height: 630,
    });
    // The declared size, when present, says the same.
    expect(meta("property", "og:image:width") ?? "1200").toBe("1200");
    expect(meta("property", "og:image:height") ?? "630").toBe("630");
  });

  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable.png", 512],
  ])("public/%s is a %i × %i PNG (IHDR)", (file, size) => {
    expect(pngSize(join(ROOT, "public", file))).toEqual({
      width: size,
      height: size,
    });
  });

  // The two "any" icons keep the rounded badge's corners transparent: IHDR
  // colour type 6 (RGBA) and the top-left pixel's alpha 0, read by inflating
  // the IDAT stream (the first pixel of the first row is raw whatever the
  // filter: its left, up and up-left neighbours are zero). Rendered
  // with a white page behind, they had white corners.
  it.each(["icon-192.png", "icon-512.png"])(
    "public/%s is RGBA with a transparent top-left corner",
    (file) => {
      const bytes = readFileSync(join(ROOT, "public", file));
      expect(bytes[24], "bit depth").toBe(8);
      expect(bytes[25], "colour type (6 = RGBA)").toBe(6);
      expect(pngFirstPixel(bytes)).toEqual([0, 0, 0, 0]);
    },
  );

  it("the maskable icon is opaque to its edges (the launcher cuts the shape)", () => {
    const bytes = readFileSync(join(ROOT, "public", "icon-maskable.png"));
    const [, , , alpha] =
      bytes[25] === 6 ? pngFirstPixel(bytes) : [0, 0, 0, 255];
    expect(alpha).toBe(255);
  });
});

/** RGBA of pixel (0, 0) of an 8-bit RGBA PNG: IDAT chunks inflated, filter byte skipped. */
function pngFirstPixel(bytes: Buffer): [number, number, number, number] {
  const idat: Buffer[] = [];
  let at = 8;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString("latin1");
    if (type === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + length));
    if (type === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return [raw[1]!, raw[2]!, raw[3]!, raw[4]!];
}
