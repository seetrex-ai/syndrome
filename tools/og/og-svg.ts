// Source of public/og.png (tasks/plans/phase2.md D14): the
// OpenGraph card as an SVG, generated from the geometry of docs/spec.md §3 and the
// LIGHT side of the colour tokens of src/index.css and src/ui/grid/grid.css, so
// the card follows the palette. Regenerate the SVG with
//
//   node tools/og/og-svg.ts            (Node 24 strips the types itself)
//
// and the PNG by rendering tools/og/og.svg at exactly 1200 x 630 CSS px in
// Chromium (viewport 1200 x 630, device scale factor 1). Playwright is not a
// dependency of this repo; the exact one-off command, with
// the system Chrome through npx, from the repo root (absolute file:// URL):
//
//   npx playwright screenshot --browser chromium --channel chrome --viewport-size 1200,630 file:///C:/dev/SEEQuant/tools/og/og.svg public/og.png
//
// (drop `--channel chrome` to use Playwright's own Chromium, `npx playwright
// install chromium` first). tests/intent/opengraph.test.ts reads the IHDR of
// the result: 1200 x 630 or red. The PWA icons are rendered from the brand
// mark (design.md D7) by tools/og/render-icons.mjs, from the repo root:
//
//   node tools/og/render-icons.mjs
//
// (Playwright's API with the system Chrome and `omitBackground: true`: the
// favicon at 192 and 512 keeps the rounded badge's corners TRANSPARENT, and
// the maskable variant, tools/og/icon-maskable.svg with the mark inside the
// safe zone, is opaque to its edges at 512. The `playwright screenshot` CLI
// paints white behind the page (white corners);
// tests/intent/opengraph.test.ts reads the colour type and the corner pixel.)
// The picture: a d = 5 rotated surface code with two X errors on (2, 1) and
// (2, 2), their two Z defects at plaquettes (2, 0) and (2, 2) (the shared
// plaquette (1, 1) sees both and stays quiet), the matching edge between them
// and the correction chain through the two qubits.

