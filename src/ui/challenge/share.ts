// Sharing a puzzle (tasks/plans/phase2.md D11; docs/spec.md §4.6 "by image or by
// URL"). The URL is the hash link of puzzle.ts. The image is the grid's own
// <svg>, serialized with the styles the browser computed inlined on every
// element (the stylesheet is not part of the file), rasterised through <img>
// and <canvas>; no dependency. Web Share with the file where the browser can
// (phones), a download otherwise.

import { encodePuzzle, HASH_PREFIX, type Puzzle } from "./puzzle";

/**
 * `<base>/#c=<puzzle>`; `base` is `location.origin + location.pathname`. The
 * path is normalised to its directory: a trailing `index.html` is dropped and
 * a trailing slash ensured, so a page served as `/index.html` shares `/#c=…`.
 */
export function puzzleUrl(base: string, puzzle: Puzzle): string {
  const directory = base.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
  return `${directory}/${HASH_PREFIX}${encodePuzzle(puzzle)}`;
}

// Presentation constants of the serializer: the style properties copied from
// the computed style onto each element so the image needs no stylesheet.
// Namespaces, MIME types, element names and the canvas context id are written
// inline where the DOM takes them (tests/intent/i18n-literal-text exempts
// those arguments).
// prettier-ignore
const INLINED = "fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin opacity font-size font-weight font-family".split(" "); // i18n-exempt: CSS properties inlined into the exported SVG

/** A computed background that paints nothing (jsdom, or no stylesheet). */
const UNPAINTED = /^(?:|transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/;

/**
 * Background colour of the exported image: the page's own, as the browser
 * painted `<body>` (`--bg` of index.css resolved through `color-scheme`, so a
 * forced `<html data-theme>` and the OS preference agree with the grid colours
 * the serializer inlines, which come from the same computed
 * styles). White only when nothing painted the page (tests without a stylesheet).
 */
export function pageBackground(doc: Document = document): string {
  const painted = getComputedStyle(doc.body).backgroundColor;
  return UNPAINTED.test(painted.trim()) ? "#ffffff" : painted; // i18n-exempt: fallback canvas colour
}

/** Width of the exported SVG in CSS px (the PNG is `scale` times that). */
export const IMAGE_WIDTH = 480;

/**
 * A standalone SVG document of `svg`: a deep clone with every element's
 * computed fill, stroke, widths, dashes, opacity and font inlined as its own
 * style, `class` attributes dropped, an explicit size and a background rect.
 * The live element is not touched.
 */
export function serializeGridSvg(
  svg: SVGSVGElement,
  background: string,
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sources = svg.querySelectorAll("*");
  const targets = clone.querySelectorAll("*");
  for (let i = 0; i < sources.length; i++) {
    const computed = getComputedStyle(sources[i]!);
    const target = targets[i] as HTMLElement | SVGElement;
    for (const property of INLINED) {
      const value = computed.getPropertyValue(property);
      if (value !== "") target.style.setProperty(property, value);
    }
    target.removeAttribute("class");
  }
  // Tooltips are not painted; the serializer declares the namespace itself
  // (an explicit xmlns attribute would be emitted twice: not well-formed).
  for (const title of clone.querySelectorAll("title")) title.remove();
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  const [, , w, h] = (svg.getAttribute("viewBox") ?? "0 0 1 1")
    .split(/\s+/)
    .map(Number);
  const width = IMAGE_WIDTH;
  const height = Math.round((IMAGE_WIDTH * (h ?? 1)) / (w ?? 1));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(-1e4));
  rect.setAttribute("y", String(-1e4));
  rect.setAttribute("width", String(2e4));
  rect.setAttribute("height", String(2e4));
  rect.setAttribute("fill", background);
  clone.insertBefore(rect, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("the SVG image could not be decoded"));
    image.src = url;
  });
}

/** PNG of the grid at `scale` × IMAGE_WIDTH px (2 for a crisp share on phones). */
export async function gridToPngBlob(
  svg: SVGSVGElement,
  background: string,
  scale = 2,
): Promise<Blob> {
  const text = serializeGridSvg(svg, background);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2D canvas context");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob === null
            ? reject(new Error("toBlob returned null"))
            : resolve(blob),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The rejection Web Share gives when the user closes the share sheet. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Web Share with the file where supported (phones); a download named
 * `fileName` otherwise, and also when the share itself is refused (a browser
 * that cannot share this file after all). Closing the share sheet is the
 * user's choice, not a failure: nothing happens.
 *
 * Resolves true when the image was shared or downloaded, false when the user
 * closed the share sheet: only a completed share counts as `challenge_shared`
 * (tasks/plans/analytics.md D14).
 */
export async function shareOrDownload(
  blob: Blob,
  fileName: string,
): Promise<boolean> {
  const file = new File([blob], fileName, { type: "image/png" });
  const data = { files: [file] };
  if (navigator.canShare?.(data) === true) {
    try {
      await navigator.share(data);
      return true;
    } catch (error) {
      if (isAbort(error)) return false;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return true;
}
