// Fingerprint of the VISIBLE strings of a locale file: the sha256 of the
// file's JSON with the `a11y` branch (aria-only names, never painted) removed
// and the keys sorted at every level, so the hash depends on the texts and
// not on the order or the whitespace of the file.
//
// tests/intent/design-conventions.test.tsx (test_intent_no_visible_text_changed)
// compares the working locales with tests/fixtures/locales-main.sha256.json,
// the fingerprints of `main`'s locales at the start of the visual redesign,
// without touching git. When a text change IS intended, refresh the fixture
// from the branch that carries it, the one way (the path argument; Node 24
// strips the types itself):
//
//   node tools/locales/fingerprint.ts tests/fixtures/locales-main.sha256.json
//
// and say so in the commit. Without the argument it prints the fingerprints.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCALES = ["en", "es"] as const;

/** JSON with keys sorted at every depth; arrays and scalars as they are. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** sha256 (hex) of the locale's visible strings: everything but `a11y`. */
export function visibleFingerprint(json: string): string {
  const data = JSON.parse(json) as Record<string, unknown>;
  const { a11y: _aria, ...visible } = data;
  void _aria;
  return createHash("sha256").update(canonical(visible)).digest("hex");
}

export function fingerprints(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of LOCALES) {
    out[code] = visibleFingerprint(
      readFileSync(join(root, "src", "locales", `${code}.json`), "utf8"),
    );
  }
  return out;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const text = `${JSON.stringify(fingerprints(root), null, 2)}\n`;
  const target = process.argv[2];
  if (target === undefined) process.stdout.write(text);
  else writeFileSync(target, text);
}