// tests/intent/opengraph.test.ts imports ogSvg() and compares it with the
// committed tools/og/og.svg: a token or geometry change that is not
// regenerated is red (the script had kept a removed token).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/** Light side of every `--token: light-dark(#light, #dark)` of the given sheets. */
function lightTokens(...sheets: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sheet of sheets) {
    const css = readFileSync(join(root, sheet), "utf8");
    for (const m of css.matchAll(
      /(--[\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*#[0-9a-f]{6}\)/gi,
    )) {
      out[m[1]!] = m[2]!;
    }
  }
  return out;
}

/** The card as SVG text, from the current light tokens. */
export function ogSvg(): string {
  const c = lightTokens("src/index.css", "src/ui/grid/grid.css");
  const need = (name: string): string => {
    const value = c[name];
    if (value === undefined) throw new Error(`token ${name} not found`);
    return value;
  };

  const D = 5;
  const STEP = 90;
  const X0 = 120;
  const Y0 = 115;
  const px = (col: number): number => X0 + col * STEP;
  const py = (row: number): number => Y0 + row * STEP;

  // docs/spec.md §3: the plaquette between rows i, i+1 and columns j, j+1 is Z when
  // (i + j) is even, X when odd; the boundary rows i = -1 and i = d-1 keep only
  // the X ones, the boundary columns j = -1 and j = d-1 only the Z ones.
  const typeOf = (i: number, j: number): "Z" | "X" =>
    (i + j) % 2 === 0 ? "Z" : "X";

  const errors = new Set(["2,1", "2,2"]);
  // Z plaquettes that see an odd number of the X errors.
  const defects = new Set<string>();
  for (let i = 0; i < D - 1; i++) {
    for (let j = 0; j < D - 1; j++) {
      if (typeOf(i, j) !== "Z") continue;
      let parity = 0;
      for (const [r, col] of [
        [i, j],
        [i, j + 1],
        [i + 1, j],
        [i + 1, j + 1],
      ]) {
        if (errors.has(`${r},${col}`)) parity ^= 1;
      }
      if (parity === 1) defects.add(`${i},${j}`);
    }
  }
  if ([...defects].sort().join(" ") !== "2,0 2,2") {
    throw new Error(`unexpected defects: ${[...defects].join(" ")}`);
  }

  const fill = (type: "Z" | "X"): string =>
    need(type === "Z" ? "--plaquette-z" : "--plaquette-x");

  const parts: string[] = [];
  // Boundary plaquettes: half discs outside the lattice.
  for (let j = 0; j < D - 1; j++) {
    const cx = (px(j) + px(j + 1)) / 2;
    const r = STEP / 2;
    if (typeOf(-1, j) === "X") {
      parts.push(
        `<path d="M${px(j)} ${py(0)} A${r} ${r} 0 0 1 ${px(j + 1)} ${py(0)} Z" fill="${fill("X")}" stroke="${need("--plaquette-stroke")}"/>`,
      );
    }
    if (typeOf(D - 1, j) === "X") {
      parts.push(
        `<path d="M${px(j + 1)} ${py(D - 1)} A${r} ${r} 0 0 1 ${px(j)} ${py(D - 1)} Z" fill="${fill("X")}" stroke="${need("--plaquette-stroke")}"/>`,
      );
    }
    void cx;
  }
  for (let i = 0; i < D - 1; i++) {
    const r = STEP / 2;
    if (typeOf(i, -1) === "Z") {
      parts.push(
        `<path d="M${px(0)} ${py(i + 1)} A${r} ${r} 0 0 1 ${px(0)} ${py(i)} Z" fill="${fill("Z")}" stroke="${need("--plaquette-stroke")}"/>`,
      );
    }
    if (typeOf(i, D - 1) === "Z") {
      parts.push(
        `<path d="M${px(D - 1)} ${py(i)} A${r} ${r} 0 0 1 ${px(D - 1)} ${py(i + 1)} Z" fill="${fill("Z")}" stroke="${need("--plaquette-stroke")}"/>`,
      );
    }
  }
  // Interior plaquettes, defects on top with their stroke.
  for (let i = 0; i < D - 1; i++) {
    for (let j = 0; j < D - 1; j++) {
      const defect = defects.has(`${i},${j}`);
      parts.push(
        `<rect x="${px(j)}" y="${py(i)}" width="${STEP}" height="${STEP}" fill="${defect ? need("--defect") : fill(typeOf(i, j))}" stroke="${defect ? need("--defect-stroke") : need("--plaquette-stroke")}" stroke-width="${defect ? 2.5 : 1}"/>`,
      );
    }
  }
  // Matching edge between the two defect centres, correction chain on the qubits:
  // at full opacity, dimmed by token like grid.css.
  const [a, b] = [...defects].sort().map((k) => k.split(",").map(Number));
  parts.push(
    `<line x1="${px(a![1]! + 0.5)}" y1="${py(a![0]! + 0.5)}" x2="${px(b![1]! + 0.5)}" y2="${py(b![0]! + 0.5)}" stroke="${need("--match")}" stroke-width="2.5" stroke-dasharray="8 7"/>`,
  );
  parts.push(
    `<line x1="${px(1)}" y1="${py(2)}" x2="${px(2)}" y2="${py(2)}" stroke="${need("--chain-x")}" stroke-width="9" stroke-linecap="round"/>`,
  );
  // Qubits.
  for (let row = 0; row < D; row++) {
    for (let col = 0; col < D; col++) {
      const error = errors.has(`${row},${col}`);
      parts.push(
        `<circle cx="${px(col)}" cy="${py(row)}" r="15" fill="${error ? need("--pauli-x") : need("--qubit")}" stroke="${need("--qubit-stroke")}" stroke-width="2"/>`,
      );
      if (error) {
        parts.push(
          `<text x="${px(col)}" y="${py(row) + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="${need("--on-pauli")}">X</text>`,
        );
      }
    }
  }

  // The brand mark of src/ui/brand/Brand.tsx (two Z plaquettes in the accent,
  // two X plaquettes, nine qubits), beside the wordmark; the display face is
  // the self-hosted Space Grotesk (design.md D3), by a path relative to this
  // file, so the render from file:// finds it.
  const mark = (x: number, y: number, s: number): string => {
    const r = (col: number, row: number, type: "Z" | "X"): string =>
      `<rect x="${x + col * s}" y="${y + row * s}" width="${s}" height="${s}" rx="${s * 0.15}" fill="${type === "Z" ? need("--accent") : need("--plaquette-x")}"/>`;
    const dots = [0, 1, 2].flatMap((row) =>
      [0, 1, 2].map(
        (col) =>
          `<circle cx="${x + col * s}" cy="${y + row * s}" r="${s * 0.24}" fill="${need("--fg")}"/>`,
      ),
    );
    return [
      r(0, 0, "Z"),
      r(1, 0, "X"),
      r(0, 1, "X"),
      r(1, 1, "Z"),
      ...dots,
    ].join("\n    ");
  };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <defs>
    <style>@font-face { font-family: "Space Grotesk"; src: url("../../public/fonts/space-grotesk-var.woff2") format("woff2"); font-weight: 300 700; }</style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${need("--surface")}"/>
      <stop offset="1" stop-color="${need("--bg")}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g>
    ${parts.join("\n    ")}
  </g>
  <g>
    ${mark(592, 166, 20)}
  </g>
  <text x="652" y="200" font-size="34" font-family="'Space Grotesk', system-ui, sans-serif" font-weight="600" fill="${need("--muted")}">SEEQuant</text>
  <text x="580" y="290" font-size="92" font-family="'Space Grotesk', system-ui, sans-serif" font-weight="700" letter-spacing="-2" fill="${need("--fg")}">Syndrome</text>
  <text x="580" y="370" font-size="42" font-family="'Space Grotesk', system-ui, sans-serif" font-weight="600" letter-spacing="-1" fill="${need("--fg")}">More qubits, fewer errors.</text>
  <text x="580" y="430" font-size="26" fill="${need("--muted")}">Play with the surface code and watch</text>
  <text x="580" y="466" font-size="26" fill="${need("--muted")}">the logical error rate fall as the distance grows.</text>
  <text x="580" y="540" font-size="26" fill="${need("--accent")}">seequant.app/syndrome</text>
</svg>
`;
  return svg;
}

// Run as a script (`node tools/og/og-svg.ts`): write the file.
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const svg = ogSvg();
  writeFileSync(join(here, "og.svg"), svg);
  console.log(`tools/og/og.svg written (${svg.length} bytes)`);
}
