// Renders the PWA icons from the brand SVGs with a TRANSPARENT background
// (the Playwright CLI paints white under the rounded
// badge, so icon-192/512 had white corners). One-off, from the repo root:
//
//   node tools/og/render-icons.mjs
//
// Playwright (with its Chromium) comes with the video tool's dependencies.
// The maskable icon keeps its own square background (the launcher masks it).
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const JOBS = [
  ["public/favicon.svg", 192, "public/icon-192.png"],
  ["public/favicon.svg", 512, "public/icon-512.png"],
  ["tools/og/icon-maskable.svg", 512, "public/icon-maskable.png"],
];

// The system Chrome, as tools/video does (no Playwright browser download).
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const [source, size, target] of JOBS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(resolve(source)).href);
    await page.screenshot({ path: target, omitBackground: true });
    await page.close();
    console.log(`${target} (${size} x ${size}, transparent background)`);
  }
} finally {
  await browser.close();
}
