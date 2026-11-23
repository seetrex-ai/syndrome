// jsdom resolves neither `light-dark()` nor `color-scheme`, so under Vitest
// `getComputedStyle(document.body).backgroundColor` paints nothing. This stub
// does what Chrome does with src/index.css: the body's background is the side
// of `--bg` chosen by `<html data-theme>` ("light"/"dark" force it) or, with
// no attribute, by `prefers-color-scheme` (window.matchMedia). Both sides are
// read from the stylesheet, so the tests follow a palette change.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

export const BG = ((): { light: string; dark: string } => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const m = /--bg:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(css);
  if (m === null) throw new Error("--bg: light-dark(…) not found in index.css");
  return { light: m[1]!, dark: m[2]! };
})();

/** `#rrggbb` as the `rgb(r, g, b)` a computed style serialises. */
export const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

/**
 * Install the stub for one test: the OS preference is `osDark`; the body's
 * computed background follows the forced theme first. Undone by
 * `vi.restoreAllMocks()` + `vi.unstubAllGlobals()` (call both in afterEach).
 */
export function stubPaintedBody(osDark: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (query: string): MediaQueryList =>
        ({
          matches: osDark && query.includes("dark"),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    ),
  );
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    if (el !== document.body) return original(el, pseudo);
    const forced = document.documentElement.getAttribute("data-theme");
    const dark = forced === "dark" || (forced !== "light" && osDark);
    return {
      backgroundColor: rgb(dark ? BG.dark : BG.light),
    } as CSSStyleDeclaration;
  });
}
